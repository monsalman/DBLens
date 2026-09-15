package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/driver"
	"github.com/go-chi/chi/v5"
)

type Response struct {
	Data  interface{} `json:"data"`
	Error *string     `json:"error"`
}

func MaskDSN(dsn string) string {
	return driver.MaskDSN(dsn)
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

type TestConnectionRequest struct {
	DSN string `json:"dsn"`
}

// resolveDriver extracts DSN from X-DBLENS-DSN header first,
// and falls back to resolving global server-seeded connections by connId param.
func (h *Handler) resolveDriver(r *http.Request) (*connection.PoolEntry, error) {
	dsn := strings.TrimSpace(r.Header.Get("X-DBLENS-DSN"))
	if dsn != "" {
		return h.mgr.GetByDSN(dsn)
	}

	connID := chi.URLParam(r, "connId")
	if connID != "" {
		if globalDSN, ok := h.mgr.GetGlobalDSNByID(connID); ok {
			return h.mgr.GetByDSN(globalDSN)
		}
	}

	return nil, fmt.Errorf("X-DBLENS-DSN header is required")
}

func (h *Handler) ListGlobalProfiles(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, h.mgr.GlobalProfiles())
}

func (h *Handler) TestConnection(w http.ResponseWriter, r *http.Request) {
	var req TestConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}
	req.DSN = strings.TrimSpace(req.DSN)
	if req.DSN == "" {
		sendError(w, http.StatusBadRequest, "dsn is required")
		return
	}

	dialect, err := h.mgr.TestDSN(req.DSN)
	if err != nil {
		sendJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"message": "Connection failed: " + err.Error(),
			"dialect": dialect,
		})
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Connected successfully",
		"dialect": dialect,
	})
}

type SelectDatabaseRequest struct {
	Database string `json:"database"`
}

func (h *Handler) GetDatabases(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
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
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
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
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
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
	schema := r.URL.Query().Get("schema")

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
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
	tableName := chi.URLParam(r, "table")
	schema := r.URL.Query().Get("schema")

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
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
	tableName := chi.URLParam(r, "table")

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
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
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
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
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
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
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	erd, err := entry.Driver.GetERDData(r.Context())
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, erd)
}
