package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/materialize"
)

func TestMaterializeHandlers(t *testing.T) {
	dbFile := fmt.Sprintf("/tmp/dblens_api_mat_%d.db", time.Now().UnixNano())
	defer os.Remove(dbFile)

	dsn := "sqlite://" + dbFile
	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to init sqlite test db: %v", err)
	}

	ctx := context.Background()
	_, err = entry.Driver.ExecuteRaw(ctx, "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, tier TEXT);")
	if err != nil {
		t.Fatalf("setup table failed: %v", err)
	}
	_, err = entry.Driver.ExecuteRaw(ctx, "INSERT INTO customers (name, tier) VALUES ('Acme Corp', 'vip'), ('Beta LLC', 'standard'), ('Gamma Inc', 'vip');")
	if err != nil {
		t.Fatalf("setup seed failed: %v", err)
	}

	h, err := api.NewHandler(mgr)
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}
	t.Cleanup(h.Shutdown)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. POST /api/connections/c1/materialize/preview
	t.Run("Materialize Preview", func(t *testing.T) {
		reqBody := materialize.MaterializeRequest{
			TargetTable: "vip_customers",
			SourceQuery: "SELECT id, name FROM customers WHERE tier = 'vip'",
			Mode:        "create",
		}
		data, _ := json.Marshal(reqBody)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/materialize/preview", bytes.NewReader(data))
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("preview status %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data materialize.MaterializePreview `json:"data"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
			t.Fatalf("failed decoding preview resp: %v", err)
		}
		if resp.Data.TargetTable != "vip_customers" {
			t.Errorf("expected TargetTable vip_customers, got %s", resp.Data.TargetTable)
		}
	})

	// 2. POST /api/connections/c1/materialize (create mode)
	t.Run("Materialize Execute Create", func(t *testing.T) {
		reqBody := materialize.MaterializeRequest{
			TargetTable: "vip_customers",
			SourceQuery: "SELECT id, name FROM customers WHERE tier = 'vip'",
			Mode:        "create",
		}
		data, _ := json.Marshal(reqBody)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/materialize", bytes.NewReader(data))
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("execute status %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data materialize.MaterializeResult `json:"data"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
			t.Fatalf("failed decoding resp: %v", err)
		}
		if !resp.Data.Success {
			t.Errorf("expected success true")
		}
		if resp.Data.RowsAffected != 2 {
			t.Errorf("expected 2 rows affected, got %d", resp.Data.RowsAffected)
		}
	})

	// 3. POST /api/connections/c1/materialize in ReadOnly Safe Mode
	t.Run("Materialize Execute ReadOnly blocked", func(t *testing.T) {
		reqBody := materialize.MaterializeRequest{
			TargetTable: "should_block",
			SourceQuery: "SELECT 1",
			Mode:        "create",
		}
		data, _ := json.Marshal(reqBody)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/materialize", bytes.NewReader(data))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 4. POST /api/connections/c1/materialize (temp scratchpad mode)
	t.Run("Materialize Scratchpad and List", func(t *testing.T) {
		reqBody := materialize.MaterializeRequest{
			TargetTable: "scratch_tiers",
			SourceQuery: "SELECT DISTINCT tier FROM customers",
			Mode:        "temp",
			TTLMinutes:  60,
		}
		data, _ := json.Marshal(reqBody)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/materialize", bytes.NewReader(data))
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("scratch execute status %d: %s", rec.Code, rec.Body.String())
		}

		// GET /api/connections/c1/materialize/scratch
		listReq := httptest.NewRequest(http.MethodGet, "/api/connections/c1/materialize/scratch", nil)
		listRec := httptest.NewRecorder()
		router.ServeHTTP(listRec, listReq)

		if listRec.Code != http.StatusOK {
			t.Fatalf("scratch list status %d: %s", listRec.Code, listRec.Body.String())
		}

		var listResp struct {
			Data []materialize.ScratchTable `json:"data"`
		}
		if err := json.NewDecoder(listRec.Body).Decode(&listResp); err != nil {
			t.Fatalf("failed decoding scratch list: %v", err)
		}
		if len(listResp.Data) == 0 {
			t.Fatalf("expected at least 1 scratch table registered")
		}
		found := false
		for _, st := range listResp.Data {
			if st.Table == "scratch_tiers" {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected scratch_tiers in scratch list")
		}
	})

	// 5. POST /api/connections/c1/materialize/scratch/promote
	t.Run("Promote Scratch Table", func(t *testing.T) {
		reqBody := map[string]string{
			"schema": "",
			"table":  "scratch_tiers",
		}
		data, _ := json.Marshal(reqBody)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/materialize/scratch/promote", bytes.NewReader(data))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("promote status %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data map[string]string `json:"data"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
			t.Fatalf("decode promote resp: %v", err)
		}
		if resp.Data["migrationSql"] == "" {
			t.Errorf("expected non-empty migrationSql")
		}
	})

	// 6. DELETE /api/connections/c1/materialize/scratch/{schema}/{table}
	t.Run("Delete Scratch Table", func(t *testing.T) {
		// Register a temporary scratch table to delete
		reqBody := materialize.MaterializeRequest{
			TargetTable: "to_delete",
			SourceQuery: "SELECT 1 AS x",
			Mode:        "temp",
		}
		data, _ := json.Marshal(reqBody)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/materialize", bytes.NewReader(data))
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("create temp status %d: %s", rec.Code, rec.Body.String())
		}

		// Delete endpoint
		delReq := httptest.NewRequest(http.MethodDelete, "/api/connections/c1/materialize/scratch/main/to_delete", nil)
		delReq.Header.Set("X-DBLENS-DSN", dsn)
		delRec := httptest.NewRecorder()
		router.ServeHTTP(delRec, delReq)

		if delRec.Code != http.StatusOK {
			t.Fatalf("delete scratch status %d: %s", delRec.Code, delRec.Body.String())
		}
	})

	// 7. POST /api/connections/c1/materialize/scratch/expire
	t.Run("Expire Scratch Tables", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/materialize/scratch/expire", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expire scratch status %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 8. DELETE non-existent scratch table: returns 404 and does NOT drop real table
	t.Run("Delete Non-Existent Scratch Table Does Not Drop Real Table", func(t *testing.T) {
		delReq := httptest.NewRequest(http.MethodDelete, "/api/connections/c1/materialize/scratch/main/customers", nil)
		delReq.Header.Set("X-DBLENS-DSN", dsn)
		delRec := httptest.NewRecorder()
		router.ServeHTTP(delRec, delReq)

		if delRec.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for non-existent scratch table, got %d: %s", delRec.Code, delRec.Body.String())
		}

		// Verify real table still exists and data is intact
		res, err := entry.Driver.ExecuteQuery(ctx, "SELECT COUNT(*) FROM customers;")
		if err != nil {
			t.Fatalf("expected real table 'customers' to still exist, but got error: %v", err)
		}
		if len(res.Rows) == 0 || fmt.Sprintf("%v", res.Rows[0][0]) != "3" {
			t.Fatalf("expected 3 rows in real table 'customers', got %v", res.Rows)
		}
	})
}
