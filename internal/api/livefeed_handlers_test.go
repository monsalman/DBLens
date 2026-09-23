package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLiveFeedStatus(t *testing.T) {
	h := &Handler{}
	req := httptest.NewRequest(http.MethodGet, "/api/live-feed/status", nil)
	w := httptest.NewRecorder()
	h.LiveFeedStatus(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "active_feeds") {
		t.Fatalf("expected active_feeds in body, got: %s", w.Body.String())
	}
}

func TestLiveTableFeed_MissingTable(t *testing.T) {
	h := &Handler{}
	req := httptest.NewRequest(http.MethodGet, "/api/connections/test/live-feed", nil)
	w := httptest.NewRecorder()
	h.LiveTableFeed(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing table, got %d", w.Code)
	}
}
