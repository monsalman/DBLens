package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/healthmon"
	"github.com/go-chi/chi/v5"
)

func newHealthHandler() (*Handler, chi.Router) {
	h := &Handler{healthMon: healthmon.New(), shutdownCh: make(chan struct{})}
	r := chi.NewRouter()
	r.Get("/api/health/connections", h.HealthConnections)
	r.Get("/api/health/stream", h.HealthStream)
	return h, r
}

func TestHealthConnectionsSnapshot(t *testing.T) {
	h, r := newHealthHandler()
	for i := 0; i < 3; i++ {
		h.healthMon.Record("global_1", 12, true)
	}
	h.healthMon.Record("global_2", 0, false)

	w := doJSON(t, r, http.MethodGet, "/api/health/connections", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var out struct {
		Data struct {
			Connections []healthmon.ConnectionHealth `json:"connections"`
			Summary     healthmon.Summary            `json:"summary"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (body=%s)", err, w.Body.String())
	}
	if len(out.Data.Connections) != 2 {
		t.Fatalf("expected 2 connections, got %d", len(out.Data.Connections))
	}
	if out.Data.Summary.Total != 2 || out.Data.Summary.Healthy != 1 || out.Data.Summary.Degraded != 1 {
		t.Fatalf("unexpected summary: %+v", out.Data.Summary)
	}
	if !strings.Contains(encodeJSON(out.Data.Connections), `"status":"green"`) {
		t.Fatalf("expected a green connection in %s", w.Body.String())
	}
}

func TestHealthConnectionsUnavailable(t *testing.T) {
	h := &Handler{}
	req := httptest.NewRequest(http.MethodGet, "/api/health/connections", nil)
	w := httptest.NewRecorder()
	h.HealthConnections(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 without a monitor, got %d", w.Code)
	}
}

func TestHealthStreamSendsSSEFrame(t *testing.T) {
	h, _ := newHealthHandler()
	for i := 0; i < 3; i++ {
		h.healthMon.Record("global_1", 8, true)
	}

	// The first frame is written on connect; cancelling the request context
	// makes the ticker loop return immediately, so the test never sleeps.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/health/stream", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	h.HealthStream(w, req)

	if ct := w.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("expected text/event-stream, got %q", ct)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("expected no-cache, got %q", cc)
	}
	body := w.Body.String()
	if !strings.HasPrefix(body, "data: ") || !strings.HasSuffix(body, "\n\n") {
		t.Fatalf("expected a data: frame, got %q", body)
	}
	if !strings.Contains(body, `"connection_id":"global_1"`) || !strings.Contains(body, `"summary"`) {
		t.Fatalf("expected connection + summary in frame, got %q", body)
	}
}

func TestHealthStreamStopsOnShutdown(t *testing.T) {
	h, _ := newHealthHandler()
	close(h.shutdownCh)

	req := httptest.NewRequest(http.MethodGet, "/api/health/stream", nil)
	w := httptest.NewRecorder()
	h.HealthStream(w, req) // must return, not block forever

	if !strings.Contains(w.Body.String(), "data: ") {
		t.Fatalf("expected the initial frame before shutdown, got %q", w.Body.String())
	}
}
