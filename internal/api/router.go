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
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-DBLENS-DSN", "X-DBLENS-READONLY"},
		ExposedHeaders:   []string{"Link", "X-Total-Count"},
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
	api.Get("/profiles/global", h.ListGlobalProfiles)

	api.Post("/connections/test", h.TestConnection)
	api.Get("/connections/{connId}/databases", h.GetDatabases)
	api.Post("/connections/{connId}/databases/select", h.SelectDatabase)
	api.Get("/connections/{connId}/schemas", h.GetSchemas)
	api.Get("/connections/{connId}/tables", h.GetTables)
	api.Get("/connections/{connId}/tables/{table}", h.GetTableDetails)
	api.Get("/connections/{connId}/tables/{table}/ddl", h.GetTableDDL)
	api.Post("/connections/{connId}/tables/{table}/alter-preview", h.AlterTablePreview)
	api.Post("/connections/{connId}/tables/{table}/alter", h.AlterTableApply)
	api.Post("/connections/{connId}/tables/{table}/data", h.QueryTableData)
	api.Post("/connections/{connId}/query", h.ExecuteQuery)
	api.Post("/connections/{connId}/explain", h.ExplainQuery)
	api.Post("/connections/{connId}/databases/{db}/explain", h.ExplainQuery)
	api.Get("/connections/{connId}/assistant/schema", h.GetAssistantSchema)
	api.Post("/connections/{connId}/assistant/prompt", h.BuildAssistantPrompt)
	api.Post("/connections/{connId}/assistant/generate", h.GenerateSQL)
	api.Post("/connections/{connId}/assistant/fix", h.FixSQL)
	api.Post("/connections/{connId}/assistant/explain", h.ExplainSQL)
	api.Post("/connections/{connId}/mutate", h.MutateRow)
	api.Post("/connections/{connId}/batch-insert", h.BatchInsert)
	api.Get("/connections/{connId}/erd", h.GetERDData)
	api.Get("/connections/{connId}/export", h.ExportTable)
	api.Post("/connections/{connId}/mask/detect", h.DetectMaskPII)
	api.Post("/connections/{connId}/mask/preview", h.PreviewMaskData)
	api.Post("/connections/{connId}/import/csv", h.ImportCSV)
	api.Post("/connections/{connId}/import/sql", h.ImportSQL)
	api.Get("/connections/{connId}/dump", h.DumpDatabase)
	api.Post("/connections/{connId}/restore", h.RestoreDatabase)
	api.Post("/connections/{connId}/diff", h.DiffSchemas)
	api.Post("/connections/{connId}/diff/apply", h.ApplyDiff)
	api.Get("/connections/{connId}/processes", h.GetProcesses)
	api.Post("/connections/{connId}/processes/kill", h.KillProcess)
	api.Get("/connections/{connId}/health", h.GetDatabaseHealth)
	api.Get("/connections/{connId}/privileges", h.GetPrivileges)
	api.Post("/connections/{connId}/privileges/preview", h.PreviewPrivileges)
	api.Post("/connections/{connId}/privileges/apply", h.ApplyPrivileges)
	api.Get("/connections/{connId}/rest/{table}", h.RestGet)
	api.Get("/connections/{connId}/rest/{schema}/{table}", h.RestGet)
	api.Post("/connections/{connId}/rest/{table}", h.RestPost)
	api.Post("/connections/{connId}/rest/{schema}/{table}", h.RestPost)
	api.Patch("/connections/{connId}/rest/{table}", h.RestPatch)
	api.Patch("/connections/{connId}/rest/{schema}/{table}", h.RestPatch)
	api.Delete("/connections/{connId}/rest/{table}", h.RestDelete)
	api.Delete("/connections/{connId}/rest/{schema}/{table}", h.RestDelete)

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
