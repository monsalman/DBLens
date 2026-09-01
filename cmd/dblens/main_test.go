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
