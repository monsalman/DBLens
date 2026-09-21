package federation_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/driver/sqlite"
	"github.com/dblens/dblens/internal/driver/types"
	"github.com/dblens/dblens/internal/federation"
)

func TestParseQueryReferences(t *testing.T) {
	query := `SELECT u.name, o.amount FROM [pg_1].users u JOIN [mysql_2].sales.orders o ON u.id = o.user_id WHERE u.active = 1`
	refs, rewritten, err := federation.ParseQueryReferences(query)
	if err != nil {
		t.Fatalf("unexpected error parsing references: %v", err)
	}

	if len(refs) != 2 {
		t.Fatalf("expected 2 table references, got %d", len(refs))
	}

	ref1 := refs[0]
	if ref1.ConnID != "pg_1" || ref1.Table != "users" || ref1.Schema != "" {
		t.Errorf("ref1 mismatch: %+v", ref1)
	}
	if ref1.TempTable != "fed_pg_1_users" {
		t.Errorf("ref1 tempTable mismatch: %s", ref1.TempTable)
	}

	ref2 := refs[1]
	if ref2.ConnID != "mysql_2" || ref2.Schema != "sales" || ref2.Table != "orders" {
		t.Errorf("ref2 mismatch: %+v", ref2)
	}
	if ref2.TempTable != "fed_mysql_2_sales_orders" {
		t.Errorf("ref2 tempTable mismatch: %s", ref2.TempTable)
	}

	expectedRewritten := `SELECT u.name, o.amount FROM fed_pg_1_users u JOIN fed_mysql_2_sales_orders o ON u.id = o.user_id WHERE u.active = 1`
	if rewritten != expectedRewritten {
		t.Errorf("rewritten sql mismatch:\nexpected: %s\ngot:      %s", expectedRewritten, rewritten)
	}
}

func TestParseQueryReferencesDeduplication(t *testing.T) {
	query := `SELECT * FROM [connA].users u1 JOIN [connA].users u2 ON u1.manager_id = u2.id`
	refs, rewritten, err := federation.ParseQueryReferences(query)
	if err != nil {
		t.Fatalf("failed parsing query: %v", err)
	}

	if len(refs) != 1 {
		t.Fatalf("expected 1 unique ref, got %d", len(refs))
	}

	expected := `SELECT * FROM fed_connA_users u1 JOIN fed_connA_users u2 ON u1.manager_id = u2.id`
	if rewritten != expected {
		t.Errorf("mismatched rewritten sql:\nexpected: %s\ngot:      %s", expected, rewritten)
	}
}

func TestExecuteFederatedQuery(t *testing.T) {
	ctx := context.Background()

	// 1. Create DB 1 (Users)
	dbFile1 := fmt.Sprintf("/tmp/dblens_fed_test1_%d.db", time.Now().UnixNano())
	_ = os.Remove(dbFile1)
	defer os.Remove(dbFile1)

	drv1, err := sqlite.New("sqlite://" + dbFile1)
	if err != nil {
		t.Fatalf("failed to create db1: %v", err)
	}
	defer drv1.Close()

	_, err = drv1.ExecuteQuery(ctx, `
		CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
		INSERT INTO users VALUES (1, 'Alice', 'alice@example.com');
		INSERT INTO users VALUES (2, 'Bob', 'bob@example.com');
		INSERT INTO users VALUES (3, 'Charlie', 'charlie@example.com');
	`)
	if err != nil {
		t.Fatalf("setup db1 failed: %v", err)
	}

	// 2. Create DB 2 (Orders)
	dbFile2 := fmt.Sprintf("/tmp/dblens_fed_test2_%d.db", time.Now().UnixNano())
	_ = os.Remove(dbFile2)
	defer os.Remove(dbFile2)

	drv2, err := sqlite.New("sqlite://" + dbFile2)
	if err != nil {
		t.Fatalf("failed to create db2: %v", err)
	}
	defer drv2.Close()

	_, err = drv2.ExecuteQuery(ctx, `
		CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL);
		INSERT INTO orders VALUES (101, 1, 99.50);
		INSERT INTO orders VALUES (102, 1, 150.00);
		INSERT INTO orders VALUES (103, 2, 45.00);
	`)
	if err != nil {
		t.Fatalf("setup db2 failed: %v", err)
	}

	resolver := func(ctx context.Context, connID string) (types.Driver, error) {
		switch connID {
		case "db_users":
			return drv1, nil
		case "db_orders":
			return drv2, nil
		default:
			return nil, fmt.Errorf("unknown conn: %s", connID)
		}
	}

	fedQuery := `
		SELECT u.name, SUM(o.amount) as total_spent, COUNT(o.id) as order_count
		FROM [db_users].users u
		JOIN [db_orders].orders o ON u.id = o.user_id
		GROUP BY u.name
		ORDER BY total_spent DESC;
	`

	res, err := federation.ExecuteFederatedQuery(ctx, fedQuery, resolver, federation.QueryConfig{
		MaxRowsPerTable: 5000,
	})
	if err != nil {
		t.Fatalf("ExecuteFederatedQuery failed: %v", err)
	}

	if len(res.TableStats) != 2 {
		t.Fatalf("expected 2 table stats, got %d", len(res.TableStats))
	}

	if len(res.Result.Rows) != 2 {
		t.Fatalf("expected 2 aggregated rows, got %d", len(res.Result.Rows))
	}

	// First row: Alice with 249.50
	row0 := res.Result.Rows[0]
	if fmt.Sprintf("%v", row0[0]) != "Alice" {
		t.Errorf("expected first row to be Alice, got %v", row0[0])
	}
	totalSpent := fmt.Sprintf("%v", row0[1])
	if totalSpent != "249.5" && totalSpent != "249.50" {
		t.Errorf("expected 249.5, got %v", totalSpent)
	}

	// Second row: Bob with 45
	row1 := res.Result.Rows[1]
	if fmt.Sprintf("%v", row1[0]) != "Bob" {
		t.Errorf("expected second row to be Bob, got %v", row1[0])
	}
}

func TestDataPipeMigration(t *testing.T) {
	ctx := context.Background()

	srcFile := fmt.Sprintf("/tmp/dblens_pipe_src_%d.db", time.Now().UnixNano())
	tgtFile := fmt.Sprintf("/tmp/dblens_pipe_tgt_%d.db", time.Now().UnixNano())
	defer os.Remove(srcFile)
	defer os.Remove(tgtFile)

	srcDrv, err := sqlite.New("sqlite://" + srcFile)
	if err != nil {
		t.Fatalf("failed creating src driver: %v", err)
	}
	defer srcDrv.Close()

	tgtDrv, err := sqlite.New("sqlite://" + tgtFile)
	if err != nil {
		t.Fatalf("failed creating tgt driver: %v", err)
	}
	defer tgtDrv.Close()

	// Seed source
	_, err = srcDrv.ExecuteQuery(ctx, `
		CREATE TABLE products (
			id INTEGER PRIMARY KEY,
			title TEXT NOT NULL,
			price REAL,
			in_stock INTEGER
		);
		INSERT INTO products VALUES (1, 'Widget A', 19.99, 1);
		INSERT INTO products VALUES (2, 'Widget B', 29.99, 0);
		INSERT INTO products VALUES (3, 'Widget C', 39.99, 1);
	`)
	if err != nil {
		t.Fatalf("seed src failed: %v", err)
	}

	// Run data pipe with CreateTable
	pipeReq := federation.PipeRequest{
		SourceConnID:  "src",
		TargetConnID:  "tgt",
		SourceTable:   "products",
		TargetTable:   "products_backup",
		CreateTable:   true,
		TruncateTable: false,
		BatchSize:     2, // test chunking
	}

	pipeRes, err := federation.ExecutePipe(ctx, pipeReq, srcDrv, tgtDrv)
	if err != nil {
		t.Fatalf("ExecutePipe failed: %v", err)
	}

	if pipeRes.RowsMigrated != 3 {
		t.Fatalf("expected 3 rows migrated, got %d", pipeRes.RowsMigrated)
	}

	// Verify target table
	tgtCheck, err := tgtDrv.ExecuteQuery(ctx, "SELECT COUNT(*) FROM products_backup;")
	if err != nil {
		t.Fatalf("target table query failed: %v", err)
	}
	if fmt.Sprintf("%v", tgtCheck.Rows[0][0]) != "3" {
		t.Fatalf("target row count is not 3: %v", tgtCheck.Rows[0][0])
	}

	// Test Truncate and re-migrate
	pipeReq.TruncateTable = true
	pipeReq.CreateTable = false
	pipeRes2, err := federation.ExecutePipe(ctx, pipeReq, srcDrv, tgtDrv)
	if err != nil {
		t.Fatalf("re-run with truncate failed: %v", err)
	}
	if pipeRes2.RowsMigrated != 3 {
		t.Fatalf("expected 3 rows migrated on rerun, got %d", pipeRes2.RowsMigrated)
	}
}

func TestReconcile(t *testing.T) {
	ctx := context.Background()

	file1 := fmt.Sprintf("/tmp/dblens_rec1_%d.db", time.Now().UnixNano())
	file2 := fmt.Sprintf("/tmp/dblens_rec2_%d.db", time.Now().UnixNano())
	defer os.Remove(file1)
	defer os.Remove(file2)

	drv1, err := sqlite.New("sqlite://" + file1)
	if err != nil {
		t.Fatalf("drv1 failed: %v", err)
	}
	defer drv1.Close()

	drv2, err := sqlite.New("sqlite://" + file2)
	if err != nil {
		t.Fatalf("drv2 failed: %v", err)
	}
	defer drv2.Close()

	_, err = drv1.ExecuteQuery(ctx, `
		CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
		INSERT INTO customers VALUES (1, 'John');
		INSERT INTO customers VALUES (2, 'Jane');
	`)
	if err != nil {
		t.Fatalf("drv1 setup failed: %v", err)
	}

	_, err = drv2.ExecuteQuery(ctx, `
		CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
		INSERT INTO customers VALUES (1, 'John');
		INSERT INTO customers VALUES (2, 'Jane');
	`)
	if err != nil {
		t.Fatalf("drv2 setup failed: %v", err)
	}

	// 1. Identical test
	recRes, err := federation.ExecuteReconcile(ctx, federation.ReconcileRequest{
		SourceConnID: "c1",
		TargetConnID: "c2",
		SourceTable:  "customers",
		TargetTable:  "customers",
	}, drv1, drv2)
	if err != nil {
		t.Fatalf("ExecuteReconcile failed: %v", err)
	}

	if recRes.Status != "IDENTICAL" {
		t.Fatalf("expected IDENTICAL status, got %s", recRes.Status)
	}
	if recRes.SourceRowCount != 2 || recRes.TargetRowCount != 2 {
		t.Fatalf("row count mismatch: %d vs %d", recRes.SourceRowCount, recRes.TargetRowCount)
	}

	// 2. Row count mismatch test
	_, _ = drv2.ExecuteQuery(ctx, `INSERT INTO customers VALUES (3, 'Bob');`)
	recRes2, err := federation.ExecuteReconcile(ctx, federation.ReconcileRequest{
		SourceConnID: "c1",
		TargetConnID: "c2",
		SourceTable:  "customers",
		TargetTable:  "customers",
	}, drv1, drv2)
	if err != nil {
		t.Fatalf("ExecuteReconcile failed: %v", err)
	}
	if recRes2.Status != "ROW_COUNT_MISMATCH" {
		t.Fatalf("expected ROW_COUNT_MISMATCH, got %s", recRes2.Status)
	}
}

func TestMapColumnType(t *testing.T) {
	// Postgres to SQLite
	if res := federation.MapColumnType("postgres", "sqlite", "BIGINT"); res != "INTEGER" {
		t.Errorf("expected INTEGER, got %s", res)
	}
	if res := federation.MapColumnType("postgres", "sqlite", "NUMERIC(10,2)"); res != "REAL" {
		t.Errorf("expected REAL, got %s", res)
	}
	if res := federation.MapColumnType("postgres", "sqlite", "VARCHAR(255)"); res != "TEXT" {
		t.Errorf("expected TEXT, got %s", res)
	}

	// Postgres to MySQL
	if res := federation.MapColumnType("postgres", "mysql", "UUID"); res != "VARCHAR(36)" {
		t.Errorf("expected VARCHAR(36), got %s", res)
	}
	if res := federation.MapColumnType("postgres", "mysql", "JSONB"); res != "JSON" {
		t.Errorf("expected JSON, got %s", res)
	}

	// MySQL to Postgres
	if res := federation.MapColumnType("mysql", "postgres", "TINYINT(1)"); res != "BOOLEAN" {
		t.Errorf("expected BOOLEAN, got %s", res)
	}
	if res := federation.MapColumnType("mysql", "postgres", "DATETIME"); res != "TIMESTAMP" {
		t.Errorf("expected TIMESTAMP, got %s", res)
	}
}
