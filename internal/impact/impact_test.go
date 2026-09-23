package impact_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/impact"
)

func TestTextualReferenceScanner(t *testing.T) {
	t.Run("Mask comments and literals", func(t *testing.T) {
		sql := `
-- single line comment with table users
/* multi-line comment referencing users
and columns */
SELECT id, 'this is a string literal containing users and email' AS note
FROM accounts
WHERE note = 'users';
`
		masked := impact.MaskCommentsAndLiterals(sql)
		if strings.Contains(masked, "--") || strings.Contains(masked, "/*") {
			t.Errorf("expected comments masked, got: %s", masked)
		}
		if strings.Contains(masked, "string literal containing users") {
			t.Errorf("expected string literal masked, got: %s", masked)
		}
		if !strings.Contains(masked, "accounts") {
			t.Errorf("expected accounts preserved, got: %s", masked)
		}
	})

	t.Run("Textual reference detection for tables", func(t *testing.T) {
		sqlWithRef := "SELECT c.id, c.name FROM customers c JOIN orders o ON o.customer_id = c.id"
		if !impact.TextualReferenceMatches(sqlWithRef, "customers", "") {
			t.Errorf("expected customers match in SQL")
		}
		if !impact.TextualReferenceMatches(sqlWithRef, "orders", "") {
			t.Errorf("expected orders match in SQL")
		}
		if impact.TextualReferenceMatches(sqlWithRef, "products", "") {
			t.Errorf("did not expect products match in SQL")
		}
		// Match inside comments should not trigger
		sqlWithCommentOnly := "SELECT 1; -- customers table mention"
		if impact.TextualReferenceMatches(sqlWithCommentOnly, "customers", "") {
			t.Errorf("did not expect match inside comment")
		}
	})

	t.Run("Textual reference detection for columns", func(t *testing.T) {
		sql := "SELECT id, email, created_at FROM users WHERE status = 'active'"
		if !impact.TextualReferenceMatches(sql, "users", "email") {
			t.Errorf("expected email column match in users query")
		}
		if impact.TextualReferenceMatches(sql, "users", "phone_number") {
			t.Errorf("did not expect phone_number column match")
		}
	})
}

func setupTestDB(t *testing.T) (string, func()) {
	dbFile := fmt.Sprintf("/tmp/dblens_impact_test_%d.db", time.Now().UnixNano())
	cleanup := func() {
		_ = os.Remove(dbFile)
	}
	return "sqlite://" + dbFile, cleanup
}

func TestImpactAnalyzerAndPlanner(t *testing.T) {
	dsn, cleanup := setupTestDB(t)
	defer cleanup()

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to init test db: %v", err)
	}

	ctx := context.Background()
	schemaSQL := []string{
		"CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT);",
		"CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total REAL, FOREIGN KEY (user_id) REFERENCES users(id));",
		"CREATE TABLE user_logs (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, FOREIGN KEY (user_id) REFERENCES users(id));",
		"CREATE VIEW v_user_orders AS SELECT u.username, o.total FROM users u JOIN orders o ON u.id = o.user_id;",
		"CREATE VIEW v_high_value_orders AS SELECT username, total FROM v_user_orders WHERE total > 100;",
		"CREATE TRIGGER trg_user_audit AFTER INSERT ON users BEGIN INSERT INTO user_logs(user_id, action) VALUES (NEW.id, 'INSERT'); END;",
	}

	for _, stmt := range schemaSQL {
		if _, err := entry.Driver.ExecuteRaw(ctx, stmt); err != nil {
			t.Fatalf("failed setup stmt %q: %v", stmt, err)
		}
	}

	t.Run("Analyze impact for users table", func(t *testing.T) {
		req := impact.ImpactRequest{
			Schema:     "main",
			Object:     "users",
			ObjectType: "table",
			Depth:      5,
		}

		graph, err := impact.AnalyzeImpact(ctx, entry.Driver, req)
		if err != nil {
			t.Fatalf("AnalyzeImpact failed: %v", err)
		}

		if graph.Root.Name != "users" {
			t.Errorf("expected root name 'users', got %q", graph.Root.Name)
		}

		if graph.TotalDependents < 4 {
			t.Errorf("expected at least 4 dependents (orders, user_logs, views, trigger), got %d", graph.TotalDependents)
		}

		// Check presence of trigger, view, fk/table
		foundTrigger := false
		foundView := false
		foundFK := false
		for _, n := range graph.Nodes {
			if n.Kind == "trigger" && n.Name == "trg_user_audit" {
				foundTrigger = true
			}
			if n.Kind == "view" && n.Name == "v_user_orders" {
				foundView = true
			}
			if n.Kind == "foreign_key" || n.Kind == "table" {
				foundFK = true
			}
		}

		if !foundTrigger {
			t.Errorf("expected trg_user_audit in dependents")
		}
		if !foundView {
			t.Errorf("expected v_user_orders in dependents")
		}
		if !foundFK {
			t.Errorf("expected foreign key or dependent table in dependents")
		}

		// Safe Drop Plan
		plan, err := impact.BuildRemediationPlan(ctx, entry.Driver, graph, true)
		if err != nil {
			t.Fatalf("BuildRemediationPlan failed: %v", err)
		}

		if len(plan.Steps) == 0 {
			t.Fatalf("expected non-empty plan steps")
		}

		// Verify drop order: triggers must be dropped before views, views before target
		triggerIndex := -1
		viewIndex := -1
		targetIndex := -1

		for idx, s := range plan.Steps {
			if s.ObjectKind == "trigger" {
				triggerIndex = idx
			}
			if s.ObjectKind == "view" {
				viewIndex = idx
			}
			if s.ObjectKind == "table" && s.ObjectName == "users" {
				targetIndex = idx
			}
		}

		if triggerIndex == -1 || viewIndex == -1 || targetIndex == -1 {
			t.Fatalf("missing expected step types in plan: trigger=%d, view=%d, target=%d", triggerIndex, viewIndex, targetIndex)
		}

		if triggerIndex > targetIndex {
			t.Errorf("expected triggers dropped before target")
		}
		if viewIndex > targetIndex {
			t.Errorf("expected views dropped before target")
		}

		// UP and DOWN SQL checks
		if !strings.Contains(plan.UpSQL, "DROP TRIGGER") {
			t.Errorf("expected UpSQL to drop trigger")
		}
		if !strings.Contains(plan.UpSQL, "DROP TABLE") {
			t.Errorf("expected UpSQL to drop table")
		}
		if !strings.Contains(plan.DownSQL, "COMMIT") {
			t.Errorf("expected DownSQL to end with COMMIT")
		}

		// Markdown export test
		md := impact.ExportMarkdown(graph, plan)
		if !strings.Contains(md, "# Schema Object Impact Report: `users`") {
			t.Errorf("expected markdown report title")
		}
		if !strings.Contains(md, "Safe Drop Remediation Plan") {
			t.Errorf("expected markdown report to contain plan")
		}
	})

	t.Run("Analyze impact for column", func(t *testing.T) {
		req := impact.ImpactRequest{
			Schema:     "main",
			Object:     "users",
			ObjectType: "column",
			Column:     "id",
			Depth:      3,
		}

		graph, err := impact.AnalyzeImpact(ctx, entry.Driver, req)
		if err != nil {
			t.Fatalf("AnalyzeImpact for column failed: %v", err)
		}

		if graph.Root.Name != "id" {
			t.Errorf("expected root name 'id', got %q", graph.Root.Name)
		}

		plan, err := impact.BuildRemediationPlan(ctx, entry.Driver, graph, false)
		if err != nil {
			t.Fatalf("BuildRemediationPlan failed: %v", err)
		}

		lastStep := plan.Steps[len(plan.Steps)-1]
		if lastStep.ObjectKind != "column" || !strings.Contains(lastStep.SQL, "DROP COLUMN") {
			t.Errorf("expected last step to drop column, got: %s", lastStep.SQL)
		}
	})

	t.Run("Rename plan generation", func(t *testing.T) {
		req := impact.ImpactRequest{
			Schema:     "main",
			Object:     "users",
			ObjectType: "table",
		}
		graph, err := impact.AnalyzeImpact(ctx, entry.Driver, req)
		if err != nil {
			t.Fatalf("AnalyzeImpact failed: %v", err)
		}

		renameReq := impact.RenameRequest{
			Schema:     "main",
			Object:     "users",
			ObjectType: "table",
			NewName:    "app_users",
		}

		rPlan, err := impact.BuildRenamePlan(ctx, entry.Driver, graph, renameReq)
		if err != nil {
			t.Fatalf("BuildRenamePlan failed: %v", err)
		}

		if rPlan.NewName != "app_users" {
			t.Errorf("expected new name app_users, got %s", rPlan.NewName)
		}
		if !strings.Contains(rPlan.UpSQL, "RENAME TO \"app_users\"") {
			t.Errorf("expected UpSQL to rename table, got: %s", rPlan.UpSQL)
		}
		if !strings.Contains(rPlan.DownSQL, "RENAME TO \"users\"") {
			t.Errorf("expected DownSQL to restore old name, got: %s", rPlan.DownSQL)
		}
	})

	t.Run("Circular dependency safety", func(t *testing.T) {
		// Self-referential or circular table
		_, err := entry.Driver.ExecuteRaw(ctx, "CREATE TABLE employees (id INTEGER PRIMARY KEY, manager_id INTEGER, FOREIGN KEY(manager_id) REFERENCES employees(id));")
		if err != nil {
			t.Fatalf("failed creating self-referencing table: %v", err)
		}

		req := impact.ImpactRequest{
			Schema:     "main",
			Object:     "employees",
			ObjectType: "table",
			Depth:      5,
		}

		// Must not hang or stack overflow
		graph, err := impact.AnalyzeImpact(ctx, entry.Driver, req)
		if err != nil {
			t.Fatalf("AnalyzeImpact on self-referential table failed: %v", err)
		}
		if graph.Root.Name != "employees" {
			t.Errorf("expected employees, got %s", graph.Root.Name)
		}
	})
}
