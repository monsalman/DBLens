package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/lockmgr"
	"github.com/go-chi/chi/v5"
)

// lockStreamTick defines the polling frequency for the lock tree SSE stream.
const lockStreamTick = 2 * time.Second

// GetLocks inspects and returns the database lock tree snapshot.
// GET /api/connections/{connId}/locks
func (h *Handler) GetLocks(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveLockDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	resp, err := lockmgr.InspectLocks(r.Context(), entry.Driver)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, resp)
}

// StreamLocks streams real-time database lock updates over Server-Sent Events (SSE).
// GET /api/connections/{connId}/locks/stream
func (h *Handler) StreamLocks(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		sendError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	entry, err := h.resolveLockDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{})

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	sendFrame := func() bool {
		resp, err := lockmgr.InspectLocks(r.Context(), entry.Driver)
		if err != nil {
			return true // continue listening on transient inspection error
		}
		body := encodeJSON(resp)
		if body == "" {
			return false
		}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", body); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	if !sendFrame() {
		return
	}

	ticker := time.NewTicker(lockStreamTick)
	defer ticker.Stop()
	ctx := r.Context()

	for {
		select {
		case <-ctx.Done():
			return
		case <-h.shutdownSignal():
			return
		case <-ticker.C:
			if !sendFrame() {
				return
			}
		}
	}
}

// TerminateLock terminates or cancels a blocking session.
// POST /api/connections/{connId}/locks/terminate
func (h *Handler) TerminateLock(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only")
		return
	}

	entry, err := h.resolveLockDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req lockmgr.TerminateLockRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if req.PID <= 0 {
		sendError(w, http.StatusBadRequest, "Valid positive pid is required")
		return
	}

	if err := lockmgr.TerminateSession(r.Context(), entry.Driver, req.PID, req.Force); err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Session %d terminated", req.PID),
		"pid":     req.PID,
	})
}

// ExportLocksJSON exports the lock graph snapshot as downloadable JSON.
// GET /api/connections/{connId}/locks/export.json
func (h *Handler) ExportLocksJSON(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveLockDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	resp, err := lockmgr.InspectLocks(r.Context(), entry.Driver)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	raw, err := json.MarshalIndent(resp, "", "  ")
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to marshal lock export: "+err.Error())
		return
	}

	connID := chi.URLParam(r, "connId")
	if strings.TrimSpace(connID) == "" {
		connID = "session"
	}
	filename := fmt.Sprintf("locks-%s-%d.json", connID, time.Now().Unix())

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func (h *Handler) resolveLockDriver(r *http.Request) (*connection.PoolEntry, error) {
	target := h.resolveConnTarget(r)
	if target.DSN != "" || target.ConnID != "" {
		if entry, err := h.pool(target); err == nil && entry != nil {
			return entry, nil
		}
	}
	return h.resolveDriver(r)
}
