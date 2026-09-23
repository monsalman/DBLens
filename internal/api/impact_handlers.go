package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/dblens/dblens/internal/impact"
)

// ImpactPlanPayload specifies input options for generating a safe-drop plan.
type ImpactPlanPayload struct {
	Schema     string              `json:"schema"`
	Object     string              `json:"object"`
	ObjectType string              `json:"object_type"`
	Column     string              `json:"column,omitempty"`
	Depth      int                 `json:"depth,omitempty"`
	Cascade    bool                `json:"cascade,omitempty"`
	Graph      *impact.ImpactGraph `json:"graph,omitempty"`
}

// ImpactRenamePayload specifies input options for renaming an object or column.
type ImpactRenamePayload struct {
	Schema     string `json:"schema"`
	Object     string `json:"object"`
	ObjectType string `json:"object_type"`
	Column     string `json:"column,omitempty"`
	NewName    string `json:"new_name"`
}

// GetImpactHandler inspects dependencies for a schema object or column.
// GET /api/connections/{connId}/impact
func (h *Handler) GetImpactHandler(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	object := strings.TrimSpace(r.URL.Query().Get("object"))
	if object == "" {
		object = strings.TrimSpace(r.URL.Query().Get("table"))
	}
	if object == "" {
		sendError(w, http.StatusBadRequest, "object parameter is required")
		return
	}

	schema := strings.TrimSpace(r.URL.Query().Get("schema"))
	objectType := strings.TrimSpace(r.URL.Query().Get("object_type"))
	column := strings.TrimSpace(r.URL.Query().Get("column"))
	depthStr := strings.TrimSpace(r.URL.Query().Get("depth"))

	depth := 5
	if depthStr != "" {
		if d, err := strconv.Atoi(depthStr); err == nil && d > 0 {
			depth = d
		}
	}

	graph, err := impact.AnalyzeImpact(r.Context(), entry.Driver, impact.ImpactRequest{
		Schema:     schema,
		Object:     object,
		ObjectType: objectType,
		Column:     column,
		Depth:      depth,
	})
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, graph)
}

// CreateImpactPlanHandler builds an ordered safe drop plan with reversible UP/DOWN scripts.
// POST /api/connections/{connId}/impact/plan
func (h *Handler) CreateImpactPlanHandler(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var payload ImpactPlanPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request payload: "+err.Error())
		return
	}

	graph := payload.Graph
	if graph == nil {
		if payload.Object == "" {
			sendError(w, http.StatusBadRequest, "object is required")
			return
		}
		depth := payload.Depth
		if depth <= 0 {
			depth = 5
		}
		var err error
		graph, err = impact.AnalyzeImpact(r.Context(), entry.Driver, impact.ImpactRequest{
			Schema:     payload.Schema,
			Object:     payload.Object,
			ObjectType: payload.ObjectType,
			Column:     payload.Column,
			Depth:      depth,
		})
		if err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	plan, err := impact.BuildRemediationPlan(r.Context(), entry.Driver, graph, payload.Cascade)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, plan)
}

// CreateImpactRenameHandler builds an ordered rename plan and DDL.
// POST /api/connections/{connId}/impact/rename
func (h *Handler) CreateImpactRenameHandler(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var payload ImpactRenamePayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request payload: "+err.Error())
		return
	}

	if payload.Object == "" || payload.NewName == "" {
		sendError(w, http.StatusBadRequest, "object and new_name are required")
		return
	}

	graph, err := impact.AnalyzeImpact(r.Context(), entry.Driver, impact.ImpactRequest{
		Schema:     payload.Schema,
		Object:     payload.Object,
		ObjectType: payload.ObjectType,
		Column:     payload.Column,
		Depth:      5,
	})
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	renamePlan, err := impact.BuildRenamePlan(r.Context(), entry.Driver, graph, impact.RenameRequest{
		Schema:     payload.Schema,
		Object:     payload.Object,
		ObjectType: payload.ObjectType,
		Column:     payload.Column,
		NewName:    payload.NewName,
	})
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, renamePlan)
}

// ExportImpactMDHandler generates and downloads a structured markdown impact report.
// GET /api/connections/{connId}/impact/export.md
// POST /api/connections/{connId}/impact/export.md
func (h *Handler) ExportImpactMDHandler(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var schema, object, objectType, column string
	var cascade bool
	var depth int = 5
	var directGraph *impact.ImpactGraph

	if r.Method == http.MethodPost {
		bodyBytes, err := io.ReadAll(r.Body)
		if err == nil && len(bodyBytes) > 0 {
			var payload ImpactPlanPayload
			if json.Unmarshal(bodyBytes, &payload) == nil {
				schema = payload.Schema
				object = payload.Object
				objectType = payload.ObjectType
				column = payload.Column
				cascade = payload.Cascade
				if payload.Depth > 0 {
					depth = payload.Depth
				}
				directGraph = payload.Graph
			}
		}
	}

	if directGraph == nil && object == "" {
		object = strings.TrimSpace(r.URL.Query().Get("object"))
		if object == "" {
			object = strings.TrimSpace(r.URL.Query().Get("table"))
		}
		schema = strings.TrimSpace(r.URL.Query().Get("schema"))
		objectType = strings.TrimSpace(r.URL.Query().Get("object_type"))
		column = strings.TrimSpace(r.URL.Query().Get("column"))
		cascade = strings.EqualFold(r.URL.Query().Get("cascade"), "true")
		if d, err := strconv.Atoi(r.URL.Query().Get("depth")); err == nil && d > 0 {
			depth = d
		}
	}

	if directGraph == nil && object == "" {
		http.Error(w, "object parameter is required", http.StatusBadRequest)
		return
	}

	graph := directGraph
	if graph == nil {
		var err error
		graph, err = impact.AnalyzeImpact(r.Context(), entry.Driver, impact.ImpactRequest{
			Schema:     schema,
			Object:     object,
			ObjectType: objectType,
			Column:     column,
			Depth:      depth,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	plan, err := impact.BuildRemediationPlan(r.Context(), entry.Driver, graph, cascade)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	md := impact.ExportMarkdown(graph, plan)
	filename := graph.Root.Name
	if filename == "" {
		filename = "object"
	}

	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"impact-%s.md\"", filename))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, bytes.NewReader([]byte(md)))
}
