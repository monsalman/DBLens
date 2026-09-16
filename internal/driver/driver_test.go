package driver_test

import (
	"context"
	"fmt"
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

func TestDriverMutateRow(t *testing.T) {
	dbFile := "/tmp/dblens_mutate_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	drv, err := driver.NewDriver("sqlite://" + dbFile)
	if err != nil {
		t.Fatalf("failed to create sqlite driver: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()

	// Setup table with composite primary key
	_, err = drv.ExecuteQuery(ctx, `
		CREATE TABLE order_items (
			tenant_id INTEGER,
			order_id INTEGER,
			item_id INTEGER,
			quantity INTEGER,
			note TEXT,
			PRIMARY KEY (tenant_id, order_id, item_id)
		);
	`)
	if err != nil {
		t.Fatalf("failed to create table: %v", err)
	}

	// 1. INSERT tests
	res, err := drv.MutateRow(ctx, types.Mutation{
		Table: "order_items",
		Type:  types.MutationInsert,
		Data: map[string]interface{}{
			"tenant_id": 1,
			"order_id":  100,
			"item_id":   1,
			"quantity":  2,
			"note":      "first item",
		},
	})
	if err != nil {
		t.Fatalf("failed to insert row 1: %v", err)
	}
	if res.AffectedRows != 1 {
		t.Fatalf("expected 1 affected row, got %d", res.AffectedRows)
	}

	// Insert second row
	res, err = drv.MutateRow(ctx, types.Mutation{
		Table: "order_items",
		Type:  types.MutationInsert,
		Data: map[string]interface{}{
			"tenant_id": 1,
			"order_id":  100,
			"item_id":   2,
			"quantity":  5,
			"note":      "second item",
		},
	})
	if err != nil {
		t.Fatalf("failed to insert row 2: %v", err)
	}

	// Insert row for tenant 2
	res, err = drv.MutateRow(ctx, types.Mutation{
		Table: "order_items",
		Type:  types.MutationInsert,
		Data: map[string]interface{}{
			"tenant_id": 2,
			"order_id":  100,
			"item_id":   1,
			"quantity":  10,
			"note":      "tenant 2 item",
		},
	})
	if err != nil {
		t.Fatalf("failed to insert row 3: %v", err)
	}

	// Verify count is 3
	queryRes, err := drv.QueryTableData(ctx, types.QueryOptions{Table: "order_items"})
	if err != nil {
		t.Fatalf("failed to query table data: %v", err)
	}
	if len(queryRes.Rows) != 3 {
		t.Fatalf("expected 3 rows after insert, got %d", len(queryRes.Rows))
	}

	// 2. UPDATE with composite primary key
	res, err = drv.MutateRow(ctx, types.Mutation{
		Table: "order_items",
		Type:  types.MutationUpdate,
		Data: map[string]interface{}{
			"quantity": 20,
			"note":     "updated first item",
		},
		Where: map[string]interface{}{
			"tenant_id": 1,
			"order_id":  100,
			"item_id":   1,
		},
	})
	if err != nil {
		t.Fatalf("failed to update row with composite PK: %v", err)
	}
	if res.AffectedRows != 1 {
		t.Fatalf("expected 1 affected row on composite update, got %d", res.AffectedRows)
	}

	// Verify only row (1, 100, 1) was updated
	queryUpdated, err := drv.QueryTableData(ctx, types.QueryOptions{
		Table: "order_items",
		Filters: []types.Filter{
			{Column: "tenant_id", Operator: "=", Value: "1"},
			{Column: "item_id", Operator: "=", Value: "1"},
		},
	})
	if err != nil {
		t.Fatalf("failed to query updated row: %v", err)
	}
	if len(queryUpdated.Rows) != 1 {
		t.Fatalf("expected 1 matching row, got %d", len(queryUpdated.Rows))
	}
	colMap := make(map[string]int)
	for i, c := range queryUpdated.Columns {
		colMap[c] = i
	}
	row := queryUpdated.Rows[0]
	qty := fmt.Sprintf("%v", row[colMap["quantity"]])
	note := fmt.Sprintf("%v", row[colMap["note"]])
	if qty != "20" || note != "updated first item" {
		t.Fatalf("unexpected row data after update: qty=%s, note=%s", qty, note)
	}

	// Verify tenant 2 row was untouched
	queryTenant2, err := drv.QueryTableData(ctx, types.QueryOptions{
		Table: "order_items",
		Filters: []types.Filter{
			{Column: "tenant_id", Operator: "=", Value: "2"},
		},
	})
	if err != nil {
		t.Fatalf("failed to query tenant 2: %v", err)
	}
	colMap2 := make(map[string]int)
	for i, c := range queryTenant2.Columns {
		colMap2[c] = i
	}
	qty2 := fmt.Sprintf("%v", queryTenant2.Rows[0][colMap2["quantity"]])
	if len(queryTenant2.Rows) != 1 || qty2 != "10" {
		t.Fatalf("tenant 2 row was affected unexpectedly: %v", queryTenant2.Rows)
	}

	// 3. DELETE with composite primary key
	res, err = drv.MutateRow(ctx, types.Mutation{
		Table: "order_items",
		Type:  types.MutationDelete,
		Where: map[string]interface{}{
			"tenant_id": 1,
			"order_id":  100,
			"item_id":   1,
		},
	})
	if err != nil {
		t.Fatalf("failed to delete row with composite PK: %v", err)
	}
	if res.AffectedRows != 1 {
		t.Fatalf("expected 1 affected row on composite delete, got %d", res.AffectedRows)
	}

	// Verify 2 rows remain
	queryRemaining, err := drv.QueryTableData(ctx, types.QueryOptions{Table: "order_items"})
	if err != nil {
		t.Fatalf("failed to query remaining rows: %v", err)
	}
	if len(queryRemaining.Rows) != 2 {
		t.Fatalf("expected 2 rows after delete, got %d", len(queryRemaining.Rows))
	}

	// 4. Error validations
	// Empty data on INSERT
	_, err = drv.MutateRow(ctx, types.Mutation{
		Table: "order_items",
		Type:  types.MutationInsert,
		Data:  map[string]interface{}{},
	})
	if err == nil {
		t.Fatalf("expected error on empty data insert, got nil")
	}

	// Empty WHERE on UPDATE
	_, err = drv.MutateRow(ctx, types.Mutation{
		Table: "order_items",
		Type:  types.MutationUpdate,
		Data:  map[string]interface{}{"quantity": 99},
		Where: map[string]interface{}{},
	})
	if err == nil {
		t.Fatalf("expected error on empty where update, got nil")
	}

	// Empty WHERE on DELETE
	_, err = drv.MutateRow(ctx, types.Mutation{
		Table: "order_items",
		Type:  types.MutationDelete,
		Where: map[string]interface{}{},
	})
	if err == nil {
		t.Fatalf("expected error on empty where delete, got nil")
	}

	// Unsupported mutation type
	_, err = drv.MutateRow(ctx, types.Mutation{
		Table: "order_items",
		Type:  "UPSERT",
	})
	if err == nil {
		t.Fatalf("expected error on unsupported mutation type, got nil")
	}
}

func TestDriverBatchInsert(t *testing.T) {
	ctx := context.Background()

	// 1. PostgreSQL BuildBatchInsertSQL test
	pgRows := []map[string]interface{}{
		{"name": "Alice", "email": "alice@example.com"},
		{"name": "Bob", "email": "bob@example.com"},
	}
	pgSQL, pgArgs, err := postgres.BuildBatchInsertSQL("public", "users", pgRows)
	if err != nil {
		t.Fatalf("pg BuildBatchInsertSQL failed: %v", err)
	}
	expectedPgSQL := `INSERT INTO "public"."users" ("email", "name") VALUES ($1, $2), ($3, $4)`
	if pgSQL != expectedPgSQL {
		t.Fatalf("expected pg SQL %q, got %q", expectedPgSQL, pgSQL)
	}
	if len(pgArgs) != 4 || pgArgs[0] != "alice@example.com" || pgArgs[1] != "Alice" || pgArgs[2] != "bob@example.com" || pgArgs[3] != "Bob" {
		t.Fatalf("unexpected pg args: %v", pgArgs)
	}

	// 2. MySQL BuildBatchInsertSQL test
	myRows := []map[string]interface{}{
		{"name": "Alice", "email": "alice@example.com"},
		{"name": "Bob", "email": "bob@example.com"},
	}
	mySQL, myArgs, err := mysql.BuildBatchInsertSQL("mydb", "users", myRows)
	if err != nil {
		t.Fatalf("mysql BuildBatchInsertSQL failed: %v", err)
	}
	expectedMySQL := "INSERT INTO `mydb`.`users` (`email`, `name`) VALUES (?, ?), (?, ?)"
	if mySQL != expectedMySQL {
		t.Fatalf("expected mysql SQL %q, got %q", expectedMySQL, mySQL)
	}
	if len(myArgs) != 4 || myArgs[0] != "alice@example.com" || myArgs[1] != "Alice" || myArgs[2] != "bob@example.com" || myArgs[3] != "Bob" {
		t.Fatalf("unexpected mysql args: %v", myArgs)
	}

	// 3. SQLite execution tests
	dbFile := "/tmp/dblens_batch_insert_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	drv, err := driver.NewDriver("sqlite://" + dbFile)
	if err != nil {
		t.Fatalf("failed to create sqlite driver: %v", err)
	}
	defer drv.Close()

	_, err = drv.ExecuteQuery(ctx, `
		CREATE TABLE members (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE,
			name TEXT,
			role TEXT
		);
	`)
	if err != nil {
		t.Fatalf("failed to create table: %v", err)
	}

	// A. Normal batch insert
	insertRows := []map[string]interface{}{
		{"email": "mem1@example.com", "name": "Member 1", "role": "admin"},
		{"email": "mem2@example.com", "name": "Member 2", "role": "user"},
		{"email": "mem3@example.com", "name": "Member 3", "role": "user"},
	}
	res, err := drv.BatchInsert(ctx, "", "members", insertRows)
	if err != nil {
		t.Fatalf("failed to batch insert rows: %v", err)
	}
	if res.AffectedRows != 3 {
		t.Fatalf("expected 3 affected rows, got %d", res.AffectedRows)
	}

	// Verify data
	qRes, err := drv.QueryTableData(ctx, types.QueryOptions{Table: "members"})
	if err != nil {
		t.Fatalf("failed to query members: %v", err)
	}
	if len(qRes.Rows) != 3 {
		t.Fatalf("expected 3 rows in database, got %d", len(qRes.Rows))
	}

	// B. Chunking test: > 500 parameters (e.g. 60 rows * 10 columns = 600 parameters)
	_, err = drv.ExecuteQuery(ctx, `
		CREATE TABLE wide_table (
			c1 TEXT, c2 TEXT, c3 TEXT, c4 TEXT, c5 TEXT,
			c6 TEXT, c7 TEXT, c8 TEXT, c9 TEXT, c10 TEXT
		);
	`)
	if err != nil {
		t.Fatalf("failed to create wide table: %v", err)
	}

	var wideRows []map[string]interface{}
	for i := 0; i < 60; i++ {
		row := make(map[string]interface{})
		for j := 1; j <= 10; j++ {
			row[fmt.Sprintf("c%d", j)] = fmt.Sprintf("val_%d_%d", i, j)
		}
		wideRows = append(wideRows, row)
	}

	wideRes, err := drv.BatchInsert(ctx, "", "wide_table", wideRows)
	if err != nil {
		t.Fatalf("failed chunked batch insert: %v", err)
	}
	if wideRes.AffectedRows != 60 {
		t.Fatalf("expected 60 affected rows from chunked insert, got %d", wideRes.AffectedRows)
	}

	qWide, err := drv.QueryTableData(ctx, types.QueryOptions{Table: "wide_table", Limit: 100})
	if err != nil {
		t.Fatalf("failed to query wide table: %v", err)
	}
	if len(qWide.Rows) != 60 {
		t.Fatalf("expected 60 rows in wide table, got %d", len(qWide.Rows))
	}

	// C. Transaction rollback on error (unique constraint violation)
	dupRows := []map[string]interface{}{
		{"email": "dup@example.com", "name": "Dup 1", "role": "user"},
		{"email": "dup@example.com", "name": "Dup 2", "role": "user"}, // conflict!
	}
	_, err = drv.BatchInsert(ctx, "", "members", dupRows)
	if err == nil {
		t.Fatalf("expected error on duplicate email batch insert, got nil")
	}

	// Verify "dup@example.com" was not partially committed
	qDup, err := drv.QueryTableData(ctx, types.QueryOptions{
		Table: "members",
		Filters: []types.Filter{
			{Column: "email", Operator: "=", Value: "dup@example.com"},
		},
	})
	if err != nil {
		t.Fatalf("failed to query dup: %v", err)
	}
	if len(qDup.Rows) != 0 {
		t.Fatalf("expected 0 rows after rollback, got %d", len(qDup.Rows))
	}

	// D. Validation errors
	_, err = drv.BatchInsert(ctx, "", "members", nil)
	if err == nil {
		t.Fatalf("expected error on nil rows, got nil")
	}
	_, err = drv.BatchInsert(ctx, "", "members", []map[string]interface{}{})
	if err == nil {
		t.Fatalf("expected error on empty rows, got nil")
	}
}
