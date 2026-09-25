package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/seeder"
)

func setupSeederTestEnv(t *testing.T) (http.Handler, string, func()) {
	t.Helper()
	dbFile := filepath.Join(t.TempDir(), fmt.Sprintf("dblens_seeder_%d.db", time.Now().UnixNano()))
	dsn := "sqlite://" + dbFile

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to init db: %v", err)
	}

	ctx := context.Background()
	initSQL := `
		PRAGMA foreign_keys = ON;

		CREATE TABLE categories (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			description TEXT
		);

		CREATE TABLE products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			category_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			price DECIMAL(10,2) NOT NULL,
			sku TEXT,
			is_active BOOLEAN NOT NULL,
			FOREIGN KEY (category_id) REFERENCES categories(id)
		);
	`
	if _, err := entry.Driver.ExecuteQuery(ctx, initSQL); err != nil {
		t.Fatalf("failed to create tables: %v", err)
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

func TestSeederPlanHandler(t *testing.T) {
	router, dsn, cleanup := setupSeederTestEnv(t)
	defer cleanup()

	payload := seeder.SeederOptions{
		Schema:          "main",
		Tables:          []string{"products", "categories"},
		DefaultRowCount: 5,
		Seed:            100,
	}
	body, _ := json.Marshal(payload)

	req := httptest.NewRequest("POST", "/api/connections/default/seeder/plan", bytes.NewReader(body))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data seeder.SeedPlan `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse plan JSON: %v", err)
	}

	plan := resp.Data
	if len(plan.DAGOrder) != 2 {
		t.Fatalf("expected 2 tables in DAGOrder, got %d", len(plan.DAGOrder))
	}
	if plan.DAGOrder[0] != "categories" || plan.DAGOrder[1] != "products" {
		t.Errorf("expected DAG order [categories, products], got %v", plan.DAGOrder)
	}

	// Verify sample rows preview
	for _, tp := range plan.Tables {
		if len(tp.SampleRows) != 3 {
			t.Errorf("expected 3 sample rows for %s, got %d", tp.Table, len(tp.SampleRows))
		}
	}
}

func TestSeederRunHandler(t *testing.T) {
	router, dsn, cleanup := setupSeederTestEnv(t)
	defer cleanup()

	payload := api.SeederRunRequest{
		Options: &seeder.SeederOptions{
			Schema:          "main",
			Tables:          []string{"categories", "products"},
			DefaultRowCount: 5,
			Seed:            200,
		},
	}
	body, _ := json.Marshal(payload)

	req := httptest.NewRequest("POST", "/api/connections/default/seeder/run", bytes.NewReader(body))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data seeder.SeedResult `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode seed result: %v", err)
	}

	res := resp.Data
	if res.TotalInserted != 10 {
		t.Errorf("expected 10 total inserted rows, got %d", res.TotalInserted)
	}
	if len(res.Errors) > 0 {
		t.Errorf("unexpected seed errors: %v", res.Errors)
	}
}

func TestSeederRunSafeMode(t *testing.T) {
	router, dsn, cleanup := setupSeederTestEnv(t)
	defer cleanup()

	payload := api.SeederRunRequest{
		Options: &seeder.SeederOptions{
			Schema:          "main",
			Tables:          []string{"categories"},
			DefaultRowCount: 3,
		},
	}
	body, _ := json.Marshal(payload)

	// 1. Rejected via X-DBLENS-READONLY header
	req1 := httptest.NewRequest("POST", "/api/connections/default/seeder/run", bytes.NewReader(body))
	req1.Header.Set("X-DBLENS-DSN", dsn)
	req1.Header.Set("X-DBLENS-READONLY", "true")
	req1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()
	router.ServeHTTP(w1, req1)

	if w1.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden with X-DBLENS-READONLY, got %d: %s", w1.Code, w1.Body.String())
	}
	if !strings.Contains(w1.Body.String(), "Safe Mode") {
		t.Errorf("expected Safe Mode error message, got %s", w1.Body.String())
	}

	// 2. Rejected via X-DBLENS-ENVIRONMENT: production header
	req2 := httptest.NewRequest("POST", "/api/connections/default/seeder/run", bytes.NewReader(body))
	req2.Header.Set("X-DBLENS-DSN", dsn)
	req2.Header.Set("X-DBLENS-ENVIRONMENT", "production")
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)

	if w2.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden with X-DBLENS-ENVIRONMENT: production, got %d: %s", w2.Code, w2.Body.String())
	}
}

func TestSeederExportHandler(t *testing.T) {
	router, dsn, cleanup := setupSeederTestEnv(t)
	defer cleanup()

	payload := api.SeederExportRequest{
		Format: "sql",
		Options: &seeder.SeederOptions{
			Schema:          "main",
			Tables:          []string{"categories", "products"},
			DefaultRowCount: 4,
			Seed:            300,
		},
	}
	body, _ := json.Marshal(payload)

	// 1. Export SQL
	reqSQL := httptest.NewRequest("POST", "/api/connections/default/seeder/export?format=sql", bytes.NewReader(body))
	reqSQL.Header.Set("X-DBLENS-DSN", dsn)
	reqSQL.Header.Set("Content-Type", "application/json")
	wSQL := httptest.NewRecorder()
	router.ServeHTTP(wSQL, reqSQL)

	if wSQL.Code != http.StatusOK {
		t.Fatalf("expected status 200 for SQL export, got %d: %s", wSQL.Code, wSQL.Body.String())
	}
	if !strings.Contains(wSQL.Header().Get("Content-Type"), "application/sql") {
		t.Errorf("expected application/sql content type, got %s", wSQL.Header().Get("Content-Type"))
	}
	if !strings.Contains(wSQL.Body.String(), "INSERT INTO") {
		t.Errorf("expected SQL script to contain INSERT INTO, got:\n%s", wSQL.Body.String())
	}

	// 2. Export JSON
	payloadJSON := api.SeederExportRequest{
		Format: "json",
		Options: &seeder.SeederOptions{
			Schema:          "main",
			Tables:          []string{"categories", "products"},
			DefaultRowCount: 4,
			Seed:            300,
		},
	}
	bodyJSON, _ := json.Marshal(payloadJSON)
	reqJSON := httptest.NewRequest("POST", "/api/connections/default/seeder/export?format=json", bytes.NewReader(bodyJSON))
	reqJSON.Header.Set("X-DBLENS-DSN", dsn)
	reqJSON.Header.Set("Content-Type", "application/json")
	wJSON := httptest.NewRecorder()
	router.ServeHTTP(wJSON, reqJSON)

	if wJSON.Code != http.StatusOK {
		t.Fatalf("expected status 200 for JSON export, got %d: %s", wJSON.Code, wJSON.Body.String())
	}
	if !strings.Contains(wJSON.Header().Get("Content-Type"), "application/json") {
		t.Errorf("expected application/json content type, got %s", wJSON.Header().Get("Content-Type"))
	}
	var exportData map[string]interface{}
	if err := json.Unmarshal(wJSON.Body.Bytes(), &exportData); err != nil {
		t.Fatalf("exported json is invalid: %v", err)
	}
	if exportData["totalRows"].(float64) != 8 {
		t.Errorf("expected totalRows 8, got %v", exportData["totalRows"])
	}
}
