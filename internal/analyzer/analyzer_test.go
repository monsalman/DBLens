package analyzer

import (
	"context"
	"path/filepath"
	"testing"
)

func TestTokenizer(t *testing.T) {
	sql := `SELECT u.id, "u"."name", 'hello \'world\'', 42, 3.14 -- comment
	/* block */ FROM users WHERE flag = true;`

	tokens := Tokenize(sql)
	if len(tokens) == 0 {
		t.Fatal("expected tokens, got none")
	}

	codeTokens := TokensWithoutComments(tokens)
	for _, tok := range codeTokens {
		if tok.Type == TokenComment {
			t.Errorf("expected no comments in codeTokens, got %v", tok)
		}
	}

	// Verify line/col tracking
	if tokens[0].Line != 1 || tokens[0].Col != 1 {
		t.Errorf("first token position: got line %d col %d, want 1, 1", tokens[0].Line, tokens[0].Col)
	}
}

func TestRuleSelectStar(t *testing.T) {
	ctx := context.Background()

	// Case 1: SELECT * flagged
	res := AnalyzeSQL(ctx, "SELECT * FROM users", "postgres", "public", []string{"users"}, map[string][]string{
		"users": {"id", "email", "name"},
	}, nil)

	found := false
	for _, d := range res.Diagnostics {
		if d.RuleID == "select-star" {
			found = true
			if d.QuickFix == nil || d.QuickFix.Replacement != "id, email, name" {
				t.Errorf("expected column list quickfix, got %+v", d.QuickFix)
			}
		}
	}
	if !found {
		t.Error("expected select-star diagnostic")
	}

	// Case 2: COUNT(*) not flagged
	res2 := AnalyzeSQL(ctx, "SELECT COUNT(*) FROM users", "postgres", "public", nil, nil, nil)
	for _, d := range res2.Diagnostics {
		if d.RuleID == "select-star" {
			t.Errorf("COUNT(*) should not trigger select-star diagnostic")
		}
	}

	// Case 3: EXISTS (SELECT * ...) not flagged
	res3 := AnalyzeSQL(ctx, "SELECT id FROM users WHERE EXISTS (SELECT * FROM orders WHERE orders.user_id = users.id)", "postgres", "public", nil, nil, nil)
	for _, d := range res3.Diagnostics {
		if d.RuleID == "select-star" {
			t.Errorf("EXISTS (SELECT * ...) should not trigger select-star diagnostic")
		}
	}
}

func TestRuleUpdateDeleteWithoutWhere(t *testing.T) {
	ctx := context.Background()

	// UPDATE without WHERE
	res1 := AnalyzeSQL(ctx, "UPDATE users SET active = false", "postgres", "public", nil, nil, nil)
	hasError := false
	for _, d := range res1.Diagnostics {
		if d.RuleID == "update-delete-without-where" && d.Severity == SeverityError {
			hasError = true
			if d.QuickFix == nil {
				t.Error("expected quick fix for UPDATE without WHERE")
			}
		}
	}
	if !hasError {
		t.Error("expected error for UPDATE without WHERE")
	}

	// DELETE without WHERE
	res2 := AnalyzeSQL(ctx, "DELETE FROM users;", "postgres", "public", nil, nil, nil)
	hasDeleteError := false
	for _, d := range res2.Diagnostics {
		if d.RuleID == "update-delete-without-where" && d.Severity == SeverityError {
			hasDeleteError = true
		}
	}
	if !hasDeleteError {
		t.Error("expected error for DELETE without WHERE")
	}

	// UPDATE with WHERE should be clean
	res3 := AnalyzeSQL(ctx, "UPDATE users SET active = false WHERE id = 1;", "postgres", "public", nil, nil, nil)
	for _, d := range res3.Diagnostics {
		if d.RuleID == "update-delete-without-where" {
			t.Error("UPDATE with WHERE should not trigger error")
		}
	}
}

func TestRuleImplicitCommaJoin(t *testing.T) {
	ctx := context.Background()
	sql := "SELECT u.id, o.id FROM users u, orders o WHERE u.id = o.user_id"
	res := AnalyzeSQL(ctx, sql, "postgres", "public", nil, nil, nil)

	found := false
	for _, d := range res.Diagnostics {
		if d.RuleID == "implicit-comma-join" {
			found = true
			if d.QuickFix == nil {
				t.Error("expected quick fix for comma join")
			}
		}
	}
	if !found {
		t.Error("expected implicit-comma-join diagnostic")
	}
}

func TestRuleNotInNullable(t *testing.T) {
	ctx := context.Background()
	sql := "SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM orders)"
	res := AnalyzeSQL(ctx, sql, "postgres", "public", nil, nil, nil)

	found := false
	for _, d := range res.Diagnostics {
		if d.RuleID == "not-in-nullable" {
			found = true
			if d.QuickFix == nil || d.QuickFix.Replacement != "NOT EXISTS" {
				t.Errorf("expected NOT EXISTS quickfix, got %+v", d.QuickFix)
			}
		}
	}
	if !found {
		t.Error("expected not-in-nullable diagnostic")
	}
}

func TestRuleLeadingWildcardLike(t *testing.T) {
	ctx := context.Background()

	// Leading wildcard
	res1 := AnalyzeSQL(ctx, "SELECT id FROM users WHERE email LIKE '%@gmail.com'", "postgres", "public", nil, nil, nil)
	found := false
	for _, d := range res1.Diagnostics {
		if d.RuleID == "leading-wildcard-like" {
			found = true
			if d.QuickFix == nil || d.QuickFix.Replacement != "'@gmail.com'" {
				t.Errorf("expected '@gmail.com' quick fix, got %+v", d.QuickFix)
			}
		}
	}
	if !found {
		t.Error("expected leading-wildcard-like diagnostic")
	}

	// Trailing wildcard is clean
	res2 := AnalyzeSQL(ctx, "SELECT id FROM users WHERE email LIKE 'admin%'", "postgres", "public", nil, nil, nil)
	for _, d := range res2.Diagnostics {
		if d.RuleID == "leading-wildcard-like" {
			t.Error("trailing wildcard should not trigger diagnostic")
		}
	}
}

func TestRuleMissingLimitOnLargeSort(t *testing.T) {
	ctx := context.Background()

	// Missing LIMIT
	res1 := AnalyzeSQL(ctx, "SELECT id, name FROM users ORDER BY created_at DESC", "postgres", "public", nil, nil, nil)
	found := false
	for _, d := range res1.Diagnostics {
		if d.RuleID == "missing-limit-on-large-sort" {
			found = true
			if d.QuickFix == nil {
				t.Error("expected quick fix to append LIMIT")
			}
		}
	}
	if !found {
		t.Error("expected missing-limit-on-large-sort diagnostic")
	}

	// Has LIMIT
	res2 := AnalyzeSQL(ctx, "SELECT id, name FROM users ORDER BY created_at DESC LIMIT 50", "postgres", "public", nil, nil, nil)
	for _, d := range res2.Diagnostics {
		if d.RuleID == "missing-limit-on-large-sort" {
			t.Error("query with LIMIT should not trigger diagnostic")
		}
	}
}

func TestRuleUnusedCte(t *testing.T) {
	ctx := context.Background()
	sql := "WITH unused_metrics AS (SELECT 1 AS n), active_users AS (SELECT id FROM users) SELECT id FROM active_users"
	res := AnalyzeSQL(ctx, sql, "postgres", "public", nil, nil, nil)

	foundUnused := false
	foundActive := false
	for _, d := range res.Diagnostics {
		if d.RuleID == "unused-cte" {
			if d.StartOffset >= 0 {
				foundUnused = true
			}
		}
	}
	if !foundUnused {
		t.Error("expected unused-cte diagnostic for unused_metrics")
	}
	if foundActive {
		t.Error("active_users is used and should not be flagged")
	}
}

func TestRuleUnresolvedTable(t *testing.T) {
	ctx := context.Background()
	knownTables := []string{"users", "orders", "products"}

	// Unknown table with suggestion
	res := AnalyzeSQL(ctx, "SELECT * FROM userz", "postgres", "public", knownTables, nil, nil)
	found := false
	for _, d := range res.Diagnostics {
		if d.RuleID == "unresolved-table" {
			found = true
			if d.QuickFix == nil || d.QuickFix.Replacement != "users" {
				t.Errorf("expected suggestion 'users', got %+v", d.QuickFix)
			}
		}
	}
	if !found {
		t.Error("expected unresolved-table diagnostic")
	}

	// Known table clean
	res2 := AnalyzeSQL(ctx, "SELECT * FROM orders", "postgres", "public", knownTables, nil, nil)
	for _, d := range res2.Diagnostics {
		if d.RuleID == "unresolved-table" {
			t.Error("known table should not trigger unresolved-table")
		}
	}

	// CTE name not flagged as unknown table
	sqlCte := "WITH custom_data AS (SELECT 1 AS val) SELECT * FROM custom_data"
	res3 := AnalyzeSQL(ctx, sqlCte, "postgres", "public", knownTables, nil, nil)
	for _, d := range res3.Diagnostics {
		if d.RuleID == "unresolved-table" {
			t.Error("CTE name should be recognized as resolved table")
		}
	}
}

func TestRuleUnresolvedColumn(t *testing.T) {
	ctx := context.Background()
	knownCols := map[string][]string{
		"users": {"id", "email", "full_name"},
	}

	// Qualified unknown column with typo
	sql := "SELECT u.emal FROM users u"
	res := AnalyzeSQL(ctx, sql, "postgres", "public", []string{"users"}, knownCols, nil)

	found := false
	for _, d := range res.Diagnostics {
		if d.RuleID == "unresolved-column" {
			found = true
			if d.QuickFix == nil || d.QuickFix.Replacement != "email" {
				t.Errorf("expected suggestion 'email', got %+v", d.QuickFix)
			}
		}
	}
	if !found {
		t.Error("expected unresolved-column diagnostic")
	}
}

func TestRuleUnqualifiedColumnInJoin(t *testing.T) {
	ctx := context.Background()
	sql := "SELECT id, email, total FROM users u JOIN orders o ON u.id = o.user_id"
	res := AnalyzeSQL(ctx, sql, "postgres", "public", nil, nil, nil)

	count := 0
	for _, d := range res.Diagnostics {
		if d.RuleID == "unqualified-column-in-join" {
			count++
		}
	}
	if count == 0 {
		t.Error("expected unqualified-column-in-join diagnostics for id, email, total")
	}
}

func TestEvaluateGate(t *testing.T) {
	// Gate failure on DELETE without WHERE
	failReq := GateRequest{
		SQL:            "DELETE FROM accounts",
		FailOnSeverity: SeverityError,
		MaxAllowed:     0,
	}
	failRes := EvaluateGate(failReq)
	if failRes.Passed {
		t.Errorf("expected quality gate to fail on unconstrained DELETE")
	}

	// Gate pass on safe SELECT
	passReq := GateRequest{
		SQL:            "SELECT id, name FROM users WHERE id = 1",
		FailOnSeverity: SeverityError,
		MaxAllowed:     0,
	}
	passRes := EvaluateGate(passReq)
	if !passRes.Passed {
		t.Errorf("expected quality gate to pass on safe SELECT: %s", passRes.Reason)
	}
}

func TestStorePersistence(t *testing.T) {
	dir := t.TempDir()
	storeFile := filepath.Join(dir, "analyzer.json")

	store, err := NewStore(storeFile)
	if err != nil {
		t.Fatalf("failed to init store: %v", err)
	}

	// Default rules exist
	rules := store.GetRules()
	if len(rules) < 10 {
		t.Fatalf("expected at least 10 rules, got %d", len(rules))
	}

	// Update configuration
	err = store.UpdateRules(map[string]RuleSetting{
		"select-star": {
			Enabled:  false,
			Severity: SeverityInfo,
		},
	})
	if err != nil {
		t.Fatalf("failed to update rules: %v", err)
	}

	// Reload from new store instance
	store2, err := NewStore(storeFile)
	if err != nil {
		t.Fatalf("failed to reload store: %v", err)
	}

	rules2 := store2.GetRules()
	for _, r := range rules2 {
		if r.ID == "select-star" {
			if r.Enabled != false {
				t.Errorf("expected select-star to be disabled after reload")
			}
			if r.Severity != SeverityInfo {
				t.Errorf("expected select-star severity to be info after reload, got %s", r.Severity)
			}
		}
	}
}
