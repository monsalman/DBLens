package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/dblens/dblens/internal/pivot"
)

// PivotTransformRequest allows either flat parameters or nested config.
type PivotTransformRequest struct {
	Rows       []map[string]interface{} `json:"rows"`
	RowFields  []string                 `json:"rowFields"`
	ColField   string                   `json:"colField"`
	ValueField string                   `json:"valueField"`
	Aggregator string                   `json:"aggregator"`
	Subtotals  bool                     `json:"subtotals"`
	ColLimit   int                      `json:"colLimit,omitempty"`
	Config     *pivot.PivotRequest      `json:"config,omitempty"`
}

// toPivotRequest converts PivotTransformRequest to pivot.PivotRequest.
func (r *PivotTransformRequest) toPivotRequest() pivot.PivotRequest {
	if r.Config != nil {
		return *r.Config
	}
	return pivot.PivotRequest{
		RowFields:  r.RowFields,
		ColField:   r.ColField,
		ValueField: r.ValueField,
		Aggregator: r.Aggregator,
		Subtotals:  r.Subtotals,
		ColLimit:   r.ColLimit,
	}
}

// PivotTransformHandler transforms raw rows into a 2D PivotMatrix.
// POST /api/pivot/transform
func (h *Handler) PivotTransformHandler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var req PivotTransformRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	matrix, err := pivot.TransformRows(req.Rows, req.toPivotRequest())
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, matrix)
}

// PivotPushdownHandler generates SQL for pushdown pivoting.
// POST /api/connections/{connId}/pivot/pushdown
func (h *Handler) PivotPushdownHandler(w http.ResponseWriter, r *http.Request) {
	var req pivot.PushdownRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if req.Dialect == "" {
		if entry, err := h.resolveDriver(r); err == nil && entry != nil && entry.Driver != nil {
			req.Dialect = entry.Driver.Dialect()
		}
	}

	sql, err := pivot.GeneratePushdownSQL(req)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, pivot.PushdownResult{
		SQL:     sql,
		Dialect: req.Dialect,
	})
}

// PivotRunHandler generates and executes pushdown SQL directly on the connection.
// POST /api/connections/{connId}/pivot/run
func (h *Handler) PivotRunHandler(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, "connection resolution failed: "+err.Error())
		return
	}

	var req pivot.PushdownRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if req.Dialect == "" && entry.Driver != nil {
		req.Dialect = entry.Driver.Dialect()
	}

	sql, err := pivot.GeneratePushdownSQL(req)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	if IsNonSelectSQL(sql) {
		sendError(w, http.StatusForbidden, "Non-SELECT queries are not permitted in pivot run.")
		return
	}

	res, err := entry.Driver.ExecuteQuery(r.Context(), sql)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"sql":     sql,
		"dialect": req.Dialect,
		"result":  res,
	})
}

// parseExportPayload extracts a PivotMatrix and rowFieldNames from either PivotMatrix or PivotTransformRequest.
func parseExportPayload(bodyBytes []byte) (*pivot.PivotMatrix, []string, error) {
	// First attempt: check if wrapped in { "data": ... }
	var wrapped struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(bodyBytes, &wrapped); err == nil && len(wrapped.Data) > 0 && string(wrapped.Data) != "null" {
		if m, rf, err := parseExportPayload(wrapped.Data); err == nil {
			return m, rf, nil
		}
	}

	// Second attempt: check if it's already a PivotMatrix with "cells"
	var matrix pivot.PivotMatrix
	if err := json.Unmarshal(bodyBytes, &matrix); err == nil && matrix.Cells != nil {
		return &matrix, nil, nil
	}

	// Third attempt: PivotTransformRequest with raw rows
	var transformReq PivotTransformRequest
	if err := json.Unmarshal(bodyBytes, &transformReq); err == nil {
		pReq := transformReq.toPivotRequest()
		m, err := pivot.TransformRows(transformReq.Rows, pReq)
		if err != nil {
			return nil, nil, err
		}
		return m, pReq.RowFields, nil
	}

	return nil, nil, io.ErrUnexpectedEOF
}

// PivotExportCSVHandler exports pivot result to CSV format.
// POST /api/connections/{connId}/pivot/export.csv
// POST /api/pivot/export.csv
func (h *Handler) PivotExportCSVHandler(w http.ResponseWriter, r *http.Request) {
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		sendError(w, http.StatusBadRequest, "failed to read body: "+err.Error())
		return
	}

	matrix, rowFields, err := parseExportPayload(bodyBytes)
	if err != nil {
		sendError(w, http.StatusBadRequest, "failed to parse pivot data: "+err.Error())
		return
	}

	csvStr, err := pivot.ExportCSV(matrix, rowFields)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "failed to generate CSV: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="pivot.csv"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(csvStr))
}

// PivotExportMDHandler exports pivot result to Markdown table format.
// POST /api/connections/{connId}/pivot/export.md
// POST /api/pivot/export.md
func (h *Handler) PivotExportMDHandler(w http.ResponseWriter, r *http.Request) {
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		sendError(w, http.StatusBadRequest, "failed to read body: "+err.Error())
		return
	}

	matrix, rowFields, err := parseExportPayload(bodyBytes)
	if err != nil {
		sendError(w, http.StatusBadRequest, "failed to parse pivot data: "+err.Error())
		return
	}

	mdStr := pivot.ExportMarkdown(matrix, rowFields)

	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="pivot.md"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(mdStr))
}
