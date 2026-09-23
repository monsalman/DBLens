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
	// Capture the true socket peer BEFORE RealIP rewrites r.RemoteAddr from the
	// spoofable X-Forwarded-For header, so audit actor_ip is never attacker-chosen.
	r.Use(CaptureTruePeer)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-DBLENS-DSN", "X-DBLENS-READONLY", "X-DBLENS-SSH-TUNNEL", "X-DBLENS-ENVIRONMENT"},
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

	// Apply audit middleware BEFORE routes (chi requirement)
	if h.auditLogger != nil {
		api.Use(AuditMiddleware(h.auditLogger))
	}

	api.Get("/profiles/global", h.ListGlobalProfiles)

	api.Post("/tunnel/test", h.TestTunnelHandler)
	api.Post("/connections/test", h.TestConnection)
	api.Post("/connect", h.TestConnection)
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

	// ── Webhooks & Change Event Simulator ──
	api.Get("/connections/{connId}/webhooks", h.GetWebhooks)
	api.Post("/connections/{connId}/webhooks", h.CreateWebhook)
	api.Put("/connections/{connId}/webhooks/{id}", h.UpdateWebhook)
	api.Delete("/connections/{connId}/webhooks/{id}", h.DeleteWebhook)
	api.Get("/connections/{connId}/webhooks/deliveries", h.GetWebhookDeliveries)
	api.Post("/connections/{connId}/webhooks/deliveries/{id}/retry", h.RetryWebhookDelivery)
	api.Post("/connections/{connId}/webhooks/simulate", h.SimulateWebhook)

	// ── Multi-Connection Query Federation & Cross-Database Runner ──
	api.Post("/federation/query", h.FederatedQueryHandler)
	api.Post("/federation/pipe", h.DataPipeHandler)
	api.Post("/federation/reconcile", h.ReconcileHandler)

	// ── Visual Spatial & PostGIS / GIS Map Studio ──
	api.Post("/connections/{connId}/gis/parse", h.ParseGISData)
	api.Post("/connections/{connId}/gis/convert", h.ConvertGISData)
	api.Post("/gis/parse", h.ParseGISData)
	api.Post("/gis/convert", h.ConvertGISData)

	// ── Automated Schema Migration Generator & Changelog Hub ──
	api.Get("/connections/{connId}/migrations", h.GetMigrations)
	api.Post("/connections/{connId}/migrations/init", h.InitMigrationTracker)
	api.Post("/connections/{connId}/migrations/generate", h.GenerateMigration)
	api.Post("/connections/{connId}/migrations/apply", h.ApplyMigration)
	api.Post("/connections/{connId}/migrations/rollback", h.RollbackMigration)

	// ── Feature-29: Stored Procedure, Function, View & Trigger Studio ──
	api.Get("/connections/{connId}/routines", h.GetRoutines)
	api.Get("/connections/{connId}/routines/{schema}/{name}", h.GetRoutineDetail)
	api.Post("/connections/{connId}/routines/invoke", h.InvokeRoutine)
	api.Post("/connections/{connId}/routines/save", h.SaveRoutine)
	api.Delete("/connections/{connId}/routines/{schema}/{name}", h.DeleteRoutine)
	api.Get("/connections/{connId}/triggers", h.GetTriggers)
	api.Post("/connections/{connId}/triggers/toggle", h.ToggleTrigger)
	api.Delete("/connections/{connId}/triggers/{schema}/{name}", h.DeleteTrigger)
	api.Get("/connections/{connId}/views", h.GetViews)
	api.Post("/connections/{connId}/views/refresh", h.RefreshView)

	// ── Feature-30: Scheduled SQL Cron Jobs & Database Heartbeat Alerts ──
	api.Get("/cron/jobs", h.ListCronJobs)
	api.Post("/cron/jobs", h.CreateCronJob)
	api.Put("/cron/jobs/{id}", h.UpdateCronJob)
	api.Delete("/cron/jobs/{id}", h.DeleteCronJob)
	api.Post("/cron/jobs/{id}/run", h.RunCronJobNow)
	api.Get("/cron/jobs/{id}/history", h.GetCronJobHistory)

	// ── Feature-31: Immutable Query Audit Log & Compliance Trail ──
	api.Get("/audit/entries", h.ListAuditLog)
	api.Get("/audit/verify", h.VerifyAuditChain)
	api.Get("/audit/export.csv", h.ExportAuditCSV)

	// ── Feature-32: Live Table Feed & WAL Change Stream Viewer ──
	api.Get("/connections/{connId}/live-feed", h.LiveTableFeed)
	api.Get("/live-feed/status", h.LiveFeedStatus)

	// ── Feature-33: Shareable Query Library & Team Playbook ──
	api.Get("/playbook/entries", h.PlaybookList)
	api.Post("/playbook/entries", h.PlaybookCreate)
	api.Get("/playbook/entries/{id}", h.PlaybookGet)
	api.Put("/playbook/entries/{id}", h.PlaybookUpdate)
	api.Delete("/playbook/entries/{id}", h.PlaybookDelete)
	api.Get("/playbook/export.json", h.PlaybookExportJSON)
	api.Get("/playbook/export.md", h.PlaybookExportMD)
	api.Post("/playbook/import", h.PlaybookImport)
	api.Get("/playbook/entries/{id}/share", h.PlaybookShare)

	// ── Feature-34: Database Table Annotations & Collaborative Notes ──
	api.Get("/annotations", h.AnnotationsList)
	api.Post("/annotations", h.AnnotationCreate)
	api.Put("/annotations/{id}", h.AnnotationUpdate)
	api.Delete("/annotations/{id}", h.AnnotationDelete)
	api.Get("/annotations/export.md", h.AnnotationsExportMD)

	// ── Feature-35: Connection Health Dashboard & Latency Monitor ──
	api.Get("/health/connections", h.HealthConnections)
	api.Get("/health/stream", h.HealthStream)

	// ── Feature-36: Column Data Profiling & Dataset Quality Studio ──
	api.Post("/connections/{connId}/profile", h.ProfileTable)
	api.Post("/connections/{connId}/profile/suggest", h.ProfileSuggest)
	api.Get("/connections/{connId}/profile/export.md", h.ProfileExportMD)
	api.Post("/connections/{connId}/profile/export.md", h.ProfileExportMD)
	api.Post("/connections/{connId}/profile/compare", h.ProfileCompare)

	// ── Feature-37: Query Result Materialization & Scratch Table Workspace ──
	api.Post("/connections/{connId}/materialize/preview", h.MaterializePreview)
	api.Post("/connections/{connId}/materialize", h.MaterializeExecute)
	api.Get("/connections/{connId}/materialize/scratch", h.ScratchList)
	api.Delete("/connections/{connId}/materialize/scratch/{schema}/{table}", h.ScratchDelete)
	api.Delete("/connections/{connId}/materialize/scratch/{table}", h.ScratchDelete)
	api.Post("/connections/{connId}/materialize/scratch/promote", h.ScratchPromote)
	api.Post("/connections/{connId}/materialize/scratch/expire", h.ScratchExpire)

	// ── Feature-38: In-Editor SQL Static Analyzer & Quality Gate ─────────
	api.Post("/connections/{connId}/analyze", h.AnalyzeSQLHandler)
	api.Post("/connections/{connId}/analyze/gate", h.AnalyzeGateHandler)
	api.Post("/analyze", h.AnalyzeSQLHandler)
	api.Post("/analyze/gate", h.AnalyzeGateHandler)
	api.Get("/analyze/rules", h.GetAnalyzerRulesHandler)
	api.Put("/analyze/rules", h.UpdateAnalyzerRulesHandler)

	// ── Feature-39: Pivot & Cross-Tab Result Studio ─────────────────────
	api.Post("/connections/{connId}/pivot/pushdown", h.PivotPushdownHandler)
	api.Post("/connections/{connId}/pivot/run", h.PivotRunHandler)
	api.Post("/connections/{connId}/pivot/export.csv", h.PivotExportCSVHandler)
	api.Post("/connections/{connId}/pivot/export.md", h.PivotExportMDHandler)
	api.Post("/pivot/transform", h.PivotTransformHandler)
	api.Post("/pivot/export.csv", h.PivotExportCSVHandler)
	api.Post("/pivot/export.md", h.PivotExportMDHandler)

	// ── Feature-40: Schema Object Impact Analyzer & Safe-Drop Planner ────
	api.Get("/connections/{connId}/impact", h.GetImpactHandler)
	api.Post("/connections/{connId}/impact/plan", h.CreateImpactPlanHandler)
	api.Post("/connections/{connId}/impact/rename", h.CreateImpactRenameHandler)
	api.Get("/connections/{connId}/impact/export.md", h.ExportImpactMDHandler)
	api.Post("/connections/{connId}/impact/export.md", h.ExportImpactMDHandler)

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
