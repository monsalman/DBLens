package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
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

var (
	reWhereClause       = regexp.MustCompile(`(?i)\bWHERE\s+([\s\S]+?)(?:\s+\b(?:ORDER|GROUP|LIMIT|OFFSET|HAVING)\b|;|$)`)
	reCreateIndexStrict = regexp.MustCompile(`(?i)^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:[a-zA-Z_][a-zA-Z0-9_]*|"[^"]+"|` + "`[^`]+`" + `)\s+ON\s+(?:(?:[a-zA-Z_][a-zA-Z0-9_]*|"[^"]+"|` + "`[^`]+`" + `)\.)?(?:[a-zA-Z_][a-zA-Z0-9_]*|"[^"]+"|` + "`[^`]+`" + `)\s*(?:USING\s+[a-zA-Z0-9_]+\s*)?\([^;]+\)(?:\s+WHERE\s+[^;]+)?\s*;?\s*$`)
)

func extractWhereClause(sql string) string {
	match := reWhereClause.FindStringSubmatch(sql)
	if len(match) > 1 {
		return strings.TrimSpace(match[1])
	}
	return ""
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

	isReadOnly := isTruthy(r.Header.Get("X-DBLENS-READONLY")) ||
		isTruthy(r.URL.Query().Get("readonly")) ||
		req.ReadOnly

	if isReadOnly {
		if (strings.TrimSpace(req.BaselineSQL) != "" && IsNonSelectSQL(req.BaselineSQL)) ||
			(strings.TrimSpace(req.CandidateSQL) != "" && IsNonSelectSQL(req.CandidateSQL)) {
			sendError(w, http.StatusForbidden, "Connection is read-only. Mutating query blocked by Safe Mode.")
			return
		}
	}

	// Explain Baseline if raw SQL is provided and plan is missing
	if req.BaselinePlan == nil && strings.TrimSpace(req.BaselineSQL) != "" {
		canAnalyze := !IsNonSelectSQL(req.BaselineSQL)
		opts := types.ExplainOptions{Analyze: canAnalyze, Schema: req.Schema}
		plan, err := entry.Driver.ExplainQuery(r.Context(), req.BaselineSQL, opts)
		if err != nil && opts.Analyze {
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
		canAnalyze := !IsNonSelectSQL(req.CandidateSQL)
		opts := types.ExplainOptions{Analyze: canAnalyze, Schema: req.Schema}
		plan, err := entry.Driver.ExplainQuery(r.Context(), req.CandidateSQL, opts)
		if err != nil && opts.Analyze {
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

	isReadOnly := isTruthy(r.Header.Get("X-DBLENS-READONLY")) ||
		isTruthy(r.URL.Query().Get("readonly")) ||
		req.ReadOnly

	if isReadOnly {
		if (strings.TrimSpace(req.BaselineSQL) != "" && IsNonSelectSQL(req.BaselineSQL)) ||
			(strings.TrimSpace(req.CandidateSQL) != "" && IsNonSelectSQL(req.CandidateSQL)) {
			sendError(w, http.StatusForbidden, "Connection is read-only. Mutating query blocked by Safe Mode.")
			return
		}
	}

	// If candidate plan is missing but SQL provided, explain candidate query
	if req.CandidatePlan == nil && strings.TrimSpace(req.CandidateSQL) != "" {
		canAnalyze := !IsNonSelectSQL(req.CandidateSQL)
		opts := types.ExplainOptions{Analyze: canAnalyze, Schema: req.Schema}
		plan, err := entry.Driver.ExplainQuery(r.Context(), req.CandidateSQL, opts)
		if err != nil && opts.Analyze {
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
		canAnalyze := !IsNonSelectSQL(req.BaselineSQL)
		opts := types.ExplainOptions{Analyze: canAnalyze, Schema: req.Schema}
		plan, err := entry.Driver.ExplainQuery(r.Context(), req.BaselineSQL, opts)
		if err != nil && opts.Analyze {
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
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) || isTruthy(r.URL.Query().Get("readonly")) {
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

	cleaned := reBlockComment.ReplaceAllString(ddl, " ")
	cleaned = reLineComment.ReplaceAllString(cleaned, " ")
	stmts := splitStatements(cleaned)
	var validStmts []string
	for _, s := range stmts {
		if trimmed := strings.TrimSpace(s); trimmed != "" {
			validStmts = append(validStmts, trimmed)
		}
	}
	if len(validStmts) != 1 {
		sendError(w, http.StatusBadRequest, "Only a single CREATE INDEX statement is permitted")
		return
	}

	stmt := validStmts[0]
	stmtWithoutTrailingSemicolon := strings.TrimSuffix(stmt, ";")
	if strings.Contains(stmtWithoutTrailingSemicolon, ";") {
		sendError(w, http.StatusBadRequest, "Multi-statement execution is strictly prohibited")
		return
	}

	if !reCreateIndexStrict.MatchString(stmt) {
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

	isReadOnly := isTruthy(r.Header.Get("X-DBLENS-READONLY")) ||
		isTruthy(r.URL.Query().Get("readonly"))

	var diffResult *plandiff.PlanDiffResult

	if r.Method == http.MethodPost {
		r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Request body too large: "+err.Error(), http.StatusBadRequest)
			return
		}
		if len(bodyBytes) > 0 {
			// First try unmarshaling as full PlanDiffResult
			var full plandiff.PlanDiffResult
			if json.Unmarshal(bodyBytes, &full) == nil && (full.Summary.BaselineTotalCost > 0 || full.Summary.CandidateTotalCost > 0 || full.AlignedTree != nil) {
				diffResult = &full
			} else {
				// Otherwise unmarshal as PlanDiffRequest
				var req plandiff.PlanDiffRequest
				if err := json.Unmarshal(bodyBytes, &req); err == nil {
					if isReadOnly || req.ReadOnly {
						if (strings.TrimSpace(req.BaselineSQL) != "" && IsNonSelectSQL(req.BaselineSQL)) ||
							(strings.TrimSpace(req.CandidateSQL) != "" && IsNonSelectSQL(req.CandidateSQL)) {
							http.Error(w, "Connection is read-only. Mutating query blocked by Safe Mode.", http.StatusForbidden)
							return
						}
					}
					dialect := req.Dialect
					if dialect == "" && entry.Driver != nil {
						dialect = entry.Driver.Dialect()
					}
					if req.BaselinePlan == nil && strings.TrimSpace(req.BaselineSQL) != "" {
						opts := types.ExplainOptions{Analyze: !IsNonSelectSQL(req.BaselineSQL), Schema: req.Schema}
						req.BaselinePlan, _ = entry.Driver.ExplainQuery(r.Context(), req.BaselineSQL, opts)
					}
					if req.BaselinePlan != nil && req.BaselinePlan.Root != nil && req.BaselinePlan.Root.Filter == "" && req.BaselineSQL != "" {
						req.BaselinePlan.Root.Filter = extractWhereClause(req.BaselineSQL)
					}
					if req.CandidatePlan == nil && strings.TrimSpace(req.CandidateSQL) != "" {
						opts := types.ExplainOptions{Analyze: !IsNonSelectSQL(req.CandidateSQL), Schema: req.Schema}
						req.CandidatePlan, _ = entry.Driver.ExplainQuery(r.Context(), req.CandidateSQL, opts)
					}
					if req.CandidatePlan != nil && req.CandidatePlan.Root != nil && req.CandidatePlan.Root.Filter == "" && req.CandidateSQL != "" {
						req.CandidatePlan.Root.Filter = extractWhereClause(req.CandidateSQL)
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
