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
	"github.com/dblens/dblens/internal/routine"
)

func TestRoutineEndpoints(t *testing.T) {
	dbFile := fmt.Sprintf("/tmp/dblens_api_routine_%d.db", time.Now().UnixNano())
	defer os.Remove(dbFile)

	dsn := "sqlite://" + dbFile
	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to init sqlite test db: %v", err)
	}

	ctx := context.Background()
	// Setup test schema
	setupStmts := []string{
		"CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, email TEXT);",
		"CREATE TABLE customer_log (id INTEGER PRIMARY KEY, customer_id INT, action TEXT);",
		"CREATE TRIGGER trg_cust_audit AFTER INSERT ON customers BEGIN INSERT INTO customer_log(customer_id, action) VALUES (NEW.id, 'INSERT'); END;",
		"CREATE VIEW v_active_customers AS SELECT id, name FROM customers;",
	}
	for _, stmt := range setupStmts {
		if _, err := entry.Driver.ExecuteRaw(ctx, stmt); err != nil {
			t.Fatalf("failed setup: %v", err)
		}
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. GET /api/connections/c1/routines
	t.Run("Get Routines on SQLite", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/connections/c1/routines", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp struct {
			Data  []routine.RoutineItem `json:"data"`
			Error *string               `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed decoding: %v", err)
		}
		if resp.Error != nil {
			t.Fatalf("unexpected error: %s", *resp.Error)
		}
	})

	// 2. GET /api/connections/c1/routines/main/nonexistent -> 404
	t.Run("Get Routine Detail Not Found", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/connections/c1/routines/main/nonexistent", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", rec.Code)
		}
	})

	// 3. POST /api/connections/c1/routines/invoke
	t.Run("Invoke Routine Function", func(t *testing.T) {
		body, _ := json.Marshal(routine.InvokeRoutineRequest{
			Name:        "length",
			RoutineType: "FUNCTION",
			Parameters:  []interface{}{"hello world"},
		})
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/routines/invoke", bytes.NewReader(body))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp struct {
			Data  routine.InvokeRoutineResponse `json:"data"`
			Error *string                       `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed decoding: %v", err)
		}
		if resp.Error != nil {
			t.Fatalf("unexpected error: %s", *resp.Error)
		}
		if len(resp.Data.Rows) != 1 {
			t.Fatalf("expected 1 row, got %d", len(resp.Data.Rows))
		}
	})

	// 4. ReadOnly Guardrail on SaveRoutine
	t.Run("Save Routine ReadOnly Block", func(t *testing.T) {
		body, _ := json.Marshal(api.SaveRoutinePayload{
			DDL: "CREATE PROCEDURE foo() BEGIN END;",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/routines/save", bytes.NewReader(body))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 5. ReadOnly Guardrail on DeleteRoutine
	t.Run("Delete Routine ReadOnly Block", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/connections/c1/routines/main/foo?type=PROCEDURE", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 6. GET /api/connections/c1/triggers
	t.Run("Get Triggers", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/connections/c1/triggers", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp struct {
			Data  []routine.TriggerItem `json:"data"`
			Error *string               `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed decoding: %v", err)
		}
		if len(resp.Data) != 1 {
			t.Fatalf("expected 1 trigger, got %d", len(resp.Data))
		}
		if resp.Data[0].Name != "trg_cust_audit" {
			t.Errorf("expected trigger trg_cust_audit, got %s", resp.Data[0].Name)
		}
	})

	// 7. Toggle Trigger ReadOnly Block
	t.Run("Toggle Trigger ReadOnly Block", func(t *testing.T) {
		body, _ := json.Marshal(routine.ToggleTriggerRequest{
			Schema:  "main",
			Table:   "customers",
			Name:    "trg_cust_audit",
			Enabled: false,
		})
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/triggers/toggle", bytes.NewReader(body))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d", rec.Code)
		}
	})

	// 8. Delete Trigger ReadOnly Block & Success
	t.Run("Delete Trigger ReadOnly Block", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/connections/c1/triggers/main/trg_cust_audit", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d", rec.Code)
		}
	})

	t.Run("Delete Trigger Success", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/connections/c1/triggers/main/trg_cust_audit", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		// Verify trigger deleted
		getReq := httptest.NewRequest(http.MethodGet, "/api/connections/c1/triggers", nil)
		getReq.Header.Set("X-DBLENS-DSN", dsn)
		getRec := httptest.NewRecorder()
		router.ServeHTTP(getRec, getReq)

		var resp struct {
			Data []routine.TriggerItem `json:"data"`
		}
		_ = json.Unmarshal(getRec.Body.Bytes(), &resp)
		if len(resp.Data) != 0 {
			t.Fatalf("expected 0 triggers, got %d", len(resp.Data))
		}
	})

	// 9. GET /api/connections/c1/views
	t.Run("Get Views", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/connections/c1/views", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp struct {
			Data  []routine.ViewItem `json:"data"`
			Error *string            `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed decoding: %v", err)
		}
		if len(resp.Data) != 1 {
			t.Fatalf("expected 1 view, got %d", len(resp.Data))
		}
		if resp.Data[0].Name != "v_active_customers" {
			t.Errorf("expected view name v_active_customers, got %s", resp.Data[0].Name)
		}
	})

	// 10. Refresh View ReadOnly Block
	t.Run("Refresh View ReadOnly Block", func(t *testing.T) {
		body, _ := json.Marshal(routine.RefreshViewRequest{
			Schema: "main",
			Name:   "v_active_customers",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/views/refresh", bytes.NewReader(body))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d", rec.Code)
		}
	})

	// 11. Refresh View on SQLite returns error (unsupported)
	t.Run("Refresh View Unsupported Dialect", func(t *testing.T) {
		body, _ := json.Marshal(routine.RefreshViewRequest{
			Schema: "main",
			Name:   "v_active_customers",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/views/refresh", bytes.NewReader(body))
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}
