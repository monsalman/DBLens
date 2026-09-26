package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/lockmgr"
)

func setupLockTestEnv(t *testing.T) (http.Handler, string, func()) {
	dbFile := fmt.Sprintf("/tmp/dblens_api_lock_%d.db", time.Now().UnixNano())
	dsn := "sqlite://" + dbFile

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to init sqlite db: %v", err)
	}

	ctx := context.Background()
	initSQL := []string{
		"CREATE TABLE lock_test (id INTEGER PRIMARY KEY, name TEXT);",
		"INSERT INTO lock_test VALUES (1, 'initial');",
	}
	for _, sql := range initSQL {
		if _, err := entry.Driver.ExecuteRaw(ctx, sql); err != nil {
			t.Fatalf("failed init sql: %v", err)
		}
	}

	h, err := api.NewHandler(mgr)
	if err != nil {
		t.Fatalf("failed to create api handler: %v", err)
	}

	router := api.SetupRouter(h, api.RouterConfig{})

	cleanup := func() {
		h.Shutdown()
		_ = os.Remove(dbFile)
	}

	return router, dsn, cleanup
}

func TestLockManagerEndpoints(t *testing.T) {
	router, dsn, cleanup := setupLockTestEnv(t)
	defer cleanup()

	// 1. GET /api/connections/{connId}/locks
	t.Run("GET /api/connections/{connId}/locks returns lock tree response", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/connections/test-conn/locks", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var envelope struct {
			Data lockmgr.LockTreeResponse `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		resp := envelope.Data

		if resp.Dialect != "sqlite" {
			t.Errorf("expected dialect sqlite, got %s", resp.Dialect)
		}
		if resp.TotalLocks < 1 {
			t.Errorf("expected at least 1 lock coordinator node for sqlite, got %d", resp.TotalLocks)
		}
	})

	// 2. GET /api/connections/{connId}/locks/stream
	t.Run("GET /api/connections/{connId}/locks/stream produces SSE event", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()

		req := httptest.NewRequest(http.MethodGet, "/api/connections/test-conn/locks/stream", nil).WithContext(ctx)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()

		// Serve in goroutine because stream loops until context cancelled
		done := make(chan struct{})
		go func() {
			router.ServeHTTP(rec, req)
			close(done)
		}()
		<-done

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		contentType := rec.Header().Get("Content-Type")
		if !strings.Contains(contentType, "text/event-stream") {
			t.Errorf("expected text/event-stream, got %s", contentType)
		}
		body := rec.Body.String()
		if !strings.Contains(body, "data: {") {
			t.Errorf("expected SSE data frame in response, got: %s", body)
		}
	})

	// 3. POST /api/connections/{connId}/locks/terminate rejects read-only connections
	t.Run("POST /api/connections/{connId}/locks/terminate rejects X-DBLENS-READONLY", func(t *testing.T) {
		body := []byte(`{"pid": 1234, "force": true}`)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/locks/terminate", bytes.NewReader(body))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 4. POST /api/connections/{connId}/locks/terminate rejects invalid pid
	t.Run("POST /api/connections/{connId}/locks/terminate rejects invalid pid", func(t *testing.T) {
		body := []byte(`{"pid": 0, "force": false}`)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/locks/terminate", bytes.NewReader(body))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 5. GET /api/connections/{connId}/locks/export.json
	t.Run("GET /api/connections/{connId}/locks/export.json exports formatted json", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/connections/test-conn/locks/export.json", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Header().Get("Content-Type"), "application/json") {
			t.Errorf("expected application/json, got %s", rec.Header().Get("Content-Type"))
		}
		if !strings.Contains(rec.Header().Get("Content-Disposition"), "attachment; filename=\"locks-") {
			t.Errorf("expected attachment header, got %s", rec.Header().Get("Content-Disposition"))
		}

		var resp lockmgr.LockTreeResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode exported json: %v", err)
		}
		if resp.Dialect != "sqlite" {
			t.Errorf("expected dialect sqlite in export, got %s", resp.Dialect)
		}
	})
}
