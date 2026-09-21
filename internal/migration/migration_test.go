package migration_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/driver/sqlite"
	"github.com/dblens/dblens/internal/migration"
)

func TestSanitizeSlug(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Add users table", "add_users_table"},
		{"Create_Posts_Table!", "create_posts_table"},
		{"  --Drop Old Index--  ", "drop_old_index"},
		{"", "migration"},
		{"!@#$%^", "migration"},
	}

	for _, tc := range tests {
		got := migration.SanitizeSlug(tc.input)
		if got != tc.expected {
			t.Errorf("SanitizeSlug(%q) = %q; want %q", tc.input, got, tc.expected)
		}
	}
}

func TestSanitizeVersion(t *testing.T) {
	v := migration.SanitizeVersion("20260922120000")
	if v != "20260922120000" {
		t.Fatalf("expected version preserved, got %s", v)
	}

	autoV := migration.SanitizeVersion("")
	if len(autoV) != 14 {
		t.Fatalf("expected 14-char timestamp version, got %s", autoV)
	}
}

func TestCalculateChecksum(t *testing.T) {
	sql1 := "CREATE TABLE test (id INT);"
	sql2 := "  CREATE TABLE test (id INT);  \n"
	sql3 := "CREATE TABLE test (id BIGINT);"

	c1 := migration.CalculateChecksum(sql1)
	c2 := migration.CalculateChecksum(sql2)
	c3 := migration.CalculateChecksum(sql3)

	if c1 != c2 {
		t.Errorf("expected matching checksums for trimmed SQL, got %s vs %s", c1, c2)
	}
	if c1 == c3 {
		t.Errorf("expected different checksums for different SQL, got same %s", c1)
	}
	if len(c1) != 64 {
		t.Errorf("expected 64 hex character sha256 checksum, got length %d", len(c1))
	}
}

func TestTrackerTableDDL(t *testing.T) {
	pgDDL := migration.TrackerTableDDL("postgres")
	if !strings.Contains(pgDDL, "BIGSERIAL PRIMARY KEY") || !strings.Contains(pgDDL, "TIMESTAMPTZ") {
		t.Errorf("unexpected Postgres DDL: %s", pgDDL)
	}

	myDDL := migration.TrackerTableDDL("mysql")
	if !strings.Contains(myDDL, "BIGINT AUTO_INCREMENT PRIMARY KEY") || !strings.Contains(myDDL, "DATETIME") {
		t.Errorf("unexpected MySQL DDL: %s", myDDL)
	}

	sqDDL := migration.TrackerTableDDL("sqlite")
	if !strings.Contains(sqDDL, "INTEGER PRIMARY KEY AUTOINCREMENT") {
		t.Errorf("unexpected SQLite DDL: %s", sqDDL)
	}
}

func TestGenerateBundleFormats(t *testing.T) {
	req := migration.GenerateMigrationRequest{
		Name:    "Create Users Table",
		UpSQL:   "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);",
		DownSQL: "DROP TABLE users;",
		Version: "20260922120000",
	}

	// 1. golang-migrate
	req.Format = migration.FormatGolangMigrate
	b1, err := migration.GenerateBundle(req)
	if err != nil {
		t.Fatalf("golang-migrate generate failed: %v", err)
	}
	if len(b1.Files) != 2 {
		t.Fatalf("expected 2 files for golang-migrate, got %d", len(b1.Files))
	}
	if b1.Files[0].FileName != "20260922120000_create_users_table.up.sql" {
		t.Errorf("unexpected up filename: %s", b1.Files[0].FileName)
	}
	if b1.Files[1].FileName != "20260922120000_create_users_table.down.sql" {
		t.Errorf("unexpected down filename: %s", b1.Files[1].FileName)
	}
	if !strings.Contains(b1.Files[0].Content, req.UpSQL) {
		t.Errorf("up file missing up SQL")
	}

	// 2. goose
	req.Format = migration.FormatGoose
	b2, err := migration.GenerateBundle(req)
	if err != nil {
		t.Fatalf("goose generate failed: %v", err)
	}
	if len(b2.Files) != 1 {
		t.Fatalf("expected 1 file for goose, got %d", len(b2.Files))
	}
	if b2.Files[0].FileName != "20260922120000_create_users_table.sql" {
		t.Errorf("unexpected goose filename: %s", b2.Files[0].FileName)
	}
	if !strings.Contains(b2.Files[0].Content, "-- +goose Up") || !strings.Contains(b2.Files[0].Content, "-- +goose Down") {
		t.Errorf("goose file missing markers: %s", b2.Files[0].Content)
	}

	// 3. flyway
	req.Format = migration.FormatFlyway
	b3, err := migration.GenerateBundle(req)
	if err != nil {
		t.Fatalf("flyway generate failed: %v", err)
	}
	if len(b3.Files) != 2 {
		t.Fatalf("expected 2 files for flyway, got %d", len(b3.Files))
	}
	if b3.Files[0].FileName != "V20260922120000__create_users_table.sql" {
		t.Errorf("unexpected flyway version file: %s", b3.Files[0].FileName)
	}
	if b3.Files[1].FileName != "U20260922120000__create_users_table.sql" {
		t.Errorf("unexpected flyway undo file: %s", b3.Files[1].FileName)
	}

	// 4. dbmate
	req.Format = migration.FormatDbmate
	b4, err := migration.GenerateBundle(req)
	if err != nil {
		t.Fatalf("dbmate generate failed: %v", err)
	}
	if len(b4.Files) != 1 {
		t.Fatalf("expected 1 file for dbmate, got %d", len(b4.Files))
	}
	if !strings.Contains(b4.Files[0].Content, "-- migrate:up") || !strings.Contains(b4.Files[0].Content, "-- migrate:down") {
		t.Errorf("dbmate file missing markers: %s", b4.Files[0].Content)
	}

	// 5. prisma
	req.Format = migration.FormatPrisma
	b5, err := migration.GenerateBundle(req)
	if err != nil {
		t.Fatalf("prisma generate failed: %v", err)
	}
	if len(b5.Files) != 1 || b5.Files[0].FileName != "migration.sql" {
		t.Fatalf("unexpected prisma file: %+v", b5.Files)
	}
}

func TestMigrationTrackerLifecycle(t *testing.T) {
	dbFile := fmt.Sprintf("/tmp/dblens_migration_test_%d.db", time.Now().UnixNano())
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	drv, err := sqlite.New("sqlite://" + dbFile)
	if err != nil {
		t.Fatalf("failed to create sqlite driver: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()

	// Initial check: not initialized
	init, err := migration.IsTrackerInitialized(ctx, drv)
	if err != nil {
		t.Fatalf("unexpected error checking initialization: %v", err)
	}
	if init {
		t.Fatalf("expected tracker to not be initialized initially")
	}

	// List when not initialized should return empty without error
	list, err := migration.List(ctx, drv)
	if err != nil || len(list) != 0 {
		t.Fatalf("expected empty list, got err=%v, count=%d", err, len(list))
	}

	// Initialize tracker table
	err = migration.EnsureTrackerTable(ctx, drv)
	if err != nil {
		t.Fatalf("EnsureTrackerTable failed: %v", err)
	}

	init, err = migration.IsTrackerInitialized(ctx, drv)
	if err != nil || !init {
		t.Fatalf("expected tracker initialized, got init=%v, err=%v", init, err)
	}

	// Apply migration 1
	rec1, err := migration.Apply(ctx, drv, migration.ApplyMigrationRequest{
		Version: "20260922000001",
		Name:    "create_accounts",
		UpSQL:   "CREATE TABLE accounts (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE);",
		DownSQL: "DROP TABLE accounts;",
	})
	if err != nil {
		t.Fatalf("failed to apply migration 1: %v", err)
	}
	if rec1.Version != "20260922000001" || rec1.Name != "create_accounts" {
		t.Errorf("unexpected record 1: %+v", rec1)
	}

	// Apply migration 2
	rec2, err := migration.Apply(ctx, drv, migration.ApplyMigrationRequest{
		Version: "20260922000002",
		Name:    "create_transfers",
		UpSQL:   "CREATE TABLE transfers (id INTEGER PRIMARY KEY, account_id INTEGER, amount REAL);",
		DownSQL: "DROP TABLE transfers;",
	})
	if err != nil {
		t.Fatalf("failed to apply migration 2: %v", err)
	}
	if rec2.Version != "20260922000002" {
		t.Errorf("unexpected record 2 version: %s", rec2.Version)
	}

	// Prevent duplicate application
	_, err = migration.Apply(ctx, drv, migration.ApplyMigrationRequest{
		Version: "20260922000001",
		Name:    "duplicate",
		UpSQL:   "SELECT 1;",
		DownSQL: "",
	})
	if err == nil || !strings.Contains(err.Error(), "already been applied") {
		t.Fatalf("expected error on duplicate version, got %v", err)
	}

	// List applied migrations
	all, err := migration.List(ctx, drv)
	if err != nil {
		t.Fatalf("failed to list migrations: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("expected 2 migrations, got %d", len(all))
	}
	if all[0].Version != "20260922000001" || all[1].Version != "20260922000002" {
		t.Errorf("unexpected versions in list: %s, %s", all[0].Version, all[1].Version)
	}

	// Rollback latest migration (migration 2)
	rolled, err := migration.Rollback(ctx, drv, "")
	if err != nil {
		t.Fatalf("failed to rollback latest migration: %v", err)
	}
	if rolled.Version != "20260922000002" {
		t.Errorf("expected rolled back migration 2, got %s", rolled.Version)
	}

	// Verify transfers table was dropped by DownSQL
	_, err = drv.ExecuteQuery(ctx, "SELECT * FROM transfers;")
	if err == nil {
		t.Errorf("transfers table should have been dropped by rollback")
	}

	// List after rollback should have only migration 1
	remaining, err := migration.List(ctx, drv)
	if err != nil || len(remaining) != 1 {
		t.Fatalf("expected 1 remaining migration, got %d (err=%v)", len(remaining), err)
	}
	if remaining[0].Version != "20260922000001" {
		t.Errorf("expected remaining migration 1, got %s", remaining[0].Version)
	}

	// Rollback migration 1 by explicit version
	rolled1, err := migration.Rollback(ctx, drv, "20260922000001")
	if err != nil {
		t.Fatalf("failed to rollback migration 1: %v", err)
	}
	if rolled1.Version != "20260922000001" {
		t.Errorf("expected rolled back migration 1, got %s", rolled1.Version)
	}

	// Verify accounts table dropped
	_, err = drv.ExecuteQuery(ctx, "SELECT * FROM accounts;")
	if err == nil {
		t.Errorf("accounts table should have been dropped by rollback")
	}

	// Empty rollback attempt
	_, err = migration.Rollback(ctx, drv, "")
	if err == nil || !strings.Contains(err.Error(), "no applied migrations") {
		t.Fatalf("expected error on empty rollback, got %v", err)
	}
}
