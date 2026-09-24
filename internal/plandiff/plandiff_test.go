package plandiff

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/driver/types"
)

func TestAligner_Postgres_Improvement(t *testing.T) {
	baseline := &types.ExplainResult{
		Dialect: "postgres",
		Summary: types.ExplainSummary{
			TotalCost:     12500.0,
			ExecutionTime: 45.2,
		},
		Root: &types.PlanNode{
			NodeType:     "Seq Scan",
			RelationName: "users",
			TotalCost:    12500.0,
			ActualTime:   45.2,
			ActualRows:   100000,
			Filter:       "(status = 'active'::text) AND (age > 21)",
		},
	}

	candidate := &types.ExplainResult{
		Dialect: "postgres",
		Summary: types.ExplainSummary{
			TotalCost:     140.0,
			ExecutionTime: 1.5,
		},
		Root: &types.PlanNode{
			NodeType:     "Index Scan",
			RelationName: "users",
			IndexName:    "idx_users_status_age",
			TotalCost:    140.0,
			ActualTime:   1.5,
			ActualRows:   250,
			IndexCond:    "(status = 'active'::text)",
			Filter:       "(age > 21)",
		},
	}

	res := ComparePlans(baseline, candidate, "postgres", "public")
	if res == nil {
		t.Fatal("expected non-nil PlanDiffResult")
	}

	if res.Summary.CostDeltaPct >= 0 {
		t.Fatalf("expected negative cost delta (improvement), got %.2f%%", res.Summary.CostDeltaPct)
	}
	if res.Summary.TimeDeltaPct >= 0 {
		t.Fatalf("expected negative time delta (improvement), got %.2f%%", res.Summary.TimeDeltaPct)
	}

	if res.AlignedTree == nil {
		t.Fatal("expected non-nil AlignedTree")
	}
	if !strings.Contains(res.AlignedTree.Operation, "Seq Scan -> Index Scan") {
		t.Fatalf("expected operation 'Seq Scan -> Index Scan', got '%s'", res.AlignedTree.Operation)
	}
	if res.AlignedTree.Relation != "users" {
		t.Fatalf("expected relation 'users', got '%s'", res.AlignedTree.Relation)
	}
	if res.AlignedTree.BottleneckSeverity != "low" {
		t.Fatalf("expected severity 'low' for improved node, got '%s'", res.AlignedTree.BottleneckSeverity)
	}
}

func TestAligner_Regression_Critical(t *testing.T) {
	baseline := &types.ExplainResult{
		Dialect: "postgres",
		Summary: types.ExplainSummary{
			TotalCost:     200.0,
			ExecutionTime: 2.0,
		},
		Root: &types.PlanNode{
			NodeType:     "Index Scan",
			RelationName: "orders",
			TotalCost:    200.0,
			ActualTime:   2.0,
			ActualRows:   10,
		},
	}

	candidate := &types.ExplainResult{
		Dialect: "postgres",
		Summary: types.ExplainSummary{
			TotalCost:     8500.0,
			ExecutionTime: 38.0,
		},
		Root: &types.PlanNode{
			NodeType:     "Seq Scan",
			RelationName: "orders",
			TotalCost:    8500.0,
			ActualTime:   38.0,
			ActualRows:   50000,
			Filter:       "(order_status = 'pending')",
		},
	}

	res := ComparePlans(baseline, candidate, "postgres", "public")
	if res.Summary.CostDeltaPct <= 100 {
		t.Fatalf("expected massive cost delta > 100%%, got %.2f%%", res.Summary.CostDeltaPct)
	}
	if res.Summary.BottleneckCount == 0 {
		t.Fatal("expected at least 1 bottleneck detected")
	}
	if res.AlignedTree.BottleneckSeverity != "critical" {
		t.Fatalf("expected severity 'critical', got '%s'", res.AlignedTree.BottleneckSeverity)
	}
}

func TestAligner_MySQL(t *testing.T) {
	baseline := &types.ExplainResult{
		Dialect: "mysql",
		Root: &types.PlanNode{
			NodeType:     "ALL",
			RelationName: "customers",
			TotalCost:    500.0,
			Rows:         5000,
			Filter:       "`customers`.`country` = 'CA'",
		},
	}

	candidate := &types.ExplainResult{
		Dialect: "mysql",
		Root: &types.PlanNode{
			NodeType:     "ref",
			RelationName: "customers",
			IndexName:    "idx_country",
			TotalCost:    15.0,
			Rows:         100,
		},
	}

	res := ComparePlans(baseline, candidate, "mysql", "")
	if res.Summary.CostDeltaPct >= 0 {
		t.Fatalf("expected negative cost delta, got %.2f%%", res.Summary.CostDeltaPct)
	}
	if res.AlignedTree.Relation != "customers" {
		t.Fatalf("expected relation customers, got %s", res.AlignedTree.Relation)
	}
}

func TestAligner_SQLite(t *testing.T) {
	baseline := &types.ExplainResult{
		Dialect: "sqlite",
		Root: &types.PlanNode{
			NodeType:     "SCAN TABLE",
			RelationName: "products",
			TotalCost:    800.0,
			Filter:       "products.category_id = 5",
		},
	}

	candidate := &types.ExplainResult{
		Dialect: "sqlite",
		Root: &types.PlanNode{
			NodeType:     "SEARCH TABLE",
			RelationName: "products",
			IndexName:    "idx_products_cat",
			TotalCost:    20.0,
		},
	}

	res := ComparePlans(baseline, candidate, "sqlite", "")
	if res.Summary.CostDeltaPct >= 0 {
		t.Fatalf("expected improvement delta, got %.2f%%", res.Summary.CostDeltaPct)
	}
}

func TestAligner_TreeWithChildren(t *testing.T) {
	baseline := &types.ExplainResult{
		Root: &types.PlanNode{
			NodeType:  "Nested Loop",
			TotalCost: 1000.0,
			Children: []types.PlanNode{
				{
					NodeType:     "Seq Scan",
					RelationName: "orders",
					TotalCost:    600.0,
					Filter:       "created_at > '2024-01-01'",
				},
				{
					NodeType:     "Index Scan",
					RelationName: "users",
					TotalCost:    400.0,
					IndexName:    "idx_users_id",
				},
			},
		},
	}

	candidate := &types.ExplainResult{
		Root: &types.PlanNode{
			NodeType:  "Nested Loop",
			TotalCost: 350.0,
			Children: []types.PlanNode{
				{
					NodeType:     "Index Scan",
					RelationName: "orders",
					TotalCost:    50.0,
					IndexName:    "idx_orders_created",
				},
				{
					NodeType:     "Index Scan",
					RelationName: "users",
					TotalCost:    300.0,
					IndexName:    "idx_users_id",
				},
			},
		},
	}

	res := ComparePlans(baseline, candidate, "postgres", "public")
	if len(res.AlignedTree.Children) != 2 {
		t.Fatalf("expected 2 aligned children, got %d", len(res.AlignedTree.Children))
	}

	ordersChild := res.AlignedTree.Children[0]
	if ordersChild.Relation != "orders" {
		t.Fatalf("expected orders child, got %s", ordersChild.Relation)
	}
	if ordersChild.CostDeltaPct >= 0 {
		t.Fatalf("expected orders child cost delta < 0, got %.2f%%", ordersChild.CostDeltaPct)
	}
}

func TestAdvisor_PostgresMultiColumn(t *testing.T) {
	cand := &types.ExplainResult{
		Dialect: "postgres",
		Root: &types.PlanNode{
			NodeType:     "Seq Scan",
			RelationName: "invoices",
			TotalCost:    4500.0,
			Rows:         20000,
			Filter:       "((tenant_id = 10) AND (status = 'unpaid') AND (due_date < '2025-01-01'::date))",
		},
	}

	recs := RecommendIndexes(cand, nil, "postgres", "public")
	if len(recs) == 0 {
		t.Fatal("expected at least 1 index recommendation")
	}

	rec := recs[0]
	if rec.Table != "invoices" {
		t.Fatalf("expected table invoices, got %s", rec.Table)
	}
	if rec.IndexType != "btree" {
		t.Fatalf("expected btree, got %s", rec.IndexType)
	}
	if !strings.Contains(rec.DDL, "CREATE INDEX CONCURRENTLY") {
		t.Fatalf("expected CREATE INDEX CONCURRENTLY, got %s", rec.DDL)
	}
	if !strings.Contains(rec.RollbackDDL, "DROP INDEX CONCURRENTLY") {
		t.Fatalf("expected DROP INDEX CONCURRENTLY, got %s", rec.RollbackDDL)
	}
	if rec.EstimatedCostSavingsPct < 50.0 || rec.EstimatedCostSavingsPct > 95.0 {
		t.Fatalf("expected savings between 50%% and 95%%, got %.1f%%", rec.EstimatedCostSavingsPct)
	}

	// tenant_id and status should precede due_date (equality before range)
	foundTenant := -1
	foundDue := -1
	for idx, col := range rec.Columns {
		if col == "tenant_id" || col == "status" {
			foundTenant = idx
		}
		if col == "due_date" {
			foundDue = idx
		}
	}
	if foundTenant >= 0 && foundDue >= 0 && foundTenant > foundDue {
		t.Fatalf("expected equality column before range column, got cols: %v", rec.Columns)
	}
}

func TestAdvisor_Dialects(t *testing.T) {
	node := &types.PlanNode{
		NodeType:     "Seq Scan",
		RelationName: "items",
		TotalCost:    1200.0,
		Filter:       "category = 'electronics' AND price > 100",
	}

	plan := &types.ExplainResult{Root: node}

	// Test MySQL
	myRecs := RecommendIndexes(plan, nil, "mysql", "")
	if len(myRecs) == 0 || !strings.Contains(myRecs[0].DDL, "CREATE INDEX idx_items_") {
		t.Fatalf("unexpected MySQL DDL: %v", myRecs)
	}
	if !strings.HasPrefix(myRecs[0].RollbackDDL, "DROP INDEX idx_items_") || (!strings.Contains(myRecs[0].RollbackDDL, "ON items") && !strings.Contains(myRecs[0].RollbackDDL, "ON `items`")) {
		t.Fatalf("unexpected MySQL rollback: %s", myRecs[0].RollbackDDL)
	}

	// Test SQLite
	liteRecs := RecommendIndexes(plan, nil, "sqlite", "")
	if len(liteRecs) == 0 || !strings.Contains(liteRecs[0].DDL, "CREATE INDEX idx_items_") {
		t.Fatalf("unexpected SQLite DDL: %v", liteRecs)
	}
	if !strings.Contains(liteRecs[0].RollbackDDL, "DROP INDEX IF EXISTS idx_items_") {
		t.Fatalf("unexpected SQLite rollback: %s", liteRecs[0].RollbackDDL)
	}
}

func TestMarkdownReport(t *testing.T) {
	baseline := &types.ExplainResult{
		Dialect: "postgres",
		Summary: types.ExplainSummary{
			TotalCost:     1000.0,
			ExecutionTime: 25.0,
		},
		Root: &types.PlanNode{
			NodeType:     "Seq Scan",
			RelationName: "logs",
			TotalCost:    1000.0,
			ActualTime:   25.0,
			Filter:       "level = 'ERROR'",
		},
	}

	candidate := &types.ExplainResult{
		Dialect: "postgres",
		Summary: types.ExplainSummary{
			TotalCost:     50.0,
			ExecutionTime: 2.0,
		},
		Root: &types.PlanNode{
			NodeType:     "Index Scan",
			RelationName: "logs",
			IndexName:    "idx_logs_level",
			TotalCost:    50.0,
			ActualTime:   2.0,
			IndexCond:    "level = 'ERROR'",
		},
	}

	diff := ComparePlans(baseline, candidate, "postgres", "public")
	md := GenerateMarkdownReport(diff)

	if !strings.Contains(md, "# Execution Plan Diff Report") {
		t.Fatal("missing markdown title")
	}
	if !strings.Contains(md, "Total Cost") || !strings.Contains(md, "Execution Time") {
		t.Fatal("missing summary metrics in markdown")
	}
	if !strings.Contains(md, "Plan Tree Comparison") {
		t.Fatal("missing plan tree comparison section")
	}
}

func TestAdvisor_IdentifierInjectionPrevention(t *testing.T) {
	// Table injection
	planInjectionTable := &types.ExplainResult{
		Root: &types.PlanNode{
			NodeType:     "Seq Scan",
			RelationName: "users; DROP TABLE users;--",
			TotalCost:    1000.0,
			Filter:       "id = 1",
		},
	}
	recs := RecommendIndexes(planInjectionTable, nil, "postgres", "public")
	if len(recs) != 0 {
		t.Fatalf("expected 0 recommendations for malicious table name, got %d", len(recs))
	}

	// Schema injection
	planSafe := &types.ExplainResult{
		Root: &types.PlanNode{
			NodeType:     "Seq Scan",
			RelationName: "users",
			TotalCost:    1000.0,
			Filter:       "status = 'active'",
		},
	}
	recsSchema := RecommendIndexes(planSafe, nil, "postgres", "public; DROP TABLE users;--")
	if len(recsSchema) == 0 {
		t.Fatal("expected recommendation with cleaned schema")
	}
	if strings.Contains(recsSchema[0].DDL, "DROP TABLE") {
		t.Fatalf("DDL contains injected schema: %s", recsSchema[0].DDL)
	}
}

func TestAdvisor_ForeignTableColumnsIgnored(t *testing.T) {
	node := &types.PlanNode{
		NodeType:     "Seq Scan",
		RelationName: "orders",
		TotalCost:    1500.0,
		Filter:       "(orders.status = 'shipped') AND (customers.id = orders.customer_id)",
	}
	plan := &types.ExplainResult{Root: node}
	recs := RecommendIndexes(plan, nil, "postgres", "public")
	if len(recs) == 0 {
		t.Fatal("expected at least 1 recommendation")
	}
	for _, col := range recs[0].Columns {
		if col == "id" {
			t.Fatalf("expected foreign table column 'id' to be discarded from orders index recommendation, got: %v", recs[0].Columns)
		}
	}
}

func TestAdvisor_BothCandidateAndBaselineAnalyzed(t *testing.T) {
	cand := &types.ExplainResult{
		Root: &types.PlanNode{
			NodeType:     "Seq Scan",
			RelationName: "orders",
			TotalCost:    1000.0,
			Filter:       "order_status = 'pending'",
		},
	}
	base := &types.ExplainResult{
		Root: &types.PlanNode{
			NodeType:     "Seq Scan",
			RelationName: "users",
			TotalCost:    2000.0,
			Filter:       "user_role = 'admin'",
		},
	}
	recs := RecommendIndexes(cand, base, "postgres", "public")
	foundOrders := false
	foundUsers := false
	for _, rec := range recs {
		if rec.Table == "orders" {
			foundOrders = true
		}
		if rec.Table == "users" {
			foundUsers = true
		}
	}
	if !foundOrders || !foundUsers {
		t.Fatalf("expected both orders and users recommendations, got orders=%v, users=%v", foundOrders, foundUsers)
	}
}

func TestAdvisor_EmptyRecommendationsJSONSafety(t *testing.T) {
	recs := RecommendIndexes(nil, nil, "postgres", "public")
	if recs == nil {
		t.Fatal("expected non-nil recommendations slice")
	}
	b, err := json.Marshal(recs)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}
	if string(b) != "[]" {
		t.Fatalf("expected '[]', got '%s'", string(b))
	}

	diff := ComparePlans(nil, nil, "postgres", "public")
	diffBytes, err := json.Marshal(diff)
	if err != nil {
		t.Fatalf("failed to marshal diff: %v", err)
	}
	if !strings.Contains(string(diffBytes), `"recommendations":[]`) {
		t.Fatalf("expected '\"recommendations\":[]' in json, got '%s'", string(diffBytes))
	}
}

func TestRecursionDepthBounds(t *testing.T) {
	// Build a 150-deep plan tree
	root := &types.PlanNode{NodeType: "Node-0"}
	curr := root
	for i := 1; i <= 150; i++ {
		child := types.PlanNode{NodeType: fmt.Sprintf("Node-%d", i), RelationName: "t"}
		curr.Children = []types.PlanNode{child}
		curr = &curr.Children[0]
	}

	aligned := AlignTrees(root, root)
	if aligned == nil {
		t.Fatal("expected aligned root")
	}
	bottlenecks := countBottlenecks(aligned)
	if bottlenecks < 0 {
		t.Fatal("invalid bottleneck count")
	}

	var nodes []*types.PlanNode
	collectPlanNodes(root, &nodes, 0)
	if len(nodes) > 105 {
		t.Fatalf("expected collectPlanNodes depth bounded to 101, got %d nodes", len(nodes))
	}
}
