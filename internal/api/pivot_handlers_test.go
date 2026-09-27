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
	"github.com/dblens/dblens/internal/pivot"
)

func setupPivotTestEnv(t *testing.T) (http.Handler, string, func()) {
	dbFile := fmt.Sprintf("/tmp/dblens_api_pivot_%d.db", time.Now().UnixNano())
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
		`CREATE TABLE sales (
			id INTEGER PRIMARY KEY,
			dept TEXT,
			region TEXT,
			quarter TEXT,
			revenue REAL
		);`,
		`INSERT INTO sales (id, dept, region, quarter, revenue) VALUES
			(1, 'Sales', 'North', 'Q1', 100.0),
			(2, 'Sales', 'North', 'Q2', 200.0),
			(3, 'Sales', 'South', 'Q1', 150.0),
			(4, 'Sales', 'South', 'Q2', 250.0),
			(5, 'Eng', 'North', 'Q1', 300.0),
			(6, 'Eng', 'North', 'Q2', 400.0);`,
	}
	for _, q := range queries {
		if _, err := entry.Driver.ExecuteQuery(ctx, q); err != nil {
			cleanup()
			t.Fatalf("failed to seed sales table: %v", err)
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

func TestPivotTransformEndpoint(t *testing.T) {
	router, _, cleanup := setupPivotTestEnv(t)
	defer cleanup()

	payload := api.PivotTransformRequest{
		Rows: []map[string]interface{}{
			{"dept": "Sales", "quarter": "Q1", "revenue": 100},
			{"dept": "Sales", "quarter": "Q2", "revenue": 200},
			{"dept": "Eng", "quarter": "Q1", "revenue": 150},
		},
		RowFields:  []string{"dept"},
		ColField:   "quarter",
		ValueField: "revenue",
		Aggregator: "sum",
		Subtotals:  true,
	}

	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/api/pivot/transform", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data pivot.PivotMatrix `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	matrix := resp.Data

	if len(matrix.ColHeaders) != 2 || len(matrix.RowHeaders) != 2 {
		t.Errorf("unexpected matrix dimensions: cols=%d, rows=%d", len(matrix.ColHeaders), len(matrix.RowHeaders))
	}
	if matrix.GrandTotal != 450.0 {
		t.Errorf("expected grand total 450, got %v", matrix.GrandTotal)
	}
}

func TestPivotPushdownAndRunEndpoints(t *testing.T) {
	router, dsn, cleanup := setupPivotTestEnv(t)
	defer cleanup()

	pushdownReq := pivot.PushdownRequest{
		Query:      "SELECT dept, region, quarter, revenue FROM sales",
		RowFields:  []string{"dept"},
		ColField:   "quarter",
		ValueField: "revenue",
		Aggregator: "sum",
		Subtotals:  false,
		ColValues:  []string{"Q1", "Q2"},
	}

	// 1. Test Pushdown endpoint
	body, _ := json.Marshal(pushdownReq)
	req := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/pivot/pushdown", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DBLENS-DSN", dsn)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("pushdown expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var pResp struct {
		Data pivot.PushdownResult `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &pResp); err != nil {
		t.Fatalf("failed to decode pushdown result: %v", err)
	}
	pRes := pResp.Data

	if !strings.Contains(pRes.SQL, "Q1") || !strings.Contains(pRes.SQL, "Q2") {
		t.Errorf("expected generated SQL to contain Q1 and Q2: %s", pRes.SQL)
	}

	// 2. Test Run endpoint
	reqRun := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/pivot/run", bytes.NewReader(body))
	reqRun.Header.Set("Content-Type", "application/json")
	reqRun.Header.Set("X-DBLENS-DSN", dsn)

	recRun := httptest.NewRecorder()
	router.ServeHTTP(recRun, reqRun)

	if recRun.Code != http.StatusOK {
		t.Fatalf("pivot run expected 200, got %d: %s", recRun.Code, recRun.Body.String())
	}

	var runResp struct {
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(recRun.Body.Bytes(), &runResp); err != nil {
		t.Fatalf("failed to decode run response: %v", err)
	}

	resultMap, ok := runResp.Data["result"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing result object in run response: %v", runResp.Data)
	}
	rows, ok := resultMap["rows"].([]interface{})
	if !ok || len(rows) != 2 {
		t.Errorf("expected 2 result rows from pushed-down query, got %v", rows)
	}
}

func TestPivotExportEndpoints(t *testing.T) {
	router, _, cleanup := setupPivotTestEnv(t)
	defer cleanup()

	matrix := pivot.PivotMatrix{
		ColHeaders: []string{"Q1", "Q2"},
		RowHeaders: [][]string{{"Sales"}, {"Eng"}},
		Cells: [][]interface{}{
			{100.0, 200.0},
			{150.0, 300.0},
		},
		RowTotals:  []interface{}{300.0, 450.0},
		ColTotals:  []interface{}{250.0, 500.0},
		GrandTotal: 750.0,
	}

	body, _ := json.Marshal(matrix)

	// 1. Export CSV
	reqCSV := httptest.NewRequest(http.MethodPost, "/api/pivot/export.csv", bytes.NewReader(body))
	reqCSV.Header.Set("Content-Type", "application/json")
	recCSV := httptest.NewRecorder()
	router.ServeHTTP(recCSV, reqCSV)

	if recCSV.Code != http.StatusOK {
		t.Fatalf("export CSV expected 200, got %d: %s", recCSV.Code, recCSV.Body.String())
	}
	if !strings.Contains(recCSV.Body.String(), "Q1,Q2,Total") {
		t.Errorf("CSV output missing header: %s", recCSV.Body.String())
	}

	// 2. Export Markdown
	reqMD := httptest.NewRequest(http.MethodPost, "/api/pivot/export.md", bytes.NewReader(body))
	reqMD.Header.Set("Content-Type", "application/json")
	recMD := httptest.NewRecorder()
	router.ServeHTTP(recMD, reqMD)

	if recMD.Code != http.StatusOK {
		t.Fatalf("export MD expected 200, got %d: %s", recMD.Code, recMD.Body.String())
	}
	if !strings.Contains(recMD.Body.String(), "| Row 1 | Q1 | Q2 | Total |") {
		t.Errorf("MD output missing header: %s", recMD.Body.String())
	}
}
