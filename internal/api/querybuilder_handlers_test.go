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
	"github.com/dblens/dblens/internal/querybuilder"
)

func setupQueryBuilderTestEnv(t *testing.T) (http.Handler, string, func()) {
	dbFile := fmt.Sprintf("/tmp/dblens_api_qb_%d.db", time.Now().UnixNano())
	dsn := "sqlite://" + dbFile

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to init sqlite db: %v", err)
	}

	ctx := context.Background()
	initSQL := []string{
		"CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, email TEXT, status TEXT);",
		"CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, amount REAL);",
		"INSERT INTO customers (id, name, email, status) VALUES (1, 'Alice', 'alice@test.com', 'active');",
		"INSERT INTO customers (id, name, email, status) VALUES (2, 'Bob', 'bob@test.com', 'inactive');",
		"INSERT INTO orders (id, customer_id, amount) VALUES (101, 1, 150.0);",
		"INSERT INTO orders (id, customer_id, amount) VALUES (102, 1, 200.0);",
		"INSERT INTO orders (id, customer_id, amount) VALUES (103, 2, 50.0);",
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

func TestQueryBuilder_GenerateAPI(t *testing.T) {
	router, dsn, cleanup := setupQueryBuilderTestEnv(t)
	defer cleanup()

	limit := 5
	reqBody := api.GenerateVisualQueryRequest{
		Dialect: "postgres",
		State: querybuilder.QueryCanvasState{
			Tables: []querybuilder.CanvasTable{
				{
					ID:    "t1",
					Name:  "customers",
					Alias: "c",
					Columns: []querybuilder.CanvasColumn{
						{Name: "id", Selected: true},
						{Name: "name", Selected: true},
					},
				},
			},
			Filters: []querybuilder.CanvasFilter{
				{
					TableID:  "t1",
					Column:   "status",
					Operator: "=",
					Value:    "active",
				},
			},
			Limit: &limit,
		},
	}
	b, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/querybuilder/generate", bytes.NewReader(b))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data  querybuilder.BuildSQLResponse `json:"data"`
		Error *string                       `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Error != nil {
		t.Fatalf("unexpected error in response: %v", *resp.Error)
	}

	if !strings.Contains(resp.Data.SQL, `"c"."id"`) || !strings.Contains(resp.Data.SQL, `LIMIT 5`) {
		t.Errorf("unexpected generated SQL: %s", resp.Data.SQL)
	}
}

func TestQueryBuilder_RunAPI(t *testing.T) {
	router, dsn, cleanup := setupQueryBuilderTestEnv(t)
	defer cleanup()

	runReq := api.RunVisualQueryRequest{
		Dialect: "sqlite",
		State: querybuilder.QueryCanvasState{
			Tables: []querybuilder.CanvasTable{
				{
					ID:    "t1",
					Name:  "customers",
					Alias: "c",
					Columns: []querybuilder.CanvasColumn{
						{Name: "name", Selected: true},
					},
				},
				{
					ID:    "t2",
					Name:  "orders",
					Alias: "o",
					Columns: []querybuilder.CanvasColumn{
						{Name: "amount", Selected: true, Aggregate: "SUM", Alias: "total_amount"},
					},
				},
			},
			Joins: []querybuilder.CanvasJoin{
				{
					ID:            "j1",
					SourceTableID: "t1",
					SourceColumn:  "id",
					TargetTableID: "t2",
					TargetColumn:  "customer_id",
					JoinType:      "INNER",
				},
			},
		},
	}
	b, _ := json.Marshal(runReq)

	req := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/querybuilder/run", bytes.NewReader(b))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data struct {
			SQL    string                 `json:"sql"`
			Result map[string]interface{} `json:"result"`
		} `json:"data"`
		Error *string `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", *resp.Error)
	}
	if !strings.Contains(resp.Data.SQL, `SUM("o"."amount")`) {
		t.Errorf("unexpected SQL executed: %s", resp.Data.SQL)
	}

	// Test non-SELECT rejection
	badRunReq := api.RunVisualQueryRequest{
		SQL: "DROP TABLE customers;",
	}
	bBad, _ := json.Marshal(badRunReq)
	reqBad := httptest.NewRequest(http.MethodPost, "/api/connections/conn1/querybuilder/run", bytes.NewReader(bBad))
	reqBad.Header.Set("X-DBLENS-DSN", dsn)
	reqBad.Header.Set("Content-Type", "application/json")
	wBad := httptest.NewRecorder()
	router.ServeHTTP(wBad, reqBad)

	if wBad.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for DROP TABLE, got %d", wBad.Code)
	}
}

func TestQueryBuilder_SaveAndListAPI(t *testing.T) {
	router, dsn, cleanup := setupQueryBuilderTestEnv(t)
	defer cleanup()

	saveReq := querybuilder.SavedVisualQuery{
		Name:         "Customer Orders Analysis",
		Description:  "Aggregates total customer order amount",
		ConnectionID: "conn_test",
		State: querybuilder.QueryCanvasState{
			Tables: []querybuilder.CanvasTable{
				{
					ID:   "t1",
					Name: "customers",
					Columns: []querybuilder.CanvasColumn{
						{Name: "id", Selected: true},
					},
				},
			},
		},
	}
	b, _ := json.Marshal(saveReq)

	// Save
	reqSave := httptest.NewRequest(http.MethodPost, "/api/connections/conn_test/querybuilder/save", bytes.NewReader(b))
	reqSave.Header.Set("X-DBLENS-DSN", dsn)
	reqSave.Header.Set("Content-Type", "application/json")
	wSave := httptest.NewRecorder()
	router.ServeHTTP(wSave, reqSave)

	if wSave.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", wSave.Code, wSave.Body.String())
	}

	var saveResp struct {
		Data  querybuilder.SavedVisualQuery `json:"data"`
		Error *string                       `json:"error"`
	}
	if err := json.Unmarshal(wSave.Body.Bytes(), &saveResp); err != nil {
		t.Fatalf("failed to decode save response: %v", err)
	}
	savedID := saveResp.Data.ID
	if savedID == "" {
		t.Fatalf("expected saved query ID")
	}

	// List
	reqList := httptest.NewRequest(http.MethodGet, "/api/connections/conn_test/querybuilder/saved", nil)
	reqList.Header.Set("X-DBLENS-DSN", dsn)
	wList := httptest.NewRecorder()
	router.ServeHTTP(wList, reqList)

	if wList.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", wList.Code, wList.Body.String())
	}

	var listResp struct {
		Data  []querybuilder.SavedVisualQuery `json:"data"`
		Error *string                         `json:"error"`
	}
	if err := json.Unmarshal(wList.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("failed to decode list response: %v", err)
	}
	if len(listResp.Data) == 0 {
		t.Fatalf("expected at least 1 saved query in list")
	}

	// Delete
	reqDel := httptest.NewRequest(http.MethodDelete, "/api/connections/conn_test/querybuilder/saved/"+savedID, nil)
	reqDel.Header.Set("X-DBLENS-DSN", dsn)
	wDel := httptest.NewRecorder()
	router.ServeHTTP(wDel, reqDel)

	if wDel.Code != http.StatusOK {
		t.Fatalf("expected 200 on delete, got %d: %s", wDel.Code, wDel.Body.String())
	}
}
