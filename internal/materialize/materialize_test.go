package materialize_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/materialize"
)

func TestDDLBuilders(t *testing.T) {
	query := "SELECT id, name, email FROM users WHERE active = 1"

	t.Run("Create mode in SQLite", func(t *testing.T) {
		req := materialize.MaterializeRequest{
			TargetTable: "active_users",
			SourceQuery: query,
			Mode:        materialize.ModeCreate,
		}
		ddl, err := materialize.BuildDDL("sqlite", req)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expected := `CREATE TABLE "active_users" AS SELECT id, name, email FROM users WHERE active = 1;`
		if ddl != expected {
			t.Errorf("got %q, want %q", ddl, expected)
		}
	})

	t.Run("Replace mode in PostgreSQL", func(t *testing.T) {
		req := materialize.MaterializeRequest{
			TargetSchema: "analytics",
			TargetTable:  "active_users",
			SourceQuery:  query,
			Mode:         materialize.ModeReplace,
		}
		ddl, err := materialize.BuildDDL("postgres", req)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(ddl, `DROP TABLE IF EXISTS "analytics"."active_users";`) {
			t.Errorf("expected DROP TABLE in %q", ddl)
		}
		if !strings.Contains(ddl, `CREATE TABLE "analytics"."active_users" AS SELECT id, name, email FROM users WHERE active = 1;`) {
			t.Errorf("expected CREATE TABLE in %q", ddl)
		}
	})

	t.Run("Append mode in MySQL", func(t *testing.T) {
		req := materialize.MaterializeRequest{
			TargetSchema: "mydb",
			TargetTable:  "users_archive",
			SourceQuery:  query,
			Mode:         materialize.ModeAppend,
			Columns:      []string{"id", "name", "email"},
		}
		ddl, err := materialize.BuildDDL("mysql", req)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expected := "INSERT INTO `mydb`.`users_archive` (`id`, `name`, `email`) SELECT id, name, email FROM users WHERE active = 1;"
		if ddl != expected {
			t.Errorf("got %q, want %q", ddl, expected)
		}
	})

	t.Run("Temp mode in PostgreSQL and MySQL", func(t *testing.T) {
		req := materialize.MaterializeRequest{
			TargetTable: "scratch_temp",
			SourceQuery: query,
			Mode:        materialize.ModeTemp,
		}
		pgDDL, err := materialize.BuildDDL("postgres", req)
		if err != nil || !strings.HasPrefix(pgDDL, `CREATE TEMP TABLE "scratch_temp" AS`) {
			t.Errorf("expected CREATE TEMP TABLE in pg, got: %s", pgDDL)
		}

		myDDL, err := materialize.BuildDDL("mysql", req)
		if err != nil || !strings.HasPrefix(myDDL, "CREATE TEMPORARY TABLE `scratch_temp` AS") {
			t.Errorf("expected CREATE TEMPORARY TABLE in mysql, got: %s", myDDL)
		}
	})

	t.Run("View mode in PostgreSQL and SQLite", func(t *testing.T) {
		req := materialize.MaterializeRequest{
			TargetTable: "v_active_users",
			SourceQuery: query,
			Mode:        materialize.ModeView,
		}
		pgDDL, err := materialize.BuildDDL("postgres", req)
		if err != nil || !strings.HasPrefix(pgDDL, `CREATE OR REPLACE VIEW "v_active_users" AS`) {
			t.Errorf("expected CREATE OR REPLACE VIEW in pg, got: %s", pgDDL)
		}

		sqliteDDL, err := materialize.BuildDDL("sqlite", req)
		if err != nil || !strings.Contains(sqliteDDL, `DROP VIEW IF EXISTS "v_active_users";`) || !strings.Contains(sqliteDDL, `CREATE VIEW "v_active_users" AS`) {
			t.Errorf("expected DROP & CREATE VIEW in sqlite, got: %s", sqliteDDL)
		}
	})

	t.Run("Materialized view mode", func(t *testing.T) {
		req := materialize.MaterializeRequest{
			TargetTable: "mv_active_users",
			SourceQuery: query,
			Mode:        materialize.ModeMaterializedView,
		}
		pgDDL, err := materialize.BuildDDL("postgres", req)
		if err != nil || !strings.HasPrefix(pgDDL, `CREATE MATERIALIZED VIEW "mv_active_users" AS`) {
			t.Errorf("expected CREATE MATERIALIZED VIEW in pg, got: %s", pgDDL)
		}

		_, err = materialize.BuildDDL("sqlite", req)
		if err == nil {
			t.Fatalf("expected error for materialized view in sqlite, got nil")
		}
	})
}

func TestMaterializePreview(t *testing.T) {
	ctx := context.Background()
	dbFile := fmt.Sprintf("/tmp/mat_preview_%d.db", time.Now().UnixNano())
	defer os.Remove(dbFile)

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN("sqlite://" + dbFile)
	if err != nil {
		t.Fatalf("failed to init sqlite: %v", err)
	}

	t.Run("Normal preview", func(t *testing.T) {
		req := materialize.MaterializeRequest{
			TargetTable:   "t_test",
			SourceQuery:   "SELECT 1 AS val",
			Mode:          "create",
			EstimatedRows: 42,
		}
		prev, err := materialize.Preview(ctx, entry.Driver, req)
		if err != nil {
			t.Fatalf("Preview failed: %v", err)
		}
		if prev.TargetTable != "t_test" {
			t.Errorf("expected TargetTable t_test, got %s", prev.TargetTable)
		}
		if prev.EstimatedRows != 42 {
			t.Errorf("expected EstimatedRows 42, got %d", prev.EstimatedRows)
		}
		if len(prev.Warnings) != 0 {
			t.Errorf("expected 0 warnings, got %v", prev.Warnings)
		}
	})

	t.Run("Production replace warning", func(t *testing.T) {
		req := materialize.MaterializeRequest{
			TargetTable:        "prod_table",
			SourceQuery:        "SELECT 1",
			Mode:               "replace",
			IsProduction:       true,
			OverrideProduction: false,
		}
		prev, err := materialize.Preview(ctx, entry.Driver, req)
		if err != nil {
			t.Fatalf("Preview failed: %v", err)
		}
		if len(prev.Warnings) == 0 {
			t.Errorf("expected warning for production replace without override")
		}
	})
}

func TestMaterializeExecutionAndScratch(t *testing.T) {
	ctx := context.Background()
	dbFile := fmt.Sprintf("/tmp/mat_exec_%d.db", time.Now().UnixNano())
	defer os.Remove(dbFile)

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN("sqlite://" + dbFile)
	if err != nil {
		t.Fatalf("failed to init sqlite: %v", err)
	}

	// Seed source data
	_, err = entry.Driver.ExecuteRaw(ctx, "CREATE TABLE source_items (id INTEGER PRIMARY KEY, name TEXT, score INT);")
	if err != nil {
		t.Fatalf("create source table failed: %v", err)
	}
	_, err = entry.Driver.ExecuteRaw(ctx, "INSERT INTO source_items (name, score) VALUES ('Alice', 95), ('Bob', 80), ('Charlie', 60);")
	if err != nil {
		t.Fatalf("insert source table failed: %v", err)
	}

	store := materialize.NewInMemoryScratchStore()

	t.Run("Create mode same-connection", func(t *testing.T) {
		req := materialize.MaterializeRequest{
			SourceConnID: "c1",
			TargetConnID: "c1",
			TargetTable:  "top_students",
			SourceQuery:  "SELECT name, score FROM source_items WHERE score >= 80",
			Mode:         materialize.ModeCreate,
		}
		res, err := materialize.ExecuteWithStore(ctx, entry.Driver, entry.Driver, req, store)
		if err != nil {
			t.Fatalf("Execute failed: %v", err)
		}
		if !res.Success {
			t.Fatalf("expected Success=true")
		}
		if res.RowsAffected != 2 {
			t.Errorf("expected 2 rows affected, got %d", res.RowsAffected)
		}

		// Verify table actually created
		qRes, err := entry.Driver.ExecuteQuery(ctx, "SELECT COUNT(*) FROM top_students")
		if err != nil || len(qRes.Rows) == 0 {
			t.Fatalf("failed to query created table: %v", err)
		}
	})

	t.Run("Replace mode blocks on production without override", func(t *testing.T) {
		req := materialize.MaterializeRequest{
			SourceConnID:       "c1",
			TargetConnID:       "c1",
			TargetTable:        "top_students",
			SourceQuery:        "SELECT name, score FROM source_items",
			Mode:               materialize.ModeReplace,
			IsProduction:       true,
			OverrideProduction: false,
		}
		_, err := materialize.ExecuteWithStore(ctx, entry.Driver, entry.Driver, req, store)
		if err == nil {
			t.Fatalf("expected error when replacing on production without override")
		}
	})

	t.Run("Replace mode succeeds with override", func(t *testing.T) {
		req := materialize.MaterializeRequest{
			SourceConnID:       "c1",
			TargetConnID:       "c1",
			TargetTable:        "top_students",
			SourceQuery:        "SELECT name, score FROM source_items",
			Mode:               materialize.ModeReplace,
			IsProduction:       true,
			OverrideProduction: true,
		}
		res, err := materialize.ExecuteWithStore(ctx, entry.Driver, entry.Driver, req, store)
		if err != nil {
			t.Fatalf("Execute replace with override failed: %v", err)
		}
		if res.RowsAffected != 3 {
			t.Errorf("expected 3 rows affected, got %d", res.RowsAffected)
		}
	})

	t.Run("Temp scratchpad table registers with ScratchStore", func(t *testing.T) {
		req := materialize.MaterializeRequest{
			SourceConnID: "c1",
			TargetConnID: "c1",
			TargetTable:  "temp_analytics",
			SourceQuery:  "SELECT name, score FROM source_items WHERE score > 90",
			Mode:         materialize.ModeTemp,
			TTLMinutes:   30,
		}
		res, err := materialize.ExecuteWithStore(ctx, entry.Driver, entry.Driver, req, store)
		if err != nil {
			t.Fatalf("Execute temp failed: %v", err)
		}
		if res.Scratch == nil {
			t.Fatalf("expected ScratchTable in result")
		}
		if res.RowsAffected != 1 {
			t.Errorf("expected 1 row, got %d", res.RowsAffected)
		}

		// Check ScratchStore
		list := store.List("c1")
		if len(list) != 1 {
			t.Fatalf("expected 1 scratch table registered, got %d", len(list))
		}
		if list[0].Table != "temp_analytics" {
			t.Errorf("got table %s, want temp_analytics", list[0].Table)
		}

		// Test Promote
		migrationSQL, err := store.Promote("c1", "", "temp_analytics")
		if err != nil {
			t.Fatalf("Promote failed: %v", err)
		}
		if !strings.Contains(migrationSQL, "temp_analytics") {
			t.Errorf("expected migration sql to mention temp_analytics, got: %s", migrationSQL)
		}
		if len(store.List("c1")) != 0 {
			t.Errorf("expected 0 scratch tables after promotion, got %d", len(store.List("c1")))
		}
	})

	t.Run("ScratchStore Expire", func(t *testing.T) {
		// Register an already expired table
		store.Register(materialize.ScratchTable{
			ConnID:    "c1",
			Table:     "expired_table",
			ExpiresAt: time.Now().Add(-10 * time.Minute),
		})
		// Register a future table
		store.Register(materialize.ScratchTable{
			ConnID:    "c1",
			Table:     "active_table",
			ExpiresAt: time.Now().Add(60 * time.Minute),
		})

		dropped, err := store.Expire(ctx, entry.Driver)
		if err != nil {
			t.Fatalf("Expire failed: %v", err)
		}
		if dropped != 1 {
			t.Errorf("expected 1 dropped, got %d", dropped)
		}

		remaining := store.List("c1")
		if len(remaining) != 1 || remaining[0].Table != "active_table" {
			t.Errorf("expected active_table remaining, got %v", remaining)
		}

		// Delete active table
		err = store.Delete("c1", "", "active_table")
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}
		if len(store.List("c1")) != 0 {
			t.Errorf("expected 0 tables after delete")
		}
	})
}
