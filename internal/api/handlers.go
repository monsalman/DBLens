package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/driver"
	"github.com/go-chi/chi/v5"
)

type Response struct {
	Data  interface{} `json:"data"`
	Error *string     `json:"error"`
}

func MaskDSN(dsn string) string {
	if strings.Contains(dsn, "://") {
		parts := strings.SplitN(dsn, "://", 2)
		cred := parts[0]
		rest := parts[1]
		// Simple mask: if contains ://user:pass@host, hide the pass
		if idx := strings.Index(rest, "@"); idx > 0 {
			if passIdx := strings.Index(rest[:idx], ":"); passIdx > 0 {
				rest = rest[:passIdx+1] + "***" + rest[idx:]
			}
		}
		return cred + "://" + rest
	}
	return dsn
}

func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Response{
		Data:  data,
		Error: nil,
	})
}

func sendError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Response{
		Data:  nil,
		Error: &msg,
	})
}

type Handler struct {
	mgr *connection.Manager
}

func NewHandler(mgr *connection.Manager) *Handler {
	return &Handler{mgr: mgr}
}

type AddConnectionRequest struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	DSN      string `json:"dsn"`
	Color    string `json:"color"`
	ReadOnly bool   `json:"readOnly"`
}

type CreateProfileRequest struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	DSN      string `json:"dsn"`
	Color    string `json:"color"`
	ReadOnly bool   `json:"readOnly"`
}

type UpdateProfileRequest struct {
	Label    string `json:"label"`
	DSN      string `json:"dsn"`
	Color    string `json:"color"`
	ReadOnly bool   `json:"readOnly"`
}

type TestConnectionRequest struct {
	DSN      string `json:"dsn"`
	Label    string `json:"label"`
	Color    string `json:"color"`
	ReadOnly bool   `json:"readOnly"`
}

type TestConnectionResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Dialect string `json:"dialect"`
}

func (h *Handler) ListProfiles(w http.ResponseWriter, r *http.Request) {
	profiles, err := h.mgr.ListProfiles()
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	masked := make([]connection.Profile, len(profiles))
	for i, p := range profiles {
		masked[i] = connection.Profile{
			ID:       p.ID,
			Label:    p.Label,
			DSN:      MaskDSN(p.DSN),
			Color:    p.Color,
			ReadOnly: p.ReadOnly,
		}
	}

	sendJSON(w, http.StatusOK, masked)
}

func (h *Handler) CreateProfile(w http.ResponseWriter, r *http.Request) {
	var req CreateProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}
	if req.DSN == "" {
		sendError(w, http.StatusBadRequest, "dsn is required")
		return
	}

	entry, err := h.mgr.ConnectProfile(req.ID, req.Label, req.DSN, req.Color, req.ReadOnly)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusCreated, map[string]interface{}{
		"id":       entry.ID,
		"label":    entry.Label,
		"color":    entry.Color,
		"readOnly": entry.ReadOnly,
		"dialect":  entry.Driver.Dialect(),
	})
}

func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		sendError(w, http.StatusBadRequest, "profile id is required")
		return
	}

	var req UpdateProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}
	if req.DSN == "" {
		sendError(w, http.StatusBadRequest, "dsn is required")
		return
	}

	entry, err := h.mgr.UpdateProfile(id, req.Label, req.DSN, req.Color, req.ReadOnly)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"id":       entry.ID,
		"label":    entry.Label,
		"color":    entry.Color,
		"readOnly": entry.ReadOnly,
		"dialect":  entry.Driver.Dialect(),
	})
}

func (h *Handler) DeleteProfile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		id = chi.URLParam(r, "connId")
	}
	if err := h.mgr.RemoveProfile(id); err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, map[string]string{"message": "profile removed"})
}

func (h *Handler) ListConnections(w http.ResponseWriter, r *http.Request) {
	list := h.mgr.List()
	sendJSON(w, http.StatusOK, list)
}

func (h *Handler) AddConnection(w http.ResponseWriter, r *http.Request) {
	var req AddConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}
	if req.DSN == "" {
		sendError(w, http.StatusBadRequest, "dsn is required")
		return
	}

	entry, err := h.mgr.AddWithID(req.ID, req.Label, req.DSN, req.Color, req.ReadOnly)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusCreated, map[string]interface{}{
		"id":       entry.ID,
		"label":    entry.Label,
		"color":    entry.Color,
		"readOnly": entry.ReadOnly,
		"dialect":  entry.Driver.Dialect(),
	})
}

func (h *Handler) RemoveConnection(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	if err := h.mgr.Remove(connID); err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, map[string]string{"message": "connection removed"})
}

func (h *Handler) PingConnection(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	if err := h.mgr.Ping(connID); err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) TestConnection(w http.ResponseWriter, r *http.Request) {
	var req TestConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}
	if req.DSN == "" {
		sendError(w, http.StatusBadRequest, "dsn is required")
		return
	}

	// Try to create a driver instance and ping
	drv, err := driver.NewDriver(req.DSN)
	if err != nil {
		sendJSON(w, http.StatusOK, map[string]interface{}{
			"success": false, "message": "Failed to parse DSN: " + err.Error(),
		})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pingErr := drv.Ping(ctx)
	dialect := drv.Dialect()
	drv.Close() // Always close after test

	if pingErr != nil {
		sendJSON(w, http.StatusOK, map[string]interface{}{
			"success": false, "message": "Connection failed: " + pingErr.Error(), "dialect": dialect,
		})
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true, "message": "Connected successfully", "dialect": dialect,
	})
}

type SelectDatabaseRequest struct {
	Database string `json:"database"`
}

func (h *Handler) GetDatabases(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	entry, err := h.mgr.Get(connID)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}

	dbs, err := entry.Driver.InspectDatabases(r.Context())
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, dbs)
}

func (h *Handler) SelectDatabase(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	entry, err := h.mgr.Get(connID)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}

	var req SelectDatabaseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}
	if req.Database == "" {
		sendError(w, http.StatusBadRequest, "database is required")
		return
	}

	if err := entry.Driver.SelectDatabase(r.Context(), req.Database); err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, map[string]string{"message": "database switched"})
}

func (h *Handler) GetSchemas(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	entry, err := h.mgr.Get(connID)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}

	schemas, err := entry.Driver.InspectSchemas(r.Context())
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, schemas)
}

func (h *Handler) GetTables(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	schema := r.URL.Query().Get("schema")

	entry, err := h.mgr.Get(connID)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}

	tables, err := entry.Driver.InspectTables(r.Context(), schema)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, tables)
}

func (h *Handler) GetTableDetails(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	tableName := chi.URLParam(r, "table")
	schema := r.URL.Query().Get("schema")

	entry, err := h.mgr.Get(connID)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}

	details, err := entry.Driver.InspectTableDetails(r.Context(), schema, tableName)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, details)
}

func (h *Handler) QueryTableData(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	tableName := chi.URLParam(r, "table")

	entry, err := h.mgr.Get(connID)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}

	var opts driver.QueryOptions
	if err := json.NewDecoder(r.Body).Decode(&opts); err != nil {
		opts = driver.QueryOptions{}
	}
	opts.Table = tableName

	res, err := entry.Driver.QueryTableData(r.Context(), opts)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, res)
}

type ExecuteQueryRequest struct {
	SQL string `json:"sql"`
}

func (h *Handler) ExecuteQuery(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")

	entry, err := h.mgr.Get(connID)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}

	var req ExecuteQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if req.SQL == "" {
		sendError(w, http.StatusBadRequest, "sql field is required")
		return
	}

	res, err := entry.Driver.ExecuteQuery(r.Context(), req.SQL)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, res)
}

func (h *Handler) MutateRow(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")

	entry, err := h.mgr.Get(connID)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}

	if entry.ReadOnly {
		sendError(w, http.StatusForbidden, "Connection is read-only")
		return
	}

	var mut driver.Mutation
	if err := json.NewDecoder(r.Body).Decode(&mut); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	res, err := entry.Driver.MutateRow(r.Context(), mut)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, res)
}

func (h *Handler) GetERDData(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")

	entry, err := h.mgr.Get(connID)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}

	erd, err := entry.Driver.GetERDData(r.Context())
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, erd)
}
