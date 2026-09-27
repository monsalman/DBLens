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
	"github.com/dblens/dblens/internal/partition"
)

func setupPartitionTestEnv(t *testing.T) (http.Handler, string, func()) {
	dbFile := fmt.Sprintf("/tmp/dblens_api_part_%d.db", time.Now().UnixNano())
	cleanup := func() { _ = os.Remove(dbFile) }

	dsn := "sqlite://" + dbFile
	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		cleanup()
		t.Fatalf("failed to init sqlite db: %v", err)
	}

	ctx := context.Background()
	queries := []string{
		`CREATE TABLE orders (id INTEGER PRIMARY KEY, amount REAL);`,
		`CREATE TABLE orders_2026_01 (id INTEGER PRIMARY KEY, amount REAL);`,
		`CREATE TABLE orders_2026_02 (id INTEGER PRIMARY KEY, amount REAL);`,
		`INSERT INTO orders_2026_01 (id, amount) VALUES (1, 100.5), (2, 200.0);`,
	}
	for _, q := range queries {
		if _, err := entry.Driver.ExecuteQuery(ctx, q); err != nil {
			cleanup()
			t.Fatalf("failed to seed db: %v", err)
		}
	}

	h, err := api.NewHandler(mgr)
	if err != nil {
		cleanup()
		t.Fatalf("failed to init handler: %v", err)
	}

	router := api.SetupRouter(h, api.RouterConfig{})
	return router, dsn, func() {
		h.Shutdown()
		cleanup()
	}
}

func TestGetPartitionsHandler(t *testing.T) {
	router, dsn, cleanup := setupPartitionTestEnv(t)
	defer cleanup()

	// Missing table query param -> 400
	req := httptest.NewRequest("GET", "/api/connections/test/partitions", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing table, got %d", w.Code)
	}

	// Valid table query -> 200 OK
	req = httptest.NewRequest("GET", "/api/connections/test/partitions?table=orders", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d (body: %s)", w.Code, w.Body.String())
	}

	var resp struct {
		Data  *partition.PartitionTopology `json:"data"`
		Error *string                      `json:"error"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Data == nil {
		t.Fatalf("expected data in response")
	}
	if resp.Data.ParentTable != "orders" {
		t.Errorf("expected parent table orders, got %s", resp.Data.ParentTable)
	}
	if len(resp.Data.Partitions) != 2 {
		t.Errorf("expected 2 chunk partitions, got %d", len(resp.Data.Partitions))
	}
}

func TestGeneratePartitionDDLHandler(t *testing.T) {
	router, dsn, cleanup := setupPartitionTestEnv(t)
	defer cleanup()

	body := partition.GeneratePartitionDDLRequest{
		ParentTable: "events",
		Schema:      "public",
		Dialect:     "postgres",
		Interval:    "month",
		Count:       3,
		StartDate:   "2026-10-01",
	}
	payload, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/api/connections/test/partitions/generate-ddl", bytes.NewReader(payload))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d (body: %s)", w.Code, w.Body.String())
	}

	var resp struct {
		Data  *partition.MaintenancePlan `json:"data"`
		Error *string                    `json:"error"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Data == nil || len(resp.Data.GeneratedDDL) != 3 {
		t.Fatalf("expected 3 generated statements")
	}
}

func TestDetachPartitionHandler(t *testing.T) {
	router, dsn, cleanup := setupPartitionTestEnv(t)
	defer cleanup()

	// Detach orders_2026_02 (which exists in SQLite)
	body := partition.DetachPartitionRequest{
		ParentTable:   "orders",
		PartitionName: "orders_2026_02",
	}
	payload, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/api/connections/test/partitions/detach", bytes.NewReader(payload))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d (body: %s)", w.Code, w.Body.String())
	}

	var resp struct {
		Data  map[string]interface{} `json:"data"`
		Error *string                `json:"error"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Data["success"] != true {
		t.Errorf("expected success true")
	}
}

func TestGetPartitionHealthHandler(t *testing.T) {
	router, dsn, cleanup := setupPartitionTestEnv(t)
	defer cleanup()

	req := httptest.NewRequest("GET", "/api/connections/test/partitions/health?table=orders", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d (body: %s)", w.Code, w.Body.String())
	}

	var resp struct {
		Data  *partition.PartitionHealthReport `json:"data"`
		Error *string                          `json:"error"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Data == nil {
		t.Fatalf("expected health report data")
	}
	if resp.Data.ParentTable != "orders" {
		t.Errorf("expected parent table orders, got %s", resp.Data.ParentTable)
	}
}

func TestExportPartitionMDHandler(t *testing.T) {
	router, dsn, cleanup := setupPartitionTestEnv(t)
	defer cleanup()

	req := httptest.NewRequest("GET", "/api/connections/test/partitions/export.md?table=orders", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d (body: %s)", w.Code, w.Body.String())
	}

	contentType := w.Header().Get("Content-Type")
	if !strings.Contains(contentType, "text/markdown") {
		t.Errorf("expected markdown content-type, got %s", contentType)
	}

	bodyStr := w.Body.String()
	if !strings.Contains(bodyStr, "# Partition & Shard Topology:") || !strings.Contains(bodyStr, "orders") {
		t.Errorf("expected markdown title in body, got:\n%s", bodyStr)
	}
}
