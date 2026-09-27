package seeder

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/driver/sqlite"
	"github.com/dblens/dblens/internal/driver/types"
)

func TestBuildDAGTopologicalSort(t *testing.T) {
	tables := []string{"order_items", "orders", "users", "products"}
	fks := []types.ForeignKey{
		{Table: "orders", Column: "user_id", RefTable: "users", RefColumn: "id"},
		{Table: "order_items", Column: "order_id", RefTable: "orders", RefColumn: "id"},
		{Table: "order_items", Column: "product_id", RefTable: "products", RefColumn: "id"},
	}

	dag := BuildDAG(tables, fks)
	if dag.CyclesDetected {
		t.Fatalf("unexpected cycles detected in linear DAG")
	}

	orderIdx := make(map[string]int)
	for i, to := range dag.SortedTables {
		orderIdx[to.Table] = i
	}

	// users and products must come before orders and order_items
	if orderIdx["users"] >= orderIdx["orders"] {
		t.Errorf("users should come before orders, got %d >= %d", orderIdx["users"], orderIdx["orders"])
	}
	if orderIdx["orders"] >= orderIdx["order_items"] {
		t.Errorf("orders should come before order_items, got %d >= %d", orderIdx["orders"], orderIdx["order_items"])
	}
	if orderIdx["products"] >= orderIdx["order_items"] {
		t.Errorf("products should come before order_items, got %d >= %d", orderIdx["products"], orderIdx["order_items"])
	}

	// Verify levels
	for _, to := range dag.SortedTables {
		if to.Table == "users" || to.Table == "products" {
			if to.Level != 0 {
				t.Errorf("table %s should have level 0, got %d", to.Table, to.Level)
			}
		}
		if to.Table == "orders" && to.Level != 1 {
			t.Errorf("orders should have level 1, got %d", to.Level)
		}
		if to.Table == "order_items" && to.Level != 2 {
			t.Errorf("order_items should have level 2, got %d", to.Level)
		}
	}
}

func TestBuildDAGSelfReferencingFK(t *testing.T) {
	tables := []string{"employees"}
	fks := []types.ForeignKey{
		{Table: "employees", Column: "manager_id", RefTable: "employees", RefColumn: "id"},
	}

	dag := BuildDAG(tables, fks)
	if dag.CyclesDetected {
		t.Errorf("self-referencing FK should not be flagged as unresolvable cycle")
	}
	if len(dag.SortedTables) != 1 {
		t.Fatalf("expected 1 table, got %d", len(dag.SortedTables))
	}
	empOrder := dag.SortedTables[0]
	if len(empOrder.SelfFKs) != 1 {
		t.Fatalf("expected 1 SelfFK, got %d", len(empOrder.SelfFKs))
	}
	if empOrder.SelfFKs[0].Column != "manager_id" {
		t.Errorf("expected manager_id SelfFK, got %s", empOrder.SelfFKs[0].Column)
	}
}

func TestBuildDAGCycleResolution(t *testing.T) {
	tables := []string{"authors", "books"}
	// Circular: authors.featured_book_id -> books.id, books.author_id -> authors.id
	fks := []types.ForeignKey{
		{Table: "authors", Column: "featured_book_id", RefTable: "books", RefColumn: "id"},
		{Table: "books", Column: "author_id", RefTable: "authors", RefColumn: "id"},
	}

	dag := BuildDAG(tables, fks)
	if !dag.CyclesDetected {
		t.Errorf("expected cycle detection for mutual circular FK")
	}
	if len(dag.DAGOrder) != 2 {
		t.Fatalf("expected all 2 tables in DAGOrder, got %d", len(dag.DAGOrder))
	}
	if len(dag.CycleEdges) == 0 {
		t.Errorf("expected at least 1 cycle edge recorded")
	}
}

func TestGeneratorsDeterminismAndTypes(t *testing.T) {
	const seed = 123456789
	g1 := NewDataGenerator(seed)
	g2 := NewDataGenerator(seed)

	typesToTest := []GeneratorConfig{
		{Type: GenName},
		{Type: GenFirstName},
		{Type: GenLastName},
		{Type: GenEmail},
		{Type: GenUUID},
		{Type: GenPhone},
		{Type: GenAddress},
		{Type: GenCity},
		{Type: GenCountry},
		{Type: GenPostalCode},
		{Type: GenTimestamp},
		{Type: GenDate},
		{Type: GenInteger, Min: 10, Max: 50},
		{Type: GenSequence},
		{Type: GenDecimal, Min: 10, Max: 100, Decimals: 2},
		{Type: GenBoolean, TruePct: 50},
		{Type: GenEnum, Options: []string{"A", "B", "C"}},
		{Type: GenText},
		{Type: GenParagraph},
		{Type: GenJSON},
	}

	uuidRegex := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	emailRegex := regexp.MustCompile(`^[a-z0-9.]+@[a-z0-9.]+$`)

	for _, cfg := range typesToTest {
		v1 := g1.GenerateValue(cfg)
		v2 := g2.GenerateValue(cfg)

		if v1 != v2 {
			t.Errorf("non-deterministic output for %s: %v vs %v", cfg.Type, v1, v2)
		}

		switch cfg.Type {
		case GenUUID:
			str := v1.(string)
			if !uuidRegex.MatchString(str) {
				t.Errorf("invalid UUID format: %s", str)
			}
		case GenEmail:
			str := v1.(string)
			if !emailRegex.MatchString(str) {
				t.Errorf("invalid email format: %s", str)
			}
		case GenJSON:
			str := v1.(string)
			var parsed map[string]interface{}
			if err := json.Unmarshal([]byte(str), &parsed); err != nil {
				t.Errorf("invalid JSON payload: %s, err: %v", str, err)
			}
		}
	}
}

func TestInferGenerator(t *testing.T) {
	tests := []struct {
		col      types.ColumnMeta
		expected GeneratorType
	}{
		{col: types.ColumnMeta{Name: "id", DataType: "integer", IsPrimary: true}, expected: GenSequence},
		{col: types.ColumnMeta{Name: "uuid", DataType: "char(36)", IsPrimary: true}, expected: GenUUID},
		{col: types.ColumnMeta{Name: "user_email", DataType: "varchar(255)"}, expected: GenEmail},
		{col: types.ColumnMeta{Name: "first_name", DataType: "text"}, expected: GenFirstName},
		{col: types.ColumnMeta{Name: "full_name", DataType: "text"}, expected: GenName},
		{col: types.ColumnMeta{Name: "phone_number", DataType: "text"}, expected: GenPhone},
		{col: types.ColumnMeta{Name: "created_at", DataType: "datetime"}, expected: GenTimestamp},
		{col: types.ColumnMeta{Name: "birth_date", DataType: "date"}, expected: GenDate},
		{col: types.ColumnMeta{Name: "is_active", DataType: "boolean"}, expected: GenBoolean},
		{col: types.ColumnMeta{Name: "status", DataType: "varchar(50)"}, expected: GenEnum},
		{col: types.ColumnMeta{Name: "price", DataType: "decimal(10,2)"}, expected: GenDecimal},
		{col: types.ColumnMeta{Name: "metadata", DataType: "json"}, expected: GenJSON},
	}

	for _, tt := range tests {
		res := InferGenerator(tt.col)
		if res.Type != tt.expected {
			t.Errorf("for col %s (%s): expected generator %s, got %s", tt.col.Name, tt.col.DataType, tt.expected, res.Type)
		}
	}
}

func TestKeyPool(t *testing.T) {
	pool := NewKeyPool()
	pool.AddKey("users", "id", 101)
	pool.AddKeys("users", "id", []interface{}{102, 103, 104})

	if pool.Count("users", "id") != 4 {
		t.Fatalf("expected count 4, got %d", pool.Count("users", "id"))
	}

	keys := pool.GetKeys("users", "id")
	if len(keys) != 4 || keys[0] != 101 {
		t.Errorf("unexpected keys returned: %v", keys)
	}

	// Ring buffer sequential test
	val0, ok0 := pool.SampleSequential("users", "id", 0)
	val4, ok4 := pool.SampleSequential("users", "id", 4) // should wrap around to index 0
	if !ok0 || !ok4 || val0 != val4 || val0 != 101 {
		t.Errorf("ring buffer sequential failed: val0=%v, val4=%v", val0, val4)
	}
}

func TestSQLiteSeederEndToEnd(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_seeder.db")
	t.Cleanup(func() { os.Remove(dbPath) })

	drv, err := sqlite.New("sqlite://" + dbPath)
	if err != nil {
		t.Fatalf("failed to init sqlite driver: %v", err)
	}
	defer drv.Close()
	ctx := context.Background()

	// 1. Create relational schema with self-referencing FK
	schemaSQL := `
		PRAGMA foreign_keys = ON;

		CREATE TABLE departments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			budget DECIMAL(10,2) NOT NULL
		);

		CREATE TABLE employees (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			department_id INTEGER NOT NULL,
			manager_id INTEGER,
			full_name TEXT NOT NULL,
			email TEXT NOT NULL,
			is_active BOOLEAN NOT NULL,
			FOREIGN KEY (department_id) REFERENCES departments(id),
			FOREIGN KEY (manager_id) REFERENCES employees(id)
		);

		CREATE TABLE projects (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			lead_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			FOREIGN KEY (lead_id) REFERENCES employees(id)
		);
	`
	if _, err := drv.ExecuteQuery(ctx, schemaSQL); err != nil {
		t.Fatalf("failed to create sqlite schema: %v", err)
	}

	// 2. Build Plan
	opts := SeederOptions{
		Schema:          "main",
		Tables:          []string{"projects", "employees", "departments"},
		DefaultRowCount: 10,
		Seed:            42,
		BatchSize:       50,
	}

	plan, err := BuildPlan(ctx, drv, opts)
	if err != nil {
		t.Fatalf("BuildPlan failed: %v", err)
	}

	// Verify DAG order: departments -> employees -> projects
	if len(plan.DAGOrder) != 3 {
		t.Fatalf("expected 3 tables, got %d", len(plan.DAGOrder))
	}
	if plan.DAGOrder[0] != "departments" || plan.DAGOrder[1] != "employees" || plan.DAGOrder[2] != "projects" {
		t.Errorf("unexpected DAGOrder: %v", plan.DAGOrder)
	}

	// Verify preview sample rows
	for _, tp := range plan.Tables {
		if len(tp.SampleRows) != 3 {
			t.Errorf("expected 3 sample rows for %s, got %d", tp.Table, len(tp.SampleRows))
		}
	}

	// 3. Run Seeder
	var progressEvents []SeedProgress
	res, err := Run(ctx, drv, plan, func(p SeedProgress) {
		progressEvents = append(progressEvents, p)
	})
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}

	if res.TotalInserted != 30 {
		t.Errorf("expected 30 rows inserted, got %d", res.TotalInserted)
	}
	if len(res.Errors) > 0 {
		t.Errorf("unexpected errors during seeding: %v", res.Errors)
	}
	if len(progressEvents) == 0 {
		t.Errorf("expected progress events to be emitted")
	}

	// 4. Verify SQLite foreign keys integrity
	fkCheckRes, err := drv.ExecuteQuery(ctx, "PRAGMA foreign_key_check;")
	if err != nil {
		t.Fatalf("PRAGMA foreign_key_check failed: %v", err)
	}
	if len(fkCheckRes.Rows) > 0 {
		t.Fatalf("foreign_key_check reported integrity violations: %v", fkCheckRes.Rows)
	}

	// 5. Test Export SQL and JSON
	sqlBytes, err := Export(ctx, drv, plan, "sql")
	if err != nil {
		t.Fatalf("Export sql failed: %v", err)
	}
	sqlStr := string(sqlBytes)
	if !strings.Contains(sqlStr, "INSERT INTO") {
		t.Errorf("expected INSERT INTO in exported SQL, got:\n%s", sqlStr)
	}

	jsonBytes, err := Export(ctx, drv, plan, "json")
	if err != nil {
		t.Fatalf("Export json failed: %v", err)
	}
	var jsonFixture map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &jsonFixture); err != nil {
		t.Fatalf("exported JSON is invalid: %v", err)
	}
	if jsonFixture["totalRows"].(float64) != 30 {
		t.Errorf("expected totalRows 30 in JSON fixture, got %v", jsonFixture["totalRows"])
	}
}

func TestKeyPoolSampleSequentialNegativeIndex(t *testing.T) {
	pool := NewKeyPool()
	pool.AddKeys("items", "id", []interface{}{10, 20, 30})

	// Negative indices must not panic and must correctly wrap modulo
	valNeg1, ok1 := pool.SampleSequential("items", "id", -1)
	if !ok1 || valNeg1 != 30 {
		t.Errorf("expected -1 to wrap to 30, got %v (ok=%v)", valNeg1, ok1)
	}

	valNeg2, ok2 := pool.SampleSequential("items", "id", -2)
	if !ok2 || valNeg2 != 20 {
		t.Errorf("expected -2 to wrap to 20, got %v (ok=%v)", valNeg2, ok2)
	}

	valNeg3, ok3 := pool.SampleSequential("items", "id", -3)
	if !ok3 || valNeg3 != 10 {
		t.Errorf("expected -3 to wrap to 10, got %v (ok=%v)", valNeg3, ok3)
	}
}

func TestQuoteIdentAndTableEscaping(t *testing.T) {
	// MySQL escaping
	if q := quoteIdent("mysql", "users`table"); q != "`users``table`" {
		t.Errorf("expected MySQL escaped backtick, got %s", q)
	}
	if q := quoteTable("mysql", "db`schema", "my`table"); q != "`db``schema`.`my``table`" {
		t.Errorf("expected MySQL escaped table, got %s", q)
	}

	// Postgres/SQLite escaping
	if q := quoteIdent("postgres", `my"col`); q != `"my""col"` {
		t.Errorf("expected Postgres escaped double quotes, got %s", q)
	}
	if q := quoteTable("postgres", `my"schema`, `my"table`); q != `"my""schema"."my""table"` {
		t.Errorf("expected Postgres escaped table, got %s", q)
	}
	if q := quoteTable("sqlite", "", `simple_table`); q != `"simple_table"` {
		t.Errorf("expected SQLite simple table without schema prefix, got %s", q)
	}
}

func TestGenIntegerOverflowAndDecimalClamp(t *testing.T) {
	gen := NewDataGenerator(999)

	// Int64 range overflow test
	cfgOverflow := GeneratorConfig{
		Type: GenInteger,
		Min:  -5000000000000000000,
		Max:  9223372036854775807, // maxVal - minVal + 1 overflows int64
	}
	// Must not panic on overflow
	vInt := gen.GenerateValue(cfgOverflow)
	if _, ok := vInt.(int64); !ok {
		t.Errorf("expected int64 from GenInteger, got %T", vInt)
	}

	// Decimal precision clamp test (> 10 clamped to 10)
	cfgDec := GeneratorConfig{
		Type:     GenDecimal,
		Min:      10,
		Max:      20,
		Decimals: 50,
	}
	vDec := gen.GenerateValue(cfgDec).(string)
	parts := strings.Split(vDec, ".")
	if len(parts) == 2 && len(parts[1]) > 10 {
		t.Errorf("expected decimal places to be clamped to at most 10, got %d in %s", len(parts[1]), vDec)
	}
}

func TestSequenceOffsetAndCollisionAvoidance(t *testing.T) {
	gen := NewDataGenerator(1234)

	// Test sequence with custom Min starting offset
	cfgSeq := GeneratorConfig{
		Type: GenSequence,
		Min:  500,
	}
	v1 := gen.GenerateValue(cfgSeq).(int64)
	v2 := gen.GenerateValue(cfgSeq).(int64)
	v3 := gen.GenerateValue(cfgSeq).(int64)

	if v1 != 500 || v2 != 501 || v3 != 502 {
		t.Errorf("expected sequence 500, 501, 502; got %d, %d, %d", v1, v2, v3)
	}
}

func TestPostgreSQLExportScriptOrder(t *testing.T) {
	tables := []TableData{
		{
			Table: "items",
			Rows: []map[string]interface{}{
				{"id": 1, "name": "Item 1"},
			},
		},
	}
	sqlStr, err := ExportSQL("postgres", "public", tables)
	if err != nil {
		t.Fatalf("ExportSQL failed: %v", err)
	}

	beginIdx := strings.Index(sqlStr, "BEGIN;")
	setConstraintsIdx := strings.Index(sqlStr, "SET CONSTRAINTS ALL DEFERRED;")

	if beginIdx == -1 || setConstraintsIdx == -1 {
		t.Fatalf("expected BEGIN; and SET CONSTRAINTS ALL DEFERRED; in postgres export")
	}
	if beginIdx > setConstraintsIdx {
		t.Errorf("BEGIN; must appear BEFORE SET CONSTRAINTS ALL DEFERRED; in PostgreSQL scripts")
	}
}

func TestSeedPlanEmptyTablesNotNull(t *testing.T) {
	plan := SeedPlan{
		Seed:     123,
		Schema:   "public",
		Tables:   make([]TableSeedPlan, 0),
		DAGOrder: []string{},
	}
	b, err := json.Marshal(plan)
	if err != nil {
		t.Fatalf("failed to marshal plan: %v", err)
	}
	if !strings.Contains(string(b), `"tables":[]`) {
		t.Errorf("expected tables to serialize as [] not null, got:\n%s", string(b))
	}
}
