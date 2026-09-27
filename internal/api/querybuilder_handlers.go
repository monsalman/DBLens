package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	"github.com/dblens/dblens/internal/querybuilder"
	"github.com/go-chi/chi/v5"
)

// GenerateVisualQueryRequest represents the payload for generating SQL from canvas state.
type GenerateVisualQueryRequest struct {
	State   querybuilder.QueryCanvasState `json:"state"`
	Dialect string                        `json:"dialect,omitempty"`
}

// RunVisualQueryRequest represents the payload for running a visual query.
type RunVisualQueryRequest struct {
	State   querybuilder.QueryCanvasState `json:"state"`
	SQL     string                        `json:"sql,omitempty"`
	Dialect string                        `json:"dialect,omitempty"`
}

// GenerateVisualQueryHandler generates SQL from visual query canvas state.
// POST /api/connections/{connId}/querybuilder/generate
func (h *Handler) GenerateVisualQueryHandler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		sendError(w, http.StatusBadRequest, "failed to read request body: "+err.Error())
		return
	}

	var req GenerateVisualQueryRequest
	if err := json.Unmarshal(bodyBytes, &req); err == nil && len(req.State.Tables) > 0 {
		// parsed successfully with state envelope
	} else {
		// try unmarshaling directly into QueryCanvasState
		var state querybuilder.QueryCanvasState
		if err2 := json.Unmarshal(bodyBytes, &state); err2 == nil && len(state.Tables) > 0 {
			req.State = state
		}
	}

	dialect := req.Dialect
	if dialect == "" {
		if entry, err := h.resolveDriver(r); err == nil && entry != nil && entry.Driver != nil {
			dialect = entry.Driver.Dialect()
		}
	}
	if dialect == "" {
		dialect = "postgres"
	}

	res, err := querybuilder.GenerateSQL(req.State, dialect)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, res)
}

// RunVisualQueryHandler executes a visual query directly against the target connection.
// POST /api/connections/{connId}/querybuilder/run
func (h *Handler) RunVisualQueryHandler(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, "connection resolution failed: "+err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		sendError(w, http.StatusBadRequest, "failed to read request body: "+err.Error())
		return
	}

	var req RunVisualQueryRequest
	if err := json.Unmarshal(bodyBytes, &req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	dialect := req.Dialect
	if dialect == "" && entry.Driver != nil {
		dialect = entry.Driver.Dialect()
	}
	if dialect == "" {
		dialect = "postgres"
	}

	sql := req.SQL
	if sql == "" {
		res, err := querybuilder.GenerateSQL(req.State, dialect)
		if err != nil {
			sendError(w, http.StatusBadRequest, "failed to generate SQL: "+err.Error())
			return
		}
		sql = res.SQL
	}

	if IsNonSelectSQL(sql) {
		sendError(w, http.StatusForbidden, "Non-SELECT queries are not permitted in visual query run.")
		return
	}

	execRes, err := entry.Driver.ExecuteQuery(r.Context(), sql)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"sql":     sql,
		"dialect": dialect,
		"result":  execRes,
	})
}

// ListSavedVisualQueriesHandler lists saved visual queries for a connection.
// GET /api/connections/{connId}/querybuilder/saved
// GET /api/querybuilder/saved
func (h *Handler) ListSavedVisualQueriesHandler(w http.ResponseWriter, r *http.Request) {
	if h.queryBuilderStore == nil {
		sendJSON(w, http.StatusOK, []*querybuilder.SavedVisualQuery{})
		return
	}
	connID := chi.URLParam(r, "connId")
	items := h.queryBuilderStore.List(connID)
	sendJSON(w, http.StatusOK, items)
}

// SaveVisualQueryHandler saves or updates a visual query.
// POST /api/connections/{connId}/querybuilder/save
// POST /api/querybuilder/save
func (h *Handler) SaveVisualQueryHandler(w http.ResponseWriter, r *http.Request) {
	if h.queryBuilderStore == nil {
		sendError(w, http.StatusInternalServerError, "query builder store unavailable")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var item querybuilder.SavedVisualQuery
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	connID := chi.URLParam(r, "connId")
	if item.ConnectionID == "" && connID != "" {
		item.ConnectionID = connID
	}

	if item.SQL == "" && len(item.State.Tables) > 0 {
		dialect := "postgres"
		if entry, err := h.resolveDriver(r); err == nil && entry != nil && entry.Driver != nil {
			dialect = entry.Driver.Dialect()
		}
		if res, err := querybuilder.GenerateSQL(item.State, dialect); err == nil && res != nil {
			item.SQL = res.SQL
		}
	}

	saved, err := h.queryBuilderStore.Save(&item)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, saved)
}

// DeleteSavedVisualQueryHandler removes a saved visual query by ID.
// DELETE /api/connections/{connId}/querybuilder/saved/{id}
// DELETE /api/querybuilder/saved/{id}
func (h *Handler) DeleteSavedVisualQueryHandler(w http.ResponseWriter, r *http.Request) {
	if h.queryBuilderStore == nil {
		sendError(w, http.StatusInternalServerError, "query builder store unavailable")
		return
	}

	id := chi.URLParam(r, "id")
	if id == "" {
		sendError(w, http.StatusBadRequest, "missing query id")
		return
	}

	if err := h.queryBuilderStore.Delete(id); err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// Silence unused package import warning if any
var _ = bytes.NewBuffer
