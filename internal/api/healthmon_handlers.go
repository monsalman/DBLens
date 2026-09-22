package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/dblens/dblens/internal/healthmon"
)

// healthStreamTick is how often the SSE loop re-reads the in-memory monitor.
// It never re-runs a query: the prober owns probing, the stream only pushes.
const healthStreamTick = 5 * time.Second

// requireHealthMonitor reports the response and returns false when the monitor
// failed to initialise at startup.
func (h *Handler) requireHealthMonitor(w http.ResponseWriter) bool {
	if h == nil || h.healthMon == nil {
		sendError(w, http.StatusInternalServerError, "health monitor unavailable")
		return false
	}
	return true
}

// HealthConnections returns the current per-connection health snapshot plus the
// status summary. Response shape: {connections: [...], summary: {...}}.
func (h *Handler) HealthConnections(w http.ResponseWriter, r *http.Request) {
	if !h.requireHealthMonitor(w) {
		return
	}
	snapshot := h.healthMon.Snapshot()
	if snapshot == nil {
		snapshot = []healthmon.ConnectionHealth{}
	}
	sendJSON(w, http.StatusOK, map[string]interface{}{
		"connections": snapshot,
		"summary":     h.healthMon.Summary(),
	})
}

// HealthStream pushes the health snapshot as Server-Sent Events. The first
// frame is the current state on connect, then one frame every healthStreamTick
// read straight from the monitor (no database round-trip per tick).
func (h *Handler) HealthStream(w http.ResponseWriter, r *http.Request) {
	if !h.requireHealthMonitor(w) {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		sendError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	frame := func() bool {
		payload := map[string]interface{}{
			"connections": h.healthMon.Snapshot(),
			"summary":     h.healthMon.Summary(),
		}
		body := encodeJSON(payload)
		if body == "" {
			return false
		}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", body); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	if !frame() {
		return
	}

	ticker := time.NewTicker(healthStreamTick)
	defer ticker.Stop()
	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-h.shutdownSignal():
			return
		case <-ticker.C:
			if !frame() {
				return
			}
		}
	}
}

// shutdownSignal exposes the handler's shutdown channel so the SSE loop exits
// when the process is draining, not only when the client disconnects.
func (h *Handler) shutdownSignal() <-chan struct{} {
	if h.shutdownCh == nil {
		return nil // nil channel: select blocks on it forever, which is correct
	}
	return h.shutdownCh
}
