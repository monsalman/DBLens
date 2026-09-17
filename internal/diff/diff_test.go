package diff

import (
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/driver/types"
)

func strPtr(s string) *string {
	return &s
}

func TestCompareTablesIdentical(t *testing.T) {
	src := &types.TableDetail{
		Name:   "users",
		Schema: "public",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "integer", IsPrimary: true},
			{Name: "email", Type: "varchar(255)", IsNullable: false},
		},
	}
	tgt := &types.TableDetail{
		Name:   "users",
		Schema: "public",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "int4", IsPrimary: true},
			{Name: "email", Type: "VARCHAR(255)", IsNullable: false},
		},
	}

	diff := CompareTables(src, tgt, "postgres")
	if diff.Status != DiffIdentical {
		t.Fatalf("expected IDENTICAL status, got %s", diff.Status)
	}
	if len(diff.MigrationSQL) != 0 {
		t.Fatalf("expected 0 migration statements for identical tables, got %d", len(diff.MigrationSQL))
	}
}

func TestCompareTablesAddedAndRemovedColumnsPostgres(t *testing.T) {
	src := &types.TableDetail{
		Name:   "customers",
		Schema: "public",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "integer", IsPrimary: true},
			{Name: "name", Type: "text", IsNullable: false},
			{Name: "phone", Type: "text", IsNullable: true}, // Added in source
		},
	}
	tgt := &types.TableDetail{
		Name:   "customers",
		Schema: "public",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "integer", IsPrimary: true},
			{Name: "name", Type: "text", IsNullable: false},
			{Name: "fax", Type: "text", IsNullable: true}, // Removed in source
		},
	}

	diff := CompareTables(src, tgt, "postgres")
	if diff.Status != DiffModified {
		t.Fatalf("expected MODIFIED status, got %s", diff.Status)
	}

	var hasAddedPhone, hasRemovedFax bool
	for _, col := range diff.Columns {
		if col.Name == "phone" && col.Status == DiffAdded {
			hasAddedPhone = true
		}
		if col.Name == "fax" && col.Status == DiffRemoved {
			hasRemovedFax = true
		}
	}
	if !hasAddedPhone {
		t.Errorf("expected added column 'phone'")
	}
	if !hasRemovedFax {
		t.Errorf("expected removed column 'fax'")
	}

	sqlJoined := strings.Join(diff.MigrationSQL, " ")
	if !strings.Contains(sqlJoined, `ADD COLUMN "phone" text`) {
		t.Errorf("expected ADD COLUMN \"phone\" in SQL, got: %s", sqlJoined)
	}
	if !strings.Contains(sqlJoined, `DROP COLUMN "fax"`) {
		t.Errorf("expected DROP COLUMN \"fax\" in SQL, got: %s", sqlJoined)
	}
}

func TestCompareTablesModifiedColumnMySQL(t *testing.T) {
	src := &types.TableDetail{
		Name:   "products",
		Schema: "inventory",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "int", IsPrimary: true},
			{Name: "price", Type: "decimal(12,2)", IsNullable: false, Default: strPtr("0.00")},
		},
	}
	tgt := &types.TableDetail{
		Name:   "products",
		Schema: "inventory",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "int", IsPrimary: true},
			{Name: "price", Type: "decimal(10,2)", IsNullable: true, Default: nil},
		},
	}

	diff := CompareTables(src, tgt, "mysql")
	if diff.Status != DiffModified {
		t.Fatalf("expected MODIFIED status, got %s", diff.Status)
	}

	var priceCol *ColumnDiff
	for _, col := range diff.Columns {
		if col.Name == "price" {
			priceCol = &col
			break
		}
	}
	if priceCol == nil || priceCol.Status != DiffModified {
		t.Fatalf("expected modified column 'price'")
	}

	sqlJoined := strings.Join(diff.MigrationSQL, " ")
	if !strings.Contains(sqlJoined, "ALTER TABLE `inventory`.`products` MODIFY COLUMN `price`") {
		t.Errorf("expected MySQL MODIFY COLUMN in SQL, got: %s", sqlJoined)
	}
}

func TestCompareTablesSQLiteTableRecreation(t *testing.T) {
	src := &types.TableDetail{
		Name:   "orders",
		Schema: "main",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "INTEGER", IsPrimary: true},
			{Name: "status", Type: "TEXT", IsNullable: false},
		},
	}
	tgt := &types.TableDetail{
		Name:   "orders",
		Schema: "main",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "INTEGER", IsPrimary: true},
			{Name: "status", Type: "INTEGER", IsNullable: true}, // altered type and nullability
		},
	}

	diff := CompareTables(src, tgt, "sqlite")
	if diff.Status != DiffModified {
		t.Fatalf("expected MODIFIED status, got %s", diff.Status)
	}

	sqlJoined := strings.Join(diff.MigrationSQL, " ")
	if !strings.Contains(sqlJoined, "orders_dblens_tmp") {
		t.Errorf("expected sqlite temp table recreation script, got: %s", sqlJoined)
	}
}

func TestCompareTablesIndexesAndFKs(t *testing.T) {
	src := &types.TableDetail{
		Name:   "items",
		Schema: "public",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "integer", IsPrimary: true},
			{Name: "sku", Type: "text", IsNullable: false},
		},
		Indexes: []types.IndexMeta{
			{Name: "idx_items_sku", Columns: []string{"sku"}, IsUnique: true},
		},
		FKs: []types.ForeignKey{
			{Name: "fk_items_store", Column: "store_id", RefTable: "stores", RefColumn: "id", OnDelete: "CASCADE"},
		},
	}
	tgt := &types.TableDetail{
		Name:   "items",
		Schema: "public",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "integer", IsPrimary: true},
			{Name: "sku", Type: "text", IsNullable: false},
		},
		Indexes: []types.IndexMeta{},
		FKs:     []types.ForeignKey{},
	}

	diff := CompareTables(src, tgt, "postgres")
	if diff.Status != DiffModified {
		t.Fatalf("expected MODIFIED status, got %s", diff.Status)
	}
	if len(diff.Indexes) != 1 || diff.Indexes[0].Status != DiffAdded {
		t.Errorf("expected 1 added index, got %v", diff.Indexes)
	}
	if len(diff.ForeignKeys) != 1 || diff.ForeignKeys[0].Status != DiffAdded {
		t.Errorf("expected 1 added foreign key, got %v", diff.ForeignKeys)
	}

	sqlJoined := strings.Join(diff.MigrationSQL, " ")
	if !strings.Contains(sqlJoined, "CREATE UNIQUE INDEX") {
		t.Errorf("expected CREATE UNIQUE INDEX in migration SQL, got: %s", sqlJoined)
	}
	if !strings.Contains(sqlJoined, "ADD CONSTRAINT") {
		t.Errorf("expected ADD CONSTRAINT in migration SQL, got: %s", sqlJoined)
	}
}

func TestCompareSchemas(t *testing.T) {
	srcTables := map[string]*types.TableDetail{
		"users": {
			Name:   "users",
			Schema: "public",
			Columns: []types.ColumnMeta{
				{Name: "id", Type: "integer", IsPrimary: true},
				{Name: "email", Type: "varchar(255)"},
			},
		},
		"new_table": {
			Name:   "new_table",
			Schema: "public",
			Columns: []types.ColumnMeta{
				{Name: "id", Type: "integer", IsPrimary: true},
				{Name: "val", Type: "text"},
			},
		},
	}

	tgtTables := map[string]*types.TableDetail{
		"users": {
			Name:   "users",
			Schema: "public",
			Columns: []types.ColumnMeta{
				{Name: "id", Type: "integer", IsPrimary: true},
				{Name: "email", Type: "varchar(100)"}, // Modified
			},
		},
		"old_table": {
			Name:   "old_table",
			Schema: "public",
			Columns: []types.ColumnMeta{
				{Name: "id", Type: "integer", IsPrimary: true},
			},
		},
	}

	result := CompareSchemas(srcTables, tgtTables, "postgres", "public", "public")

	if result.TotalTables != 3 {
		t.Errorf("expected 3 total tables, got %d", result.TotalTables)
	}
	if result.AddedCount != 1 {
		t.Errorf("expected 1 added table, got %d", result.AddedCount)
	}
	if result.RemovedCount != 1 {
		t.Errorf("expected 1 removed table, got %d", result.RemovedCount)
	}
	if result.ModifiedCount != 1 {
		t.Errorf("expected 1 modified table, got %d", result.ModifiedCount)
	}
	if result.IdenticalCount != 0 {
		t.Errorf("expected 0 identical tables, got %d", result.IdenticalCount)
	}

	sqlJoined := strings.Join(result.MigrationSQL, " ")
	if !strings.Contains(sqlJoined, `CREATE TABLE "public"."new_table"`) && !strings.Contains(sqlJoined, `CREATE TABLE "new_table"`) {
		t.Errorf("expected CREATE TABLE for new_table, got: %s", sqlJoined)
	}
	if !strings.Contains(sqlJoined, `DROP TABLE IF EXISTS "public"."old_table" CASCADE;`) && !strings.Contains(sqlJoined, `DROP TABLE IF EXISTS "old_table" CASCADE;`) {
		t.Errorf("expected DROP TABLE for old_table, got: %s", sqlJoined)
	}
	if !strings.Contains(sqlJoined, `ALTER TABLE "public"."users"`) && !strings.Contains(sqlJoined, `ALTER TABLE "users"`) {
		t.Errorf("expected ALTER TABLE for users, got: %s", sqlJoined)
	}
}

func TestQuotingAndCaseSensitivity(t *testing.T) {
	if QuoteIdent("foo", "mysql") != "`foo`" {
		t.Errorf("mysql quoting failed")
	}
	if QuoteIdent("foo", "postgres") != `"foo"` {
		t.Errorf("postgres quoting failed")
	}
	if QuoteIdent("foo", "sqlite") != `"foo"` {
		t.Errorf("sqlite quoting failed")
	}

	// Schema quoting tests
	if QuoteTableRef("public", "tbl", "postgres") != `"public"."tbl"` {
		t.Errorf("expected postgres public schema to be preserved, got %s", QuoteTableRef("public", "tbl", "postgres"))
	}
	if QuoteTableRef("main", "tbl", "postgres") != `"tbl"` {
		t.Errorf("expected main schema to be omitted, got %s", QuoteTableRef("main", "tbl", "postgres"))
	}
	if QuoteTableRef("", "tbl", "postgres") != `"tbl"` {
		t.Errorf("expected empty schema to be omitted, got %s", QuoteTableRef("", "tbl", "postgres"))
	}
	if QuoteTableRef("public", "tbl", "sqlite") != `"tbl"` {
		t.Errorf("expected sqlite schema to be omitted, got %s", QuoteTableRef("public", "tbl", "sqlite"))
	}

	if !typesEquivalent("INT", "integer") {
		t.Errorf("case-insensitive type equivalence failed")
	}
	if !typesEquivalent("VARCHAR(100)", "varchar(100)") {
		t.Errorf("varchar case sensitivity failed")
	}
}

func TestDiffSecuritySanitization(t *testing.T) {
	// 1. Malicious column type rejected in GenerateCreateTableSQL
	badTypeTable := &types.TableDetail{
		Name:   "injected",
		Schema: "public",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "integer; DROP TABLE users;--", IsPrimary: true},
		},
	}
	_, _, err := GenerateCreateTableSQL(badTypeTable, "postgres", "public")
	if err == nil {
		t.Fatalf("expected error for SQL injection in column type, got nil")
	}

	// 2. Malicious default rejected in GenerateCreateTableSQL
	badDefTable := &types.TableDetail{
		Name:   "injected_def",
		Schema: "public",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "integer", IsPrimary: true, Default: strPtr("1; DROP TABLE users;--")},
		},
	}
	_, _, err = GenerateCreateTableSQL(badDefTable, "postgres", "public")
	if err == nil {
		t.Fatalf("expected error for SQL injection in default value, got nil")
	}

	// 3. Malicious foreign key action rejected
	badFKTable := &types.TableDetail{
		Name:   "injected_fk",
		Schema: "public",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "integer", IsPrimary: true},
			{Name: "user_id", Type: "integer"},
		},
		FKs: []types.ForeignKey{
			{Name: "fk_user", Column: "user_id", RefTable: "users", RefColumn: "id", OnDelete: "CASCADE; DROP TABLE users;--"},
		},
	}
	_, _, err = GenerateCreateTableSQL(badFKTable, "postgres", "public")
	if err == nil {
		t.Fatalf("expected error for SQL injection in FK action, got nil")
	}

	// 4. CompareTables with added table containing malicious type produces error comment
	tableDiff := CompareTables(badTypeTable, nil, "postgres")
	if !strings.Contains(tableDiff.SQL, "-- injected:") {
		t.Fatalf("expected SQL error comment for malicious table, got %s", tableDiff.SQL)
	}

	// 5. CompareTables with altered column containing malicious type produces error comment
	srcTbl := &types.TableDetail{
		Name:   "users",
		Schema: "public",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "integer", IsPrimary: true},
			{Name: "email", Type: "text; DROP TABLE users;--"},
		},
	}
	tgtTbl := &types.TableDetail{
		Name:   "users",
		Schema: "public",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "integer", IsPrimary: true},
			{Name: "email", Type: "varchar(255)"},
		},
	}
	altDiff := CompareTables(srcTbl, tgtTbl, "postgres")
	if !strings.Contains(altDiff.SQL, "-- users:") {
		t.Fatalf("expected error comment in SQL for altered column injection, got %s", altDiff.SQL)
	}

	// 6. MySQL index generation omits IF NOT EXISTS
	idxTable := &types.TableDetail{
		Name:   "items",
		Schema: "inventory",
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "int", IsPrimary: true},
			{Name: "sku", Type: "varchar(100)"},
		},
		Indexes: []types.IndexMeta{
			{Name: "idx_items_sku", Columns: []string{"sku"}},
		},
	}
	stmts, sqlMySQL, err := GenerateCreateTableSQL(idxTable, "mysql", "inventory")
	if err != nil {
		t.Fatalf("unexpected error for valid table: %v", err)
	}
	if strings.Contains(sqlMySQL, "IF NOT EXISTS") {
		t.Errorf("MySQL CREATE INDEX must not contain IF NOT EXISTS, got: %s", sqlMySQL)
	}
	if len(stmts) != 2 || !strings.Contains(stmts[1], "CREATE INDEX `idx_items_sku` ON `inventory`.`items` (`sku`);") {
		t.Errorf("unexpected MySQL index statement: %v", stmts)
	}

	// 7. Postgres index generation includes IF NOT EXISTS
	_, sqlPG, err := GenerateCreateTableSQL(idxTable, "postgres", "inventory")
	if err != nil {
		t.Fatalf("unexpected error for postgres: %v", err)
	}
	if !strings.Contains(sqlPG, "IF NOT EXISTS") {
		t.Errorf("Postgres CREATE INDEX should contain IF NOT EXISTS, got: %s", sqlPG)
	}
}
