package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/dblens/dblens/internal/routine"
)

// SaveRoutinePayload represents the input for creating or altering a routine.
type SaveRoutinePayload struct {
	DDL string `json:"ddl"`
}

// GetRoutines lists stored procedures and functions for the active connection.
func (h *Handler) GetRoutines(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	schema := strings.TrimSpace(r.URL.Query().Get("schema"))
	if hasControlChars(schema) {
		sendError(w, http.StatusBadRequest, "schema contains invalid control characters")
		return
	}

	routines, err := routine.InspectRoutines(r.Context(), entry.Driver, schema)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, routines)
}

// GetRoutineDetail fetches full routine details including definition and parameters.
func (h *Handler) GetRoutineDetail(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	schema := chi.URLParam(r, "schema")
	name := chi.URLParam(r, "name")
	if hasControlChars(schema) || hasControlChars(name) {
		sendError(w, http.StatusBadRequest, "schema or name contains invalid control characters")
		return
	}

	item, err := routine.InspectRoutineDetail(r.Context(), entry.Driver, schema, name)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, item)
}

// InvokeRoutine executes a procedure or function and returns column data and rows.
func (h *Handler) InvokeRoutine(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
	var req routine.InvokeRoutineRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if hasControlChars(req.Schema) || hasControlChars(req.Name) {
		sendError(w, http.StatusBadRequest, "schema or name contains invalid control characters")
		return
	}

	resp, err := routine.InvokeRoutine(r.Context(), entry.Driver, req)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, resp)
}

// SaveRoutine executes the provided routine DDL.
func (h *Handler) SaveRoutine(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
	var req SaveRoutinePayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := routine.SaveRoutine(r.Context(), entry.Driver, req.DDL); err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{
		"message": "Routine saved successfully",
	})
}

// DeleteRoutine drops a stored procedure or function.
func (h *Handler) DeleteRoutine(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	schema := chi.URLParam(r, "schema")
	name := chi.URLParam(r, "name")
	rType := strings.TrimSpace(r.URL.Query().Get("type"))
	if hasControlChars(schema) || hasControlChars(name) || hasControlChars(rType) {
		sendError(w, http.StatusBadRequest, "parameters contain invalid control characters")
		return
	}

	if err := routine.DeleteRoutine(r.Context(), entry.Driver, schema, name, rType); err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{
		"message": "Routine dropped successfully",
	})
}

// GetTriggers lists triggers from the database catalog.
func (h *Handler) GetTriggers(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	schema := strings.TrimSpace(r.URL.Query().Get("schema"))
	table := strings.TrimSpace(r.URL.Query().Get("table"))
	if hasControlChars(schema) || hasControlChars(table) {
		sendError(w, http.StatusBadRequest, "schema or table contains invalid control characters")
		return
	}

	triggers, err := routine.InspectTriggers(r.Context(), entry.Driver, schema, table)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, triggers)
}

// ToggleTrigger enables or disables a trigger.
func (h *Handler) ToggleTrigger(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req routine.ToggleTriggerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if hasControlChars(req.Schema) || hasControlChars(req.Table) || hasControlChars(req.Name) {
		sendError(w, http.StatusBadRequest, "parameters contain invalid control characters")
		return
	}

	if err := routine.ToggleTrigger(r.Context(), entry.Driver, req); err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	status := "enabled"
	if !req.Enabled {
		status = "disabled"
	}
	sendJSON(w, http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Trigger %s %s successfully", req.Name, status),
	})
}

// DeleteTrigger drops a trigger.
func (h *Handler) DeleteTrigger(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	schema := chi.URLParam(r, "schema")
	name := chi.URLParam(r, "name")
	table := strings.TrimSpace(r.URL.Query().Get("table"))
	if hasControlChars(schema) || hasControlChars(name) || hasControlChars(table) {
		sendError(w, http.StatusBadRequest, "parameters contain invalid control characters")
		return
	}

	if err := routine.DeleteTrigger(r.Context(), entry.Driver, schema, table, name); err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{
		"message": "Trigger dropped successfully",
	})
}

// GetViews lists standard and materialized views.
func (h *Handler) GetViews(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	schema := strings.TrimSpace(r.URL.Query().Get("schema"))
	if hasControlChars(schema) {
		sendError(w, http.StatusBadRequest, "schema contains invalid control characters")
		return
	}

	views, err := routine.InspectViews(r.Context(), entry.Driver, schema)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, views)
}

// RefreshView refreshes a materialized view.
func (h *Handler) RefreshView(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req routine.RefreshViewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if hasControlChars(req.Schema) || hasControlChars(req.Name) {
		sendError(w, http.StatusBadRequest, "parameters contain invalid control characters")
		return
	}

	if err := routine.RefreshView(r.Context(), entry.Driver, req); err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{
		"message": fmt.Sprintf("View %s refreshed successfully", req.Name),
	})
}
