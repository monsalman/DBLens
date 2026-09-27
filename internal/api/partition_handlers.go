package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/partition"
	"github.com/go-chi/chi/v5"
)

// GetPartitions inspects partition topology for a given connection and table.
// GET /api/connections/{connId}/partitions?schema={schema}&table={table}
func (h *Handler) GetPartitions(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	table := strings.TrimSpace(r.URL.Query().Get("table"))
	schema := strings.TrimSpace(r.URL.Query().Get("schema"))
	if table == "" {
		sendError(w, http.StatusBadRequest, "table query parameter is required")
		return
	}

	topo, err := partition.InspectTopology(r.Context(), entry.Driver, schema, table)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to inspect partitions: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, topo)
}

// GeneratePartitionDDL generates DDL to create upcoming partitions.
// POST /api/connections/{connId}/partitions/generate-ddl
func (h *Handler) GeneratePartitionDDL(w http.ResponseWriter, r *http.Request) {
	var req partition.GeneratePartitionDDLRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request payload: "+err.Error())
		return
	}

	if strings.TrimSpace(req.ParentTable) == "" {
		sendError(w, http.StatusBadRequest, "parentTable is required")
		return
	}

	if req.Dialect == "" {
		if entry, err := h.resolveDriver(r); err == nil && entry != nil && entry.Driver != nil {
			req.Dialect = entry.Driver.Dialect()
		}
	}

	plan, err := partition.GenerateUpcomingDDL(req)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, plan)
}

// DetachPartition detaches or drops a partition from the parent table.
// POST /api/connections/{connId}/partitions/detach
func (h *Handler) DetachPartition(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req partition.DetachPartitionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request payload: "+err.Error())
		return
	}

	if strings.TrimSpace(req.ParentTable) == "" || strings.TrimSpace(req.PartitionName) == "" {
		sendError(w, http.StatusBadRequest, "parentTable and partitionName are required")
		return
	}

	dialect := entry.Driver.Dialect()
	ddl, err := partition.GenerateDetachDDL(req, dialect)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	if _, err := entry.Driver.ExecuteRaw(r.Context(), ddl); err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to execute detach DDL: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"ddl":     ddl,
		"message": fmt.Sprintf("Partition %s detached successfully", req.PartitionName),
	})
}

// GetPartitionHealth returns health, skew, and maintenance recommendations for table partitions.
// GET /api/connections/{connId}/partitions/health?schema={schema}&table={table}
func (h *Handler) GetPartitionHealth(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	table := strings.TrimSpace(r.URL.Query().Get("table"))
	schema := strings.TrimSpace(r.URL.Query().Get("schema"))

	if table != "" {
		topo, err := partition.InspectTopology(r.Context(), entry.Driver, schema, table)
		if err != nil {
			sendError(w, http.StatusInternalServerError, "Failed to inspect partition health: "+err.Error())
			return
		}
		sendJSON(w, http.StatusOK, topo.HealthReport)
		return
	}

	// Multiple table inspection if table omitted
	tables, err := entry.Driver.InspectTables(r.Context(), schema)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to list tables: "+err.Error())
		return
	}

	reports := make([]*partition.PartitionHealthReport, 0)
	limit := 10
	if len(tables) < limit {
		limit = len(tables)
	}

	for i := 0; i < limit; i++ {
		tMeta := tables[i]
		if tMeta.Type == "view" {
			continue
		}
		topo, err := partition.InspectTopology(r.Context(), entry.Driver, tMeta.Schema, tMeta.Name)
		if err == nil && topo != nil && len(topo.Partitions) > 0 {
			reports = append(reports, topo.HealthReport)
		}
	}

	sendJSON(w, http.StatusOK, reports)
}

// ExportPartitionMD exports the partition topology as a formatted Markdown report.
// GET /api/connections/{connId}/partitions/export.md?schema={schema}&table={table}
func (h *Handler) ExportPartitionMD(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	table := strings.TrimSpace(r.URL.Query().Get("table"))
	schema := strings.TrimSpace(r.URL.Query().Get("schema"))
	if table == "" {
		sendError(w, http.StatusBadRequest, "table query parameter is required")
		return
	}

	connID := chi.URLParam(r, "connId")
	topo, err := partition.InspectTopology(r.Context(), entry.Driver, schema, table)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to inspect partitions: "+err.Error())
		return
	}

	md := partition.RenderMarkdown(topo)

	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	if r.URL.Query().Get("download") != "false" {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"partition-topology-%s-%s.md\"", connID, table))
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(md))
}
