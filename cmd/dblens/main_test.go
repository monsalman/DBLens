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

	mgr := connection.NewManager()
	entry, err := mgr.AddWithID("test_sqlite", "Test SQLite", "sqlite://"+dbFile, "#3b82f6", false)
	if err != nil {
		t.Fatalf("failed to add connection: %v", err)
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

	// Test profile creation & listing
	profReqBody := `{"id":"test_prof","label":"Test Profile","dsn":"sqlite:///tmp/dblens_prof_test.db","color":"#ff0000","readOnly":false}`
	profReq := httptest.NewRequest("POST", "/api/profiles", strings.NewReader(profReqBody))
	profReq.Header.Set("Content-Type", "application/json")
	profRec := httptest.NewRecorder()
	router.ServeHTTP(profRec, profReq)
	if profRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 created for profile, got %d: %s", profRec.Code, profRec.Body.String())
	}

	listProfReq := httptest.NewRequest("GET", "/api/profiles", nil)
	listProfRec := httptest.NewRecorder()
	router.ServeHTTP(listProfRec, listProfReq)
	if listProfRec.Code != http.StatusOK || !strings.Contains(listProfRec.Body.String(), "test_prof") {
		t.Fatalf("expected 200 containing test_prof, got %d: %s", listProfRec.Code, listProfRec.Body.String())
	}

	// Test profile update (PUT /api/profiles/:id)
	updateProfBody := `{"label":"Updated Profile","dsn":"sqlite:///tmp/dblens_prof_updated.db","color":"#00ff00","readOnly":true}`
	updateProfReq := httptest.NewRequest("PUT", "/api/profiles/test_prof", strings.NewReader(updateProfBody))
	updateProfReq.Header.Set("Content-Type", "application/json")
	updateProfRec := httptest.NewRecorder()
	router.ServeHTTP(updateProfRec, updateProfReq)
	if updateProfRec.Code != http.StatusOK {
		t.Fatalf("expected 200 ok for update profile, got %d: %s", updateProfRec.Code, updateProfRec.Body.String())
	}
	if !strings.Contains(updateProfRec.Body.String(), "Updated Profile") {
		t.Fatalf("response does not contain updated label: %s", updateProfRec.Body.String())
	}

	// Test connection test endpoint (POST /api/connections/test) - Success
	testConnBody := `{"label":"Test Temp","dsn":"sqlite:///tmp/dblens_temp_test.db"}`
	testConnReq := httptest.NewRequest("POST", "/api/connections/test", strings.NewReader(testConnBody))
	testConnReq.Header.Set("Content-Type", "application/json")
	testConnRec := httptest.NewRecorder()
	router.ServeHTTP(testConnRec, testConnReq)
	if testConnRec.Code != http.StatusOK || !strings.Contains(testConnRec.Body.String(), `"success":true`) {
		t.Fatalf("expected 200 with success:true for test connection, got %d: %s", testConnRec.Code, testConnRec.Body.String())
	}

	// Test connection test endpoint (POST /api/connections/test) - Unsupported / Invalid DSN
	testInvalidConnBody := `{"label":"Invalid","dsn":"invalid://localhost:5432"}`
	testInvalidReq := httptest.NewRequest("POST", "/api/connections/test", strings.NewReader(testInvalidConnBody))
	testInvalidReq.Header.Set("Content-Type", "application/json")
	testInvalidRec := httptest.NewRecorder()
	router.ServeHTTP(testInvalidRec, testInvalidReq)
	if testInvalidRec.Code != http.StatusOK || !strings.Contains(testInvalidRec.Body.String(), `"success":false`) {
		t.Fatalf("expected 200 with success:false for invalid test connection, got %d: %s", testInvalidRec.Code, testInvalidRec.Body.String())
	}

	req := httptest.NewRequest("GET", "/api/connections", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "test_sqlite") {
		t.Fatalf("response does not contain test_sqlite")
	}
	fmt.Println("All backend tests passed successfully")
}
