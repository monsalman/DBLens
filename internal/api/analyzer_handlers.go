package api

import (
	"encoding/json"
	"net/http"

	"github.com/dblens/dblens/internal/analyzer"
)

type AnalyzeRequestBody struct {
	SQL         string                          `json:"sql"`
	Dialect     string                          `json:"dialect,omitempty"`
	Schema      string                          `json:"schema,omitempty"`
	KnownTables []string                        `json:"known_tables,omitempty"`
	KnownCols   map[string][]string             `json:"known_cols,omitempty"`
	RuleConfig  map[string]analyzer.RuleSetting `json:"rule_config,omitempty"`
}

func (h *Handler) AnalyzeSQLHandler(w http.ResponseWriter, r *http.Request) {
	var req AnalyzeRequestBody
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	// If no known tables supplied, try to auto-discover via connection driver
	if len(req.KnownTables) == 0 {
		if entry, err := h.resolveDriver(r); err == nil && entry != nil && entry.Driver != nil {
			if tables, err := entry.Driver.InspectTables(r.Context(), req.Schema); err == nil && tables != nil {
				for _, t := range tables {
					req.KnownTables = append(req.KnownTables, t.Name)
				}
			}
		}
	}

	// Overlay with stored rule configurations
	finalConfig := make(map[string]analyzer.RuleSetting)
	if h.analyzerStore != nil {
		finalConfig = h.analyzerStore.GetRuleConfig()
	}
	for k, v := range req.RuleConfig {
		finalConfig[k] = v
	}

	result := analyzer.AnalyzeSQL(
		r.Context(),
		req.SQL,
		req.Dialect,
		req.Schema,
		req.KnownTables,
		req.KnownCols,
		finalConfig,
	)

	sendJSON(w, http.StatusOK, result)
}

func (h *Handler) GetAnalyzerRulesHandler(w http.ResponseWriter, r *http.Request) {
	if h.analyzerStore != nil {
		sendJSON(w, http.StatusOK, h.analyzerStore.GetRules())
		return
	}

	metas := make([]analyzer.RuleMeta, 0, len(analyzer.AllRules))
	for _, r := range analyzer.AllRules {
		metas = append(metas, r.Meta())
	}
	sendJSON(w, http.StatusOK, metas)
}

func (h *Handler) UpdateAnalyzerRulesHandler(w http.ResponseWriter, r *http.Request) {
	var updates map[string]analyzer.RuleSetting
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if h.analyzerStore == nil {
		sendError(w, http.StatusInternalServerError, "analyzer store not available")
		return
	}

	if err := h.analyzerStore.UpdateRules(updates); err != nil {
		sendError(w, http.StatusInternalServerError, "failed to update rules: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, h.analyzerStore.GetRules())
}

func (h *Handler) AnalyzeGateHandler(w http.ResponseWriter, r *http.Request) {
	var req analyzer.GateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	// Auto-discover tables if not provided
	if len(req.KnownTables) == 0 {
		if entry, err := h.resolveDriver(r); err == nil && entry != nil && entry.Driver != nil {
			if tables, err := entry.Driver.InspectTables(r.Context(), req.Schema); err == nil && tables != nil {
				for _, t := range tables {
					req.KnownTables = append(req.KnownTables, t.Name)
				}
			}
		}
	}

	// Overlay with stored rule configurations
	finalConfig := make(map[string]analyzer.RuleSetting)
	if h.analyzerStore != nil {
		finalConfig = h.analyzerStore.GetRuleConfig()
	}
	for k, v := range req.RuleConfig {
		finalConfig[k] = v
	}
	req.RuleConfig = finalConfig

	result := analyzer.EvaluateGate(req)
	sendJSON(w, http.StatusOK, result)
}
