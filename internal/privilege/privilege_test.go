package privilege_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/driver/sqlite"
	"github.com/dblens/dblens/internal/privilege"
)

func TestGeneratePlan_Postgres(t *testing.T) {
	roles := []privilege.RoleInfo{
		{Name: "app_reader", IsSuperuser: false, CanLogin: true},
		{Name: "app_writer", IsSuperuser: false, CanLogin: true},
	}

	changes := []privilege.PrivilegeChange{
		{
			Role:            "app_reader",
			Schema:          "public",
			Table:           "users",
			Privilege:       "SELECT",
			Action:          "GRANT",
			WithGrantOption: true,
		},
		{
			Role:      "app_writer",
			Schema:    "public",
			Table:     "orders",
			Privilege: "INSERT",
			Action:    "REVOKE",
		},
	}

	plan, err := privilege.GeneratePlan("postgres", changes, roles)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(plan.Statements) != 2 {
		t.Fatalf("expected 2 statements, got %d", len(plan.Statements))
	}

	expected0 := `GRANT SELECT ON "public"."users" TO "app_reader" WITH GRANT OPTION;`
	if plan.Statements[0] != expected0 {
		t.Errorf("expected statement 0:\n%s\ngot:\n%s", expected0, plan.Statements[0])
	}

	expected1 := `REVOKE INSERT ON "public"."orders" FROM "app_writer";`
	if plan.Statements[1] != expected1 {
		t.Errorf("expected statement 1:\n%s\ngot:\n%s", expected1, plan.Statements[1])
	}

	if plan.Dangerous {
		t.Errorf("expected plan not to be dangerous")
	}
}

func TestGeneratePlan_MySQL(t *testing.T) {
	roles := []privilege.RoleInfo{
		{Name: "app_user@localhost", IsSuperuser: false, CanLogin: true},
		{Name: "analyst", IsSuperuser: false, CanLogin: true},
	}

	changes := []privilege.PrivilegeChange{
		{
			Role:      "app_user@localhost",
			Schema:    "shop",
			Table:     "products",
			Privilege: "SELECT",
			Action:    "GRANT",
		},
		{
			Role:      "analyst",
			Schema:    "shop",
			Table:     "sales",
			Privilege: "DELETE",
			Action:    "REVOKE",
		},
	}

	plan, err := privilege.GeneratePlan("mysql", changes, roles)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(plan.Statements) != 2 {
		t.Fatalf("expected 2 statements, got %d", len(plan.Statements))
	}

	expected0 := "GRANT SELECT ON `shop`.`products` TO 'app_user'@'localhost';"
	if plan.Statements[0] != expected0 {
		t.Errorf("expected statement 0:\n%s\ngot:\n%s", expected0, plan.Statements[0])
	}

	expected1 := "REVOKE DELETE ON `shop`.`sales` FROM 'analyst'@'%';"
	if plan.Statements[1] != expected1 {
		t.Errorf("expected statement 1:\n%s\ngot:\n%s", expected1, plan.Statements[1])
	}
}

func TestGeneratePlan_SQLite(t *testing.T) {
	changes := []privilege.PrivilegeChange{
		{
			Role:      "sqlite_admin",
			Schema:    "main",
			Table:     "items",
			Privilege: "SELECT",
			Action:    "GRANT",
		},
	}

	plan, err := privilege.GeneratePlan("sqlite", changes, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(plan.Statements) != 1 {
		t.Fatalf("expected 1 statement, got %d", len(plan.Statements))
	}

	if !strings.Contains(plan.Statements[0], "-- [SQLite Simulated]") {
		t.Errorf("expected comment indicator in statement, got: %s", plan.Statements[0])
	}

	hasInfoWarning := false
	for _, w := range plan.Warnings {
		if w.Level == "info" && strings.Contains(w.Message, "file permissions") {
			hasInfoWarning = true
			break
		}
	}
	if !hasInfoWarning {
		t.Errorf("expected info warning about sqlite file permissions")
	}
}

func TestGeneratePlan_SafetyWarnings(t *testing.T) {
	roles := []privilege.RoleInfo{
		{Name: "postgres", IsSuperuser: true, CanLogin: true},
		{Name: "superadmin", IsSuperuser: true, CanLogin: true},
		{Name: "regular_user", IsSuperuser: false, CanLogin: true},
	}

	// 1. Revoking from superadmin
	superChanges := []privilege.PrivilegeChange{
		{
			Role:      "superadmin",
			Schema:    "public",
			Table:     "users",
			Privilege: "SELECT",
			Action:    "REVOKE",
		},
	}

	plan1, err := privilege.GeneratePlan("postgres", superChanges, roles)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !plan1.Dangerous {
		t.Errorf("expected dangerous=true when revoking from superuser")
	}
	if len(plan1.Warnings) == 0 || plan1.Warnings[0].Level != "critical" {
		t.Errorf("expected critical warning for superuser revoke, got %+v", plan1.Warnings)
	}

	// 2. Revoking ALL from regular user
	allChanges := []privilege.PrivilegeChange{
		{
			Role:      "regular_user",
			Schema:    "public",
			Table:     "users",
			Privilege: "ALL",
			Action:    "REVOKE",
		},
	}

	plan2, err := privilege.GeneratePlan("postgres", allChanges, roles)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !plan2.Dangerous {
		t.Errorf("expected dangerous=true when revoking ALL")
	}

	// 3. Granting is safe
	grantChanges := []privilege.PrivilegeChange{
		{
			Role:      "regular_user",
			Schema:    "public",
			Table:     "users",
			Privilege: "SELECT",
			Action:    "GRANT",
		},
	}
	plan3, err := privilege.GeneratePlan("postgres", grantChanges, roles)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if plan3.Dangerous {
		t.Errorf("granting privilege should not be marked dangerous")
	}
}

func TestGeneratePlan_SQLInjectionPrevention(t *testing.T) {
	cases := []struct {
		name   string
		change privilege.PrivilegeChange
	}{
		{
			name: "injected role",
			change: privilege.PrivilegeChange{
				Role:      `admin"; DROP TABLE users; --`,
				Schema:    "public",
				Table:     "users",
				Privilege: "SELECT",
				Action:    "GRANT",
			},
		},
		{
			name: "injected table",
			change: privilege.PrivilegeChange{
				Role:      "analyst",
				Schema:    "public",
				Table:     "users; DROP TABLE orders;",
				Privilege: "SELECT",
				Action:    "GRANT",
			},
		},
		{
			name: "injected schema",
			change: privilege.PrivilegeChange{
				Role:      "analyst",
				Schema:    "public' OR 1=1",
				Table:     "users",
				Privilege: "SELECT",
				Action:    "GRANT",
			},
		},
		{
			name: "illegal privilege",
			change: privilege.PrivilegeChange{
				Role:      "analyst",
				Schema:    "public",
				Table:     "users",
				Privilege: "EXECUTE; SHUTDOWN;",
				Action:    "GRANT",
			},
		},
		{
			name: "illegal action",
			change: privilege.PrivilegeChange{
				Role:      "analyst",
				Schema:    "public",
				Table:     "users",
				Privilege: "SELECT",
				Action:    "DROP",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := privilege.GeneratePlan("postgres", []privilege.PrivilegeChange{tc.change}, nil)
			if err == nil {
				t.Errorf("expected error for case %q, but got nil", tc.name)
			}
		})
	}
}

func TestInspectAndApply_SQLite(t *testing.T) {
	dbFile := "/tmp/dblens_test_privileges.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	drv, err := sqlite.New("sqlite://" + dbFile)
	if err != nil {
		t.Fatalf("failed to create sqlite driver: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()
	_, err = drv.ExecuteQuery(ctx, `CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);`)
	if err != nil {
		t.Fatalf("failed to create table: %v", err)
	}

	report, err := privilege.InspectPrivileges(ctx, drv, "")
	if err != nil {
		t.Fatalf("InspectPrivileges failed: %v", err)
	}

	if report.Dialect != "sqlite" {
		t.Errorf("expected dialect sqlite, got %s", report.Dialect)
	}
	if len(report.Roles) != 1 || report.Roles[0].Name != "sqlite_admin" {
		t.Errorf("expected sqlite_admin role, got %+v", report.Roles)
	}

	foundTable := false
	for _, tbl := range report.Tables {
		if tbl == "customers" {
			foundTable = true
			break
		}
	}
	if !foundTable {
		t.Errorf("expected table 'customers' in report.Tables, got %+v", report.Tables)
	}

	// Test ApplyPlan with SQLite simulated statements
	plan := &privilege.PrivilegePlan{
		Statements: []string{
			`-- [SQLite Simulated] GRANT SELECT ON "customers" TO sqlite_admin;`,
		},
	}
	if err := privilege.ApplyPlan(ctx, drv, plan); err != nil {
		t.Errorf("ApplyPlan on sqlite should succeed without error: %v", err)
	}
}
