package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/dblens/dblens/internal/livefeed"
	"github.com/go-chi/chi/v5"
)

// activeFeeds tracks number of open SSE live-feed connections.
var activeFeeds int64

// LiveTableFeed streams row-level change events via SSE.
// Query params: schema, table, interval (seconds, float, min 0.5, max 30, default 2)
func (h *Handler) LiveTableFeed(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	schema := r.URL.Query().Get("schema")
	table := r.URL.Query().Get("table")
	if table == "" {
		sendError(w, http.StatusBadRequest, "table param required")
		return
	}

	intervalSec := 2.0
	if s := r.URL.Query().Get("interval"); s != "" {
		if v, err := strconv.ParseFloat(s, 64); err == nil {
			intervalSec = v
		}
	}
	if intervalSec < 0.5 {
		intervalSec = 0.5
	}
	if intervalSec > 30 {
		intervalSec = 30
	}

	pollInterval := time.Duration(intervalSec * float64(time.Second))

	// Build exec func using the connection manager.
	execFunc := func(cID, sql string, _ []interface{}) ([]map[string]interface{}, error) {
		var dsn string
		var ok bool
		if dsn, ok = h.mgr.GetGlobalDSNByID(cID); !ok {
			return nil, fmt.Errorf("connection not found: %s", cID)
		}
		entry, err := h.mgr.GetByDSN(dsn)
		if err != nil {
			return nil, err
		}
		res, err := entry.Driver.ExecuteQuery(r.Context(), sql)
		if err != nil {
			return nil, err
		}
		rows := make([]map[string]interface{}, 0, len(res.Rows))
		for _, row := range res.Rows {
			m := make(map[string]interface{}, len(res.Columns))
			for i, col := range res.Columns {
				if i < len(row) {
					m[col] = row[i]
				}
			}
			rows = append(rows, m)
		}
		return rows, nil
	}

	cfg := livefeed.FeedConfig{
		ConnID:       connID,
		Schema:       schema,
		Table:        table,
		PollInterval: pollInterval,
	}
	poller := livefeed.NewPoller(cfg, execFunc)

	// SSE headers.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		sendError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	atomic.AddInt64(&activeFeeds, 1)
	defer atomic.AddInt64(&activeFeeds, -1)

	ctx := r.Context()
	events := make(chan livefeed.ChangeEvent, 64)

	_ = poller.Start(ctx, events)
	defer poller.Stop()

	// Send connected event.
	connected := map[string]interface{}{
		"type":     "connected",
		"table":    table,
		"schema":   schema,
		"interval": intervalSec,
	}
	b, _ := json.Marshal(connected)
	fmt.Fprintf(w, "data: %s\n\n", b)
	flusher.Flush()

	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-events:
			b, err := json.Marshal(ev)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
		}
	}
}

// LiveFeedStatus returns the count of active SSE live-feed connections.
func (h *Handler) LiveFeedStatus(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, map[string]int64{"active_feeds": atomic.LoadInt64(&activeFeeds)})
}
