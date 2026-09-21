package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
	"github.com/dblens/dblens/internal/federation"
)

// FederatedConnectionProfile provides connection context from the client.
type FederatedConnectionProfile struct {
	ID    string `json:"id"`
	DSN   string `json:"dsn"`
	Label string `json:"label,omitempty"`
}

// FederatedQueryAPIRequest contains parameters for cross-database execution.
type FederatedQueryAPIRequest struct {
	Query       string                       `json:"query"`
	Limit       int                          `json:"limit"`
	Connections []FederatedConnectionProfile `json:"connections,omitempty"`
	DSNs        map[string]string            `json:"dsns,omitempty"`
}

// DataPipeAPIRequest specifies source and target table parameters for streaming migration.
type DataPipeAPIRequest struct {
	SourceConnID  string `json:"sourceConnId"`
	SourceDSN     string `json:"sourceDsn"`
	SourceSchema  string `json:"sourceSchema"`
	SourceTable   string `json:"sourceTable"`
	TargetConnID  string `json:"targetConnId"`
	TargetDSN     string `json:"targetDsn"`
	TargetSchema  string `json:"targetSchema"`
	TargetTable   string `json:"targetTable"`
	CreateTable   bool   `json:"createTable"`
	TruncateTable bool   `json:"truncateTable"`
	BatchSize     int    `json:"batchSize"`
}

// ReconcileAPIRequest specifies tables to compare across two connections.
type ReconcileAPIRequest struct {
	SourceConnID string `json:"sourceConnId"`
	SourceDSN    string `json:"sourceDsn"`
	SourceSchema string `json:"sourceSchema"`
	SourceTable  string `json:"sourceTable"`
	TargetConnID string `json:"targetConnId"`
	TargetDSN    string `json:"targetDsn"`
	TargetSchema string `json:"targetSchema"`
	TargetTable  string `json:"targetTable"`
	SampleLimit  int    `json:"sampleLimit"`
}

// FederatedQueryHandler executes a cross-connection federated query in ephemeral SQLite.
func (h *Handler) FederatedQueryHandler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20) // 2MB limit
	var req FederatedQueryAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	rawQuery := strings.TrimSpace(req.Query)
	if rawQuery == "" {
		sendError(w, http.StatusBadRequest, "query cannot be empty")
		return
	}

	// Build map of provided connections
	dsnMap := make(map[string]string)
	for k, v := range req.DSNs {
		dsnMap[k] = v
	}
	for _, c := range req.Connections {
		if c.ID != "" && c.DSN != "" {
			dsnMap[c.ID] = c.DSN
		}
	}

	resolver := func(ctx context.Context, connID string) (types.Driver, error) {
		// 1. Check direct client DSN map
		if dsn, exists := dsnMap[connID]; exists && strings.TrimSpace(dsn) != "" {
			entry, err := h.mgr.GetByDSN(dsn)
			if err != nil {
				return nil, err
			}
			return entry.Driver, nil
		}

		// 2. Check global server connections
		if globalDSN, ok := h.mgr.GetGlobalDSNByID(connID); ok {
			entry, err := h.mgr.GetByDSN(globalDSN)
			if err != nil {
				return nil, err
			}
			return entry.Driver, nil
		}

		// 3. If connID itself looks like a DSN
		if strings.Contains(connID, "://") || strings.HasPrefix(connID, "file:") {
			entry, err := h.mgr.GetByDSN(connID)
			if err != nil {
				return nil, err
			}
			return entry.Driver, nil
		}

		// 4. Fallback to header DSN if matches
		hdrDSN := strings.TrimSpace(r.Header.Get("X-DBLENS-DSN"))
		if hdrDSN != "" {
			entry, err := h.mgr.GetByDSN(hdrDSN)
			if err == nil {
				return entry.Driver, nil
			}
		}

		return nil, fmt.Errorf("connection %q could not be resolved; pass DSN in request connections", connID)
	}

	result, err := federation.ExecuteFederatedQuery(r.Context(), rawQuery, resolver, federation.QueryConfig{
		MaxRowsPerTable: req.Limit,
	})
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, result)
}

// DataPipeHandler clones or streams a table from source connection to target connection.
func (h *Handler) DataPipeHandler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	var req DataPipeAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if hasControlChars(req.SourceSchema) || hasControlChars(req.SourceTable) ||
		hasControlChars(req.TargetSchema) || hasControlChars(req.TargetTable) {
		sendError(w, http.StatusBadRequest, "table or schema name contains invalid control characters")
		return
	}

	if strings.TrimSpace(req.SourceTable) == "" {
		sendError(w, http.StatusBadRequest, "sourceTable is required")
		return
	}

	// Safe Mode / ReadOnly check on target
	if r.Header.Get("X-DBLENS-READONLY") == "true" {
		sendError(w, http.StatusForbidden, "target connection is in read-only safe mode; data pipe write blocked")
		return
	}

	// Resolve Source Driver
	srcEntry, err := h.resolveDriverWithFallback(r, req.SourceDSN, req.SourceConnID)
	if err != nil {
		sendError(w, http.StatusBadRequest, "source database connection failed: "+err.Error())
		return
	}

	// Resolve Target Driver
	tgtEntry, err := h.resolveDriverWithFallback(r, req.TargetDSN, req.TargetConnID)
	if err != nil {
		sendError(w, http.StatusBadRequest, "target database connection failed: "+err.Error())
		return
	}

	pipeReq := federation.PipeRequest{
		SourceConnID:  req.SourceConnID,
		TargetConnID:  req.TargetConnID,
		SourceSchema:  req.SourceSchema,
		SourceTable:   req.SourceTable,
		TargetSchema:  req.TargetSchema,
		TargetTable:   req.TargetTable,
		CreateTable:   req.CreateTable,
		TruncateTable: req.TruncateTable,
		BatchSize:     req.BatchSize,
	}

	res, err := federation.ExecutePipe(r.Context(), pipeReq, srcEntry.Driver, tgtEntry.Driver)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "data pipe execution failed: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, res)
}

// ReconcileHandler compares schema, row counts, and checksums between two connections.
func (h *Handler) ReconcileHandler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	var req ReconcileAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if hasControlChars(req.SourceSchema) || hasControlChars(req.SourceTable) ||
		hasControlChars(req.TargetSchema) || hasControlChars(req.TargetTable) {
		sendError(w, http.StatusBadRequest, "table or schema name contains invalid control characters")
		return
	}

	if strings.TrimSpace(req.SourceTable) == "" {
		sendError(w, http.StatusBadRequest, "sourceTable is required")
		return
	}

	srcEntry, err := h.resolveDriverWithFallback(r, req.SourceDSN, req.SourceConnID)
	if err != nil {
		sendError(w, http.StatusBadRequest, "source database connection failed: "+err.Error())
		return
	}

	tgtEntry, err := h.resolveDriverWithFallback(r, req.TargetDSN, req.TargetConnID)
	if err != nil {
		sendError(w, http.StatusBadRequest, "target database connection failed: "+err.Error())
		return
	}

	recReq := federation.ReconcileRequest{
		SourceConnID: req.SourceConnID,
		TargetConnID: req.TargetConnID,
		SourceSchema: req.SourceSchema,
		SourceTable:  req.SourceTable,
		TargetSchema: req.TargetSchema,
		TargetTable:  req.TargetTable,
		SampleLimit:  req.SampleLimit,
	}

	res, err := federation.ExecuteReconcile(r.Context(), recReq, srcEntry.Driver, tgtEntry.Driver)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "reconciliation failed: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, res)
}
