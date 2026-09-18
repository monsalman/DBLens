package params

import (
	"reflect"
	"strings"
	"testing"
)

func TestCompileNamedParams_Postgres(t *testing.T) {
	raw := "SELECT * FROM users WHERE status = :status AND age >= :min_age"
	p := map[string]interface{}{
		"status":  "active",
		"min_age": 18,
	}

	sql, args, err := CompileNamedParams("postgres", raw, p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedSQL := "SELECT * FROM users WHERE status = $1 AND age >= $2"
	if sql != expectedSQL {
		t.Errorf("expected SQL %q, got %q", expectedSQL, sql)
	}

	expectedArgs := []interface{}{"active", 18}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Errorf("expected args %v, got %v", expectedArgs, args)
	}
}

func TestCompileNamedParams_MySQLAndSQLite(t *testing.T) {
	dialects := []string{"mysql", "mariadb", "sqlite", "sqlite3"}
	raw := "SELECT * FROM users WHERE status = :status AND age >= :min_age"
	p := map[string]interface{}{
		"status":  "active",
		"min_age": 18,
	}

	for _, d := range dialects {
		sql, args, err := CompileNamedParams(d, raw, p)
		if err != nil {
			t.Fatalf("[%s] unexpected error: %v", d, err)
		}

		expectedSQL := "SELECT * FROM users WHERE status = ? AND age >= ?"
		if sql != expectedSQL {
			t.Errorf("[%s] expected SQL %q, got %q", d, expectedSQL, sql)
		}

		expectedArgs := []interface{}{"active", 18}
		if !reflect.DeepEqual(args, expectedArgs) {
			t.Errorf("[%s] expected args %v, got %v", d, expectedArgs, args)
		}
	}
}

func TestCompileNamedParams_MultipleOccurrences(t *testing.T) {
	// Postgres reuses $1 for same variable
	raw := "SELECT * FROM items WHERE (name = :val OR code = :val) AND category = :cat"
	p := map[string]interface{}{
		"val": "sample",
		"cat": "electronics",
	}

	pgSQL, pgArgs, err := CompileNamedParams("postgres", raw, p)
	if err != nil {
		t.Fatalf("postgres error: %v", err)
	}
	expectedPgSQL := "SELECT * FROM items WHERE (name = $1 OR code = $1) AND category = $2"
	if pgSQL != expectedPgSQL {
		t.Errorf("postgres expected %q, got %q", expectedPgSQL, pgSQL)
	}
	expectedPgArgs := []interface{}{"sample", "electronics"}
	if !reflect.DeepEqual(pgArgs, expectedPgArgs) {
		t.Errorf("postgres expected args %v, got %v", expectedPgArgs, pgArgs)
	}

	// SQLite / MySQL creates multiple ? placeholders and repeats the arg
	sqSQL, sqArgs, err := CompileNamedParams("sqlite", raw, p)
	if err != nil {
		t.Fatalf("sqlite error: %v", err)
	}
	expectedSqSQL := "SELECT * FROM items WHERE (name = ? OR code = ?) AND category = ?"
	if sqSQL != expectedSqSQL {
		t.Errorf("sqlite expected %q, got %q", expectedSqSQL, sqSQL)
	}
	expectedSqArgs := []interface{}{"sample", "sample", "electronics"}
	if !reflect.DeepEqual(sqArgs, expectedSqArgs) {
		t.Errorf("sqlite expected args %v, got %v", expectedSqArgs, sqArgs)
	}
}

func TestCompileNamedParams_DoubleBraceSyntax(t *testing.T) {
	raw := "SELECT * FROM orders WHERE id = {{ order_id }} AND status = {{status}}"
	p := map[string]interface{}{
		"order_id": 42,
		"status":   "shipped",
	}

	sql, args, err := CompileNamedParams("postgres", raw, p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedSQL := "SELECT * FROM orders WHERE id = $1 AND status = $2"
	if sql != expectedSQL {
		t.Errorf("expected SQL %q, got %q", expectedSQL, sql)
	}
	expectedArgs := []interface{}{42, "shipped"}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Errorf("expected args %v, got %v", expectedArgs, args)
	}
}

func TestCompileNamedParams_PostgresCastExclusion(t *testing.T) {
	raw := "SELECT created_at::date, count(*)::int FROM events WHERE type = :type AND amount > 0::numeric"
	p := map[string]interface{}{
		"type": "signup",
	}

	sql, args, err := CompileNamedParams("postgres", raw, p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedSQL := "SELECT created_at::date, count(*)::int FROM events WHERE type = $1 AND amount > 0::numeric"
	if sql != expectedSQL {
		t.Errorf("expected SQL %q, got %q", expectedSQL, sql)
	}
	if len(args) != 1 || args[0] != "signup" {
		t.Errorf("unexpected args: %v", args)
	}
}

func TestCompileNamedParams_StringLiteralPreservation(t *testing.T) {
	raw := "SELECT 'not a :param' AS label, 'it''s a :fake' AS quote, :real AS actual FROM test"
	p := map[string]interface{}{
		"real": 123,
	}

	sql, args, err := CompileNamedParams("postgres", raw, p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedSQL := "SELECT 'not a :param' AS label, 'it''s a :fake' AS quote, $1 AS actual FROM test"
	if sql != expectedSQL {
		t.Errorf("expected SQL %q, got %q", expectedSQL, sql)
	}
	if len(args) != 1 || args[0] != 123 {
		t.Errorf("unexpected args: %v", args)
	}
}

func TestCompileNamedParams_MissingParams(t *testing.T) {
	raw := "SELECT * FROM users WHERE id = :id AND role = :role"
	p := map[string]interface{}{
		"id": 10,
	}

	_, _, err := CompileNamedParams("postgres", raw, p)
	if err == nil {
		t.Fatal("expected error for missing param :role, got nil")
	}
	if !strings.Contains(err.Error(), "role") {
		t.Errorf("expected error message to mention 'role', got %v", err)
	}

	// Test with nil map
	_, _, err = CompileNamedParams("postgres", raw, nil)
	if err == nil {
		t.Fatal("expected error for nil params map, got nil")
	}
}

func TestCompileNamedParams_NoParams(t *testing.T) {
	raw := "SELECT 1 AS num, 'text' AS txt"
	sql, args, err := CompileNamedParams("postgres", raw, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sql != raw {
		t.Errorf("expected untouched sql %q, got %q", raw, sql)
	}
	if len(args) != 0 {
		t.Errorf("expected empty args, got %v", args)
	}
}

func TestCompileNamedParams_CommentsIgnored(t *testing.T) {
	raw := `-- Filter by :ignored_comment
/* Multi-line
   :ignored_block_comment
*/
SELECT * FROM users WHERE status = :real`
	p := map[string]interface{}{
		"real": "active",
	}

	sql, args, err := CompileNamedParams("postgres", raw, p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(sql, "-- Filter by :ignored_comment") {
		t.Errorf("expected line comment preserved, got: %s", sql)
	}
	if !strings.Contains(sql, ":ignored_block_comment") {
		t.Errorf("expected block comment preserved, got: %s", sql)
	}
	if !strings.Contains(sql, "status = $1") {
		t.Errorf("expected status = $1, got: %s", sql)
	}
	if len(args) != 1 || args[0] != "active" {
		t.Errorf("expected args ['active'], got %v", args)
	}
}

func TestCompileNamedParams_EscapedBackticks(t *testing.T) {
	raw := "SELECT `col``with:fake_param` AS res, :real AS val FROM `my``table`"
	p := map[string]interface{}{
		"real": 42,
	}

	// Test with MySQL dialect (?)
	sql, args, err := CompileNamedParams("mysql", raw, p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedSQL := "SELECT `col``with:fake_param` AS res, ? AS val FROM `my``table`"
	if sql != expectedSQL {
		t.Errorf("expected SQL %q, got %q", expectedSQL, sql)
	}
	if len(args) != 1 || args[0] != 42 {
		t.Errorf("expected args [42], got %v", args)
	}

	// Test with Postgres dialect ($1)
	pgSQL, pgArgs, err := CompileNamedParams("postgres", raw, p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedPgSQL := "SELECT `col``with:fake_param` AS res, $1 AS val FROM `my``table`"
	if pgSQL != expectedPgSQL {
		t.Errorf("expected SQL %q, got %q", expectedPgSQL, pgSQL)
	}
	if len(pgArgs) != 1 || pgArgs[0] != 42 {
		t.Errorf("expected args [42], got %v", pgArgs)
	}
}
