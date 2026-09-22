package explain_test

import (
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/explain"
)

func TestParsePostgres(t *testing.T) {
	pgJSON := `[
  {
    "Plan": {
      "Node Type": "Hash Join",
      "Parallel Aware": false,
      "Async Capable": false,
      "Join Type": "Inner",
      "Startup Cost": 15.50,
      "Total Cost": 1250.00,
      "Plan Rows": 100,
      "Plan Width": 64,
      "Actual Startup Time": 0.050,
      "Actual Total Time": 55.200,
      "Actual Rows": 95,
      "Actual Loops": 1,
      "Hash Cond": "(orders.user_id = users.id)",
      "Plans": [
        {
          "Node Type": "Seq Scan",
          "Parent Relationship": "Outer",
          "Parallel Aware": false,
          "Async Capable": false,
          "Relation Name": "orders",
          "Alias": "orders",
          "Startup Cost": 0.00,
          "Total Cost": 800.00,
          "Plan Rows": 5000,
          "Plan Width": 32,
          "Actual Startup Time": 0.010,
          "Actual Total Time": 12.500,
          "Actual Rows": 5000,
          "Actual Loops": 1,
          "Filter": "(amount > 100)",
          "Rows Removed by Filter": 600
        },
        {
          "Node Type": "Hash",
          "Parent Relationship": "Inner",
          "Parallel Aware": false,
          "Async Capable": false,
          "Startup Cost": 14.50,
          "Total Cost": 14.50,
          "Plan Rows": 100,
          "Plan Width": 32,
          "Actual Startup Time": 0.030,
          "Actual Total Time": 0.030,
          "Actual Rows": 100,
          "Actual Loops": 1,
          "Plans": [
            {
              "Node Type": "Index Scan",
              "Parent Relationship": "Outer",
              "Parallel Aware": false,
              "Async Capable": false,
              "Index Name": "users_pkey",
              "Relation Name": "users",
              "Alias": "users",
              "Startup Cost": 0.15,
              "Total Cost": 14.50,
              "Plan Rows": 100,
              "Plan Width": 32,
              "Actual Startup Time": 0.005,
              "Actual Total Time": 0.025,
              "Actual Rows": 100,
              "Actual Loops": 1,
              "Index Cond": "(id < 100)"
            }
          ]
        }
      ]
    },
    "Planning Time": 0.145,
    "Triggers": [],
    "Execution Time": 55.450
  }
]`

	res, err := explain.ParsePostgres(pgJSON)
	if err != nil {
		t.Fatalf("unexpected error parsing postgres json: %v", err)
	}

	if res.Dialect != "postgres" {
		t.Errorf("expected dialect postgres, got %s", res.Dialect)
	}
	if res.Root == nil {
		t.Fatalf("expected non-nil root node")
	}
	if res.Root.NodeType != "Hash Join" {
		t.Errorf("expected root NodeType 'Hash Join', got %s", res.Root.NodeType)
	}
	if res.Root.TotalCost != 1250.00 {
		t.Errorf("expected root TotalCost 1250.00, got %v", res.Root.TotalCost)
	}
	if !res.Root.IsExpensive {
		t.Errorf("expected root to be marked expensive (cost > 1000 and time > 50ms)")
	}
	if res.Summary.ExecutionTime != 55.450 {
		t.Errorf("expected execution time 55.450, got %v", res.Summary.ExecutionTime)
	}
	if res.Summary.PlanningTime != 0.145 {
		t.Errorf("expected planning time 0.145, got %v", res.Summary.PlanningTime)
	}

	// Verify children
	if len(res.Root.Children) != 2 {
		t.Fatalf("expected 2 children on root, got %d", len(res.Root.Children))
	}

	childSeqScan := res.Root.Children[0]
	if childSeqScan.NodeType != "Seq Scan" {
		t.Errorf("expected child 0 to be Seq Scan, got %s", childSeqScan.NodeType)
	}
	if childSeqScan.RelationName != "orders" {
		t.Errorf("expected child 0 relationName 'orders', got %s", childSeqScan.RelationName)
	}
	if !childSeqScan.IsExpensive {
		t.Errorf("expected Seq Scan to be marked isExpensive")
	}
	hasSeqWarning := false
	for _, w := range childSeqScan.Warnings {
		if strings.Contains(w, "Sequential scan on table 'orders'") {
			hasSeqWarning = true
		}
	}
	if !hasSeqWarning {
		t.Errorf("expected sequential scan warning on orders, got %v", childSeqScan.Warnings)
	}
}

func TestParseMySQL(t *testing.T) {
	myJSON := `{
  "query_block": {
    "select_id": 1,
    "cost_info": {
      "query_cost": "45.00"
    },
    "ordering_operation": {
      "using_filesort": true,
      "cost_info": {
        "sort_cost": "15.00"
      },
      "nested_loop": [
        {
          "table": {
            "table_name": "users",
            "access_type": "ALL",
            "rows_examined_per_scan": 1000,
            "rows_produced_per_join": 500,
            "filtered": "50.00",
            "cost_info": {
              "read_cost": "10.00",
              "prefix_cost": "20.00"
            },
            "attached_condition": "('users'.'status' = 'active')"
          }
        },
        {
          "table": {
            "table_name": "orders",
            "access_type": "ref",
            "key": "idx_user_id",
            "rows_examined_per_scan": 2,
            "cost_info": {
              "read_cost": "5.00",
              "prefix_cost": "25.00"
            }
          }
        }
      ]
    }
  }
}`

	res, err := explain.ParseMySQL(myJSON)
	if err != nil {
		t.Fatalf("unexpected error parsing mysql json: %v", err)
	}

	if res.Dialect != "mysql" {
		t.Errorf("expected dialect mysql, got %s", res.Dialect)
	}
	if res.Root == nil {
		t.Fatalf("expected non-nil root")
	}
	if res.Root.NodeType != "Sort (ORDER BY)" {
		t.Errorf("expected root NodeType 'Sort (ORDER BY)', got %s", res.Root.NodeType)
	}
	if !res.Root.IsExpensive {
		t.Errorf("expected Sort with filesort to be marked isExpensive")
	}
	if res.Summary.TotalCost != 45.00 {
		t.Errorf("expected totalCost 45.00, got %v", res.Summary.TotalCost)
	}

	// Verify nested loop inside sort
	if len(res.Root.Children) != 1 {
		t.Fatalf("expected 1 child under sort, got %d", len(res.Root.Children))
	}
	nl := res.Root.Children[0]
	if nl.NodeType != "Nested Loop Join" {
		t.Errorf("expected Nested Loop Join, got %s", nl.NodeType)
	}
	if len(nl.Children) != 2 {
		t.Fatalf("expected 2 tables in nested loop, got %d", len(nl.Children))
	}

	tblUsers := nl.Children[0]
	if tblUsers.NodeType != "Table Scan (ALL)" {
		t.Errorf("expected Table Scan (ALL), got %s", tblUsers.NodeType)
	}
	if !tblUsers.IsExpensive {
		t.Errorf("expected table scan ALL to be marked isExpensive")
	}

	tblOrders := nl.Children[1]
	if tblOrders.NodeType != "Index Lookup (ref)" {
		t.Errorf("expected Index Lookup (ref), got %s", tblOrders.NodeType)
	}
	if tblOrders.IndexName != "idx_user_id" {
		t.Errorf("expected indexName 'idx_user_id', got %s", tblOrders.IndexName)
	}
}

func TestParseSQLite(t *testing.T) {
	rows := []explain.SQLiteRow{
		{ID: 2, Parent: 0, NotUsed: 0, Detail: "SCAN users AS u"},
		{ID: 4, Parent: 0, NotUsed: 0, Detail: "SEARCH orders USING INDEX idx_user_id (user_id=?)"},
		{ID: 6, Parent: 0, NotUsed: 0, Detail: "USE TEMP B-TREE FOR ORDER BY"},
	}

	res, err := explain.ParseSQLite(rows)
	if err != nil {
		t.Fatalf("unexpected error parsing sqlite plan: %v", err)
	}

	if res.Dialect != "sqlite" {
		t.Errorf("expected dialect sqlite, got %s", res.Dialect)
	}
	if res.Root == nil {
		t.Fatalf("expected non-nil root")
	}
	if res.Root.NodeType != "QUERY PLAN" {
		t.Errorf("expected QUERY PLAN root for multiple top-level nodes, got %s", res.Root.NodeType)
	}
	if len(res.Root.Children) != 3 {
		t.Fatalf("expected 3 children, got %d", len(res.Root.Children))
	}

	c0 := res.Root.Children[0]
	if c0.NodeType != "Seq Scan" {
		t.Errorf("expected c0 to be Seq Scan, got %s", c0.NodeType)
	}
	if c0.RelationName != "users" {
		t.Errorf("expected relationName 'users', got %s", c0.RelationName)
	}
	if c0.Alias != "u" {
		t.Errorf("expected alias 'u', got %s", c0.Alias)
	}
	if !c0.IsExpensive {
		t.Errorf("expected c0 to be isExpensive")
	}

	c1 := res.Root.Children[1]
	if c1.NodeType != "Index Search" {
		t.Errorf("expected c1 to be Index Search, got %s", c1.NodeType)
	}
	if c1.IndexName != "idx_user_id" {
		t.Errorf("expected indexName 'idx_user_id', got %s", c1.IndexName)
	}
	if c1.Filter != "user_id=?" {
		t.Errorf("expected filter 'user_id=?', got %s", c1.Filter)
	}

	c2 := res.Root.Children[2]
	if c2.NodeType != "Temp B-Tree (ORDER BY)" {
		t.Errorf("expected Temp B-Tree (ORDER BY), got %s", c2.NodeType)
	}
	if !c2.IsExpensive {
		t.Errorf("expected Temp B-Tree to be isExpensive")
	}
}

func TestParseSQLiteHierarchy(t *testing.T) {
	rows := []explain.SQLiteRow{
		{ID: 2, Parent: 0, NotUsed: 0, Detail: "CO-ROUTINE s"},
		{ID: 5, Parent: 2, NotUsed: 0, Detail: "SCAN users"},
		{ID: 8, Parent: 2, NotUsed: 0, Detail: "USE TEMP B-TREE FOR DISTINCT"},
		{ID: 10, Parent: 0, NotUsed: 0, Detail: "SCAN s"},
	}

	res, err := explain.ParseSQLite(rows)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(res.Root.Children) != 2 {
		t.Fatalf("expected 2 top-level children, got %d", len(res.Root.Children))
	}

	coroutine := res.Root.Children[0]
	if coroutine.NodeType != "Co-routine" {
		t.Errorf("expected Co-routine, got %s", coroutine.NodeType)
	}
	if len(coroutine.Children) != 2 {
		t.Fatalf("expected 2 children under co-routine, got %d", len(coroutine.Children))
	}
	if coroutine.Children[0].NodeType != "Seq Scan" {
		t.Errorf("expected Seq Scan under co-routine, got %s", coroutine.Children[0].NodeType)
	}
	if coroutine.Children[1].NodeType != "Temp B-Tree (DISTINCT)" {
		t.Errorf("expected Temp B-Tree (DISTINCT) under co-routine, got %s", coroutine.Children[1].NodeType)
	}
}

func TestParseSQLiteThreeLevelHierarchy(t *testing.T) {
	rows := []explain.SQLiteRow{
		{ID: 1, Parent: 0, NotUsed: 0, Detail: "CO-ROUTINE sub"},
		{ID: 2, Parent: 1, NotUsed: 0, Detail: "COMPOUND QUERY"},
		{ID: 3, Parent: 2, NotUsed: 0, Detail: "SCAN users"},
	}

	res, err := explain.ParseSQLite(rows)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if res.Root == nil {
		t.Fatalf("expected non-nil root")
	}

	// Root should be CO-ROUTINE sub
	if len(res.Root.Children) != 1 {
		t.Fatalf("expected 1 child under root (ID 2), got %d", len(res.Root.Children))
	}
	level2 := res.Root.Children[0]
	if level2.NodeType != "Compound Query" {
		t.Errorf("expected Compound Query at level 2, got %s", level2.NodeType)
	}
	// Level 2 should have level 3 (ID 3)
	if len(level2.Children) != 1 {
		t.Fatalf("BUG CONFIRMED: expected 1 grandchild under level 2, got %d", len(level2.Children))
	}
	if level2.Children[0].NodeType != "Seq Scan" {
		t.Errorf("expected Seq Scan at level 3, got %s", level2.Children[0].NodeType)
	}
}
