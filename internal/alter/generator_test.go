package alter_test

import (
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/alter"
	"github.com/dblens/dblens/internal/driver/types"
)

func ptr[T any](v T) *T {
	return &v
}

func TestGeneratePostgresDDL(t *testing.T) {
	req := types.AlterTableRequest{
		Schema: "public",
		Table:  "users",
		AddedColumns: []types.ColumnMeta{
			{Name: "bio", Type: "TEXT", IsNullable: true},
			{Name: "age", Type: "INTEGER", IsNullable: false, Default: ptr("18")},
		},
		DroppedColumns: []string{"temp_col"},
		RenamedColumns: []types.RenameColumnSpec{
			{From: "fname", To: "first_name"},
		},
		AlteredColumns: []types.AlterColumnSpec{
			{Name: "email", Type: "VARCHAR(300)", Nullable: ptr(false)},
			{Name: "status", Default: ptr("active")},
			{Name: "old_flag", DropDefault: true},
		},
		AddedIndexes: []types.IndexMeta{
			{Name: "idx_users_email", Columns: []string{"email"}, IsUnique: true},
		},
		DroppedIndexes: []string{"idx_users_old"},
		AddedForeignKeys: []types.ForeignKey{
			{Name: "fk_users_org", Column: "org_id", RefTable: "organizations", RefColumn: "id", OnDelete: "CASCADE"},
		},
		DroppedForeignKeys: []string{"fk_users_old_org"},
	}

	stmts, sql, err := alter.GenerateAlterDDL("postgres", req)
	if err != nil {
		t.Fatalf("GenerateAlterDDL failed: %v", err)
	}

	expectedSubstrings := []string{
		`ALTER TABLE "public"."users" DROP CONSTRAINT IF EXISTS "fk_users_old_org"`,
		`DROP INDEX IF EXISTS "public"."idx_users_old"`,
		`ALTER TABLE "public"."users" DROP COLUMN "temp_col"`,
		`ALTER TABLE "public"."users" RENAME COLUMN "fname" TO "first_name"`,
		`ALTER TABLE "public"."users" ALTER COLUMN "email" TYPE VARCHAR(300)`,
		`ALTER TABLE "public"."users" ALTER COLUMN "email" SET NOT NULL`,
		`ALTER TABLE "public"."users" ALTER COLUMN "status" SET DEFAULT 'active'`,
		`ALTER TABLE "public"."users" ALTER COLUMN "old_flag" DROP DEFAULT`,
		`ALTER TABLE "public"."users" ADD COLUMN "bio" TEXT`,
		`ALTER TABLE "public"."users" ADD COLUMN "age" INTEGER DEFAULT 18 NOT NULL`,
		`ALTER TABLE "public"."users" ADD CONSTRAINT "fk_users_org" FOREIGN KEY ("org_id") REFERENCES "public"."organizations" ("id") ON DELETE CASCADE`,
		`CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_email" ON "public"."users" ("email")`,
	}

	for _, sub := range expectedSubstrings {
		if !strings.Contains(sql, sub) {
			t.Errorf("expected SQL to contain %q, but got:\n%s", sub, sql)
		}
	}

	if len(stmts) != len(expectedSubstrings) {
		t.Errorf("expected %d statements, got %d", len(expectedSubstrings), len(stmts))
	}
}

func TestGenerateMySQLDDL(t *testing.T) {
	req := types.AlterTableRequest{
		Schema: "mydb",
		Table:  "orders",
		AddedColumns: []types.ColumnMeta{
			{Name: "note", Type: "VARCHAR(255)", IsNullable: true, Default: ptr("N/A")},
		},
		DroppedColumns: []string{"obsolete_field"},
		RenamedColumns: []types.RenameColumnSpec{
			{From: "amt", To: "amount"},
		},
		AlteredColumns: []types.AlterColumnSpec{
			{Name: "amount", Type: "DECIMAL(10,2)", Nullable: ptr(false)},
		},
		AddedIndexes: []types.IndexMeta{
			{Name: "idx_orders_amt", Columns: []string{"amount"}, IsUnique: false},
		},
		DroppedIndexes: []string{"idx_old_amt"},
		AddedForeignKeys: []types.ForeignKey{
			{Name: "fk_orders_user", Column: "user_id", RefTable: "users", RefColumn: "id", OnDelete: "SET NULL"},
		},
		DroppedForeignKeys: []string{"fk_orders_old_user"},
	}

	_, sql, err := alter.GenerateAlterDDL("mysql", req)
	if err != nil {
		t.Fatalf("GenerateAlterDDL mysql failed: %v", err)
	}

	expectedSubstrings := []string{
		"ALTER TABLE `mydb`.`orders` DROP FOREIGN KEY `fk_orders_old_user`",
		"DROP INDEX `idx_old_amt` ON `mydb`.`orders`",
		"ALTER TABLE `mydb`.`orders` DROP COLUMN `obsolete_field`",
		"ALTER TABLE `mydb`.`orders` RENAME COLUMN `amt` TO `amount`",
		"ALTER TABLE `mydb`.`orders` MODIFY COLUMN `amount` DECIMAL(10,2) NOT NULL",
		"ALTER TABLE `mydb`.`orders` ADD COLUMN `note` VARCHAR(255) DEFAULT 'N/A'",
		"ALTER TABLE `mydb`.`orders` ADD CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `mydb`.`users` (`id`) ON DELETE SET NULL",
		"CREATE INDEX `idx_orders_amt` ON `mydb`.`orders` (`amount`)",
	}

	for _, sub := range expectedSubstrings {
		if !strings.Contains(sql, sub) {
			t.Errorf("expected MySQL SQL to contain %q, but got:\n%s", sub, sql)
		}
	}
}

func TestGenerateSQLiteDDL(t *testing.T) {
	req := types.AlterTableRequest{
		Table: "items",
		AddedColumns: []types.ColumnMeta{
			{Name: "sku", Type: "TEXT", IsNullable: true},
		},
		DroppedColumns: []string{"trash"},
		RenamedColumns: []types.RenameColumnSpec{
			{From: "cost", To: "price"},
		},
		AddedIndexes: []types.IndexMeta{
			{Name: "idx_items_sku", Columns: []string{"sku"}, IsUnique: true},
		},
		DroppedIndexes: []string{"idx_old"},
	}

	_, sql, err := alter.GenerateAlterDDL("sqlite", req)
	if err != nil {
		t.Fatalf("GenerateAlterDDL sqlite failed: %v", err)
	}

	expectedSubstrings := []string{
		`DROP INDEX IF EXISTS "idx_old"`,
		`ALTER TABLE "items" DROP COLUMN "trash"`,
		`ALTER TABLE "items" RENAME COLUMN "cost" TO "price"`,
		`ALTER TABLE "items" ADD COLUMN "sku" TEXT`,
		`CREATE UNIQUE INDEX IF NOT EXISTS "idx_items_sku" ON "items" ("sku")`,
	}

	for _, sub := range expectedSubstrings {
		if !strings.Contains(sql, sub) {
			t.Errorf("expected SQLite SQL to contain %q, but got:\n%s", sub, sql)
		}
	}
}

func TestSQLInjectionRejectionInColumnTypes(t *testing.T) {
	badTypes := []string{
		"TEXT; DROP TABLE users; --",
		"INTEGER/*comment*/",
		"VARCHAR(255)\x00evil",
		"TEXT\nDROP TABLE users",
		"TEXT\rDROP TABLE users",
		strings.Repeat("A", 65),
		"INT; SELECT 1",
		"VARCHAR(100)--",
	}

	for _, bt := range badTypes {
		req := types.AlterTableRequest{
			Table: "items",
			AddedColumns: []types.ColumnMeta{
				{Name: "bad_col", Type: bt},
			},
		}

		for _, d := range []string{"postgres", "mysql", "sqlite"} {
			_, _, err := alter.GenerateAlterDDL(d, req)
			if err == nil {
				t.Errorf("expected error for bad column type %q in dialect %s, got nil", bt, d)
			}
		}

		// Also test AlteredColumns (for pg and mysql)
		altReq := types.AlterTableRequest{
			Table: "items",
			AlteredColumns: []types.AlterColumnSpec{
				{Name: "bad_col", Type: bt},
			},
		}
		for _, d := range []string{"postgres", "mysql"} {
			_, _, err := alter.GenerateAlterDDL(d, altReq)
			if err == nil {
				t.Errorf("expected error for altered bad column type %q in dialect %s, got nil", bt, d)
			}
		}
	}
}

func TestSQLInjectionRejectionInFKActions(t *testing.T) {
	badActions := []string{
		"CASCADE; DROP TABLE users; --",
		"NO ACTION/*comment*/",
		"INVALID_ACTION",
		"SET NULL\x00",
		"DROP",
	}

	for _, ba := range badActions {
		req := types.AlterTableRequest{
			Table: "items",
			AddedForeignKeys: []types.ForeignKey{
				{Column: "user_id", RefTable: "users", RefColumn: "id", OnDelete: ba},
			},
		}
		for _, d := range []string{"postgres", "mysql"} {
			_, _, err := alter.GenerateAlterDDL(d, req)
			if err == nil {
				t.Errorf("expected error for bad FK OnDelete %q in dialect %s, got nil", ba, d)
			}
		}

		reqUpdate := types.AlterTableRequest{
			Table: "items",
			AddedForeignKeys: []types.ForeignKey{
				{Column: "user_id", RefTable: "users", RefColumn: "id", OnUpdate: ba},
			},
		}
		for _, d := range []string{"postgres", "mysql"} {
			_, _, err := alter.GenerateAlterDDL(d, reqUpdate)
			if err == nil {
				t.Errorf("expected error for bad FK OnUpdate %q in dialect %s, got nil", ba, d)
			}
		}
	}
}

func TestSQLInjectionRejectionInDefaultValues(t *testing.T) {
	badDefaults := []string{
		"'active'; DROP TABLE users; --",
		"1; DROP TABLE users; --",
		"now(); DROP TABLE users; --()",
		"bad/*comment*/",
		"val\x00inject",
		"val\ninject",
		"val\rinject",
	}

	for _, bd := range badDefaults {
		req := types.AlterTableRequest{
			Table: "items",
			AddedColumns: []types.ColumnMeta{
				{Name: "status", Type: "VARCHAR(50)", Default: ptr(bd)},
			},
		}
		for _, d := range []string{"postgres", "mysql", "sqlite"} {
			_, _, err := alter.GenerateAlterDDL(d, req)
			if err == nil {
				t.Errorf("expected error for bad default value %q in dialect %s, got nil", bd, d)
			}
		}
	}

	// Test safe values format correctly
	safeReq := types.AlterTableRequest{
		Table: "items",
		AddedColumns: []types.ColumnMeta{
			{Name: "c1", Type: "TEXT", Default: ptr("O'Reilly")},
			{Name: "c2", Type: "TEXT", Default: ptr("'quoted''str'")},
			{Name: "c3", Type: "INTEGER", Default: ptr("42")},
			{Name: "c4", Type: "TIMESTAMP", Default: ptr("CURRENT_TIMESTAMP")},
		},
	}
	_, sql, err := alter.GenerateAlterDDL("postgres", safeReq)
	if err != nil {
		t.Fatalf("unexpected error for safe defaults: %v", err)
	}
	if !strings.Contains(sql, "DEFAULT 'O''Reilly'") {
		t.Errorf("expected escaped O''Reilly, got: %s", sql)
	}
	if !strings.Contains(sql, "DEFAULT 42") {
		t.Errorf("expected DEFAULT 42, got: %s", sql)
	}
	if !strings.Contains(sql, "DEFAULT CURRENT_TIMESTAMP") {
		t.Errorf("expected DEFAULT CURRENT_TIMESTAMP, got: %s", sql)
	}
}

func TestSQLiteUnsupportedOperationsRejected(t *testing.T) {
	// 1. Altered columns
	altReq := types.AlterTableRequest{
		Table: "items",
		AlteredColumns: []types.AlterColumnSpec{
			{Name: "qty", Type: "BIGINT"},
		},
	}
	_, _, err := alter.GenerateAlterDDL("sqlite", altReq)
	if err == nil || !strings.Contains(err.Error(), "sqlite does not support altering") {
		t.Errorf("expected SQLite error for altered columns, got: %v", err)
	}

	// 2. Added FK
	fkAddReq := types.AlterTableRequest{
		Table: "items",
		AddedForeignKeys: []types.ForeignKey{
			{Column: "user_id", RefTable: "users", RefColumn: "id"},
		},
	}
	_, _, err = alter.GenerateAlterDDL("sqlite", fkAddReq)
	if err == nil || !strings.Contains(err.Error(), "sqlite does not support adding foreign keys") {
		t.Errorf("expected SQLite error for added foreign keys, got: %v", err)
	}

	// 3. Dropped FK
	fkDropReq := types.AlterTableRequest{
		Table:              "items",
		DroppedForeignKeys: []string{"fk_items_users"},
	}
	_, _, err = alter.GenerateAlterDDL("sqlite", fkDropReq)
	if err == nil || !strings.Contains(err.Error(), "sqlite does not support dropping foreign keys") {
		t.Errorf("expected SQLite error for dropped foreign keys, got: %v", err)
	}
}

func TestRefTableMultiSegmentQuoting(t *testing.T) {
	req := types.AlterTableRequest{
		Table: "orders",
		AddedForeignKeys: []types.ForeignKey{
			{
				Name:      "fk_orders_user",
				Column:    "user_id",
				RefTable:  "auth_db.auth_schema.users",
				RefColumn: "id",
				OnDelete:  "CASCADE",
			},
		},
	}

	_, sqlPG, err := alter.GenerateAlterDDL("postgres", req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expectedPG := `REFERENCES "auth_db"."auth_schema"."users" ("id")`
	if !strings.Contains(sqlPG, expectedPG) {
		t.Errorf("expected %q in SQL, got: %s", expectedPG, sqlPG)
	}

	_, sqlMY, err := alter.GenerateAlterDDL("mysql", req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expectedMY := "REFERENCES `auth_db`.`auth_schema`.`users` (`id`)"
	if !strings.Contains(sqlMY, expectedMY) {
		t.Errorf("expected %q in MySQL SQL, got: %s", expectedMY, sqlMY)
	}
}
