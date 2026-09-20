package assistant

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/driver/sqlite"
)

func TestStripCodeFences(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "raw sql without fences",
			input:    "SELECT * FROM users WHERE active = 1;",
			expected: "SELECT * FROM users WHERE active = 1;",
		},
		{
			name:     "wrapped in sql fence",
			input:    "```sql\nSELECT * FROM users WHERE active = 1;\n```",
			expected: "SELECT * FROM users WHERE active = 1;",
		},
		{
			name:     "wrapped in generic fence",
			input:    "```\nSELECT id, name FROM teams;\n```",
			expected: "SELECT id, name FROM teams;",
		},
		{
			name:     "conversational prefix and suffix",
			input:    "Here is the query you requested:\n```sql\nSELECT COUNT(*) FROM orders;\n```\nHope this helps!",
			expected: "SELECT COUNT(*) FROM orders;",
		},
		{
			name:     "unclosed fence",
			input:    "```sql\nSELECT 1;",
			expected: "SELECT 1;",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := StripCodeFences(tc.input)
			if got != tc.expected {
				t.Fatalf("expected:\n%q\ngot:\n%q", tc.expected, got)
			}
		})
	}
}

func TestBuildPrompt(t *testing.T) {
	ctx := &SchemaContext{
		Tables: []CompactTable{
			{
				Name: "users",
				Columns: []CompactColumn{
					{Name: "id", Type: "INTEGER", PK: true},
					{Name: "email", Type: "TEXT", Nullable: false},
				},
			},
		},
		DDL: "CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  email TEXT NOT NULL\n);",
	}

	t.Run("generate prompt", func(t *testing.T) {
		prompt := BuildPrompt("generate", "PostgreSQL", ctx, "find user with email foo@bar.com", "")
		if !strings.Contains(prompt, "PostgreSQL") {
			t.Fatalf("missing dialect in prompt: %s", prompt)
		}
		if !strings.Contains(prompt, "CREATE TABLE users") {
			t.Fatalf("missing DDL in prompt: %s", prompt)
		}
		if !strings.Contains(prompt, "foo@bar.com") {
			t.Fatalf("missing user request in prompt: %s", prompt)
		}
	})

	t.Run("fix prompt", func(t *testing.T) {
		prompt := BuildPrompt("fix", "SQLite", ctx, "SELECT * FRM users", "syntax error near FRM")
		if !strings.Contains(prompt, "SELECT * FRM users") {
			t.Fatalf("missing failing query: %s", prompt)
		}
		if !strings.Contains(prompt, "syntax error near FRM") {
			t.Fatalf("missing error message: %s", prompt)
		}
	})

	t.Run("explain prompt", func(t *testing.T) {
		prompt := BuildPrompt("explain", "MySQL", ctx, "SELECT id FROM users", "")
		if !strings.Contains(prompt, "SELECT id FROM users") {
			t.Fatalf("missing query: %s", prompt)
		}
		if !strings.Contains(prompt, "concise bullet points") {
			t.Fatalf("missing bullet points instructions: %s", prompt)
		}
	})
}

func TestExtractCompactSchema_SQLite(t *testing.T) {
	drv, err := sqlite.New("sqlite://:memory:")
	if err != nil {
		t.Fatalf("failed to init sqlite driver: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()

	// Seed tables with PK and FK
	_, err = drv.ExecuteQuery(ctx, `
		CREATE TABLE departments (
			id INTEGER PRIMARY KEY,
			dept_name TEXT NOT NULL
		);
		CREATE TABLE employees (
			id INTEGER PRIMARY KEY,
			emp_name TEXT NOT NULL,
			dept_id INTEGER,
			FOREIGN KEY (dept_id) REFERENCES departments(id)
		);
		INSERT INTO departments (id, dept_name) VALUES (1, 'Engineering');
		INSERT INTO employees (id, emp_name, dept_id) VALUES (1, 'Alice', 1);
	`)
	if err != nil {
		t.Fatalf("failed to create tables: %v", err)
	}

	schemaCtx, err := ExtractCompactSchema(ctx, drv, "")
	if err != nil {
		t.Fatalf("ExtractCompactSchema failed: %v", err)
	}

	if len(schemaCtx.Tables) < 2 {
		t.Fatalf("expected at least 2 tables, got %d", len(schemaCtx.Tables))
	}

	// Verify no row values (e.g. 'Engineering' or 'Alice') are included anywhere
	if strings.Contains(schemaCtx.DDL, "Engineering") || strings.Contains(schemaCtx.DDL, "Alice") {
		t.Fatalf("SECURITY VIOLATION: row data found in compact schema context!")
	}

	// Verify DDL contains table definitions
	if !strings.Contains(schemaCtx.DDL, "departments") || !strings.Contains(schemaCtx.DDL, "employees") {
		t.Fatalf("expected tables in DDL, got: %s", schemaCtx.DDL)
	}
}

func TestCallLLM_OpenAI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&req)

		w.Header().Set("Content-Type", "application/json")
		resp := map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"index": 0,
					"message": map[string]string{
						"role":    "assistant",
						"content": "```sql\nSELECT * FROM employees;\n```",
					},
				},
			},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	cfg := LLMConfig{
		Provider: "openai",
		Endpoint: server.URL,
		APIKey:   "test-key",
		Model:    "gpt-4o-mini",
	}

	res, err := CallLLM(context.Background(), cfg, "system prompt", "user prompt")
	if err != nil {
		t.Fatalf("CallLLM failed: %v", err)
	}

	sql := StripCodeFences(res)
	if sql != "SELECT * FROM employees;" {
		t.Fatalf("expected SELECT * FROM employees;, got %q", sql)
	}
}

func TestCallLLM_Anthropic(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "anthropic-key" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		resp := map[string]interface{}{
			"content": []map[string]interface{}{
				{
					"type": "text",
					"text": "- Explains the query execution flow.",
				},
			},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	cfg := LLMConfig{
		Provider: "anthropic",
		Endpoint: server.URL,
		APIKey:   "anthropic-key",
		Model:    "claude-3-5-sonnet",
	}

	res, err := CallLLM(context.Background(), cfg, "system prompt", "user prompt")
	if err != nil {
		t.Fatalf("CallLLM failed: %v", err)
	}

	if !strings.Contains(res, "Explains the query execution flow") {
		t.Fatalf("unexpected anthropic response: %q", res)
	}
}

func TestGenerateAndFixSQL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		resp := map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"message": map[string]string{
						"role":    "assistant",
						"content": "SELECT id, emp_name FROM employees WHERE id = 1;",
					},
				},
			},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	drv, err := sqlite.New("sqlite://:memory:")
	if err != nil {
		t.Fatalf("failed to init sqlite driver: %v", err)
	}
	defer drv.Close()

	cfg := LLMConfig{
		Provider: "openai",
		Endpoint: server.URL,
		APIKey:   "mock-key",
		Model:    "test-model",
	}

	// Test GenerateSQL
	genResp, err := GenerateSQL(context.Background(), drv, cfg, "", "get employee 1")
	if err != nil {
		t.Fatalf("GenerateSQL failed: %v", err)
	}
	if genResp.Result != "SELECT id, emp_name FROM employees WHERE id = 1;" {
		t.Fatalf("unexpected generate result: %q", genResp.Result)
	}

	// Test FixSQL
	fixResp, err := FixSQL(context.Background(), drv, cfg, "", "SELECT id, emp_name FRM employees", "syntax error")
	if err != nil {
		t.Fatalf("FixSQL failed: %v", err)
	}
	if fixResp.Result != "SELECT id, emp_name FROM employees WHERE id = 1;" {
		t.Fatalf("unexpected fix result: %q", fixResp.Result)
	}
}
