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
	"github.com/dblens/dblens/internal/impact"
)

func setupImpactTestEnv(t *testing.T) (http.Handler, string, func()) {
	dbFile := fmt.Sprintf("/tmp/dblens_api_impact_%d.db", time.Now().UnixNano())
	dsn := "sqlite://" + dbFile

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to init sqlite db: %v", err)
	}

	ctx := context.Background()
	initSQL := []string{
		"CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT);",
		"CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER, title TEXT, FOREIGN KEY (author_id) REFERENCES authors(id));",
		"CREATE VIEW v_author_books AS SELECT a.name, b.title FROM authors a JOIN books b ON a.id = b.author_id;",
		"CREATE TRIGGER trg_author_ins AFTER INSERT ON authors BEGIN INSERT INTO books (author_id, title) VALUES (NEW.id, 'Untitled Draft'); END;",
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

func TestImpactAPIEndpoints(t *testing.T) {
	router, dsn, cleanup := setupImpactTestEnv(t)
	defer cleanup()

	// 1. GET /api/connections/conn1/impact
	t.Run("GET /api/connections/{connId}/impact returns graph", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/connections/conn1/impact?schema=main&object=authors&object_type=table", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data  impact.ImpactGraph `json:"data"`
			Error *string            `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}
		if resp.Error != nil {
			t.Fatalf("unexpected api error: %s", *resp.Error)
		}
		if resp.Data.Root.Name != "authors" {
			t.Errorf("expected root authors, got %s", resp.Data.Root.Name)
		}
		if resp.Data.TotalDependents < 2 {
			t.Errorf("expected at least 2 dependents, got %d", resp.Data.TotalDependents)
		}
	})

	// 2. POST /api/connections/{connId}/impact/plan
	t.Run("POST /api/connections/{connId}/impact/plan returns safe drop plan", func(t *testing.T) {
		payload := api.ImpactPlanPayload{
			Schema:     "main",
			Object:     "authors",
			ObjectType: "table",
			Cascade:    true,
		}
		body, _ := json.Marshal(payload)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/impact/plan", bytes.NewReader(body))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data  impact.RemediationPlan `json:"data"`
			Error *string                `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}
		if resp.Error != nil {
			t.Fatalf("unexpected error: %s", *resp.Error)
		}
		if len(resp.Data.Steps) == 0 {
			t.Fatalf("expected plan steps, got 0")
		}
		if !strings.Contains(resp.Data.UpSQL, "DROP") {
			t.Errorf("expected UpSQL to have DROP statements")
		}
	})

	// 3. POST /api/connections/{connId}/impact/rename
	t.Run("POST /api/connections/{connId}/impact/rename returns rename plan", func(t *testing.T) {
		payload := api.ImpactRenamePayload{
			Schema:     "main",
			Object:     "authors",
			ObjectType: "table",
			NewName:    "writers",
		}
		body, _ := json.Marshal(payload)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/impact/rename", bytes.NewReader(body))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data  impact.RenamePlan `json:"data"`
			Error *string           `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}
		if resp.Data.NewName != "writers" {
			t.Errorf("expected new_name 'writers', got %s", resp.Data.NewName)
		}
		if !strings.Contains(resp.Data.UpSQL, "RENAME TO \"writers\"") {
			t.Errorf("expected UpSQL to contain rename, got: %s", resp.Data.UpSQL)
		}
	})

	// 4. GET /api/connections/{connId}/impact/export.md
	t.Run("GET /api/connections/{connId}/impact/export.md returns markdown report", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/connections/conn1/impact/export.md?schema=main&object=authors&object_type=table", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		ct := rec.Header().Get("Content-Type")
		if !strings.HasPrefix(ct, "text/markdown") {
			t.Errorf("expected text/markdown content type, got: %s", ct)
		}
		if !strings.Contains(rec.Body.String(), "# Schema Object Impact Report: `authors`") {
			t.Errorf("expected markdown report body to contain title")
		}
	})

	// 5. POST /api/connections/{connId}/impact/export.md
	t.Run("POST /api/connections/{connId}/impact/export.md returns markdown report", func(t *testing.T) {
		payload := api.ImpactPlanPayload{
			Schema:     "main",
			Object:     "authors",
			ObjectType: "table",
			Cascade:    true,
		}
		body, _ := json.Marshal(payload)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/impact/export.md", bytes.NewReader(body))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "# Schema Object Impact Report: `authors`") {
			t.Errorf("expected markdown report title in body")
		}
	})
}
