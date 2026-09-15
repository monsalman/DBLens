package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/driver/types"
)

func TestBackendFlow(t *testing.T) {
	dbFile := "/tmp/dblens_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	dsn := "sqlite://" + dbFile

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to get connection: %v", err)
	}

	ctx := context.Background()

	_, err = entry.Driver.ExecuteQuery(ctx, `
		CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			email TEXT
		);
	`)
	if err != nil {
		t.Fatalf("failed to create table: %v", err)
	}

	mutRes, err := entry.Driver.MutateRow(ctx, types.Mutation{
		Type:  types.MutationInsert,
		Table: "users",
		Data:  map[string]interface{}{"name": "Alice", "email": "alice@example.com"},
	})
	if err != nil {
		t.Fatalf("failed to insert row: %v", err)
	}
	if mutRes.AffectedRows != 1 {
		t.Fatalf("expected 1 affected row, got %d", mutRes.AffectedRows)
	}

	qRes, err := entry.Driver.QueryTableData(ctx, types.QueryOptions{
		Table: "users",
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("failed to query data: %v", err)
	}
	if len(qRes.Rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(qRes.Rows))
	}

	handler := api.NewHandler(mgr)
	router := api.SetupRouter(handler, api.RouterConfig{})

	// Test connection test endpoint (POST /api/connections/test) - Success
	testConnBody := `{"dsn":"sqlite:///tmp/dblens_temp_test.db"}`
	testConnReq := httptest.NewRequest("POST", "/api/connections/test", strings.NewReader(testConnBody))
	testConnReq.Header.Set("Content-Type", "application/json")
	testConnRec := httptest.NewRecorder()
	router.ServeHTTP(testConnRec, testConnReq)
	if testConnRec.Code != http.StatusOK || !strings.Contains(testConnRec.Body.String(), `"success":true`) {
		t.Fatalf("expected 200 with success:true for test connection, got %d: %s", testConnRec.Code, testConnRec.Body.String())
	}

	// Test connection test endpoint (POST /api/connections/test) - Unsupported / Invalid DSN
	testInvalidConnBody := `{"dsn":"invalid://localhost:5432"}`
	testInvalidReq := httptest.NewRequest("POST", "/api/connections/test", strings.NewReader(testInvalidConnBody))
	testInvalidReq.Header.Set("Content-Type", "application/json")
	testInvalidRec := httptest.NewRecorder()
	router.ServeHTTP(testInvalidRec, testInvalidReq)
	if testInvalidRec.Code != http.StatusOK || !strings.Contains(testInvalidRec.Body.String(), `"success":false`) {
		t.Fatalf("expected 200 with success:false for invalid test connection, got %d: %s", testInvalidRec.Code, testInvalidRec.Body.String())
	}

	// Test global profiles endpoint
	globalReq := httptest.NewRequest("GET", "/api/profiles/global", nil)
	globalRec := httptest.NewRecorder()
	router.ServeHTTP(globalRec, globalReq)
	if globalRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for global profiles, got %d: %s", globalRec.Code, globalRec.Body.String())
	}

	// Test database query with X-DBLENS-DSN header
	schemasReq := httptest.NewRequest("GET", "/api/connections/default/schemas", nil)
	schemasReq.Header.Set("X-DBLENS-DSN", dsn)
	schemasRec := httptest.NewRecorder()
	router.ServeHTTP(schemasRec, schemasReq)
	if schemasRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for schemas with header, got %d: %s", schemasRec.Code, schemasRec.Body.String())
	}

	// Test database query without X-DBLENS-DSN header -> 400 Bad Request
	noHeaderReq := httptest.NewRequest("GET", "/api/connections/unknown/schemas", nil)
	noHeaderRec := httptest.NewRecorder()
	router.ServeHTTP(noHeaderRec, noHeaderReq)
	if noHeaderRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for request without header or valid connId, got %d: %s", noHeaderRec.Code, noHeaderRec.Body.String())
	}

	fmt.Println("All backend tests passed successfully")
}
