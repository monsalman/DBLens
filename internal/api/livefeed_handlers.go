package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/dblens/dblens/internal/livefeed"
)

// activeFeeds tracks number of open SSE live-feed connections.
var activeFeeds int64

// LiveTableFeed streams row-level change events via SSE.
//
// Connection resolution: the X-DBLENS-DSN header (project convention) first,
// then ?dsn= (the native browser EventSource API cannot set custom headers, so
// the drawer passes the DSN as a query parameter), then the server-seeded
// global_* connection for {connId}. The pool is resolved ONCE, before the
// poller starts — never re-dialled per tick.
//
// Query params: schema, table, interval (seconds, float, min 0.5, max 30, default 2)
func (h *Handler) LiveTableFeed(w http.ResponseWriter, r *http.Request) {
	table := r.URL.Query().Get("table")
	if table == "" {
		sendError(w, http.StatusBadRequest, "table param required")
		return
	}
	schema := r.URL.Query().Get("schema")

	// Reject a NUL byte before anything else touches the identifier.
	for _, ident := range []string{schema, table} {
		if containsNUL(ident) {
			sendError(w, http.StatusBadRequest, "identifier contains a NUL byte")
			return
		}
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

	// ── Resolve the connection ONCE and cache the driver in the closure ──
	target := h.resolveConnTarget(r)
	entry, err := h.pool(target)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	dialect := entry.Driver.Dialect()

	execFunc := func(_ string, sql string, _ []interface{}) ([]map[string]interface{}, error) {
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
		ConnID:       target.ConnID,
		Schema:       schema,
		Table:        table,
		PollInterval: pollInterval,
		Dialect:      dialect,
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
	errs := make(chan livefeed.ErrorEvent, 4)

	if err := poller.StartWithErrors(ctx, events, errs); err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer poller.Stop()

	// Send connected event.
	connected := map[string]interface{}{
		"type":     "connected",
		"table":    table,
		"schema":   schema,
		"interval": intervalSec,
		"dialect":  dialect,
	}
	b, _ := json.Marshal(connected)
	fmt.Fprintf(w, "data: %s\n\n", b)
	flusher.Flush()

	// Heartbeat keeps proxies from closing an idle stream and tells the client
	// the connection is alive even when the table has no changes.
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case errEv := <-errs:
			// Terminal error: tell the client instead of silently going quiet.
			if b, mErr := json.Marshal(errEv); mErr == nil {
				fmt.Fprintf(w, "data: %s\n\n", b)
				flusher.Flush()
			} else {
				fmt.Fprintf(w, "data: {\"type\":\"error\",\"message\":%q}\n\n", errEv.Message)
				flusher.Flush()
			}
			return
		case ev := <-events:
			b, err := json.Marshal(ev)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
		case <-heartbeat.C:
			// SSE comment frame: ignored by EventSource onmessage, keeps the
			// stream from being buffered/closed by intermediaries.
			fmt.Fprint(w, ": keep-alive\n\n")
			flusher.Flush()
		}
	}
}

// LiveFeedStatus returns the count of active SSE live-feed connections.
func (h *Handler) LiveFeedStatus(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, map[string]int64{"active_feeds": atomic.LoadInt64(&activeFeeds)})
}

// containsNUL reports whether s contains a NUL byte.
func containsNUL(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] == 0 {
			return true
		}
	}
	return false
}
