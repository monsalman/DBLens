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
	"github.com/dblens/dblens/internal/plandiff"
)

func setupPlanDiffTestEnv(t *testing.T) (http.Handler, string, func()) {
	dbFile := fmt.Sprintf("/tmp/dblens_api_plandiff_%d.db", time.Now().UnixNano())
	dsn := "sqlite://" + dbFile

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to init sqlite db: %v", err)
	}

	ctx := context.Background()
	initSQL := []string{
		"CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, email TEXT, status TEXT);",
		"CREATE INDEX idx_customers_status ON customers(status);",
		"INSERT INTO customers (name, email, status) VALUES ('Alice', 'alice@test.com', 'active');",
		"INSERT INTO customers (name, email, status) VALUES ('Bob', 'bob@test.com', 'inactive');",
	}
	for _, sql := range initSQL {
		if _, err := entry.Driver.ExecuteQuery(ctx, sql); err != nil {
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

func TestPlanDiff_CompareAPI(t *testing.T) {
	router, dsn, cleanup := setupPlanDiffTestEnv(t)
	defer cleanup()

	body := plandiff.PlanDiffRequest{
		BaselineSQL:  "SELECT * FROM customers WHERE name = 'Alice';",
		CandidateSQL: "SELECT * FROM customers WHERE status = 'active';",
	}
	bodyBytes, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/plandiff/compare", bytes.NewReader(bodyBytes))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var res struct {
		Data plandiff.PlanDiffResult `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if res.Data.AlignedTree == nil {
		t.Fatal("expected non-nil aligned tree")
	}
}

func TestPlanDiff_AdviseAPI(t *testing.T) {
	router, dsn, cleanup := setupPlanDiffTestEnv(t)
	defer cleanup()

	body := plandiff.PlanDiffRequest{
		BaselineSQL: "SELECT * FROM customers WHERE email = 'alice@test.com';",
	}
	bodyBytes, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/plandiff/advise", bytes.NewReader(bodyBytes))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var res struct {
		Data []plandiff.IndexRecommendation `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if len(res.Data) == 0 {
		t.Fatal("expected at least 1 index recommendation for unindexed email column")
	}
}

func TestPlanDiff_ApplyIndexAPI_SafeMode(t *testing.T) {
	router, dsn, cleanup := setupPlanDiffTestEnv(t)
	defer cleanup()

	// 1. Blocked via Header X-DBLENS-READONLY
	t.Run("Blocked via X-DBLENS-READONLY header", func(t *testing.T) {
		body := map[string]interface{}{
			"ddl": "CREATE INDEX idx_customers_email ON customers(email);",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/plandiff/apply-index", bytes.NewReader(bodyBytes))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 2. Blocked via payload readOnly: true
	t.Run("Blocked via payload readOnly: true", func(t *testing.T) {
		body := map[string]interface{}{
			"ddl":      "CREATE INDEX idx_customers_email ON customers(email);",
			"readOnly": true,
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/plandiff/apply-index", bytes.NewReader(bodyBytes))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 3. Rejected if non-CREATE INDEX statement
	t.Run("Rejected if non-CREATE INDEX", func(t *testing.T) {
		body := map[string]interface{}{
			"ddl": "DROP TABLE customers;",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/plandiff/apply-index", bytes.NewReader(bodyBytes))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 403 or 400 Bad Request, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 3b. Rejected if multi-statement SQL injection attempt
	t.Run("Rejected if multi-statement injection", func(t *testing.T) {
		body := map[string]interface{}{
			"ddl": "CREATE INDEX idx_customers_name ON customers(name); DROP TABLE customers;",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/plandiff/apply-index", bytes.NewReader(bodyBytes))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request for multi-statement injection, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 4. Success application
	t.Run("Successfully applies CREATE INDEX", func(t *testing.T) {
		body := map[string]interface{}{
			"ddl": "CREATE INDEX idx_customers_email ON customers(email);",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/plandiff/apply-index", bytes.NewReader(bodyBytes))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}

func TestPlanDiff_ExportMD(t *testing.T) {
	router, dsn, cleanup := setupPlanDiffTestEnv(t)
	defer cleanup()

	body := plandiff.PlanDiffRequest{
		BaselineSQL:  "SELECT * FROM customers WHERE name = 'Alice';",
		CandidateSQL: "SELECT * FROM customers WHERE status = 'active';",
	}
	bodyBytes, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/plandiff/export.md", bytes.NewReader(bodyBytes))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	contentType := rec.Header().Get("Content-Type")
	if !strings.Contains(contentType, "text/markdown") {
		t.Fatalf("expected text/markdown, got %s", contentType)
	}

	bodyStr := rec.Body.String()
	if !strings.Contains(bodyStr, "# Execution Plan Diff Report") {
		t.Fatalf("expected markdown header in export, got %s", bodyStr)
	}
}

func TestPlanDiff_SafeMode_MutatingQueries(t *testing.T) {
	router, dsn, cleanup := setupPlanDiffTestEnv(t)
	defer cleanup()

	// 1. Compare endpoint blocks mutating CTE in read-only mode
	t.Run("Compare blocks mutating CTE in safe mode", func(t *testing.T) {
		body := plandiff.PlanDiffRequest{
			BaselineSQL:  "WITH del AS (DELETE FROM customers WHERE id = 1 RETURNING *) SELECT * FROM del;",
			CandidateSQL: "SELECT * FROM customers WHERE status = 'active';",
		}
		b, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/plandiff/compare", bytes.NewReader(b))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for mutating CTE in read-only mode, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 2. Advise endpoint blocks non-select in read-only mode
	t.Run("Advise blocks non-select query in safe mode", func(t *testing.T) {
		body := plandiff.PlanDiffRequest{
			CandidateSQL: "UPDATE customers SET status = 'inactive' WHERE id = 2;",
		}
		b, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/plandiff/advise", bytes.NewReader(b))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for UPDATE in read-only mode, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 3. Export MD endpoint blocks mutating CTE in read-only mode
	t.Run("Export MD blocks mutating CTE in safe mode", func(t *testing.T) {
		body := plandiff.PlanDiffRequest{
			BaselineSQL: "WITH ins AS (INSERT INTO customers (name) VALUES ('x') RETURNING *) SELECT * FROM ins;",
		}
		b, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/plandiff/export.md", bytes.NewReader(b))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", "true")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for mutating query in export.md read-only mode, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}

func TestPlanDiff_MultilineWhereClause(t *testing.T) {
	router, dsn, cleanup := setupPlanDiffTestEnv(t)
	defer cleanup()

	body := plandiff.PlanDiffRequest{
		BaselineSQL:  "SELECT * FROM customers\nWHERE\nemail = 'alice@test.com'\nORDER BY id;",
		CandidateSQL: "SELECT * FROM customers\nWHERE\nstatus = 'active'\nLIMIT 10;",
	}
	bodyBytes, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/plandiff/compare", bytes.NewReader(bodyBytes))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var res struct {
		Data plandiff.PlanDiffResult `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if res.Data.AlignedTree == nil {
		t.Fatal("expected non-nil aligned tree")
	}
}
