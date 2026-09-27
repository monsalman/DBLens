package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/snapshot"
	"github.com/go-chi/chi/v5"
)

type CaptureSnapshotRequest struct {
	Label       string `json:"label"`
	Tag         string `json:"tag"`
	Description string `json:"description"`
	Schema      string `json:"schema"`
}

type DiffSnapshotsRequest struct {
	BaseID   string `json:"baseId"`
	TargetID string `json:"targetId"`
	Live     bool   `json:"live"`
	Schema   string `json:"schema"`
}

type RollbackPlanRequest struct {
	BaseID   string                 `json:"baseId"`
	TargetID string                 `json:"targetId"`
	Diff     *snapshot.SnapshotDiff `json:"diff,omitempty"`
}

// ListSnapshots returns all stored schema snapshots for the given connection.
// GET /api/connections/{connId}/snapshots
func (h *Handler) ListSnapshots(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	if strings.TrimSpace(connID) == "" {
		sendError(w, http.StatusBadRequest, "connId is required")
		return
	}

	store := h.getSnapshotStore()
	snapshots, err := store.List(connID)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to list snapshots: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, snapshots)
}

// CaptureSnapshot captures the current live database schema and persists it into the snapshot vault.
// POST /api/connections/{connId}/snapshots/capture
func (h *Handler) CaptureSnapshot(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	if strings.TrimSpace(connID) == "" {
		sendError(w, http.StatusBadRequest, "connId is required")
		return
	}

	var req CaptureSnapshotRequest
	if r.Body != nil && r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
			return
		}
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, "Database connection not found: "+err.Error())
		return
	}

	snap, err := snapshot.CaptureSnapshot(
		r.Context(),
		entry.Driver,
		connID,
		req.Label,
		req.Tag,
		req.Description,
		req.Schema,
	)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to capture snapshot: "+err.Error())
		return
	}

	store := h.getSnapshotStore()
	if err := store.Save(snap); err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to persist snapshot: "+err.Error())
		return
	}

	sendJSON(w, http.StatusCreated, snap)
}

// DiffSnapshots compares two snapshots, or compares a snapshot against the current live database.
// POST /api/connections/{connId}/snapshots/diff
func (h *Handler) DiffSnapshots(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	if strings.TrimSpace(connID) == "" {
		sendError(w, http.StatusBadRequest, "connId is required")
		return
	}

	var req DiffSnapshotsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if strings.TrimSpace(req.BaseID) == "" {
		sendError(w, http.StatusBadRequest, "baseId is required")
		return
	}

	store := h.getSnapshotStore()
	baseSnap, err := store.Get(connID, req.BaseID)
	if err != nil {
		sendError(w, http.StatusNotFound, "Base snapshot not found: "+err.Error())
		return
	}

	var targetSnap *snapshot.SchemaSnapshot
	if req.Live || req.TargetID == "" || strings.EqualFold(req.TargetID, "live") {
		entry, err := h.resolveDriver(r)
		if err != nil {
			sendError(w, http.StatusBadRequest, "Cannot inspect live database: "+err.Error())
			return
		}
		liveSnap, err := snapshot.CaptureSnapshot(
			r.Context(),
			entry.Driver,
			connID,
			"Live Database",
			"live",
			"Current active database schema state",
			req.Schema,
		)
		if err != nil {
			sendError(w, http.StatusInternalServerError, "Failed to inspect live schema: "+err.Error())
			return
		}
		liveSnap.ID = "live"
		targetSnap = liveSnap
	} else {
		targetSnap, err = store.Get(connID, req.TargetID)
		if err != nil {
			sendError(w, http.StatusNotFound, "Target snapshot not found: "+err.Error())
			return
		}
	}

	diffResult := snapshot.Diff(baseSnap, targetSnap)
	sendJSON(w, http.StatusOK, diffResult)
}

// GenerateRollbackPlan creates forward UP and reverse DOWN migration scripts from a diff or snapshot pair.
// POST /api/connections/{connId}/snapshots/rollback-plan
func (h *Handler) GenerateRollbackPlan(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	if strings.TrimSpace(connID) == "" {
		sendError(w, http.StatusBadRequest, "connId is required")
		return
	}

	var req RollbackPlanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	diff := req.Diff
	if diff == nil {
		if strings.TrimSpace(req.BaseID) == "" || strings.TrimSpace(req.TargetID) == "" {
			sendError(w, http.StatusBadRequest, "Either diff or both baseId and targetId are required")
			return
		}

		store := h.getSnapshotStore()
		baseSnap, err := store.Get(connID, req.BaseID)
		if err != nil {
			sendError(w, http.StatusNotFound, "Base snapshot not found: "+err.Error())
			return
		}

		targetSnap, err := store.Get(connID, req.TargetID)
		if err != nil {
			sendError(w, http.StatusNotFound, "Target snapshot not found: "+err.Error())
			return
		}

		diff = snapshot.Diff(baseSnap, targetSnap)
	}

	plan := snapshot.GenerateRollbackPlan(diff)
	sendJSON(w, http.StatusOK, plan)
}

// DeleteSnapshot deletes an archived snapshot from the vault.
// DELETE /api/connections/{connId}/snapshots/{id}
func (h *Handler) DeleteSnapshot(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	id := chi.URLParam(r, "id")

	if strings.TrimSpace(connID) == "" || strings.TrimSpace(id) == "" {
		sendError(w, http.StatusBadRequest, "connId and id are required")
		return
	}

	store := h.getSnapshotStore()
	if err := store.Delete(connID, id); err != nil {
		sendError(w, http.StatusNotFound, "Failed to delete snapshot: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Snapshot deleted successfully",
	})
}
