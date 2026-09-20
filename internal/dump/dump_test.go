package dump

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/driver/types"
)

func TestTopologicalSort(t *testing.T) {
	t.Run("independent tables", func(t *testing.T) {
		tables := []string{"zebra", "apple", "mango"}
		fks := []types.ForeignKey{}
		sorted := TopologicalSort(tables, fks)
		if len(sorted) != 3 {
			t.Fatalf("expected 3 tables, got %d", len(sorted))
		}
		// Alphabetical deterministic order for independent tables
		if sorted[0] != "apple" || sorted[1] != "mango" || sorted[2] != "zebra" {
			t.Errorf("unexpected order: %v", sorted)
		}
	})

	t.Run("linear dependency", func(t *testing.T) {
		tables := []string{"orders", "users"}
		fks := []types.ForeignKey{
			{Table: "orders", RefTable: "users", Column: "user_id", RefColumn: "id"},
		}
		sorted := TopologicalSort(tables, fks)
		if len(sorted) != 2 {
			t.Fatalf("expected 2 tables, got %d", len(sorted))
		}
		if sorted[0] != "users" || sorted[1] != "orders" {
			t.Errorf("expected [users, orders], got %v", sorted)
		}
	})

	t.Run("multi-level dependency chain", func(t *testing.T) {
		tables := []string{"comments", "tags", "posts", "users"}
		fks := []types.ForeignKey{
			{Table: "posts", RefTable: "users", Column: "author_id", RefColumn: "id"},
			{Table: "comments", RefTable: "posts", Column: "post_id", RefColumn: "id"},
			{Table: "comments", RefTable: "users", Column: "user_id", RefColumn: "id"},
		}
		sorted := TopologicalSort(tables, fks)
		if len(sorted) != 4 {
			t.Fatalf("expected 4 tables, got %d", len(sorted))
		}

		pos := make(map[string]int)
		for i, name := range sorted {
			pos[name] = i
		}

		if pos["users"] >= pos["posts"] {
			t.Errorf("users must precede posts: %v", sorted)
		}
		if pos["posts"] >= pos["comments"] {
			t.Errorf("posts must precede comments: %v", sorted)
		}
		if pos["users"] >= pos["comments"] {
			t.Errorf("users must precede comments: %v", sorted)
		}
	})

	t.Run("circular dependency", func(t *testing.T) {
		tables := []string{"table_a", "table_b", "table_c"}
		fks := []types.ForeignKey{
			{Table: "table_a", RefTable: "table_b"},
			{Table: "table_b", RefTable: "table_c"},
			{Table: "table_c", RefTable: "table_a"},
		}
		sorted := TopologicalSort(tables, fks)
		if len(sorted) != 3 {
			t.Fatalf("expected 3 tables, got %d", len(sorted))
		}
		seen := make(map[string]bool)
		for _, name := range sorted {
			seen[name] = true
		}
		if !seen["table_a"] || !seen["table_b"] || !seen["table_c"] {
			t.Errorf("expected all 3 tables present despite cycle: %v", sorted)
		}
	})

	t.Run("self referencing table", func(t *testing.T) {
		tables := []string{"employees"}
		fks := []types.ForeignKey{
			{Table: "employees", RefTable: "employees", Column: "manager_id", RefColumn: "id"},
		}
		sorted := TopologicalSort(tables, fks)
		if len(sorted) != 1 || sorted[0] != "employees" {
			t.Errorf("expected [employees], got %v", sorted)
		}
	})

	t.Run("external foreign key target", func(t *testing.T) {
		tables := []string{"orders"}
		fks := []types.ForeignKey{
			{Table: "orders", RefTable: "non_existent_table"},
		}
		sorted := TopologicalSort(tables, fks)
		if len(sorted) != 1 || sorted[0] != "orders" {
			t.Errorf("expected [orders], got %v", sorted)
		}
	})
}

func setupTestSQLiteDB(t *testing.T, dbPath string) types.Driver {
	t.Helper()
	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN("sqlite://" + dbPath)
	if err != nil {
		t.Fatalf("failed to connect sqlite: %v", err)
	}

	ctx := context.Background()
	_, err = entry.Driver.ExecuteQuery(ctx, `
		CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			username TEXT NOT NULL,
			email TEXT,
			is_active BOOLEAN
		);
		CREATE TABLE posts (
			id INTEGER PRIMARY KEY,
			user_id INTEGER,
			title TEXT NOT NULL,
			content TEXT,
			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		INSERT INTO users (id, username, email, is_active) VALUES (1, 'alice', 'alice@example.com', 1);
		INSERT INTO users (id, username, email, is_active) VALUES (2, 'bob', NULL, 0);
		INSERT INTO posts (id, user_id, title, content) VALUES (10, 1, 'First Post', 'Hello World');
		INSERT INTO posts (id, user_id, title, content) VALUES (20, 2, 'Second Post', 'Testing dump engine');
	`)
	if err != nil {
		t.Fatalf("failed to setup sqlite tables: %v", err)
	}
	return entry.Driver
}

func TestGenerateDumpSQL(t *testing.T) {
	dbFile := "/tmp/dblens_dump_gen_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	drv := setupTestSQLiteDB(t, dbFile)
	defer drv.Close()

	var buf bytes.Buffer
	opts := DumpOptions{
		IncludeSchema: true,
		IncludeData:   true,
		UseGzip:       false,
	}

	err := GenerateDump(context.Background(), drv, &buf, opts)
	if err != nil {
		t.Fatalf("GenerateDump failed: %v", err)
	}

	sqlDump := buf.String()
	if !strings.Contains(sqlDump, "PRAGMA foreign_keys = OFF;") {
		t.Errorf("expected PRAGMA foreign_keys = OFF; in dump")
	}
	if !strings.Contains(sqlDump, "CREATE TABLE") {
		t.Errorf("expected CREATE TABLE in dump")
	}
	if !strings.Contains(sqlDump, "INSERT INTO") {
		t.Errorf("expected INSERT INTO in dump")
	}
	if !strings.Contains(sqlDump, "alice") || !strings.Contains(sqlDump, "bob") {
		t.Errorf("expected user row data in dump")
	}
	if !strings.Contains(sqlDump, "PRAGMA foreign_keys = ON;") {
		t.Errorf("expected PRAGMA foreign_keys = ON; at end of dump")
	}

	// Verify topological order in output: users DDL should appear before posts DDL
	usersIdx := strings.Index(sqlDump, "Table structure for table \"users\"")
	postsIdx := strings.Index(sqlDump, "Table structure for table \"posts\"")
	if usersIdx == -1 || postsIdx == -1 || usersIdx >= postsIdx {
		t.Errorf("expected users table to appear before posts table in dump: usersIdx=%d, postsIdx=%d", usersIdx, postsIdx)
	}
}

func TestGenerateDumpGzipAndRestore(t *testing.T) {
	srcFile := "/tmp/dblens_dump_src_test.db"
	dstFile := "/tmp/dblens_dump_dst_test.db"
	_ = os.Remove(srcFile)
	_ = os.Remove(dstFile)
	defer os.Remove(srcFile)
	defer os.Remove(dstFile)

	srcDrv := setupTestSQLiteDB(t, srcFile)
	defer srcDrv.Close()

	// 1. Export with gzip
	var gzBuf bytes.Buffer
	opts := DumpOptions{
		IncludeSchema: true,
		IncludeData:   true,
		UseGzip:       true,
	}
	err := GenerateDump(context.Background(), srcDrv, &gzBuf, opts)
	if err != nil {
		t.Fatalf("GenerateDump with gzip failed: %v", err)
	}

	// Verify gzip magic bytes 0x1f 0x8b
	rawBytes := gzBuf.Bytes()
	if len(rawBytes) < 2 || rawBytes[0] != 0x1f || rawBytes[1] != 0x8b {
		t.Fatalf("expected gzip magic bytes 0x1f 0x8b, got: %x %x", rawBytes[0], rawBytes[1])
	}

	// 2. Setup empty destination DB
	mgr := connection.NewManager()
	dstEntry, err := mgr.GetByDSN("sqlite://" + dstFile)
	if err != nil {
		t.Fatalf("failed to connect dst sqlite: %v", err)
	}
	defer dstEntry.Driver.Close()

	// 3. Restore compressed dump
	res, err := RestoreDump(context.Background(), dstEntry.Driver, bytes.NewReader(rawBytes))
	if err != nil {
		t.Fatalf("RestoreDump failed: %v", err)
	}

	if len(res.Errors) > 0 {
		t.Fatalf("RestoreDump returned unexpected errors: %v", res.Errors)
	}
	if res.Executed == 0 {
		t.Fatalf("expected executed statements > 0, got 0")
	}

	// 4. Verify data in restored DB
	queryRes, err := dstEntry.Driver.ExecuteQuery(context.Background(), "SELECT username FROM users ORDER BY id;")
	if err != nil {
		t.Fatalf("failed to query restored users: %v", err)
	}
	if len(queryRes.Rows) != 2 {
		t.Fatalf("expected 2 users restored, got %d", len(queryRes.Rows))
	}
	if queryRes.Rows[0][0] != "alice" || queryRes.Rows[1][0] != "bob" {
		t.Errorf("unexpected restored user values: %v", queryRes.Rows)
	}
}

func TestRestoreDumpErrorCapturing(t *testing.T) {
	dbFile := "/tmp/dblens_dump_err_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN("sqlite://" + dbFile)
	if err != nil {
		t.Fatalf("failed to connect sqlite: %v", err)
	}
	defer entry.Driver.Close()

	sqlText := `
		CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);
		INVALID SQL SYNTAX HERE;
		INSERT INTO items (id, name) VALUES (1, 'Valid item');
	`

	res, err := RestoreDump(context.Background(), entry.Driver, strings.NewReader(sqlText))
	if err != nil {
		t.Fatalf("RestoreDump failed: %v", err)
	}

	if res.Total != 3 {
		t.Errorf("expected 3 total statements, got %d", res.Total)
	}
	if res.Executed != 2 {
		t.Errorf("expected 2 executed statements, got %d", res.Executed)
	}
	if len(res.Errors) != 1 {
		t.Errorf("expected 1 error captured, got %d: %v", len(res.Errors), res.Errors)
	}
}
