package api

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

type RouterConfig struct {
	AuthPassword string
	StaticDir    string
	EmbedFS      fs.FS
}

func SetupRouter(h *Handler, cfg RouterConfig) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	if cfg.AuthPassword != "" {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, pass, ok := r.BasicAuth()
				if !ok || pass != cfg.AuthPassword {
					w.Header().Set("WWW-Authenticate", `Basic realm="DBLens"`)
					http.Error(w, "Unauthorized", http.StatusUnauthorized)
					return
				}
				next.ServeHTTP(w, r)
			})
		})
	}

	// ── API routes FIRST (before catch-all) ──
	api := chi.NewRouter()
	api.Get("/profiles", h.ListProfiles)
	api.Post("/profiles", h.CreateProfile)
	api.Put("/profiles/{id}", h.UpdateProfile)
	api.Delete("/profiles/{id}", h.DeleteProfile)

	api.Get("/connections", h.ListConnections)
	api.Post("/connections", h.AddConnection)
	api.Post("/connections/test", h.TestConnection)
	api.Delete("/connections/{connId}", h.RemoveConnection)
	api.Get("/connections/{connId}/ping", h.PingConnection)
	api.Get("/connections/{connId}/databases", h.GetDatabases)
	api.Post("/connections/{connId}/databases/select", h.SelectDatabase)
	api.Get("/connections/{connId}/schemas", h.GetSchemas)
	api.Get("/connections/{connId}/tables", h.GetTables)
	api.Get("/connections/{connId}/tables/{table}", h.GetTableDetails)
	api.Post("/connections/{connId}/tables/{table}/data", h.QueryTableData)
	api.Post("/connections/{connId}/query", h.ExecuteQuery)
	api.Post("/connections/{connId}/mutate", h.MutateRow)
	api.Get("/connections/{connId}/erd", h.GetERDData)

	r.Mount("/api", api)

	// ── SPA fallback (skip /api/ entirely) ──
	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		// Never serve static files for API routes
		reqPath := strings.TrimPrefix(r.URL.Path, "/")
		if strings.HasPrefix(reqPath, "api/") {
			http.NotFound(w, r)
			return
		}
		if reqPath == "" {
			reqPath = "index.html"
		}

		var served bool

		if cfg.StaticDir != "" {
			diskPath := filepath.Join(cfg.StaticDir, reqPath)
			if fileInfo, err := os.Stat(diskPath); err == nil && !fileInfo.IsDir() {
				http.ServeFile(w, r, diskPath)
				served = true
			}
			if !served {
				indexPath := filepath.Join(cfg.StaticDir, "index.html")
				if _, err := os.Stat(indexPath); err == nil {
					http.ServeFile(w, r, indexPath)
					served = true
				}
			}
		}

		if !served {
			defaultDiskDir := "./web/dist"
			diskPath := filepath.Join(defaultDiskDir, reqPath)
			if fileInfo, err := os.Stat(diskPath); err == nil && !fileInfo.IsDir() {
				http.ServeFile(w, r, diskPath)
				served = true
			}
			if !served {
				defaultIndex := filepath.Join(defaultDiskDir, "index.html")
				if _, err := os.Stat(defaultIndex); err == nil {
					http.ServeFile(w, r, defaultIndex)
					served = true
				}
			}
		}

		if !served && cfg.EmbedFS != nil {
			if f, err := cfg.EmbedFS.Open(reqPath); err == nil {
				if fi, err := f.Stat(); err == nil && !fi.IsDir() {
					_ = f.Close()
					http.FileServer(http.FS(cfg.EmbedFS)).ServeHTTP(w, r)
					return
				}
				_ = f.Close()
			}
			if idxData, err := fs.ReadFile(cfg.EmbedFS, "index.html"); err == nil {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				_, _ = w.Write(idxData)
				return
			}
		}

		if !served {
			http.NotFound(w, r)
		}
	})

	return r
}
