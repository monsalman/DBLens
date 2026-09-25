package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/seeder"
)

// SeederRunRequest specifies the payload for executing a seed run.
type SeederRunRequest struct {
	Plan    *seeder.SeedPlan       `json:"plan,omitempty"`
	Options *seeder.SeederOptions  `json:"options,omitempty"`
}

// SeederExportRequest specifies the payload for exporting standalone seed fixtures.
type SeederExportRequest struct {
	Format  string                 `json:"format,omitempty"` // "sql" or "json"
	Plan    *seeder.SeedPlan       `json:"plan,omitempty"`
	Options *seeder.SeederOptions  `json:"options,omitempty"`
}

// SeederPlanHandler introspects tables, resolves DAG order, and returns execution plan with preview.
// POST /api/connections/{connId}/seeder/plan
func (h *Handler) SeederPlanHandler(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var opts seeder.SeederOptions
	if r.Body != nil {
		r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
		_ = json.NewDecoder(r.Body).Decode(&opts)
	}

	plan, err := seeder.BuildPlan(r.Context(), entry.Driver, opts)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "failed to build seed plan: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, plan)
}

// SeederRunHandler executes synthetic data insertion in DAG order.
// Enforces Safe Mode rejection if connection is read-only or marked production.
// POST /api/connections/{connId}/seeder/run
func (h *Handler) SeederRunHandler(w http.ResponseWriter, r *http.Request) {
	// Safe Mode / Read-Only check
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) ||
		strings.EqualFold(r.Header.Get("X-DBLENS-ENVIRONMENT"), "production") ||
		isTruthy(r.URL.Query().Get("readonly")) {
		sendError(w, http.StatusForbidden, "Connection is read-only or in production environment. Seeding blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req SeederRunRequest
	if r.Body != nil {
		r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	plan := req.Plan
	if plan == nil {
		opts := seeder.SeederOptions{}
		if req.Options != nil {
			opts = *req.Options
		}
		p, err := seeder.BuildPlan(r.Context(), entry.Driver, opts)
		if err != nil {
			sendError(w, http.StatusInternalServerError, "failed to build seed plan: "+err.Error())
			return
		}
		plan = p
	}

	res, err := seeder.Run(r.Context(), entry.Driver, plan, nil)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "seeding failed: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, res)
}

// SeederExportHandler exports standalone SQL or JSON fixture without modifying database.
// POST /api/connections/{connId}/seeder/export
func (h *Handler) SeederExportHandler(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	format := strings.TrimSpace(r.URL.Query().Get("format"))

	var req SeederExportRequest
	if r.Body != nil {
		r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	if format == "" && req.Format != "" {
		format = req.Format
	}
	if format == "" {
		format = "sql"
	}
	format = strings.ToLower(format)

	plan := req.Plan
	if plan == nil {
		opts := seeder.SeederOptions{}
		if req.Options != nil {
			opts = *req.Options
		}
		p, err := seeder.BuildPlan(r.Context(), entry.Driver, opts)
		if err != nil {
			sendError(w, http.StatusInternalServerError, "failed to build seed plan: "+err.Error())
			return
		}
		plan = p
	}

	data, err := seeder.Export(r.Context(), entry.Driver, plan, format)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "export failed: "+err.Error())
		return
	}

	if format == "json" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=\"seed_fixture.json\"")
	} else {
		w.Header().Set("Content-Type", "application/sql; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=\"seed_fixture.sql\"")
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
