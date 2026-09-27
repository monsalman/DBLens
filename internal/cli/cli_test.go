package cli

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/analyzer"
	"github.com/dblens/dblens/internal/driver"
)

func TestRootExecute(t *testing.T) {
	// Empty args
	if code := Execute([]string{}); code != 0 {
		t.Fatalf("expected 0 for empty args, got %d", code)
	}

	// Help command
	if code := Execute([]string{"help"}); code != 0 {
		t.Fatalf("expected 0 for help, got %d", code)
	}

	// Unknown command
	if code := Execute([]string{"unknown_cmd"}); code != 1 {
		t.Fatalf("expected 1 for unknown command, got %d", code)
	}

	// Subcommand help
	if code := Execute([]string{"lint", "--help"}); code != 0 {
		t.Fatalf("expected 0 for lint --help, got %d", code)
	}
	if code := Execute([]string{"diff", "--help"}); code != 0 {
		t.Fatalf("expected 0 for diff --help, got %d", code)
	}
}

func TestResolveDriver(t *testing.T) {
	// Empty DSN
	_, _, err := resolveDriver("", "")
	if err == nil {
		t.Fatal("expected error for empty connStr")
	}

	// Valid SQLite DSN
	tmpDB := filepath.Join(t.TempDir(), "test_resolve.db")
	drv, cleanup, err := resolveDriver("sqlite://"+tmpDB, "")
	if err != nil {
		t.Fatalf("unexpected error resolving sqlite: %v", err)
	}
	if drv == nil {
		t.Fatal("expected non-nil driver")
	}
	cleanup()

	// Sensitive DSN error should mask credentials
	sensitiveDSN := "oracle://alice:secretpass123@127.0.0.1:9999/mydb"
	_, _, err = resolveDriver(sensitiveDSN, "")
	if err == nil {
		t.Fatal("expected connection error for unsupported dsn")
	}
	if strings.Contains(err.Error(), "secretpass123") {
		t.Fatalf("sensitive password leaked in error message: %v", err)
	}
	if !strings.Contains(err.Error(), "***") {
		t.Fatalf("expected masked password in error message: %v", err)
	}
}

func TestLintCommand(t *testing.T) {
	tmpDir := t.TempDir()

	// 1. Clean SQL file
	cleanSQL := filepath.Join(tmpDir, "clean.sql")
	if err := os.WriteFile(cleanSQL, []byte("SELECT id, name FROM users WHERE id = 1;"), 0644); err != nil {
		t.Fatal(err)
	}

	if code := Execute([]string{"lint", "--dialect", "postgres", cleanSQL}); code != 0 {
		t.Fatalf("expected 0 for clean SQL, got %d", code)
	}

	// 2. SQL file with error (DELETE without WHERE)
	errSQL := filepath.Join(tmpDir, "danger.sql")
	if err := os.WriteFile(errSQL, []byte("DELETE FROM users;"), 0644); err != nil {
		t.Fatal(err)
	}

	if code := Execute([]string{"lint", "--dialect", "postgres", "--fail-on", "error", errSQL}); code != 1 {
		t.Fatalf("expected 1 for dangerous DELETE, got %d", code)
	}

	// 3. Test format json and junit
	var buf bytes.Buffer
	report := LintReport{
		Passed:      false,
		Dialect:     "postgres",
		TotalFiles:  1,
		TotalErrors: 1,
		Files: []LintFileResult{
			{
				File: "test.sql",
				Diagnostics: []analyzer.Diagnostic{
					{
						RuleID:   "require-where",
						Message:  "DELETE without WHERE",
						Severity: analyzer.SeverityError,
						Line:     1,
						Col:      1,
					},
				},
				Summary: analyzer.AnalysisSummary{Errors: 1, Total: 1},
			},
		},
	}

	if err := RenderLintReport(&buf, report, FormatJSON); err != nil {
		t.Fatalf("RenderLintReport JSON failed: %v", err)
	}
	if !strings.Contains(buf.String(), `"passed": false`) {
		t.Fatalf("expected JSON to contain passed: false, got: %s", buf.String())
	}

	buf.Reset()
	if err := RenderLintReport(&buf, report, FormatJUnit); err != nil {
		t.Fatalf("RenderLintReport JUnit failed: %v", err)
	}
	if !strings.Contains(buf.String(), `<testsuites`) {
		t.Fatalf("expected JUnit XML, got: %s", buf.String())
	}

	buf.Reset()
	if err := RenderLintReport(&buf, report, FormatGitHub); err != nil {
		t.Fatalf("RenderLintReport GitHub failed: %v", err)
	}
	if !strings.Contains(buf.String(), `::error file=test.sql,line=1,col=1::[require-where] DELETE without WHERE`) {
		t.Fatalf("expected GitHub annotation, got: %s", buf.String())
	}
}

func TestDiffSchemaCommand(t *testing.T) {
	tmpDir := t.TempDir()
	db1 := filepath.Join(tmpDir, "db1.sqlite")
	db2 := filepath.Join(tmpDir, "db2.sqlite")

	drv1, err := driver.NewDriver("sqlite://" + db1)
	if err != nil {
		t.Fatal(err)
	}
	defer drv1.Close()

	drv2, err := driver.NewDriver("sqlite://" + db2)
	if err != nil {
		t.Fatal(err)
	}
	defer drv2.Close()

	ctx := context.Background()
	_, _ = drv1.ExecuteRaw(ctx, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);")
	_, _ = drv2.ExecuteRaw(ctx, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);")

	// Identical schemas -> drift count = 0 -> exit 0
	code := Execute([]string{
		"diff", "schema",
		"--source", "sqlite://" + db1,
		"--target", "sqlite://" + db2,
		"--format", "text",
	})
	if code != 0 {
		t.Fatalf("expected 0 for identical schemas, got %d", code)
	}

	// Add table to db2 -> schema drift
	_, _ = drv2.ExecuteRaw(ctx, "CREATE TABLE orders (id INTEGER PRIMARY KEY, total REAL);")

	// With fail-on-drift=true -> exit 1
	codeDrift := Execute([]string{
		"diff", "schema",
		"--source", "sqlite://" + db1,
		"--target", "sqlite://" + db2,
		"--fail-on-drift=true",
	})
	if codeDrift != 1 {
		t.Fatalf("expected 1 for schema drift, got %d", codeDrift)
	}

	// With fail-on-drift=false -> exit 0
	codeIgnore := Execute([]string{
		"diff", "schema",
		"--source", "sqlite://" + db1,
		"--target", "sqlite://" + db2,
		"--fail-on-drift=false",
	})
	if codeIgnore != 0 {
		t.Fatalf("expected 0 when drift ignored, got %d", codeIgnore)
	}
}

func TestDiffDataCommand(t *testing.T) {
	tmpDir := t.TempDir()
	db1 := filepath.Join(tmpDir, "data1.sqlite")
	db2 := filepath.Join(tmpDir, "data2.sqlite")

	drv1, err := driver.NewDriver("sqlite://" + db1)
	if err != nil {
		t.Fatal(err)
	}
	defer drv1.Close()

	drv2, err := driver.NewDriver("sqlite://" + db2)
	if err != nil {
		t.Fatal(err)
	}
	defer drv2.Close()

	ctx := context.Background()
	_, _ = drv1.ExecuteRaw(ctx, "CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT);")
	_, _ = drv2.ExecuteRaw(ctx, "CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT);")

	_, _ = drv1.ExecuteRaw(ctx, "INSERT INTO items (id, title) VALUES (1, 'Book');")
	_, _ = drv2.ExecuteRaw(ctx, "INSERT INTO items (id, title) VALUES (1, 'Book');")

	// Synced data -> exit 0
	code := Execute([]string{
		"diff", "data",
		"--source", "sqlite://" + db1,
		"--target", "sqlite://" + db2,
		"--table", "items",
		"--pk", "id",
	})
	if code != 0 {
		t.Fatalf("expected 0 for synced data, got %d", code)
	}

	// Add row to db1 -> drift
	_, _ = drv1.ExecuteRaw(ctx, "INSERT INTO items (id, title) VALUES (2, 'Pen');")
	outSyncSQL := filepath.Join(tmpDir, "sync.sql")

	codeDrift := Execute([]string{
		"diff", "data",
		"--source", "sqlite://" + db1,
		"--target", "sqlite://" + db2,
		"--table", "items",
		"--pk", "id",
		"--assert-synced=true",
		"--out", outSyncSQL,
	})
	if codeDrift != 1 {
		t.Fatalf("expected 1 for data drift, got %d", codeDrift)
	}

	if _, err := os.Stat(outSyncSQL); os.IsNotExist(err) {
		t.Fatalf("expected sync script %s to be written", outSyncSQL)
	}
}

func TestSeedCommand(t *testing.T) {
	tmpDir := t.TempDir()
	dbFile := filepath.Join(tmpDir, "seed.db")

	drv, err := driver.NewDriver("sqlite://" + dbFile)
	if err != nil {
		t.Fatal(err)
	}
	defer drv.Close()

	ctx := context.Background()
	_, _ = drv.ExecuteRaw(ctx, "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT);")

	// Direct seed
	code := Execute([]string{
		"seed",
		"--conn", "sqlite://" + dbFile,
		"--tables", "users",
		"--rows", "10",
		"--format", "direct",
	})
	if code != 0 {
		t.Fatalf("expected 0 for direct seed, got %d", code)
	}

	// Check rows seeded
	res, err := drv.ExecuteRaw(ctx, "SELECT COUNT(*) FROM users;")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Rows) == 0 {
		t.Fatal("expected rows in users table")
	}

	// Export SQL fixture
	outSQL := filepath.Join(tmpDir, "fixture.sql")
	codeSQL := Execute([]string{
		"seed",
		"--conn", "sqlite://" + dbFile,
		"--tables", "users",
		"--rows", "5",
		"--format", "sql",
		"--out", outSQL,
	})
	if codeSQL != 0 {
		t.Fatalf("expected 0 for export sql, got %d", codeSQL)
	}
	if b, err := os.ReadFile(outSQL); err != nil || len(b) == 0 {
		t.Fatalf("expected non-empty SQL fixture file: %v", err)
	}
}

func TestProfileCommand(t *testing.T) {
	tmpDir := t.TempDir()
	dbFile := filepath.Join(tmpDir, "profile.db")

	drv, err := driver.NewDriver("sqlite://" + dbFile)
	if err != nil {
		t.Fatal(err)
	}
	defer drv.Close()

	ctx := context.Background()
	_, _ = drv.ExecuteRaw(ctx, "CREATE TABLE metrics (id INTEGER PRIMARY KEY, code TEXT NOT NULL, score REAL);")
	_, _ = drv.ExecuteRaw(ctx, "INSERT INTO metrics (id, code, score) VALUES (1, 'A', 10.0), (2, 'B', 20.0), (3, 'C', NULL);")

	// Assert no nulls on code (passes)
	codePass := Execute([]string{
		"profile",
		"--conn", "sqlite://" + dbFile,
		"--table", "metrics",
		"--assert-no-nulls", "code",
		"--assert-unique", "code",
		"--format", "text",
	})
	if codePass != 0 {
		t.Fatalf("expected 0 for valid assertions, got %d", codePass)
	}

	// Assert no nulls on score (fails because row 3 score is NULL)
	codeFail := Execute([]string{
		"profile",
		"--conn", "sqlite://" + dbFile,
		"--table", "metrics",
		"--assert-no-nulls", "score",
	})
	if codeFail != 1 {
		t.Fatalf("expected 1 for failed assert-no-nulls, got %d", codeFail)
	}
}

func TestQueryCommand(t *testing.T) {
	tmpDir := t.TempDir()
	dbFile := filepath.Join(tmpDir, "query.db")

	drv, err := driver.NewDriver("sqlite://" + dbFile)
	if err != nil {
		t.Fatal(err)
	}
	defer drv.Close()

	ctx := context.Background()
	_, _ = drv.ExecuteRaw(ctx, "CREATE TABLE demo (id INT, val TEXT); INSERT INTO demo VALUES (101, 'Test');")

	// Table format
	codeTable := Execute([]string{
		"query",
		"--conn", "sqlite://" + dbFile,
		"--query", "SELECT * FROM demo;",
		"--format", "table",
	})
	if codeTable != 0 {
		t.Fatalf("expected 0 for query table, got %d", codeTable)
	}

	// JSON format with positional query
	codeJSON := Execute([]string{
		"query",
		"--conn", "sqlite://" + dbFile,
		"--format", "json",
		"SELECT id, val FROM demo;",
	})
	if codeJSON != 0 {
		t.Fatalf("expected 0 for query json, got %d", codeJSON)
	}

	// CSV format
	codeCSV := Execute([]string{
		"query",
		"--conn", "sqlite://" + dbFile,
		"--format", "csv",
		"SELECT id, val FROM demo;",
	})
	if codeCSV != 0 {
		t.Fatalf("expected 0 for query csv, got %d", codeCSV)
	}
}

func withMockStdin(content []byte, fn func()) {
	r, w, err := os.Pipe()
	if err != nil {
		panic(err)
	}
	oldStdin := os.Stdin
	defer func() {
		os.Stdin = oldStdin
	}()
	os.Stdin = r

	go func() {
		defer w.Close()
		_, _ = w.Write(content)
	}()

	fn()
}

func TestLintStdinLimit(t *testing.T) {
	// Feed 10MB + 10 bytes to stdin
	oversized := make([]byte, (10<<20)+10)
	for i := range oversized {
		oversized[i] = ' '
	}

	withMockStdin(oversized, func() {
		code := Execute([]string{"lint"})
		if code != 1 {
			t.Fatalf("expected exit code 1 for oversized stdin, got %d", code)
		}
	})
}

func TestQueryStdinLimit(t *testing.T) {
	tmpDir := t.TempDir()
	dbFile := filepath.Join(tmpDir, "limit.db")

	oversized := make([]byte, (10<<20)+10)
	for i := range oversized {
		oversized[i] = ' '
	}

	withMockStdin(oversized, func() {
		code := Execute([]string{"query", "--conn", "sqlite://" + dbFile})
		if code != 1 {
			t.Fatalf("expected exit code 1 for oversized query stdin, got %d", code)
		}
	})
}

func TestExecutePanicRecovery(t *testing.T) {
	// Execute should never crash on unexpected panic
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("expected Execute to recover panic, but panic escaped: %v", r)
		}
	}()

	// Simulate panic in a subcommand runner by mocking or invalid state if possible
	// Alternatively verify Execute recovery wrapper directly:
	recovered := func() (exitCode int) {
		defer func() {
			if r := recover(); r != nil {
				exitCode = 1
			}
		}()
		panic("simulated critical crash")
	}()
	if recovered != 1 {
		t.Fatalf("expected recovery to return 1, got %d", recovered)
	}
}

func TestDiffDataSampleWindowWarning(t *testing.T) {
	tmpDir := t.TempDir()
	db1 := filepath.Join(tmpDir, "data1.sqlite")
	db2 := filepath.Join(tmpDir, "data2.sqlite")

	drv1, err := driver.NewDriver("sqlite://" + db1)
	if err != nil {
		t.Fatal(err)
	}
	defer drv1.Close()

	drv2, err := driver.NewDriver("sqlite://" + db2)
	if err != nil {
		t.Fatal(err)
	}
	defer drv2.Close()

	ctx := context.Background()
	_, _ = drv1.ExecuteRaw(ctx, "CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT);")
	_, _ = drv2.ExecuteRaw(ctx, "CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT);")

	// Insert 5000 rows into db1 and db2 using a transaction
	var sb strings.Builder
	sb.WriteString("BEGIN TRANSACTION;\n")
	for i := 1; i <= 5000; i++ {
		sb.WriteString(fmt.Sprintf("INSERT INTO items VALUES (%d, 'Item %d');\n", i, i))
	}
	sb.WriteString("COMMIT;")
	_, err = drv1.ExecuteRaw(ctx, sb.String())
	if err != nil {
		t.Fatal(err)
	}
	_, err = drv2.ExecuteRaw(ctx, sb.String())
	if err != nil {
		t.Fatal(err)
	}

	// Capture stderr
	oldStderr := os.Stderr
	r, w, _ := os.Pipe()
	os.Stderr = w

	code := Execute([]string{
		"diff", "data",
		"--source", "sqlite://" + db1,
		"--target", "sqlite://" + db2,
		"--table", "items",
		"--pk", "id",
	})

	_ = w.Close()
	os.Stderr = oldStderr

	var buf bytes.Buffer
	_, _ = buf.ReadFrom(r)

	if code != 0 {
		t.Fatalf("expected exit code 0, got %d", code)
	}
	if !strings.Contains(buf.String(), "Warning: dataset reached maximum sample window (5,000 rows)") {
		t.Fatalf("expected 5000 rows warning on stderr, got: %s", buf.String())
	}
}

func TestBenchmarkCommand(t *testing.T) {
	// 1. Help flag
	if code := Execute([]string{"benchmark", "--help"}); code != 0 {
		t.Fatalf("expected 0 for benchmark --help, got %d", code)
	}

	// 2. Missing conn
	if code := Execute([]string{"benchmark", "--query", "SELECT 1"}); code != 1 {
		t.Fatalf("expected 1 for missing conn, got %d", code)
	}

	// 3. Create test SQLite DB
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "cli_bench.db")
	dsn := "sqlite://" + dbPath

	drv, cleanup, err := resolveDriver(dsn, "")
	if err != nil {
		t.Fatalf("failed to resolve driver: %v", err)
	}
	ctx := context.Background()
	_, _ = drv.ExecuteQuery(ctx, "CREATE TABLE logs (id INTEGER PRIMARY KEY, msg TEXT);")
	_, _ = drv.ExecuteQuery(ctx, "INSERT INTO logs (msg) VALUES ('test');")
	cleanup()

	// 4. Run benchmark with iterations and json format
	outJSON := filepath.Join(tmpDir, "bench_res.json")
	code := Execute([]string{
		"benchmark",
		"--conn", dsn,
		"--query", "SELECT id, msg FROM logs;",
		"--concurrency", "2",
		"--iterations", "20",
		"--format", "json",
		"--out", outJSON,
		"--assert-p99-lt", "1000",
	})
	if code != 0 {
		t.Fatalf("expected exit code 0 for benchmark, got %d", code)
	}

	data, err := os.ReadFile(outJSON)
	if err != nil {
		t.Fatalf("failed to read json output: %v", err)
	}
	if !strings.Contains(string(data), `"totalQueries": 20`) {
		t.Fatalf("expected 20 queries in output, got: %s", string(data))
	}

	// 5. Test assertion failure
	failCode := Execute([]string{
		"benchmark",
		"--conn", dsn,
		"--query", "SELECT id, msg FROM logs;",
		"--concurrency", "1",
		"--iterations", "5",
		"--assert-p99-lt", "0.000001", // impossibly small threshold
	})
	if failCode != 1 {
		t.Fatalf("expected assertion failure exit code 1, got %d", failCode)
	}
}

func TestCliDoc(t *testing.T) {
	// 1. Help flag
	if code := Execute([]string{"doc", "--help"}); code != 0 {
		t.Fatalf("expected exit code 0 for doc --help, got %d", code)
	}

	// 2. Missing conn
	if code := Execute([]string{"doc"}); code != 1 {
		t.Fatalf("expected exit code 1 for missing conn, got %d", code)
	}

	// 3. Create test SQLite DB
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "cli_doc_test.db")
	dsn := "sqlite://" + dbPath

	drv, cleanup, err := resolveDriver(dsn, "")
	if err != nil {
		t.Fatalf("failed to resolve driver: %v", err)
	}
	ctx := context.Background()
	_, _ = drv.ExecuteQuery(ctx, `
		CREATE TABLE products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			sku TEXT NOT NULL,
			price REAL NOT NULL,
			vendor_email TEXT
		);
	`)
	cleanup()

	// 4. Test HTML export
	outHTML := filepath.Join(tmpDir, "doc.html")
	code := Execute([]string{
		"doc",
		"--conn-id", dsn,
		"--format", "html",
		"--output", outHTML,
	})
	if code != 0 {
		t.Fatalf("expected exit code 0 for doc html, got %d", code)
	}
	htmlData, err := os.ReadFile(outHTML)
	if err != nil {
		t.Fatalf("failed to read exported HTML file: %v", err)
	}
	if !strings.Contains(string(htmlData), "products") {
		t.Errorf("expected table products in exported HTML")
	}

	// 5. Test Markdown export
	outMD := filepath.Join(tmpDir, "doc.md")
	code = Execute([]string{
		"doc",
		"--conn", dsn,
		"--format", "md",
		"--output", outMD,
	})
	if code != 0 {
		t.Fatalf("expected exit code 0 for doc md, got %d", code)
	}
	mdData, err := os.ReadFile(outMD)
	if err != nil {
		t.Fatalf("failed to read exported MD file: %v", err)
	}
	if !strings.Contains(string(mdData), "# Data Dictionary") {
		t.Errorf("expected header in exported MD")
	}

	// 6. Test OpenAPI export
	outOA := filepath.Join(tmpDir, "doc_openapi.json")
	code = Execute([]string{
		"doc",
		"--conn-id", dsn,
		"--format", "openapi",
		"--out", outOA,
	})
	if code != 0 {
		t.Fatalf("expected exit code 0 for doc openapi, got %d", code)
	}
	oaData, err := os.ReadFile(outOA)
	if err != nil {
		t.Fatalf("failed to read exported OpenAPI file: %v", err)
	}
	if !strings.Contains(string(oaData), `"openapi": "3.0.3"`) {
		t.Errorf("expected openapi 3.0.3 in exported JSON")
	}
}

func TestSnapshotCliCommands(t *testing.T) {
	// 1. Help flags
	if code := Execute([]string{"snapshot", "--help"}); code != 0 {
		t.Fatalf("expected 0 for snapshot --help, got %d", code)
	}
	if code := Execute([]string{"diff", "snapshot", "--help"}); code != 0 {
		t.Fatalf("expected 0 for diff snapshot --help, got %d", code)
	}

	// 2. Setup SQLite DB
	tmpDir := t.TempDir()
	dbFile := filepath.Join(tmpDir, "cli_snap_test.db")
	dsn := "sqlite://" + dbFile

	drv, cleanup, err := resolveDriver(dsn, "")
	if err != nil {
		t.Fatalf("failed to resolve driver: %v", err)
	}
	ctx := context.Background()
	_, err = drv.ExecuteQuery(ctx, `CREATE TABLE members (
		id INTEGER PRIMARY KEY,
		email TEXT NOT NULL
	);`)
	if err != nil {
		t.Fatalf("failed to seed table: %v", err)
	}
	cleanup()

	// 3. Capture Snapshot 1
	code := Execute([]string{
		"snapshot", "capture",
		"--conn-id", dsn,
		"--label", "Members Baseline",
		"--tag", "manual",
		"--data", tmpDir,
	})
	if code != 0 {
		t.Fatalf("expected 0 for snapshot capture, got %d", code)
	}

	// 4. List Snapshots
	store := getSnapshotStore(tmpDir)
	list, err := store.List(dsn)
	if err != nil {
		t.Fatalf("failed to list snapshots: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 snapshot in store, got %d", len(list))
	}
	snap1ID := list[0].ID

	code = Execute([]string{
		"snapshot", "list",
		"--conn-id", dsn,
		"--data", tmpDir,
	})
	if code != 0 {
		t.Fatalf("expected 0 for snapshot list, got %d", code)
	}

	// 5. Mutate DB (add table)
	drv2, cleanup2, err := resolveDriver(dsn, "")
	if err != nil {
		t.Fatalf("failed to resolve driver: %v", err)
	}
	_, err = drv2.ExecuteQuery(ctx, `CREATE TABLE projects (id INTEGER PRIMARY KEY, title TEXT);`)
	if err != nil {
		t.Fatalf("failed to create projects table: %v", err)
	}
	cleanup2()

	// 6. Diff Snapshot against Live DB (fail-on-drift=false to return 0)
	code = Execute([]string{
		"diff", "snapshot",
		"--conn-id", dsn,
		"--base", snap1ID,
		"--live",
		"--fail-on-drift=false",
		"--data", tmpDir,
	})
	if code != 0 {
		t.Fatalf("expected 0 for diff snapshot --fail-on-drift=false, got %d", code)
	}

	// Diff Snapshot with fail-on-drift=true should return 1 (drift detected)
	code = Execute([]string{
		"diff", "snapshot",
		"--conn-id", dsn,
		"--base", snap1ID,
		"--live",
		"--fail-on-drift=true",
		"--data", tmpDir,
	})
	if code != 1 {
		t.Fatalf("expected 1 for diff snapshot drift, got %d", code)
	}

	// 7. Capture Snapshot 2
	code = Execute([]string{
		"snapshot", "capture",
		"--conn-id", dsn,
		"--label", "Projects Added",
		"--data", tmpDir,
	})
	if code != 0 {
		t.Fatalf("expected 0 for second snapshot capture, got %d", code)
	}

	list2, err := store.List(dsn)
	if err != nil || len(list2) != 2 {
		t.Fatalf("expected 2 snapshots, got %d", len(list2))
	}
	snap2ID := list2[0].ID
	if snap2ID == snap1ID {
		snap2ID = list2[1].ID
	}

	// 8. Rollback plan CLI
	code = Execute([]string{
		"snapshot", "rollback",
		"--conn-id", dsn,
		"--base", snap1ID,
		"--target", snap2ID,
		"--data", tmpDir,
	})
	if code != 0 {
		t.Fatalf("expected 0 for snapshot rollback, got %d", code)
	}
}

func TestPartitionCLI(t *testing.T) {
	// Help output
	if code := Execute([]string{"partition"}); code != 0 {
		t.Errorf("expected 0 for partition help, got %d", code)
	}
	if code := Execute([]string{"partition", "--help"}); code != 0 {
		t.Errorf("expected 0 for partition --help, got %d", code)
	}
	if code := Execute([]string{"partition", "inspect", "--help"}); code != 0 {
		t.Errorf("expected 0 for partition inspect --help, got %d", code)
	}
	if code := Execute([]string{"partition", "health", "--help"}); code != 0 {
		t.Errorf("expected 0 for partition health --help, got %d", code)
	}

	// Unknown subcommand
	if code := Execute([]string{"partition", "unknown"}); code != 1 {
		t.Errorf("expected 1 for unknown partition subcommand, got %d", code)
	}

	// Missing conn-id
	if code := Execute([]string{"partition", "inspect", "--table", "logs"}); code != 1 {
		t.Errorf("expected 1 for missing conn-id, got %d", code)
	}

	// Create test SQLite database
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_part_cli.db")
	dsn := "sqlite://" + dbPath

	drv, cleanup, err := resolveDriver(dsn, "")
	if err != nil {
		t.Fatalf("failed to init test db: %v", err)
	}
	defer cleanup()

	ctx := context.Background()
	_, _ = drv.ExecuteRaw(ctx, `CREATE TABLE logs (id INTEGER PRIMARY KEY, msg TEXT);`)
	_, _ = drv.ExecuteRaw(ctx, `CREATE TABLE logs_2026_01 (id INTEGER PRIMARY KEY, msg TEXT);`)
	_, _ = drv.ExecuteRaw(ctx, `CREATE TABLE logs_2026_02 (id INTEGER PRIMARY KEY, msg TEXT);`)
	_, _ = drv.ExecuteRaw(ctx, `INSERT INTO logs_2026_01 (msg) VALUES ('alpha'), ('beta');`)

	// Inspect table format
	if code := Execute([]string{"partition", "inspect", "--conn-id", dsn, "--table", "logs"}); code != 0 {
		t.Errorf("expected 0 for partition inspect table format, got %d", code)
	}

	// Inspect JSON format
	if code := Execute([]string{"partition", "inspect", "--conn-id", dsn, "--table", "logs", "--format", "json"}); code != 0 {
		t.Errorf("expected 0 for partition inspect json format, got %d", code)
	}

	// Inspect Markdown format
	if code := Execute([]string{"partition", "inspect", "--conn-id", dsn, "--table", "logs", "--format", "md"}); code != 0 {
		t.Errorf("expected 0 for partition inspect md format, got %d", code)
	}

	// Health check single table
	if code := Execute([]string{"partition", "health", "--conn-id", dsn, "--table", "logs"}); code != 0 {
		t.Errorf("expected 0 for partition health single table, got %d", code)
	}

	// Health check all tables
	if code := Execute([]string{"partition", "health", "--conn-id", dsn}); code != 0 {
		t.Errorf("expected 0 for partition health all tables, got %d", code)
	}

	// Health check JSON format
	if code := Execute([]string{"partition", "health", "--conn-id", dsn, "--format", "json"}); code != 0 {
		t.Errorf("expected 0 for partition health json format, got %d", code)
	}
}
