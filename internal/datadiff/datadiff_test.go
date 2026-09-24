package datadiff

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/driver/sqlite"
	_ "modernc.org/sqlite"
)

func TestHasher(t *testing.T) {
	t.Run("normalization", func(t *testing.T) {
		if NormalizeValue(nil) != "<NULL>" {
			t.Errorf("expected <NULL>, got %s", NormalizeValue(nil))
		}
		if NormalizeValue(true) != "true" || NormalizeValue(false) != "false" {
			t.Errorf("boolean normalization failed")
		}
		if NormalizeValue(42) != "42" || NormalizeValue(int64(42)) != "42" {
			t.Errorf("integer normalization failed")
		}
		if NormalizeValue(42.0) != "42" {
			t.Errorf("whole float normalization failed: got %s", NormalizeValue(42.0))
		}
		// JSON normalization should be canonical
		json1 := `{"b": 2, "a": 1}`
		json2 := `{"a": 1, "b": 2}`
		if NormalizeValue(json1) != NormalizeValue(json2) {
			t.Errorf("json canonicalization failed: %s vs %s", NormalizeValue(json1), NormalizeValue(json2))
		}
	})

	t.Run("detect changed columns", func(t *testing.T) {
		cols := []string{"id", "name", "age", "status"}
		src := map[string]any{"id": 1, "name": "Alice", "age": 30, "status": "active"}
		tgt := map[string]any{"id": 1, "name": "Alice", "age": 31, "status": "inactive"}

		changed := DetectChangedColumns(cols, src, tgt)
		if len(changed) != 2 || changed[0] != "age" || changed[1] != "status" {
			t.Errorf("unexpected changed columns: %v", changed)
		}
	})

	t.Run("row hashing determinism", func(t *testing.T) {
		cols := []string{"id", "name"}
		row1 := map[string]any{"id": 10, "name": "Bob"}
		row2 := map[string]any{"id": 10, "name": "Bob"}
		row3 := map[string]any{"id": 10, "name": "Charlie"}

		h1 := ComputeRowHash(cols, row1)
		h2 := ComputeRowHash(cols, row2)
		h3 := ComputeRowHash(cols, row3)

		if h1 != h2 {
			t.Errorf("expected identical hashes for row1 and row2, got %s and %s", h1, h2)
		}
		if h1 == h3 {
			t.Errorf("expected different hashes for row1 and row3")
		}

		md5_1 := ComputeRowMD5(cols, row1)
		md5_2 := ComputeRowMD5(cols, row2)
		if md5_1 != md5_2 {
			t.Errorf("MD5 determinism failed")
		}
	})

	t.Run("range hashing", func(t *testing.T) {
		hashes := []string{"abc", "def", "123"}
		r1 := ComputeRangeHash(hashes)
		// Permuted input should yield identical chunk hash due to sorting
		hashesPermuted := []string{"def", "123", "abc"}
		r2 := ComputeRangeHash(hashesPermuted)
		if r1 != r2 {
			t.Errorf("range hash should be deterministic regardless of slice order: %s vs %s", r1, r2)
		}
	})
}

func TestSyncGen(t *testing.T) {
	t.Run("identifier validation", func(t *testing.T) {
		if !IsValidIdentifier("users") || !IsValidIdentifier("user_id") || !IsValidIdentifier("_meta") {
			t.Errorf("valid identifiers rejected")
		}
		if IsValidIdentifier("users; DROP TABLE users;") || IsValidIdentifier("user-name") || IsValidIdentifier("123abc") {
			t.Errorf("invalid identifiers accepted")
		}
	})

	t.Run("source_wins strategy DML generation", func(t *testing.T) {
		req := SyncScriptRequest{
			TargetDialect: "postgres",
			TargetSchema:  "public",
			TargetTable:   "users",
			PrimaryKeys:   []string{"id"},
			Columns:       []string{"id", "name", "email"},
			Strategy:      StrategySourceWins,
			DeleteExcess:  true,
			Rows: []RowDiffItem{
				{
					Status:       StatusAdded,
					SourceValues: map[string]any{"id": 1, "name": "Alice", "email": "alice@example.com"},
					PKValues:     map[string]any{"id": 1},
				},
				{
					Status:       StatusModified,
					SourceValues: map[string]any{"id": 2, "name": "Bob Updated", "email": "bob@example.com"},
					TargetValues: map[string]any{"id": 2, "name": "Bob", "email": "bob@example.com"},
					PKValues:     map[string]any{"id": 2},
				},
				{
					Status:       StatusDeleted,
					TargetValues: map[string]any{"id": 3, "name": "Charlie", "email": "charlie@example.com"},
					PKValues:     map[string]any{"id": 3},
				},
			},
		}

		resp, err := GenerateSyncScript(req)
		if err != nil {
			t.Fatalf("GenerateSyncScript failed: %v", err)
		}

		if resp.InsertCount != 1 || resp.UpdateCount != 1 || resp.DeleteCount != 1 {
			t.Errorf("unexpected counts: %+v", resp)
		}

		if !strings.Contains(resp.SQL, "BEGIN;") || !strings.Contains(resp.SQL, "COMMIT;") {
			t.Errorf("script missing transaction markers: %s", resp.SQL)
		}
		if !strings.Contains(resp.SQL, `ON CONFLICT ("id") DO UPDATE SET`) {
			t.Errorf("postgres upsert missing ON CONFLICT: %s", resp.SQL)
		}
		if !strings.Contains(resp.SQL, `DELETE FROM "public"."users" WHERE "id" = 3`) {
			t.Errorf("delete statement missing: %s", resp.SQL)
		}
	})

	t.Run("mysql dialect quoting and upsert", func(t *testing.T) {
		req := SyncScriptRequest{
			TargetDialect: "mysql",
			TargetTable:   "users",
			PrimaryKeys:   []string{"id"},
			Columns:       []string{"id", "name"},
			Strategy:      StrategySourceWins,
			Rows: []RowDiffItem{
				{
					Status:       StatusAdded,
					SourceValues: map[string]any{"id": 10, "name": "MySQL User"},
					PKValues:     map[string]any{"id": 10},
				},
			},
		}

		resp, err := GenerateSyncScript(req)
		if err != nil {
			t.Fatalf("GenerateSyncScript failed: %v", err)
		}

		if !strings.Contains(resp.SQL, "START TRANSACTION;") {
			t.Errorf("mysql script missing START TRANSACTION: %s", resp.SQL)
		}
		if !strings.Contains(resp.SQL, "`users`") || !strings.Contains(resp.SQL, "ON DUPLICATE KEY UPDATE") {
			t.Errorf("mysql syntax mismatch: %s", resp.SQL)
		}
	})

	t.Run("sqlite dialect quoting and upsert", func(t *testing.T) {
		req := SyncScriptRequest{
			TargetDialect: "sqlite",
			TargetTable:   "users",
			PrimaryKeys:   []string{"id"},
			Columns:       []string{"id", "is_admin"},
			Strategy:      StrategySourceWins,
			Rows: []RowDiffItem{
				{
					Status:       StatusAdded,
					SourceValues: map[string]any{"id": 5, "is_admin": true},
					PKValues:     map[string]any{"id": 5},
				},
			},
		}

		resp, err := GenerateSyncScript(req)
		if err != nil {
			t.Fatalf("GenerateSyncScript failed: %v", err)
		}

		if !strings.Contains(resp.SQL, "BEGIN TRANSACTION;") {
			t.Errorf("sqlite script missing BEGIN TRANSACTION: %s", resp.SQL)
		}
		// In sqlite, boolean true formats to 1
		if !strings.Contains(resp.SQL, "1") {
			t.Errorf("sqlite boolean should format to 1: %s", resp.SQL)
		}
	})

	t.Run("target_wins and insert_missing_only strategies", func(t *testing.T) {
		rows := []RowDiffItem{
			{
				Status:       StatusAdded,
				SourceValues: map[string]any{"id": 1, "name": "Src Only"},
				PKValues:     map[string]any{"id": 1},
			},
			{
				Status:       StatusDeleted,
				TargetValues: map[string]any{"id": 2, "name": "Tgt Only"},
				PKValues:     map[string]any{"id": 2},
			},
		}

		// Insert missing only
		respMissing, err := GenerateSyncScript(SyncScriptRequest{
			TargetDialect: "sqlite",
			TargetTable:   "users",
			PrimaryKeys:   []string{"id"},
			Columns:       []string{"id", "name"},
			Strategy:      StrategyInsertMissingOnly,
			Rows:          rows,
		})
		if err != nil {
			t.Fatalf("InsertMissingOnly failed: %v", err)
		}
		if respMissing.InsertCount != 1 || respMissing.UpdateCount != 0 || respMissing.DeleteCount != 0 {
			t.Errorf("unexpected counts for insert_missing_only: %+v", respMissing)
		}

		// Target wins: destination is Source table, so deleted row (present in target) is inserted into source
		respTargetWins, err := GenerateSyncScript(SyncScriptRequest{
			TargetDialect: "sqlite",
			SourceTable:   "users",
			PrimaryKeys:   []string{"id"},
			Columns:       []string{"id", "name"},
			Strategy:      StrategyTargetWins,
			Rows:          rows,
		})
		if err != nil {
			t.Fatalf("TargetWins failed: %v", err)
		}
		if respTargetWins.InsertCount != 1 || !strings.Contains(respTargetWins.SQL, "Tgt Only") {
			t.Errorf("target_wins should insert target row into source table: %s", respTargetWins.SQL)
		}
	})
}

func setupSQLiteDB(t *testing.T, filename string) (*sqlite.SQLiteDriver, string) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, filename)

	drv, err := sqlite.New(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite driver: %v", err)
	}
	t.Cleanup(func() {
		_ = drv.Close()
		_ = os.Remove(dbPath)
	})

	return drv, dbPath
}

func TestCompareDataAndExecutor(t *testing.T) {
	srcDriver, _ := setupSQLiteDB(t, "src.db")
	tgtDriver, _ := setupSQLiteDB(t, "tgt.db")

	ctx := context.Background()

	// Create tables in both databases
	_, err := srcDriver.ExecuteQuery(ctx, `CREATE TABLE products (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		price REAL NOT NULL,
		active INTEGER NOT NULL
	)`)
	if err != nil {
		t.Fatalf("create src table failed: %v", err)
	}

	_, err = tgtDriver.ExecuteQuery(ctx, `CREATE TABLE products (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		price REAL NOT NULL,
		active INTEGER NOT NULL
	)`)
	if err != nil {
		t.Fatalf("create tgt table failed: %v", err)
	}

	// Seed source: id 1 (identical), id 2 (modified in price), id 3 (added only in source)
	_, _ = srcDriver.ExecuteQuery(ctx, "INSERT INTO products VALUES (1, 'Widget A', 10.5, 1)")
	_, _ = srcDriver.ExecuteQuery(ctx, "INSERT INTO products VALUES (2, 'Widget B', 25.0, 1)")
	_, _ = srcDriver.ExecuteQuery(ctx, "INSERT INTO products VALUES (3, 'Widget C', 35.0, 1)")

	// Seed target: id 1 (identical), id 2 (old price 20.0), id 4 (deleted from source, extra in target)
	_, _ = tgtDriver.ExecuteQuery(ctx, "INSERT INTO products VALUES (1, 'Widget A', 10.5, 1)")
	_, _ = tgtDriver.ExecuteQuery(ctx, "INSERT INTO products VALUES (2, 'Widget B', 20.0, 1)")
	_, _ = tgtDriver.ExecuteQuery(ctx, "INSERT INTO products VALUES (4, 'Widget D', 40.0, 0)")

	// Run row-level comparison
	diffReq := DataDiffRequest{
		SourceTable: "products",
		TargetTable: "products",
		PageSize:    100,
	}

	diffRes, err := CompareData(ctx, diffReq, srcDriver, tgtDriver)
	if err != nil {
		t.Fatalf("CompareData failed: %v", err)
	}

	if diffRes.Summary.AddedCount != 1 {
		t.Errorf("expected 1 added, got %d", diffRes.Summary.AddedCount)
	}
	if diffRes.Summary.DeletedCount != 1 {
		t.Errorf("expected 1 deleted, got %d", diffRes.Summary.DeletedCount)
	}
	if diffRes.Summary.ModifiedCount != 1 {
		t.Errorf("expected 1 modified, got %d", diffRes.Summary.ModifiedCount)
	}
	if diffRes.Summary.IdenticalCount != 1 {
		t.Errorf("expected 1 identical, got %d", diffRes.Summary.IdenticalCount)
	}

	// Verify changed column on modified row
	for _, row := range diffRes.Rows {
		if row.Status == StatusModified {
			if len(row.ChangedColumns) != 1 || row.ChangedColumns[0] != "price" {
				t.Errorf("expected changed column 'price', got %v", row.ChangedColumns)
			}
		}
	}

	// Generate sync script to sync target to match source (source_wins) with delete excess
	syncScriptReq := SyncScriptRequest{
		TargetDialect: "sqlite",
		TargetTable:   "products",
		PrimaryKeys:   diffRes.PrimaryKeys,
		Columns:       diffRes.ComparedColumns,
		Strategy:      StrategySourceWins,
		DeleteExcess:  true,
		Rows:          diffRes.Rows,
	}

	scriptResp, err := GenerateSyncScript(syncScriptReq)
	if err != nil {
		t.Fatalf("GenerateSyncScript failed: %v", err)
	}

	// Execute sync on target
	applyReq := ApplySyncRequest{
		Statements: scriptResp.Statements,
		ReadOnly:   false,
	}

	applyResp, err := ExecuteSync(ctx, tgtDriver, applyReq)
	if err != nil {
		t.Fatalf("ExecuteSync failed: %v", err)
	}
	if !applyResp.Success || applyResp.StatementsExecuted != 3 {
		t.Errorf("unexpected apply response: %+v", applyResp)
	}

	// Re-compare: now all rows in source (1, 2, 3) should be identical in target!
	reDiff, err := CompareData(ctx, diffReq, srcDriver, tgtDriver)
	if err != nil {
		t.Fatalf("Re-compare failed: %v", err)
	}
	if reDiff.Summary.AddedCount != 0 || reDiff.Summary.DeletedCount != 0 || reDiff.Summary.ModifiedCount != 0 {
		t.Errorf("expected 0 differences after sync, got summary: %+v", reDiff.Summary)
	}
	if reDiff.Summary.IdenticalCount != 3 {
		t.Errorf("expected 3 identical rows, got %d", reDiff.Summary.IdenticalCount)
	}

	// Test Safe Mode Rejection
	safeReq := ApplySyncRequest{
		Statements: scriptResp.Statements,
		ReadOnly:   true,
	}
	_, err = ExecuteSync(ctx, tgtDriver, safeReq)
	if err == nil || !strings.Contains(err.Error(), "read-only") {
		t.Errorf("expected read-only safe mode error, got %v", err)
	}

	// Test Transaction Rollback on Error
	failReq := ApplySyncRequest{
		Statements: []string{
			"INSERT INTO products VALUES (99, 'Rollback Test', 9.9, 1)",
			"INSERT INTO non_existent_table_will_fail VALUES (1)",
		},
		ReadOnly: false,
	}
	_, err = ExecuteSync(ctx, tgtDriver, failReq)
	if err == nil {
		t.Fatalf("expected error from non_existent_table_will_fail")
	}

	// Verify row 99 was rolled back
	checkRes, err := tgtDriver.ExecuteQuery(ctx, "SELECT * FROM products WHERE id = 99")
	if err != nil {
		t.Fatalf("check query failed: %v", err)
	}
	if len(checkRes.Rows) > 0 {
		t.Errorf("transaction rollback failed; row 99 was inserted: %+v", checkRes.Rows)
	}
}

func TestRegression_SecurityAndLogic(t *testing.T) {
	t.Run("where clause validation rejects injections and mutations", func(t *testing.T) {
		invalidClauses := []string{
			"id = 1; DROP TABLE users;",
			"id = 1 -- comment",
			"/* multiline */ id = 1",
			"id = 1 */",
			"id = 1 AND EXISTS (DELETE FROM users)",
			"id = 1 UNION SELECT 1, 2; INSERT INTO audit VALUES (1)",
			"id = 1; ALTER TABLE users ADD COLUMN hacked text",
			"TRUNCATE users",
			"CREATE TABLE foo (id int)",
			"GRANT ALL ON users TO evil",
			"REVOKE ALL ON users FROM admin",
			"EXEC malicious_proc",
		}
		for _, clause := range invalidClauses {
			if err := ValidateWhereClause(clause); err == nil {
				t.Errorf("expected error for invalid where clause %q, got nil", clause)
			}
		}

		validClauses := []string{
			"",
			"   ",
			"status = 'active'",
			"age > 18 AND age < 65",
			"name LIKE 'Alice%'",
			"created_at >= '2025-01-01' AND is_deleted = false",
		}
		for _, clause := range validClauses {
			if err := ValidateWhereClause(clause); err != nil {
				t.Errorf("expected valid where clause %q, got error: %v", clause, err)
			}
		}
	})

	t.Run("sync statement validation rejects DDL and invalid tables", func(t *testing.T) {
		validStatements := []struct {
			stmt  string
			table string
		}{
			{"INSERT INTO \"users\" (\"id\", \"name\") VALUES (1, 'Alice');", "users"},
			{"INSERT INTO users (id, name) VALUES (1, 'Alice')", "users"},
			{"INSERT INTO `public`.`users` (`id`) VALUES (1)", "users"},
			{"INSERT OR IGNORE INTO users (id) VALUES (1)", "users"},
			{"INSERT IGNORE INTO users (id) VALUES (1)", "users"},
			{"UPDATE users SET name = 'Bob' WHERE id = 1;", "users"},
			{"UPDATE \"public\".\"users\" SET name = 'Bob' WHERE id = 1", "users"},
			{"UPDATE `users` SET `name` = 'Bob' WHERE `id` = 1", "users"},
			{"DELETE FROM users WHERE id = 1;", "users"},
			{"DELETE FROM \"users\" WHERE \"id\" = 1", "users"},
			{"BEGIN", ""},
			{"COMMIT", ""},
			{"START TRANSACTION", ""},
		}

		for _, tc := range validStatements {
			if err := ValidateSyncStatement(tc.stmt, tc.table); err != nil {
				t.Errorf("expected valid statement %q for table %q, got: %v", tc.stmt, tc.table, err)
			}
		}

		invalidStatements := []struct {
			stmt  string
			table string
		}{
			{"DROP TABLE users;", "users"},
			{"ALTER TABLE users ADD COLUMN x int;", "users"},
			{"TRUNCATE TABLE users;", "users"},
			{"CREATE TABLE hacker (id int);", "users"},
			{"PRAGMA foreign_keys = OFF;", "users"},
			{"SELECT * FROM users;", "users"},
			{"INSERT INTO orders (id) VALUES (1);", "users"}, // wrong table
			{"UPDATE items SET price = 1 WHERE id = 1;", "users"}, // wrong table
			{"DELETE FROM items WHERE id = 1;", "users"}, // wrong table
			{"INSERT INTO users (id) VALUES (1); DROP TABLE users;", "users"}, // multi-statement
			{"DELETE FROM users WHERE id = 1 -- comment", "users"}, // comment
		}

		for _, tc := range invalidStatements {
			if err := ValidateSyncStatement(tc.stmt, tc.table); err == nil {
				t.Errorf("expected error for invalid statement %q (table: %q), got nil", tc.stmt, tc.table)
			}
		}
	})

	t.Run("primary key validation in GenerateSyncScript", func(t *testing.T) {
		req := SyncScriptRequest{
			TargetTable: "users",
			PrimaryKeys: []string{}, // empty PKs
			Columns:     []string{"id", "name"},
			Strategy:    StrategySourceWins,
		}
		_, err := GenerateSyncScript(req)
		if err == nil || !strings.Contains(err.Error(), "at least one primary key is required") {
			t.Errorf("expected error requiring at least one primary key, got: %v", err)
		}
	})

	t.Run("target_wins dialect and table inversion", func(t *testing.T) {
		req := SyncScriptRequest{
			SourceDialect: "mysql",
			SourceSchema:  "",
			SourceTable:   "origin_items",
			TargetDialect: "postgres",
			TargetSchema:  "public",
			TargetTable:   "replica_items",
			PrimaryKeys:   []string{"id"},
			Columns:       []string{"id", "title"},
			Strategy:      StrategyTargetWins,
			Rows: []RowDiffItem{
				{
					Status:       StatusDeleted, // missing in source, exists in target -> insert into source
					TargetValues: map[string]any{"id": 42, "title": "From Target"},
					PKValues:     map[string]any{"id": 42},
				},
				{
					Status:       StatusModified,
					TargetValues: map[string]any{"id": 1, "title": "Updated in Target"},
					PKValues:     map[string]any{"id": 1},
				},
			},
		}

		resp, err := GenerateSyncScript(req)
		if err != nil {
			t.Fatalf("GenerateSyncScript failed: %v", err)
		}

		if resp.TargetDialect != "mysql" {
			t.Errorf("expected effective dialect mysql for target_wins, got %s", resp.TargetDialect)
		}
		if !strings.Contains(resp.SQL, "START TRANSACTION;") {
			t.Errorf("expected mysql transaction marker in script: %s", resp.SQL)
		}
		// Should target `origin_items` using MySQL backticks
		if !strings.Contains(resp.SQL, "`origin_items`") {
			t.Errorf("expected script to target `origin_items` with backticks: %s", resp.SQL)
		}
	})

	t.Run("literal formatting time and bytea", func(t *testing.T) {
		fixedTime := time.Date(2025, 6, 15, 12, 30, 45, 123456000, time.UTC)
		formattedTime := FormatLiteral(fixedTime, "postgres")
		if formattedTime != "'2025-06-15 12:30:45.123456'" {
			t.Errorf("expected '2025-06-15 12:30:45.123456', got %s", formattedTime)
		}

		byteData := []byte("hello")
		pgBytea := FormatLiteral(byteData, "postgres")
		if pgBytea != "decode('68656c6c6f', 'hex')" {
			t.Errorf("expected decode('68656c6c6f', 'hex') for postgres bytea, got %s", pgBytea)
		}

		sqliteBlob := FormatLiteral(byteData, "sqlite")
		if sqliteBlob != "X'68656C6C6F'" {
			t.Errorf("expected X'68656C6C6F' for sqlite blob, got %s", sqliteBlob)
		}
	})

	t.Run("boolean cross-database normalization", func(t *testing.T) {
		// SQLite 0/1 vs Postgres bool
		if NormalizeValue(0) != NormalizeValue(false) {
			t.Errorf("0 and false should normalize identically: %s vs %s", NormalizeValue(0), NormalizeValue(false))
		}
		if NormalizeValue(1) != NormalizeValue(true) {
			t.Errorf("1 and true should normalize identically: %s vs %s", NormalizeValue(1), NormalizeValue(true))
		}
		if NormalizeValue(int64(0)) != "false" || NormalizeValue(int64(1)) != "true" {
			t.Errorf("int64 0/1 normalization failed")
		}
		if NormalizeValue(uint8(0)) != "false" || NormalizeValue(uint8(1)) != "true" {
			t.Errorf("uint8 0/1 normalization failed")
		}
		if NormalizeValue("t") != "true" || NormalizeValue("f") != "false" {
			t.Errorf("string t/f normalization failed")
		}
	})
}
