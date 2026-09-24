package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
	"github.com/dblens/dblens/internal/plandiff"
)

// ApplyIndexRequest payload for applying an index recommendation.
type ApplyIndexRequest struct {
	DDL      string `json:"ddl"`
	Table    string `json:"table,omitempty"`
	ReadOnly bool   `json:"readOnly,omitempty"`
}

func extractWhereClause(sql string) string {
	upper := strings.ToUpper(sql)
	idx := strings.Index(upper, " WHERE ")
	if idx == -1 {
		return ""
	}
	clause := sql[idx+7:]
	for _, stop := range []string{" ORDER ", " GROUP ", " LIMIT ", " OFFSET ", " HAVING ", ";"} {
		if stopIdx := strings.Index(strings.ToUpper(clause), stop); stopIdx != -1 {
			clause = clause[:stopIdx]
		}
	}
	return strings.TrimSpace(clause)
}

// ComparePlanDiffHandler compares baseline and candidate queries or plans.
// POST /api/connections/{connId}/plandiff/compare
func (h *Handler) ComparePlanDiffHandler(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var req plandiff.PlanDiffRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	dialect := req.Dialect
	if dialect == "" && entry.Driver != nil {
		dialect = entry.Driver.Dialect()
	}

	// Explain Baseline if raw SQL is provided and plan is missing
	if req.BaselinePlan == nil && strings.TrimSpace(req.BaselineSQL) != "" {
		opts := types.ExplainOptions{Analyze: true, Schema: req.Schema}
		plan, err := entry.Driver.ExplainQuery(r.Context(), req.BaselineSQL, opts)
		if err != nil {
			opts.Analyze = false
			plan, err = entry.Driver.ExplainQuery(r.Context(), req.BaselineSQL, opts)
		}
		if err != nil {
			sendError(w, http.StatusBadRequest, "Baseline explain failed: "+err.Error())
			return
		}
		req.BaselinePlan = plan
	}
	if req.BaselinePlan != nil && req.BaselinePlan.Root != nil && req.BaselinePlan.Root.Filter == "" && req.BaselineSQL != "" {
		req.BaselinePlan.Root.Filter = extractWhereClause(req.BaselineSQL)
	}

	// Explain Candidate if raw SQL is provided and plan is missing
	if req.CandidatePlan == nil && strings.TrimSpace(req.CandidateSQL) != "" {
		opts := types.ExplainOptions{Analyze: true, Schema: req.Schema}
		plan, err := entry.Driver.ExplainQuery(r.Context(), req.CandidateSQL, opts)
		if err != nil {
			opts.Analyze = false
			plan, err = entry.Driver.ExplainQuery(r.Context(), req.CandidateSQL, opts)
		}
		if err != nil {
			sendError(w, http.StatusBadRequest, "Candidate explain failed: "+err.Error())
			return
		}
		req.CandidatePlan = plan
	}
	if req.CandidatePlan != nil && req.CandidatePlan.Root != nil && req.CandidatePlan.Root.Filter == "" && req.CandidateSQL != "" {
		req.CandidatePlan.Root.Filter = extractWhereClause(req.CandidateSQL)
	}

	result := plandiff.ComparePlans(req.BaselinePlan, req.CandidatePlan, dialect, req.Schema)
	sendJSON(w, http.StatusOK, result)
}

// AdvisePlanDiffHandler generates heuristic index recommendations from a plan or query.
// POST /api/connections/{connId}/plandiff/advise
func (h *Handler) AdvisePlanDiffHandler(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var req plandiff.PlanDiffRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	dialect := req.Dialect
	if dialect == "" && entry.Driver != nil {
		dialect = entry.Driver.Dialect()
	}

	// If candidate plan is missing but SQL provided, explain candidate query
	if req.CandidatePlan == nil && strings.TrimSpace(req.CandidateSQL) != "" {
		opts := types.ExplainOptions{Analyze: true, Schema: req.Schema}
		plan, err := entry.Driver.ExplainQuery(r.Context(), req.CandidateSQL, opts)
		if err != nil {
			opts.Analyze = false
			plan, _ = entry.Driver.ExplainQuery(r.Context(), req.CandidateSQL, opts)
		}
		req.CandidatePlan = plan
	}
	if req.CandidatePlan != nil && req.CandidatePlan.Root != nil && req.CandidatePlan.Root.Filter == "" && req.CandidateSQL != "" {
		req.CandidatePlan.Root.Filter = extractWhereClause(req.CandidateSQL)
	}

	// If baseline plan is missing but SQL provided, explain baseline query
	if req.BaselinePlan == nil && strings.TrimSpace(req.BaselineSQL) != "" {
		opts := types.ExplainOptions{Analyze: true, Schema: req.Schema}
		plan, err := entry.Driver.ExplainQuery(r.Context(), req.BaselineSQL, opts)
		if err != nil {
			opts.Analyze = false
			plan, _ = entry.Driver.ExplainQuery(r.Context(), req.BaselineSQL, opts)
		}
		req.BaselinePlan = plan
	}
	if req.BaselinePlan != nil && req.BaselinePlan.Root != nil && req.BaselinePlan.Root.Filter == "" && req.BaselineSQL != "" {
		req.BaselinePlan.Root.Filter = extractWhereClause(req.BaselineSQL)
	}

	recs := plandiff.RecommendIndexes(req.CandidatePlan, req.BaselinePlan, dialect, req.Schema)
	sendJSON(w, http.StatusOK, recs)
}

// ApplyPlanIndexHandler creates an index recommendation on the database.
// Safe Mode / Read-Only protected.
// POST /api/connections/{connId}/plandiff/apply-index
func (h *Handler) ApplyPlanIndexHandler(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Index creation blocked by Safe Mode.")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req ApplyIndexRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if req.ReadOnly {
		sendError(w, http.StatusForbidden, "Connection is read-only. Index creation blocked by Safe Mode.")
		return
	}

	ddl := strings.TrimSpace(req.DDL)
	if ddl == "" {
		sendError(w, http.StatusBadRequest, "DDL statement is required")
		return
	}

	upper := strings.ToUpper(ddl)
	if !strings.HasPrefix(upper, "CREATE INDEX") && !strings.HasPrefix(upper, "CREATE UNIQUE INDEX") {
		sendError(w, http.StatusBadRequest, "Only CREATE INDEX or CREATE UNIQUE INDEX statements are permitted")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	if _, err := entry.Driver.ExecuteQuery(r.Context(), ddl); err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to apply index: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Index created successfully",
		"ddl":     ddl,
	})
}

// ExportPlanDiffMDHandler generates and downloads a structured markdown comparison report.
// GET /api/connections/{connId}/plandiff/export.md
// POST /api/connections/{connId}/plandiff/export.md
func (h *Handler) ExportPlanDiffMDHandler(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var diffResult *plandiff.PlanDiffResult

	if r.Method == http.MethodPost {
		bodyBytes, err := io.ReadAll(r.Body)
		if err == nil && len(bodyBytes) > 0 {
			// First try unmarshaling as full PlanDiffResult
			var full plandiff.PlanDiffResult
			if json.Unmarshal(bodyBytes, &full) == nil && full.Summary.BaselineTotalCost > 0 || full.Summary.CandidateTotalCost > 0 || full.AlignedTree != nil {
				diffResult = &full
			} else {
				// Otherwise unmarshal as PlanDiffRequest
				var req plandiff.PlanDiffRequest
				if json.Unmarshal(bodyBytes, &req) == nil {
					dialect := req.Dialect
					if dialect == "" && entry.Driver != nil {
						dialect = entry.Driver.Dialect()
					}
					if req.BaselinePlan == nil && strings.TrimSpace(req.BaselineSQL) != "" {
						opts := types.ExplainOptions{Analyze: true, Schema: req.Schema}
						req.BaselinePlan, _ = entry.Driver.ExplainQuery(r.Context(), req.BaselineSQL, opts)
					}
					if req.CandidatePlan == nil && strings.TrimSpace(req.CandidateSQL) != "" {
						opts := types.ExplainOptions{Analyze: true, Schema: req.Schema}
						req.CandidatePlan, _ = entry.Driver.ExplainQuery(r.Context(), req.CandidateSQL, opts)
					}
					diffResult = plandiff.ComparePlans(req.BaselinePlan, req.CandidatePlan, dialect, req.Schema)
				}
			}
		}
	}

	if diffResult == nil {
		diffResult = &plandiff.PlanDiffResult{
			Dialect: entry.Driver.Dialect(),
		}
	}

	md := plandiff.GenerateMarkdownReport(diffResult)
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"plan-diff-report.md\"")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, bytes.NewReader([]byte(md)))
}
