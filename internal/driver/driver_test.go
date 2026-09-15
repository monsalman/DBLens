package driver_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/driver"
	"github.com/dblens/dblens/internal/driver/mysql"
	"github.com/dblens/dblens/internal/driver/postgres"
	"github.com/dblens/dblens/internal/driver/sqlite"
	"github.com/dblens/dblens/internal/driver/types"
)

func TestDriverFilterGeneration(t *testing.T) {
	// 1. Test invalid filter column: "*" should be skipped
	starOpts := types.QueryOptions{
		Table: "users",
		Filters: []types.Filter{
			{Column: "*", Operator: "LIKE", Value: "alice"},
		},
		Limit:  50,
		Offset: 0,
	}

	pgSQL, pgArgs := postgres.BuildQuerySQL(starOpts)
	if strings.Contains(pgSQL, `WHERE`) {
		t.Fatalf("expected postgres query with '*' filter to omit WHERE clause, got: %s", pgSQL)
	}
	if len(pgArgs) != 2 { // limit, offset only
		t.Fatalf("expected 2 pg args, got %d", len(pgArgs))
	}

	mySQL, myArgs := mysql.BuildQuerySQL(starOpts)
	if strings.Contains(mySQL, `WHERE`) {
		t.Fatalf("expected mysql query with '*' filter to omit WHERE clause, got: %s", mySQL)
	}
	if len(myArgs) != 2 {
		t.Fatalf("expected 2 mysql args, got %d", len(myArgs))
	}

	sqSQL, sqArgs := sqlite.BuildQuerySQL(starOpts)
	if strings.Contains(sqSQL, `WHERE`) {
		t.Fatalf("expected sqlite query with '*' filter to omit WHERE clause, got: %s", sqSQL)
	}
	if len(sqArgs) != 2 {
		t.Fatalf("expected 2 sqlite args, got %d", len(sqArgs))
	}

	// 2. Test whitespace-only filter column should be skipped
	emptyOpts := types.QueryOptions{
		Table: "users",
		Filters: []types.Filter{
			{Column: "   ", Operator: "=", Value: "123"},
		},
	}
	sqEmptySQL, _ := sqlite.BuildQuerySQL(emptyOpts)
	if strings.Contains(sqEmptySQL, "WHERE") {
		t.Fatalf("expected sqlite query with blank column to omit WHERE, got: %s", sqEmptySQL)
	}

	// 3. Test valid column filter
	validOpts := types.QueryOptions{
		Table: "users",
		Filters: []types.Filter{
			{Column: "name", Operator: "LIKE", Value: "alice"},
		},
		Limit:  10,
		Offset: 0,
	}

	pgValidSQL, pgValidArgs := postgres.BuildQuerySQL(validOpts)
	if !strings.Contains(pgValidSQL, `WHERE "name" LIKE $1`) {
		t.Fatalf("expected valid postgres WHERE clause, got: %s", pgValidSQL)
	}
	if len(pgValidArgs) != 3 || pgValidArgs[0] != "%alice%" {
		t.Fatalf("expected like arg '%%alice%%', got: %v", pgValidArgs)
	}

	myValidSQL, myValidArgs := mysql.BuildQuerySQL(validOpts)
	if !strings.Contains(myValidSQL, "WHERE `name` LIKE ?") {
		t.Fatalf("expected valid mysql WHERE clause, got: %s", myValidSQL)
	}
	if len(myValidArgs) != 3 || myValidArgs[0] != "%alice%" {
		t.Fatalf("expected like arg '%%alice%%', got: %v", myValidArgs)
	}

	sqValidSQL, sqValidArgs := sqlite.BuildQuerySQL(validOpts)
	if !strings.Contains(sqValidSQL, "WHERE `name` LIKE ?") {
		t.Fatalf("expected valid sqlite WHERE clause, got: %s", sqValidSQL)
	}
	if len(sqValidArgs) != 3 || sqValidArgs[0] != "%alice%" {
		t.Fatalf("expected like arg '%%alice%%', got: %v", sqValidArgs)
	}

	// 4. Test mixed filters: invalid skipped, valid preserved
	mixedOpts := types.QueryOptions{
		Table: "users",
		Filters: []types.Filter{
			{Column: "*", Operator: "LIKE", Value: "bad"},
			{Column: "status", Operator: "=", Value: "active"},
			{Column: "  ", Operator: "=", Value: "empty"},
		},
	}
	pgMixedSQL, pgMixedArgs := postgres.BuildQuerySQL(mixedOpts)
	if !strings.Contains(pgMixedSQL, `WHERE "status" = $1`) {
		t.Fatalf("expected mixed filter to only have status condition, got: %s", pgMixedSQL)
	}
	if len(pgMixedArgs) != 3 || pgMixedArgs[0] != "active" {
		t.Fatalf("unexpected args for mixed: %v", pgMixedArgs)
	}
}

func TestSQLiteQueryTableDataExecutionWithFilters(t *testing.T) {
	dbFile := "/tmp/dblens_filter_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	drv, err := driver.NewDriver("sqlite://" + dbFile)
	if err != nil {
		t.Fatalf("failed to create sqlite driver: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()
	_, err = drv.ExecuteQuery(ctx, `
		CREATE TABLE products (
			id INTEGER PRIMARY KEY,
			title TEXT,
			category TEXT
		);
		INSERT INTO products (id, title, category) VALUES (1, 'Laptop', 'electronics');
		INSERT INTO products (id, title, category) VALUES (2, 'Phone', 'electronics');
		INSERT INTO products (id, title, category) VALUES (3, 'Shirt', 'clothing');
	`)
	if err != nil {
		t.Fatalf("failed to setup sqlite data: %v", err)
	}

	// Query with fatal '*' filter: should NOT error and should return all rows
	starRes, err := drv.QueryTableData(ctx, types.QueryOptions{
		Table: "products",
		Filters: []types.Filter{
			{Column: "*", Operator: "LIKE", Value: "Lap"},
		},
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("query with '*' filter returned error: %v", err)
	}
	if len(starRes.Rows) != 3 {
		t.Fatalf("expected 3 rows when '*' filter is skipped, got %d", len(starRes.Rows))
	}

	// Query with valid column filter: should return only matching rows
	filteredRes, err := drv.QueryTableData(ctx, types.QueryOptions{
		Table: "products",
		Filters: []types.Filter{
			{Column: "title", Operator: "LIKE", Value: "Lap"},
		},
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("query with valid filter returned error: %v", err)
	}
	if len(filteredRes.Rows) != 1 {
		t.Fatalf("expected 1 row for 'Lap', got %d", len(filteredRes.Rows))
	}
}

func TestNewDriver_MySQLFormats(t *testing.T) {
	testCases := []struct {
		name string
		dsn  string
	}{
		{
			name: "standard go mysql dsn",
			dsn:  "root:pass@tcp(localhost:3306)/test",
		},
		{
			name: "uri mysql dsn with tcp",
			dsn:  "mysql://root:pass@tcp(localhost:3306)/test",
		},
		{
			name: "uri mysql dsn standard host port",
			dsn:  "mysql://root:pass@localhost:3306/test",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			drv, err := driver.NewDriver(tc.dsn)
			if err != nil {
				t.Fatalf("expected NewDriver to succeed for %s, got error: %v", tc.dsn, err)
			}
			if drv == nil {
				t.Fatalf("expected non-nil driver for %s", tc.dsn)
			}
			defer drv.Close()

			if drv.Dialect() != "mysql" {
				t.Fatalf("expected dialect 'mysql', got '%s'", drv.Dialect())
			}
		})
	}
}

func TestNewDriver_OtherFormats(t *testing.T) {
	// Postgres
	pgDrv, err := driver.NewDriver("postgres://user:pass@localhost:5432/mydb?sslmode=disable")
	if err != nil {
		t.Fatalf("unexpected error for postgres DSN: %v", err)
	}
	if pgDrv.Dialect() != "postgres" {
		t.Fatalf("expected dialect 'postgres', got '%s'", pgDrv.Dialect())
	}
	_ = pgDrv.Close()

	// SQLite URI
	sqDrv1, err := driver.NewDriver("sqlite:///tmp/test.db")
	if err != nil {
		t.Fatalf("unexpected error for sqlite URI: %v", err)
	}
	if sqDrv1.Dialect() != "sqlite" {
		t.Fatalf("expected dialect 'sqlite', got '%s'", sqDrv1.Dialect())
	}
	_ = sqDrv1.Close()

	// SQLite file path
	sqDrv2, err := driver.NewDriver("/tmp/test.db")
	if err != nil {
		t.Fatalf("unexpected error for sqlite path: %v", err)
	}
	if sqDrv2.Dialect() != "sqlite" {
		t.Fatalf("expected dialect 'sqlite', got '%s'", sqDrv2.Dialect())
	}
	_ = sqDrv2.Close()

	// Invalid
	_, err = driver.NewDriver("unsupported://localhost:1234")
	if err == nil {
		t.Fatalf("expected error for unsupported DSN format, got nil")
	}
}

func TestIdentifierEscapingAndSanitization(t *testing.T) {
	opts := types.QueryOptions{
		Schema: `my"schema`,
		Table:  `users"; DROP TABLE evil; --`,
		Filters: []types.Filter{
			{Column: `user"name`, Operator: "=", Value: "admin"},
		},
		OrderBy:  `age"desc`,
		OrderDir: `DESC; DROP TABLE evil; --`,
		Limit:    10,
		Offset:   0,
	}

	// 1. PostgreSQL escaping: double quotes escaped with ""
	pgSQL, _ := postgres.BuildQuerySQL(opts)
	expectedPgTable := `"my""schema"."users""; DROP TABLE evil; --"`
	if !strings.Contains(pgSQL, expectedPgTable) {
		t.Fatalf("expected postgres table escaping %s, got: %s", expectedPgTable, pgSQL)
	}
	if !strings.Contains(pgSQL, `"user""name" = $1`) {
		t.Fatalf("expected postgres column escaping, got: %s", pgSQL)
	}
	if !strings.Contains(pgSQL, `ORDER BY "age""desc" ASC`) {
		t.Fatalf("expected postgres order by escaping and sanitized direction ASC, got: %s", pgSQL)
	}

	// Test valid DESC
	optsDesc := opts
	optsDesc.OrderDir = "desc"
	pgSQLDesc, _ := postgres.BuildQuerySQL(optsDesc)
	if !strings.Contains(pgSQLDesc, `ORDER BY "age""desc" DESC`) {
		t.Fatalf("expected postgres order by DESC, got: %s", pgSQLDesc)
	}

	// 2. MySQL escaping: backticks escaped with ``
	myOpts := types.QueryOptions{
		Schema: "my`schema",
		Table:  "users`; DROP TABLE evil; --",
		Filters: []types.Filter{
			{Column: "user`name", Operator: "=", Value: "admin"},
		},
		OrderBy:  "age`desc",
		OrderDir: `DESC; DROP TABLE evil; --`,
		Limit:    10,
		Offset:   0,
	}
	mySQL, _ := mysql.BuildQuerySQL(myOpts)
	expectedMyTable := "`my``schema`.`users``; DROP TABLE evil; --`"
	if !strings.Contains(mySQL, expectedMyTable) {
		t.Fatalf("expected mysql table escaping %s, got: %s", expectedMyTable, mySQL)
	}
	if !strings.Contains(mySQL, "`user``name` = ?") {
		t.Fatalf("expected mysql column escaping, got: %s", mySQL)
	}
	if !strings.Contains(mySQL, "ORDER BY `age``desc` ASC") {
		t.Fatalf("expected mysql order by escaping and sanitized direction ASC, got: %s", mySQL)
	}

	// 3. SQLite escaping: backticks escaped with ``
	sqSQL, _ := sqlite.BuildQuerySQL(myOpts)
	expectedSqTable := "`users``; DROP TABLE evil; --`"
	if !strings.Contains(sqSQL, expectedSqTable) {
		t.Fatalf("expected sqlite table escaping %s, got: %s", expectedSqTable, sqSQL)
	}
	if !strings.Contains(sqSQL, "`user``name` = ?") {
		t.Fatalf("expected sqlite column escaping, got: %s", sqSQL)
	}
	if !strings.Contains(sqSQL, "ORDER BY `age``desc` ASC") {
		t.Fatalf("expected sqlite order by escaping and sanitized direction ASC, got: %s", sqSQL)
	}
}

func TestUnsupportedDSNMasking(t *testing.T) {
	_, err := driver.NewDriver("oracle://scott:tiger123@localhost:1521/xe")
	if err == nil {
		t.Fatalf("expected error for unsupported oracle DSN, got nil")
	}
	if strings.Contains(err.Error(), "tiger123") {
		t.Fatalf("expected unsupported DSN error to mask credentials, leaked raw password in: %v", err)
	}
	if !strings.Contains(err.Error(), "oracle://scott:***@localhost:1521/xe") {
		t.Fatalf("expected masked DSN in error message, got: %v", err)
	}
}
