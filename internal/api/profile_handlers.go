package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/profile"
)

type ProfileCompareRequest struct {
	BaseSchema   string                 `json:"baseSchema,omitempty"`
	BaseTable    string                 `json:"baseTable"`
	TargetSchema string                 `json:"targetSchema,omitempty"`
	TargetTable  string                 `json:"targetTable"`
	BaseReport   *profile.ProfileReport `json:"baseReport,omitempty"`
	TargetReport *profile.ProfileReport `json:"targetReport,omitempty"`
}

// ProfileTable runs column data profiling on a target table.
// POST /connections/{connId}/profile
func (h *Handler) ProfileTable(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req profile.ProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}
	req.Table = strings.TrimSpace(req.Table)
	if req.Table == "" {
		sendError(w, http.StatusBadRequest, "table is required")
		return
	}

	report, err := profile.RunProfile(r.Context(), entry.Driver, req)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, report)
}

// ProfileSuggest generates quality suggestions and constraint recommendations.
// POST /connections/{connId}/profile/suggest
func (h *Handler) ProfileSuggest(w http.ResponseWriter, r *http.Request) {
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		sendError(w, http.StatusBadRequest, "Failed to read request body")
		return
	}

	// Try decoding as existing ProfileReport first
	var report profile.ProfileReport
	if err := json.Unmarshal(bodyBytes, &report); err == nil && len(report.Columns) > 0 {
		suggestions := profile.GenerateSuggestions(&report)
		sendJSON(w, http.StatusOK, suggestions)
		return
	}

	// Otherwise decode as ProfileRequest and profile table
	var req profile.ProfileRequest
	if err := json.Unmarshal(bodyBytes, &req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}
	req.Table = strings.TrimSpace(req.Table)
	if req.Table == "" {
		sendError(w, http.StatusBadRequest, "table is required")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	generatedReport, err := profile.RunProfile(r.Context(), entry.Driver, req)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, generatedReport.Suggestions)
}

// ProfileExportMD exports a Markdown representation of the profiling report.
// GET /connections/{connId}/profile/export.md
// POST /connections/{connId}/profile/export.md
func (h *Handler) ProfileExportMD(w http.ResponseWriter, r *http.Request) {
	var rep *profile.ProfileReport
	tableName := "report"

	if r.Method == http.MethodPost {
		bodyBytes, err := io.ReadAll(r.Body)
		if err == nil && len(bodyBytes) > 0 {
			var directReport profile.ProfileReport
			if json.Unmarshal(bodyBytes, &directReport) == nil && len(directReport.Columns) > 0 {
				rep = &directReport
				tableName = directReport.Table
			} else {
				var req profile.ProfileRequest
				if json.Unmarshal(bodyBytes, &req) == nil && req.Table != "" {
					entry, err := h.resolveDriver(r)
					if err != nil {
						http.Error(w, err.Error(), http.StatusBadRequest)
						return
					}
					rep, err = profile.RunProfile(r.Context(), entry.Driver, req)
					if err != nil {
						http.Error(w, err.Error(), http.StatusInternalServerError)
						return
					}
					tableName = req.Table
				}
			}
		}
	}

	if rep == nil {
		// Attempt query parameters for GET
		table := strings.TrimSpace(r.URL.Query().Get("table"))
		if table == "" {
			http.Error(w, "table parameter is required", http.StatusBadRequest)
			return
		}
		schema := strings.TrimSpace(r.URL.Query().Get("schema"))
		entry, err := h.resolveDriver(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		rep, err = profile.RunProfile(r.Context(), entry.Driver, profile.ProfileRequest{
			Schema: schema,
			Table:  table,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		tableName = table
	}

	md := profile.ExportMarkdown(rep)
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"profile-%s.md\"", tableName))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, bytes.NewReader([]byte(md)))
}

// ProfileCompare compares two tables or precomputed profile reports.
// POST /connections/{connId}/profile/compare
func (h *Handler) ProfileCompare(w http.ResponseWriter, r *http.Request) {
	var req ProfileCompareRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	baseReport := req.BaseReport
	targetReport := req.TargetReport

	if baseReport == nil || targetReport == nil {
		entry, err := h.resolveDriver(r)
		if err != nil {
			sendError(w, http.StatusBadRequest, err.Error())
			return
		}

		if baseReport == nil {
			if strings.TrimSpace(req.BaseTable) == "" {
				sendError(w, http.StatusBadRequest, "baseTable or baseReport is required")
				return
			}
			baseReport, err = profile.RunProfile(r.Context(), entry.Driver, profile.ProfileRequest{
				Schema: req.BaseSchema,
				Table:  req.BaseTable,
			})
			if err != nil {
				sendError(w, http.StatusInternalServerError, "failed to profile baseTable: "+err.Error())
				return
			}
		}

		if targetReport == nil {
			if strings.TrimSpace(req.TargetTable) == "" {
				sendError(w, http.StatusBadRequest, "targetTable or targetReport is required")
				return
			}
			targetReport, err = profile.RunProfile(r.Context(), entry.Driver, profile.ProfileRequest{
				Schema: req.TargetSchema,
				Table:  req.TargetTable,
			})
			if err != nil {
				sendError(w, http.StatusInternalServerError, "failed to profile targetTable: "+err.Error())
				return
			}
		}
	}

	diff := profile.CompareReports(baseReport, targetReport)
	sendJSON(w, http.StatusOK, diff)
}
