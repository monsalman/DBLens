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

	r.Route("/api", func(api chi.Router) {
		api.Get("/connections", h.ListConnections)
		api.Post("/connections", h.AddConnection)
		api.Delete("/connections/{connId}", h.RemoveConnection)
		api.Get("/connections/{connId}/ping", h.PingConnection)
		api.Get("/connections/{connId}/schemas", h.GetSchemas)
		api.Get("/connections/{connId}/tables", h.GetTables)
		api.Get("/connections/{connId}/tables/{table}", h.GetTableDetails)
		api.Post("/connections/{connId}/tables/{table}/data", h.QueryTableData)
		api.Post("/connections/{connId}/query", h.ExecuteQuery)
		api.Post("/connections/{connId}/mutate", h.MutateRow)
		api.Get("/connections/{connId}/erd", h.GetERDData)
	})

	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		reqPath := strings.TrimPrefix(r.URL.Path, "/")
		if reqPath == "" {
			reqPath = "index.html"
		}

		if cfg.StaticDir != "" {
			diskPath := filepath.Join(cfg.StaticDir, reqPath)
			if fileInfo, err := os.Stat(diskPath); err == nil && !fileInfo.IsDir() {
				http.ServeFile(w, r, diskPath)
				return
			}
			indexPath := filepath.Join(cfg.StaticDir, "index.html")
			if _, err := os.Stat(indexPath); err == nil {
				http.ServeFile(w, r, indexPath)
				return
			}
		}

		// Try current directory web/dist
		defaultDiskDir := "./web/dist"
		diskPath := filepath.Join(defaultDiskDir, reqPath)
		if fileInfo, err := os.Stat(diskPath); err == nil && !fileInfo.IsDir() {
			http.ServeFile(w, r, diskPath)
			return
		}
		defaultIndex := filepath.Join(defaultDiskDir, "index.html")
		if _, err := os.Stat(defaultIndex); err == nil {
			http.ServeFile(w, r, defaultIndex)
			return
		}

		if cfg.EmbedFS != nil {
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

		http.NotFound(w, r)
	})

	return r
}
