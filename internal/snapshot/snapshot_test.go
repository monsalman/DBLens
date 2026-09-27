package snapshot

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

func TestStoreOperations(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)

	connID := "conn-test-123"
	snapID := "snap_1001"

	snap := &SchemaSnapshot{
		ID:          snapID,
		ConnID:      connID,
		Label:       "Initial Baseline",
		Description: "Production v1 baseline",
		Dialect:     "postgres",
		CreatedAt:   time.Now().UTC().Add(-time.Hour),
		Checksum:    "abc123hash",
		TablesCount: 1,
		Tag:         "manual",
		Schemas: []SchemaNode{
			{
				Name: "public",
				Tables: []TableNode{
					{
						Name:   "users",
						Schema: "public",
						Type:   "table",
						Columns: []ColumnNode{
							{Name: "id", Type: "integer", IsPrimary: true},
							{Name: "email", Type: "text", IsNullable: false},
						},
					},
				},
			},
		},
	}

	// 1. Save
	if err := store.Save(snap); err != nil {
		t.Fatalf("failed to save snapshot: %v", err)
	}

	// Check file exists and is gzipped
	expectedFile := filepath.Join(tmpDir, connID, snapID+".json.gz")
	info, err := os.Stat(expectedFile)
	if err != nil {
		t.Fatalf("snapshot file was not created: %v", err)
	}
	if info.Size() == 0 {
		t.Fatalf("snapshot file is empty")
	}

	// 2. Get
	loaded, err := store.Get(connID, snapID)
	if err != nil {
		t.Fatalf("failed to get snapshot: %v", err)
	}
	if loaded.ID != snapID || loaded.Label != "Initial Baseline" {
		t.Fatalf("loaded snapshot mismatch: %+v", loaded)
	}
	if len(loaded.Schemas) != 1 || len(loaded.Schemas[0].Tables) != 1 {
		t.Fatalf("loaded schemas mismatch: %+v", loaded.Schemas)
	}

	// 3. Save second snapshot and List
	snap2 := &SchemaSnapshot{
		ID:        "snap_1002",
		ConnID:    connID,
		Label:     "Pre-migration Snapshot",
		Dialect:   "postgres",
		CreatedAt: time.Now().UTC(),
		Checksum:  "def456hash",
		Tag:       "pre-migration",
	}
	if err := store.Save(snap2); err != nil {
		t.Fatalf("failed to save second snapshot: %v", err)
	}

	list, err := store.List(connID)
	if err != nil {
		t.Fatalf("failed to list snapshots: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 snapshots, got %d", len(list))
	}
	// Verify sorted newest first
	if list[0].ID != "snap_1002" || list[1].ID != "snap_1001" {
		t.Fatalf("snapshots not sorted newest first: %s, %s", list[0].ID, list[1].ID)
	}

	// 4. Delete
	if err := store.Delete(connID, snapID); err != nil {
		t.Fatalf("failed to delete snapshot: %v", err)
	}
	_, err = store.Get(connID, snapID)
	if err == nil {
		t.Fatalf("expected error getting deleted snapshot, got nil")
	}

	remaining, err := store.List(connID)
	if err != nil {
		t.Fatalf("failed to list after delete: %v", err)
	}
	if len(remaining) != 1 || remaining[0].ID != "snap_1002" {
		t.Fatalf("unexpected list after delete: %+v", remaining)
	}

	// 5. Path traversal attempts: dangerous chars/traversal sanitized safely inside baseDir
	traversalSnap := &SchemaSnapshot{
		ID:        "../../evil_snap",
		ConnID:    "../../evil_conn",
		Label:     "Traversal",
		Dialect:   "postgres",
		CreatedAt: time.Now().UTC(),
	}
	if err := store.Save(traversalSnap); err != nil {
		t.Fatalf("failed to save sanitized traversal snap: %v", err)
	}
	// Verify it was stored safely under baseDir and not escaped
	evilPath := filepath.Join(tmpDir, "evil_conn", "evil_snap.json.gz")
	if _, err := os.Stat(evilPath); err != nil {
		t.Errorf("expected sanitized snapshot to exist inside baseDir at %s: %v", evilPath, err)
	}
	// Fallback to unknown when all chars stripped
	dotSnap := &SchemaSnapshot{
		ID:        "..",
		ConnID:    ".",
		Label:     "Dot Snap",
		Dialect:   "postgres",
		CreatedAt: time.Now().UTC(),
	}
	if err := store.Save(dotSnap); err != nil {
		t.Fatalf("failed to save dot snap with unknown fallback: %v", err)
	}
	dotPath := filepath.Join(tmpDir, "unknown", "unknown.json.gz")
	if _, err := os.Stat(dotPath); err != nil {
		t.Errorf("expected unknown fallback snapshot to exist inside baseDir at %s: %v", dotPath, err)
	}
}

func TestDiffer(t *testing.T) {
	base := &SchemaSnapshot{
		ID:      "base_1",
		Label:   "Base",
		Dialect: "postgres",
		Schemas: []SchemaNode{
			{
				Name: "public",
				Tables: []TableNode{
					{
						Name:   "users",
						Schema: "public",
						Columns: []ColumnNode{
							{Name: "id", Type: "bigint", IsPrimary: true},
							{Name: "email", Type: "varchar(255)", IsNullable: false},
						},
						Indexes: []IndexNode{
							{Name: "idx_users_email", Columns: []string{"email"}, IsUnique: true},
						},
					},
					{
						Name:   "legacy_logs",
						Schema: "public",
						Columns: []ColumnNode{
							{Name: "id", Type: "bigint", IsPrimary: true},
						},
					},
				},
			},
		},
	}

	target := &SchemaSnapshot{
		ID:      "target_1",
		Label:   "Target",
		Dialect: "postgres",
		Schemas: []SchemaNode{
			{
				Name: "public",
				Tables: []TableNode{
					{
						Name:   "users",
						Schema: "public",
						Columns: []ColumnNode{
							{Name: "id", Type: "bigint", IsPrimary: true},
							{Name: "email", Type: "varchar(320)", IsNullable: false}, // Altered type
							{Name: "role", Type: "varchar(50)", IsNullable: true},    // Added col
						},
						Indexes: []IndexNode{
							{Name: "idx_users_role", Columns: []string{"role"}}, // Added index
						},
					},
					{
						Name:   "orders", // Added table
						Schema: "public",
						Columns: []ColumnNode{
							{Name: "id", Type: "bigint", IsPrimary: true},
							{Name: "user_id", Type: "bigint", IsNullable: false},
						},
					},
				},
			},
		},
	}

	diff := Diff(base, target)

	if diff.Summary.AddedTables != 1 || len(diff.AddedTables) != 1 || diff.AddedTables[0].Name != "orders" {
		t.Fatalf("expected 1 added table 'orders', got %+v", diff.AddedTables)
	}

	if diff.Summary.DroppedTables != 1 || len(diff.DroppedTables) != 1 || diff.DroppedTables[0].Name != "legacy_logs" {
		t.Fatalf("expected 1 dropped table 'legacy_logs', got %+v", diff.DroppedTables)
	}

	if diff.Summary.AlteredTables != 1 || len(diff.AlteredTables) != 1 {
		t.Fatalf("expected 1 altered table, got %+v", diff.AlteredTables)
	}

	at := diff.AlteredTables[0]
	if at.TableName != "users" {
		t.Fatalf("expected altered table users, got %s", at.TableName)
	}
	if len(at.AddedColumns) != 1 || at.AddedColumns[0].Name != "role" {
		t.Fatalf("expected added column role, got %+v", at.AddedColumns)
	}
	if len(at.AlteredColumns) != 1 || at.AlteredColumns[0].ColumnName != "email" {
		t.Fatalf("expected altered column email, got %+v", at.AlteredColumns)
	}
	if len(at.AddedIndexes) != 1 || at.AddedIndexes[0].Name != "idx_users_role" {
		t.Fatalf("expected added index idx_users_role, got %+v", at.AddedIndexes)
	}
	if len(at.DroppedIndexes) != 1 || at.DroppedIndexes[0].Name != "idx_users_email" {
		t.Fatalf("expected dropped index idx_users_email, got %+v", at.DroppedIndexes)
	}

	if diff.TotalDrifts <= 0 {
		t.Fatalf("expected TotalDrifts > 0, got %d", diff.TotalDrifts)
	}
}

func TestRollbackPlanGeneration(t *testing.T) {
	diff := &SnapshotDiff{
		BaseSnapshotID:   "snap_base",
		TargetSnapshotID: "snap_target",
		Dialect:          "postgres",
		AddedTables: []TableNode{
			{
				Name:   "audit_events",
				Schema: "public",
				Columns: []ColumnNode{
					{Name: "id", Type: "bigint", IsPrimary: true},
					{Name: "event", Type: "text", IsNullable: false},
				},
			},
		},
		DroppedTables: []TableNode{
			{
				Name:   "old_cache",
				Schema: "public",
				Columns: []ColumnNode{
					{Name: "key", Type: "text", IsPrimary: true},
				},
			},
		},
		AlteredTables: []TableDrift{
			{
				TableName: "accounts",
				Schema:    "public",
				AddedColumns: []ColumnNode{
					{Name: "mfa_enabled", Type: "boolean", IsNullable: false},
				},
				DroppedColumns: []ColumnNode{
					{Name: "deprecated_pin", Type: "varchar(10)", IsNullable: true},
				},
			},
		},
	}

	plan := GenerateRollbackPlan(diff)

	// UpSQL should create audit_events, drop old_cache, add mfa_enabled, drop deprecated_pin
	if !strings.Contains(plan.UpSQL, "CREATE TABLE \"audit_events\"") {
		t.Errorf("UpSQL missing CREATE TABLE audit_events: %s", plan.UpSQL)
	}
	if !strings.Contains(plan.UpSQL, "DROP TABLE \"old_cache\"") {
		t.Errorf("UpSQL missing DROP TABLE old_cache: %s", plan.UpSQL)
	}
	if !strings.Contains(plan.UpSQL, "ADD COLUMN \"mfa_enabled\"") {
		t.Errorf("UpSQL missing ADD COLUMN mfa_enabled: %s", plan.UpSQL)
	}
	if !strings.Contains(plan.UpSQL, "DROP COLUMN \"deprecated_pin\"") {
		t.Errorf("UpSQL missing DROP COLUMN deprecated_pin: %s", plan.UpSQL)
	}

	// DownSQL (rollback) should drop audit_events, recreate old_cache, drop mfa_enabled, re-add deprecated_pin
	if !strings.Contains(plan.DownSQL, "DROP TABLE \"audit_events\"") {
		t.Errorf("DownSQL missing DROP TABLE audit_events: %s", plan.DownSQL)
	}
	if !strings.Contains(plan.DownSQL, "CREATE TABLE \"old_cache\"") {
		t.Errorf("DownSQL missing CREATE TABLE old_cache: %s", plan.DownSQL)
	}
	if !strings.Contains(plan.DownSQL, "DROP COLUMN \"mfa_enabled\"") {
		t.Errorf("DownSQL missing DROP COLUMN mfa_enabled: %s", plan.DownSQL)
	}
	if !strings.Contains(plan.DownSQL, "ADD COLUMN \"deprecated_pin\"") {
		t.Errorf("DownSQL missing ADD COLUMN deprecated_pin: %s", plan.DownSQL)
	}

	// Warnings & Destructive
	if !plan.Destructive {
		t.Errorf("expected plan.Destructive to be true")
	}
	if len(plan.Warnings) == 0 {
		t.Errorf("expected warnings for destructive changes")
	}

	// Test MySQL dialect
	diff.Dialect = "mysql"
	mysqlPlan := GenerateRollbackPlan(diff)
	if !strings.Contains(mysqlPlan.UpSQL, "`audit_events`") {
		t.Errorf("MySQL UpSQL missing backtick quotes: %s", mysqlPlan.UpSQL)
	}

	// Test SQLite dialect
	diff.Dialect = "sqlite"
	sqlitePlan := GenerateRollbackPlan(diff)
	if !strings.Contains(sqlitePlan.UpSQL, "\"audit_events\"") {
		t.Errorf("SQLite UpSQL missing quotes: %s", sqlitePlan.UpSQL)
	}

	// Test FK Action Whitelist & Injection Validation
	diffFK := &SnapshotDiff{
		Dialect: "postgres",
		AlteredTables: []TableDrift{
			{
				TableName: "orders",
				Schema:    "public",
				AddedForeignKeys: []ForeignKeyNode{
					{
						Name:      "fk_user_valid",
						Column:    "user_id",
						RefTable:  "users",
						RefColumn: "id",
						OnDelete:  "CASCADE",
						OnUpdate:  "SET NULL",
					},
					{
						Name:      "fk_user_malicious",
						Column:    "tenant_id",
						RefTable:  "tenants",
						RefColumn: "id",
						OnDelete:  "CASCADE; DROP TABLE orders;--",
						OnUpdate:  "INVALID_ACTION",
					},
				},
			},
		},
	}
	planFK := GenerateRollbackPlan(diffFK)
	if !strings.Contains(planFK.UpSQL, "ON DELETE CASCADE ON UPDATE SET NULL") {
		t.Errorf("expected valid FK actions to be included: %s", planFK.UpSQL)
	}
	if strings.Contains(planFK.UpSQL, "DROP TABLE orders") || strings.Contains(planFK.UpSQL, "INVALID_ACTION") {
		t.Errorf("expected invalid/malicious FK action to be stripped: %s", planFK.UpSQL)
	}
}

func TestCaptureSnapshot(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "timeline_test.db")
	drv, err := sqlite.New(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite driver: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()
	_, err = drv.ExecuteQuery(ctx, `CREATE TABLE customers (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		email TEXT
	)`)
	if err != nil {
		t.Fatalf("failed to create table: %v", err)
	}

	_, err = drv.ExecuteQuery(ctx, `CREATE INDEX idx_customers_email ON customers(email)`)
	if err != nil {
		t.Fatalf("failed to create index: %v", err)
	}

	snap, err := CaptureSnapshot(ctx, drv, "sqlite_conn_1", "Test Capture", "manual", "First capture", "")
	if err != nil {
		t.Fatalf("CaptureSnapshot failed: %v", err)
	}

	if snap == nil {
		t.Fatalf("snapshot is nil")
	}
	if snap.ConnID != "sqlite_conn_1" {
		t.Errorf("expected connId 'sqlite_conn_1', got %s", snap.ConnID)
	}
	if snap.Label != "Test Capture" {
		t.Errorf("expected label 'Test Capture', got %s", snap.Label)
	}
	if snap.TablesCount != 1 {
		t.Errorf("expected 1 table, got %d", snap.TablesCount)
	}
	if snap.Checksum == "" {
		t.Errorf("expected non-empty checksum")
	}
	if len(snap.Schemas) == 0 || len(snap.Schemas[0].Tables) != 1 {
		t.Fatalf("unexpected schemas structure: %+v", snap.Schemas)
	}

	tbl := snap.Schemas[0].Tables[0]
	if tbl.Name != "customers" {
		t.Errorf("expected table customers, got %s", tbl.Name)
	}
	if len(tbl.Columns) != 3 {
		t.Errorf("expected 3 columns, got %d", len(tbl.Columns))
	}
	hasIdx := false
	for _, idx := range tbl.Indexes {
		if idx.Name == "idx_customers_email" {
			hasIdx = true
		}
	}
	if !hasIdx {
		t.Errorf("expected idx_customers_email index to be present in %+v", tbl.Indexes)
	}
}
