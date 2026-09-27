package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/dictionary"
	"github.com/dblens/dblens/internal/driver/types"
	"github.com/go-chi/chi/v5"
)

// GetDictionary extracts and returns the rich data dictionary for a connection.
// GET /api/connections/{connId}/dictionary
func (h *Handler) GetDictionary(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	connID := chi.URLParam(r, "connId")
	schema := strings.TrimSpace(r.URL.Query().Get("schema"))

	dict, err := dictionary.ExtractCatalog(r.Context(), entry.Driver, connID, schema, h.annotationsStore)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to extract data dictionary: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, dict)
}

// UpdateDictionaryComments updates table or column documentation comments,
// syncing with native DB comments or saving to collaborative notes.
// PUT /api/connections/{connId}/dictionary/comments
func (h *Handler) UpdateDictionaryComments(w http.ResponseWriter, r *http.Request) {
	var req dictionary.CommentUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request payload: "+err.Error())
		return
	}

	req.Table = strings.TrimSpace(req.Table)
	if req.Table == "" {
		sendError(w, http.StatusBadRequest, "table is required")
		return
	}

	if req.SyncToDB && (isTruthy(r.Header.Get("X-DBLENS-READONLY")) || isTruthy(r.URL.Query().Get("readonly"))) {
		sendError(w, http.StatusForbidden, "connection is read-only; database comment synchronization blocked by Safe Mode")
		return
	}

	connID := chi.URLParam(r, "connId")

	var drv types.Driver
	if entry, err := h.resolveDriver(r); err == nil && entry != nil {
		drv = entry.Driver
	}

	if req.SyncToDB && drv == nil {
		sendError(w, http.StatusBadRequest, "Database connection not available to sync comment")
		return
	}

	if err := dictionary.SyncComment(r.Context(), drv, connID, req, h.annotationsStore); err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Documentation comment updated successfully",
	})
}

// ExportDictionaryHTML renders the self-contained offline HTML documentation portal.
// GET /api/connections/{connId}/dictionary/export/html
func (h *Handler) ExportDictionaryHTML(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	connID := chi.URLParam(r, "connId")
	schema := strings.TrimSpace(r.URL.Query().Get("schema"))

	dict, err := dictionary.ExtractCatalog(r.Context(), entry.Driver, connID, schema, h.annotationsStore)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to extract data dictionary: "+err.Error())
		return
	}

	html, err := dictionary.RenderHTML(dict)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to render HTML documentation: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if r.URL.Query().Get("download") != "false" {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"data-dictionary-%s.html\"", connID))
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(html))
}

// ExportDictionaryMD renders the Markdown catalog report.
// GET /api/connections/{connId}/dictionary/export/md
func (h *Handler) ExportDictionaryMD(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	connID := chi.URLParam(r, "connId")
	schema := strings.TrimSpace(r.URL.Query().Get("schema"))

	dict, err := dictionary.ExtractCatalog(r.Context(), entry.Driver, connID, schema, h.annotationsStore)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to extract data dictionary: "+err.Error())
		return
	}

	md, err := dictionary.RenderMarkdown(dict)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to render Markdown documentation: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	if r.URL.Query().Get("download") != "false" {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"data-dictionary-%s.md\"", connID))
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(md))
}

// ExportDictionaryOpenAPI generates OpenAPI 3.0.3 components schema JSON.
// GET /api/connections/{connId}/dictionary/export/openapi
func (h *Handler) ExportDictionaryOpenAPI(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	connID := chi.URLParam(r, "connId")
	schema := strings.TrimSpace(r.URL.Query().Get("schema"))

	dict, err := dictionary.ExtractCatalog(r.Context(), entry.Driver, connID, schema, h.annotationsStore)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to extract data dictionary: "+err.Error())
		return
	}

	oa, err := dictionary.RenderOpenAPI(dict)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to generate OpenAPI schema: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if r.URL.Query().Get("download") != "false" {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"data-dictionary-openapi-%s.json\"", connID))
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(oa))
}
