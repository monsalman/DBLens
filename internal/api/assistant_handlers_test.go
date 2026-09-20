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

func TestAssistantEndpoints(t *testing.T) {
	dbFile := "/tmp/dblens_api_assistant_test.db"
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
		CREATE TABLE customers (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			email TEXT NOT NULL
		);
		CREATE TABLE orders (
			id INTEGER PRIMARY KEY,
			customer_id INTEGER,
			total REAL NOT NULL,
			FOREIGN KEY (customer_id) REFERENCES customers(id)
		);
		INSERT INTO customers VALUES (1, 'Alice', 'alice@example.com');
		INSERT INTO orders VALUES (1, 1, 99.9);
	`)
	if err != nil {
		t.Fatalf("failed to setup db: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. Test GET /api/connections/{connId}/assistant/schema
	t.Run("get compact schema", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/connections/default/assistant/schema", nil)
		req.Header.Set("X-DBLENS-DSN", dsn)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct {
			Data struct {
				Tables []map[string]interface{} `json:"tables"`
				DDL    string                   `json:"ddl"`
			} `json:"data"`
			Error *string `json:"error"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse schema response: %v", err)
		}
		if resp.Error != nil {
			t.Fatalf("unexpected error: %s", *resp.Error)
		}
		if len(resp.Data.Tables) < 2 {
			t.Fatalf("expected 2 tables, got %d", len(resp.Data.Tables))
		}
		if !strings.Contains(resp.Data.DDL, "CREATE TABLE") {
			t.Fatalf("expected DDL in response, got: %s", resp.Data.DDL)
		}
		// STRICT SECURITY: verify 0 row data leaked
		if strings.Contains(resp.Data.DDL, "Alice") || strings.Contains(resp.Data.DDL, "alice@example.com") {
			t.Fatalf("SECURITY VIOLATION: row data found in compact schema")
		}
	})

	// 2. Test POST /api/connections/{connId}/assistant/prompt (Offline prompt generator)
	t.Run("build offline prompt", func(t *testing.T) {
		payload := map[string]interface{}{
			"op":     "generate",
			"prompt": "Find top customers by total spent",
		}
		b, _ := json.Marshal(payload)
		req := httptest.NewRequest("POST", "/api/connections/default/assistant/prompt", bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct {
			Data struct {
				Prompt string `json:"prompt"`
			} `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		if !strings.Contains(resp.Data.Prompt, "Target Database Dialect") || !strings.Contains(resp.Data.Prompt, "customers") {
			t.Fatalf("unexpected prompt content: %s", resp.Data.Prompt)
		}
	})

	// Mock LLM server for generate, fix, explain endpoints
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var body map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)

		resp := map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"index": 0,
					"message": map[string]string{
						"role":    "assistant",
						"content": "```sql\nSELECT c.name, SUM(o.total) FROM customers c JOIN orders o ON c.id = o.customer_id GROUP BY c.id;\n```",
					},
				},
			},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer mockLLM.Close()

	// 3. Test POST /api/connections/{connId}/assistant/generate
	t.Run("generate sql", func(t *testing.T) {
		payload := map[string]interface{}{
			"prompt": "find total spent per customer",
			"config": map[string]interface{}{
				"provider": "openai",
				"endpoint": mockLLM.URL,
				"apiKey":   "mock-key",
				"model":    "gpt-4o-mini",
			},
		}
		b, _ := json.Marshal(payload)
		req := httptest.NewRequest("POST", "/api/connections/default/assistant/generate", bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct {
			Data struct {
				SQL string `json:"sql"`
				Raw string `json:"raw"`
			} `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		expected := "SELECT c.name, SUM(o.total) FROM customers c JOIN orders o ON c.id = o.customer_id GROUP BY c.id;"
		if resp.Data.SQL != expected {
			t.Fatalf("expected %q, got %q", expected, resp.Data.SQL)
		}
	})

	// 4. Test POST /api/connections/{connId}/assistant/fix
	t.Run("fix sql", func(t *testing.T) {
		payload := map[string]interface{}{
			"query": "SELECT * FRM customers",
			"error": "syntax error at or near FRM",
			"config": map[string]interface{}{
				"provider": "openai",
				"endpoint": mockLLM.URL,
				"apiKey":   "mock-key",
				"model":    "gpt-4o-mini",
			},
		}
		b, _ := json.Marshal(payload)
		req := httptest.NewRequest("POST", "/api/connections/default/assistant/fix", bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct {
			Data struct {
				SQL string `json:"sql"`
			} `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		if resp.Data.SQL == "" {
			t.Fatalf("expected fixed SQL")
		}
	})

	// 5. Test POST /api/connections/{connId}/assistant/explain
	t.Run("explain sql", func(t *testing.T) {
		explainLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			resp := map[string]interface{}{
				"choices": []map[string]interface{}{
					{
						"message": map[string]string{
							"role":    "assistant",
							"content": "- Groups orders by customer\n- Calculates sum of total spent",
						},
					},
				},
			}
			_ = json.NewEncoder(w).Encode(resp)
		}))
		defer explainLLM.Close()

		payload := map[string]interface{}{
			"query": "SELECT customer_id, SUM(total) FROM orders GROUP BY customer_id",
			"config": map[string]interface{}{
				"provider": "openai",
				"endpoint": explainLLM.URL,
				"apiKey":   "mock-key",
			},
		}
		b, _ := json.Marshal(payload)
		req := httptest.NewRequest("POST", "/api/connections/default/assistant/explain", bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct {
			Data struct {
				Explanation string `json:"explanation"`
			} `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		if !strings.Contains(resp.Data.Explanation, "Groups orders") {
			t.Fatalf("unexpected explanation: %s", resp.Data.Explanation)
		}
	})
}
