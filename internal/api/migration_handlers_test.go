package api_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/migration"
)

func TestMigrationEndpoints(t *testing.T) {
	dbFile := fmt.Sprintf("/tmp/dblens_api_migration_%d.db", time.Now().UnixNano())
	defer os.Remove(dbFile)

	dsn := "sqlite://" + dbFile
	mgr := connection.NewManager()
	h, err := api.NewHandler(mgr)
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}
	t.Cleanup(h.Shutdown)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. GET /api/connections/{connId}/migrations before init
	t.Run("Get Migrations Before Init", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/connections/c1/migrations", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data  api.MigrationListResponse `json:"data"`
			Error *string                   `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed decoding response: %v", err)
		}
		if resp.Data.Initialized {
			t.Fatalf("expected tracker not initialized initially")
		}
		if len(resp.Data.Migrations) != 0 {
			t.Fatalf("expected 0 migrations, got %d", len(resp.Data.Migrations))
		}
	})

	// 2. ReadOnly block on init
	t.Run("Init Migration ReadOnly Block", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/migrations/init", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for readonly init, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 3. POST /api/connections/{connId}/migrations/init
	t.Run("Init Migration Success", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/migrations/init", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data struct {
				Initialized bool   `json:"initialized"`
				Message     string `json:"message"`
			} `json:"data"`
			Error *string `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed decoding response: %v", err)
		}
		if !resp.Data.Initialized {
			t.Fatalf("expected initialized true")
		}
	})

	// 4. POST /api/connections/{connId}/migrations/generate
	t.Run("Generate Migration Bundle", func(t *testing.T) {
		body, _ := json.Marshal(migration.GenerateMigrationRequest{
			Name:    "create_products_table",
			UpSQL:   "CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT NOT NULL, price REAL);",
			DownSQL: "DROP TABLE products;",
			Format:  "goose",
			Version: "20260922120000",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/migrations/generate", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data  migration.MigrationBundle `json:"data"`
			Error *string                   `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed decoding bundle: %v", err)
		}
		if resp.Data.Format != "goose" || resp.Data.Version != "20260922120000" {
			t.Fatalf("unexpected bundle format or version: %+v", resp.Data)
		}
		if len(resp.Data.Files) != 1 || resp.Data.Files[0].FileName != "20260922120000_create_products_table.sql" {
			t.Fatalf("unexpected generated files: %+v", resp.Data.Files)
		}
	})

	// 5. POST /api/connections/{connId}/migrations/apply (with readonly check)
	t.Run("Apply Migration ReadOnly Block", func(t *testing.T) {
		body, _ := json.Marshal(migration.ApplyMigrationRequest{
			Version: "20260922000001",
			Name:    "create_products",
			UpSQL:   "CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT, price REAL);",
			DownSQL: "DROP TABLE products;",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/migrations/apply", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 6. POST /api/connections/{connId}/migrations/apply Success
	t.Run("Apply Migration Success", func(t *testing.T) {
		body, _ := json.Marshal(migration.ApplyMigrationRequest{
			Version: "20260922000001",
			Name:    "create_products",
			UpSQL:   "CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT, price REAL);",
			DownSQL: "DROP TABLE products;",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/migrations/apply", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data  migration.MigrationRecord `json:"data"`
			Error *string                   `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed decoding record: %v", err)
		}
		if resp.Data.Version != "20260922000001" || resp.Data.Name != "create_products" {
			t.Fatalf("unexpected applied record: %+v", resp.Data)
		}
	})

	// 7. GET /api/connections/{connId}/migrations After Apply
	t.Run("Get Migrations After Apply", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/connections/c1/migrations", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data  api.MigrationListResponse `json:"data"`
			Error *string                   `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed decoding list response: %v", err)
		}
		if !resp.Data.Initialized {
			t.Fatalf("expected tracker to be initialized")
		}
		if len(resp.Data.Migrations) != 1 || resp.Data.Migrations[0].Version != "20260922000001" {
			t.Fatalf("expected 1 applied migration with version 20260922000001, got %+v", resp.Data.Migrations)
		}
	})

	// 8. POST /api/connections/{connId}/migrations/rollback (with readonly check)
	t.Run("Rollback Migration ReadOnly Block", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/migrations/rollback", bytes.NewReader([]byte("{}")))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 9. POST /api/connections/{connId}/migrations/rollback Success
	t.Run("Rollback Migration Success", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/migrations/rollback", bytes.NewReader([]byte("{}")))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data  migration.MigrationRecord `json:"data"`
			Error *string                   `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed decoding rollback response: %v", err)
		}
		if resp.Data.Version != "20260922000001" {
			t.Fatalf("expected rolled back version 20260922000001, got %s", resp.Data.Version)
		}
	})

	// 10. GET /api/connections/{connId}/migrations After Rollback
	t.Run("Get Migrations After Rollback", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/connections/c1/migrations", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		var resp struct {
			Data  api.MigrationListResponse `json:"data"`
			Error *string                   `json:"error"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &resp)
		if len(resp.Data.Migrations) != 0 {
			t.Fatalf("expected 0 migrations after rollback, got %d", len(resp.Data.Migrations))
		}
	})
}
