package routine_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/routine"
)

func TestBuildInvokeStatement(t *testing.T) {
	tests := []struct {
		name        string
		dialect     string
		schema      string
		rName       string
		rType       string
		argCount    int
		wantSQL     string
		expectError bool
	}{
		{
			name:     "Postgres Procedure with args",
			dialect:  "postgres",
			schema:   "public",
			rName:    "process_orders",
			rType:    "PROCEDURE",
			argCount: 2,
			wantSQL:  `CALL "public"."process_orders"($1, $2);`,
		},
		{
			name:     "Postgres Procedure no args",
			dialect:  "postgresql",
			schema:   "public",
			rName:    "cleanup",
			rType:    "PROCEDURE",
			argCount: 0,
			wantSQL:  `CALL "public"."cleanup"();`,
		},
		{
			name:     "Postgres Function with args",
			dialect:  "postgres",
			schema:   "public",
			rName:    "calculate_tax",
			rType:    "FUNCTION",
			argCount: 3,
			wantSQL:  `SELECT * FROM "public"."calculate_tax"($1, $2, $3);`,
		},
		{
			name:     "MySQL Procedure with args",
			dialect:  "mysql",
			schema:   "ecommerce",
			rName:    "sp_update_inventory",
			rType:    "PROCEDURE",
			argCount: 2,
			wantSQL:  "CALL `ecommerce`.`sp_update_inventory`(?, ?);",
		},
		{
			name:     "MySQL Function with args",
			dialect:  "mysql",
			schema:   "ecommerce",
			rName:    "fn_get_discount",
			rType:    "FUNCTION",
			argCount: 1,
			wantSQL:  "SELECT `ecommerce`.`fn_get_discount`(?) AS result;",
		},
		{
			name:     "SQLite Function",
			dialect:  "sqlite",
			schema:   "",
			rName:    "custom_hash",
			rType:    "FUNCTION",
			argCount: 1,
			wantSQL:  `SELECT "custom_hash"(?) AS result;`,
		},
		{
			name:        "SQLite Procedure Error",
			dialect:     "sqlite",
			schema:      "",
			rName:       "bad_proc",
			rType:       "PROCEDURE",
			argCount:    1,
			expectError: true,
		},
		{
			name:        "Empty routine name",
			dialect:     "postgres",
			schema:      "public",
			rName:       "",
			rType:       "FUNCTION",
			argCount:    0,
			expectError: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := routine.BuildInvokeStatement(tc.dialect, tc.schema, tc.rName, tc.rType, tc.argCount)
			if tc.expectError {
				if err == nil {
					t.Fatalf("expected error, got nil with query: %s", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.wantSQL {
				t.Errorf("got %q, want %q", got, tc.wantSQL)
			}
		})
	}
}

func TestBuildTriggerToggleStatement(t *testing.T) {
	tests := []struct {
		name        string
		dialect     string
		schema      string
		table       string
		trgName     string
		enabled     bool
		wantSQL     string
		expectError bool
	}{
		{
			name:     "Postgres enable trigger",
			dialect:  "postgres",
			schema:   "public",
			table:    "orders",
			trgName:  "trg_orders_audit",
			enabled:  true,
			wantSQL:  `ALTER TABLE "public"."orders" ENABLE TRIGGER "trg_orders_audit";`,
		},
		{
			name:     "Postgres disable trigger",
			dialect:  "postgres",
			schema:   "public",
			table:    "orders",
			trgName:  "trg_orders_audit",
			enabled:  false,
			wantSQL:  `ALTER TABLE "public"."orders" DISABLE TRIGGER "trg_orders_audit";`,
		},
		{
			name:        "MySQL toggle unsupported",
			dialect:     "mysql",
			schema:      "db",
			table:       "orders",
			trgName:     "trg_orders",
			enabled:     true,
			expectError: true,
		},
		{
			name:        "SQLite toggle unsupported",
			dialect:     "sqlite",
			schema:      "main",
			table:       "orders",
			trgName:     "trg_orders",
			enabled:     false,
			expectError: true,
		},
		{
			name:        "Missing table name",
			dialect:     "postgres",
			schema:      "public",
			table:       "",
			trgName:     "trg_orders",
			enabled:     true,
			expectError: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := routine.BuildTriggerToggleStatement(tc.dialect, tc.schema, tc.table, tc.trgName, tc.enabled)
			if tc.expectError {
				if err == nil {
					t.Fatalf("expected error, got nil with query: %s", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.wantSQL {
				t.Errorf("got %q, want %q", got, tc.wantSQL)
			}
		})
	}
}

func TestBuildTriggerDropStatement(t *testing.T) {
	tests := []struct {
		name        string
		dialect     string
		schema      string
		table       string
		trgName     string
		wantSQL     string
		expectError bool
	}{
		{
			name:    "Postgres drop trigger",
			dialect: "postgres",
			schema:  "public",
			table:   "users",
			trgName: "trg_log_user",
			wantSQL: `DROP TRIGGER IF EXISTS "trg_log_user" ON "public"."users";`,
		},
		{
			name:    "MySQL drop trigger",
			dialect: "mysql",
			schema:  "app_db",
			table:   "users",
			trgName: "trg_log_user",
			wantSQL: "DROP TRIGGER IF EXISTS `app_db`.`trg_log_user`;",
		},
		{
			name:    "SQLite drop trigger",
			dialect: "sqlite",
			schema:  "main",
			table:   "users",
			trgName: "trg_log_user",
			wantSQL: `DROP TRIGGER IF EXISTS "trg_log_user";`,
		},
		{
			name:        "Empty trigger name",
			dialect:     "postgres",
			schema:      "public",
			table:       "users",
			trgName:     "",
			expectError: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := routine.BuildTriggerDropStatement(tc.dialect, tc.schema, tc.table, tc.trgName)
			if tc.expectError {
				if err == nil {
					t.Fatalf("expected error, got nil: %s", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.wantSQL {
				t.Errorf("got %q, want %q", got, tc.wantSQL)
			}
		})
	}
}

func TestBuildViewRefreshStatement(t *testing.T) {
	tests := []struct {
		name         string
		dialect      string
		schema       string
		viewName     string
		concurrently bool
		wantSQL      string
		expectError  bool
	}{
		{
			name:         "Postgres regular refresh",
			dialect:      "postgres",
			schema:       "public",
			viewName:     "mv_daily_sales",
			concurrently: false,
			wantSQL:      `REFRESH MATERIALIZED VIEW "public"."mv_daily_sales";`,
		},
		{
			name:         "Postgres concurrent refresh",
			dialect:      "postgres",
			schema:       "analytics",
			viewName:     "mv_user_stats",
			concurrently: true,
			wantSQL:      `REFRESH MATERIALIZED VIEW CONCURRENTLY "analytics"."mv_user_stats";`,
		},
		{
			name:         "MySQL view refresh unsupported",
			dialect:      "mysql",
			schema:       "db",
			viewName:     "v_users",
			concurrently: false,
			expectError:  true,
		},
		{
			name:         "SQLite view refresh unsupported",
			dialect:      "sqlite",
			schema:       "main",
			viewName:     "v_users",
			concurrently: false,
			expectError:  true,
		},
		{
			name:         "Empty view name",
			dialect:      "postgres",
			schema:       "public",
			viewName:     "",
			concurrently: false,
			expectError:  true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := routine.BuildViewRefreshStatement(tc.dialect, tc.schema, tc.viewName, tc.concurrently)
			if tc.expectError {
				if err == nil {
					t.Fatalf("expected error, got nil: %s", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.wantSQL {
				t.Errorf("got %q, want %q", got, tc.wantSQL)
			}
		})
	}
}

func TestBuildRoutineDropStatement(t *testing.T) {
	tests := []struct {
		name        string
		dialect     string
		schema      string
		rName       string
		rType       string
		wantSQL     string
		expectError bool
	}{
		{
			name:    "Postgres drop procedure",
			dialect: "postgres",
			schema:  "public",
			rName:   "clean_cache",
			rType:   "PROCEDURE",
			wantSQL: `DROP PROCEDURE IF EXISTS "public"."clean_cache";`,
		},
		{
			name:    "Postgres drop function",
			dialect: "postgres",
			schema:  "public",
			rName:   "calc_discount",
			rType:   "FUNCTION",
			wantSQL: `DROP FUNCTION IF EXISTS "public"."calc_discount";`,
		},
		{
			name:    "MySQL drop procedure",
			dialect: "mysql",
			schema:  "store",
			rName:   "pr_order",
			rType:   "PROCEDURE",
			wantSQL: "DROP PROCEDURE IF EXISTS `store`.`pr_order`;",
		},
		{
			name:        "SQLite drop routine unsupported",
			dialect:     "sqlite",
			schema:      "",
			rName:       "fn_test",
			rType:       "FUNCTION",
			expectError: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := routine.BuildRoutineDropStatement(tc.dialect, tc.schema, tc.rName, tc.rType)
			if tc.expectError {
				if err == nil {
					t.Fatalf("expected error, got nil: %s", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.wantSQL {
				t.Errorf("got %q, want %q", got, tc.wantSQL)
			}
		})
	}
}

func TestParsePostgresArguments(t *testing.T) {
	input := "IN a integer, OUT b text, INOUT c numeric(10, 2) DEFAULT 0, d varchar(100)"
	args := routine.ParsePostgresArguments(input)

	if len(args) != 4 {
		t.Fatalf("expected 4 args, got %d", len(args))
	}

	if args[0].Name != "a" || args[0].Type != "integer" || args[0].Mode != "IN" || args[0].OrdinalPosition != 1 {
		t.Errorf("unexpected arg 0: %+v", args[0])
	}
	if args[1].Name != "b" || args[1].Type != "text" || args[1].Mode != "OUT" || args[1].OrdinalPosition != 2 {
		t.Errorf("unexpected arg 1: %+v", args[1])
	}
	if args[2].Name != "c" || args[2].Type != "numeric(10, 2)" || args[2].Mode != "INOUT" || args[2].DefaultValue != "0" {
		t.Errorf("unexpected arg 2: %+v", args[2])
	}
	if args[3].Name != "d" || args[3].Type != "varchar(100)" || args[3].Mode != "IN" {
		t.Errorf("unexpected arg 3: %+v", args[3])
	}
}

func TestSQLiteIntegration(t *testing.T) {
	dbFile := fmt.Sprintf("/tmp/dblens_routine_test_%d.db", time.Now().UnixNano())
	defer os.Remove(dbFile)

	dsn := "sqlite://" + dbFile
	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to connect sqlite: %v", err)
	}
	defer entry.Driver.Close()

	ctx := context.Background()

	// 1. Create table, trigger, and view
	stmts := []string{
		"CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price REAL);",
		"CREATE TABLE item_audit (id INTEGER PRIMARY KEY, action TEXT, item_id INT, ts DATETIME);",
		"CREATE TRIGGER trg_item_insert AFTER INSERT ON items BEGIN INSERT INTO item_audit(action, item_id, ts) VALUES ('INSERT', NEW.id, datetime('now')); END;",
		"CREATE VIEW v_expensive_items AS SELECT * FROM items WHERE price > 100;",
	}
	for _, stmt := range stmts {
		if _, err := entry.Driver.ExecuteRaw(ctx, stmt); err != nil {
			t.Fatalf("failed setup stmt %q: %v", stmt, err)
		}
	}

	// 2. Inspect Triggers
	triggers, err := routine.InspectTriggers(ctx, entry.Driver, "", "")
	if err != nil {
		t.Fatalf("InspectTriggers failed: %v", err)
	}
	if len(triggers) != 1 {
		t.Fatalf("expected 1 trigger, got %d", len(triggers))
	}
	if triggers[0].Name != "trg_item_insert" {
		t.Errorf("expected trigger name trg_item_insert, got %s", triggers[0].Name)
	}
	if triggers[0].Timing != "AFTER" {
		t.Errorf("expected AFTER timing, got %s", triggers[0].Timing)
	}
	if triggers[0].Event != "INSERT" {
		t.Errorf("expected INSERT event, got %s", triggers[0].Event)
	}

	// 3. Inspect Views
	views, err := routine.InspectViews(ctx, entry.Driver, "")
	if err != nil {
		t.Fatalf("InspectViews failed: %v", err)
	}
	if len(views) != 1 {
		t.Fatalf("expected 1 view, got %d", len(views))
	}
	if views[0].Name != "v_expensive_items" {
		t.Errorf("expected view name v_expensive_items, got %s", views[0].Name)
	}
	if views[0].IsMaterialized {
		t.Errorf("sqlite views should not be materialized")
	}

	// 4. Invoke builtin scalar function
	invResp, err := routine.InvokeRoutine(ctx, entry.Driver, routine.InvokeRoutineRequest{
		Name:        "abs",
		RoutineType: "FUNCTION",
		Parameters:  []interface{}{-42},
	})
	if err != nil {
		t.Fatalf("InvokeRoutine failed: %v", err)
	}
	if len(invResp.Rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(invResp.Rows))
	}

	// 5. Delete Trigger
	if err := routine.DeleteTrigger(ctx, entry.Driver, "main", "items", "trg_item_insert"); err != nil {
		t.Fatalf("DeleteTrigger failed: %v", err)
	}

	afterTriggers, err := routine.InspectTriggers(ctx, entry.Driver, "", "")
	if err != nil {
		t.Fatalf("InspectTriggers after delete failed: %v", err)
	}
	if len(afterTriggers) != 0 {
		t.Fatalf("expected 0 triggers after delete, got %d", len(afterTriggers))
	}
}
