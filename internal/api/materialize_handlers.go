package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
	"github.com/dblens/dblens/internal/materialize"
	"github.com/go-chi/chi/v5"
)

// MaterializePreview generates dry-run DDL and validation warnings without writing data.
func (h *Handler) MaterializePreview(w http.ResponseWriter, r *http.Request) {
	var req materialize.MaterializeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	connID := chi.URLParam(r, "connId")
	if req.TargetConnID == "" {
		req.TargetConnID = connID
	}
	if req.SourceConnID == "" {
		req.SourceConnID = connID
	}

	entry, err := h.resolveDriverWithFallback(r, req.TargetDSN, req.TargetConnID)
	if err != nil {
		sendError(w, http.StatusBadRequest, "target connection resolution failed: "+err.Error())
		return
	}

	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) ||
		strings.EqualFold(r.Header.Get("X-DBLENS-ENVIRONMENT"), "production") {
		req.IsProduction = true
	}

	prev, err := materialize.Preview(r.Context(), entry.Driver, req)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, prev)
}

// MaterializeExecute runs result materialization (server-side CTAS or cross-connection stream).
func (h *Handler) MaterializeExecute(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Materialization blocked by Safe Mode.")
		return
	}

	var req materialize.MaterializeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	connID := chi.URLParam(r, "connId")
	if req.TargetConnID == "" {
		req.TargetConnID = connID
	}
	if req.SourceConnID == "" {
		req.SourceConnID = connID
	}

	if strings.EqualFold(r.Header.Get("X-DBLENS-ENVIRONMENT"), "production") {
		req.IsProduction = true
	}

	tgtEntry, err := h.resolveDriverWithFallback(r, req.TargetDSN, req.TargetConnID)
	if err != nil {
		sendError(w, http.StatusBadRequest, "target connection failed: "+err.Error())
		return
	}

	var srcDrv types.Driver = tgtEntry.Driver
	if req.SourceConnID != "" && req.SourceConnID != req.TargetConnID {
		srcEntry, err := h.resolveDriverWithFallback(r, req.SourceDSN, req.SourceConnID)
		if err != nil {
			sendError(w, http.StatusBadRequest, "source connection failed: "+err.Error())
			return
		}
		srcDrv = srcEntry.Driver
	}

	res, err := materialize.ExecuteWithStore(r.Context(), srcDrv, tgtEntry.Driver, req, h.getScratchStore())
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, res)
}

// ScratchList lists active scratchpad tables for the connection.
func (h *Handler) ScratchList(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	items := h.getScratchStore().List(connID)
	if items == nil {
		items = []materialize.ScratchTable{}
	}
	sendJSON(w, http.StatusOK, items)
}

// ScratchDelete unregisters and drops a scratchpad table.
func (h *Handler) ScratchDelete(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	schema := chi.URLParam(r, "schema")
	table := chi.URLParam(r, "table")

	// If no separate schema param (matched single segment route), use URL param
	if table == "" && schema != "" {
		table = schema
		schema = ""
	}

	if strings.TrimSpace(table) == "" {
		sendError(w, http.StatusBadRequest, "table name is required")
		return
	}

	// Drop underlying database table if driver resolves and not read-only
	if !isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		if entry, err := h.resolveDriverWithFallback(r, "", connID); err == nil && entry != nil {
			targetRef := materialize.QuoteTableRef(schema, table, entry.Driver.Dialect())
			_, _ = entry.Driver.ExecuteQuery(r.Context(), fmt.Sprintf("DROP TABLE IF EXISTS %s;", targetRef))
			_, _ = entry.Driver.ExecuteQuery(r.Context(), fmt.Sprintf("DROP VIEW IF EXISTS %s;", targetRef))
		}
	}

	if err := h.getScratchStore().Delete(connID, schema, table); err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Scratch table %s dropped and unregistered", table),
	})
}

// ScratchPromote graduates a scratchpad table into a permanent table.
func (h *Handler) ScratchPromote(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")

	var req struct {
		Schema string `json:"schema"`
		Table  string `json:"table"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if strings.TrimSpace(req.Table) == "" {
		sendError(w, http.StatusBadRequest, "table is required")
		return
	}

	migrationSQL, err := h.getScratchStore().Promote(connID, req.Schema, req.Table)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{
		"migrationSql": migrationSQL,
		"message":      fmt.Sprintf("Scratch table %s promoted to permanent", req.Table),
	})
}

// ScratchExpire drops and purges all expired scratch tables for the connection.
func (h *Handler) ScratchExpire(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Expire blocked by Safe Mode.")
		return
	}

	connID := chi.URLParam(r, "connId")
	var drv types.Driver
	if entry, err := h.resolveDriverWithFallback(r, "", connID); err == nil && entry != nil {
		drv = entry.Driver
	}

	dropped, err := h.getScratchStore().ExpireConn(r.Context(), connID, drv)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"dropped": dropped,
		"message": fmt.Sprintf("Purged %d expired scratch tables", dropped),
	})
}
