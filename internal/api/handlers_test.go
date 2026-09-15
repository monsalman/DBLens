package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
)

func TestMaskDSN(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{
			input:    "mysql://root:***@tcp(localhost:3306)/dbname",
			expected: "mysql://root:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "root:secret@tcp(localhost:3306)/dbname",
			expected: "root:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "postgres://user:***@localhost:5432/db",
			expected: "postgres://user:***@localhost:5432/db",
		},
		{
			input:    "root@tcp(localhost:3306)/dbname",
			expected: "root@tcp(localhost:3306)/dbname",
		},
		{
			input:    "sqlite:///data/test.db",
			expected: "sqlite:///data/test.db",
		},
		{
			input:    "postgres://user:p@ss@w0rd@localhost:5432/db",
			expected: "postgres://user:***@localhost:5432/db",
		},
		{
			input:    "root:p@ss@word@tcp(localhost:3306)/dbname",
			expected: "root:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "mysql://root:p@ss@word@tcp(localhost:3306)/dbname",
			expected: "mysql://root:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "user:pass:word@tcp(localhost:3306)/dbname",
			expected: "user:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "postgres://user:secret@localhost:5432/db?email=foo@bar.com",
			expected: "postgres://user:***@localhost:5432/db?email=foo@bar.com",
		},
		{
			input:    "oracle://scott:tiger@localhost:1521/xe",
			expected: "oracle://scott:***@localhost:1521/xe",
		},
		{
			input:    "postgres://user@localhost:5432/db",
			expected: "postgres://user@localhost:5432/db",
		},
		{
			input:    ":memory:",
			expected: ":memory:",
		},
	}

	for _, tc := range cases {
		got := api.MaskDSN(tc.input)
		if got != tc.expected {
			t.Errorf("MaskDSN(%q) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}

func TestBatchInsertHandler(t *testing.T) {
	dbFile := "/tmp/dblens_api_batch_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	dsn := "sqlite://" + dbFile

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to create connection: %v", err)
	}

	ctx := context.Background()
	_, err = entry.Driver.ExecuteQuery(ctx, `
		CREATE TABLE products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			price REAL NOT NULL
		);
	`)
	if err != nil {
		t.Fatalf("failed to create table: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. Successful Batch Insert
	body := `{
		"schema": "",
		"table": "products",
		"rows": [
			{"title": "Widget A", "price": 9.99},
			{"title": "Widget B", "price": 19.99}
		]
	}`
	req := httptest.NewRequest("POST", "/api/connections/default/batch-insert", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DBLENS-DSN", dsn)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on batch insert, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"affectedRows":2`) {
		t.Fatalf("expected affectedRows: 2 in response, got: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"generatedSQL"`) {
		t.Fatalf("expected generatedSQL in response, got: %s", rec.Body.String())
	}

	// 2. Empty table validation
	emptyTableBody := `{"table": "", "rows": [{"title": "Widget C"}]}`
	req2 := httptest.NewRequest("POST", "/api/connections/default/batch-insert", strings.NewReader(emptyTableBody))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-DBLENS-DSN", dsn)
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on empty table, got: %d", rec2.Code)
	}

	// 3. Empty rows validation
	emptyRowsBody := `{"table": "products", "rows": []}`
	req3 := httptest.NewRequest("POST", "/api/connections/default/batch-insert", strings.NewReader(emptyRowsBody))
	req3.Header.Set("Content-Type", "application/json")
	req3.Header.Set("X-DBLENS-DSN", dsn)
	rec3 := httptest.NewRecorder()
	router.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on empty rows, got: %d", rec3.Code)
	}

	// 4. Malformed JSON validation
	req4 := httptest.NewRequest("POST", "/api/connections/default/batch-insert", strings.NewReader(`{malformed`))
	req4.Header.Set("Content-Type", "application/json")
	req4.Header.Set("X-DBLENS-DSN", dsn)
	rec4 := httptest.NewRecorder()
	router.ServeHTTP(rec4, req4)
	if rec4.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on invalid json, got: %d", rec4.Code)
	}

	// 5. Exceeds max row limit validation (> 1000 rows)
	tooManyRows := make([]map[string]interface{}, 1001)
	for i := range tooManyRows {
		tooManyRows[i] = map[string]interface{}{"title": "item", "price": 1.0}
	}
	tooManyJSON, _ := json.Marshal(map[string]interface{}{
		"table": "products",
		"rows":  tooManyRows,
	})
	req5 := httptest.NewRequest("POST", "/api/connections/default/batch-insert", bytes.NewReader(tooManyJSON))
	req5.Header.Set("Content-Type", "application/json")
	req5.Header.Set("X-DBLENS-DSN", dsn)
	rec5 := httptest.NewRecorder()
	router.ServeHTTP(rec5, req5)
	if rec5.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on >1000 rows, got: %d", rec5.Code)
	}
	if !strings.Contains(rec5.Body.String(), "exceeds maximum limit") {
		t.Fatalf("expected limit error message, got: %s", rec5.Body.String())
	}
}
