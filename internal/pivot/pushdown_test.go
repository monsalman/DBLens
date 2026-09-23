package pivot

import (
	"strings"
	"testing"
)

func TestGeneratePushdownSQL_Postgres(t *testing.T) {
	req := PushdownRequest{
		Query:      "SELECT region, quarter, revenue FROM sales",
		Dialect:    "postgres",
		RowFields:  []string{"region"},
		ColField:   "quarter",
		ValueField: "revenue",
		Aggregator: "sum",
		Subtotals:  true,
		ColValues:  []string{"Q1", "Q2", "Q3"},
	}

	sql, err := GeneratePushdownSQL(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// PostgreSQL uses FILTER (WHERE ...) and double quotes
	if !strings.Contains(sql, `SUM("revenue") FILTER (WHERE "quarter" = 'Q1') AS "Q1"`) {
		t.Errorf("missing postgres FILTER clause in SQL:\n%s", sql)
	}
	if !strings.Contains(sql, `GROUP BY ROLLUP ("region")`) {
		t.Errorf("missing postgres ROLLUP clause in SQL:\n%s", sql)
	}
	if !strings.Contains(sql, `FROM (SELECT region, quarter, revenue FROM sales) AS _src`) {
		t.Errorf("missing FROM subquery in SQL:\n%s", sql)
	}
}

func TestGeneratePushdownSQL_MySQL(t *testing.T) {
	req := PushdownRequest{
		Query:      "SELECT dept, quarter, revenue FROM sales",
		Dialect:    "mysql",
		RowFields:  []string{"dept"},
		ColField:   "quarter",
		ValueField: "revenue",
		Aggregator: "avg",
		Subtotals:  true,
		ColValues:  []string{"Q1", "Q2"},
	}

	sql, err := GeneratePushdownSQL(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// MySQL uses backticks and CASE WHEN ... THEN ... END and WITH ROLLUP
	if !strings.Contains(sql, "AVG(CASE WHEN `quarter` = 'Q1' THEN `revenue` ELSE NULL END) AS `Q1`") {
		t.Errorf("missing mysql CASE WHEN clause in SQL:\n%s", sql)
	}
	if !strings.Contains(sql, "GROUP BY `dept` WITH ROLLUP") {
		t.Errorf("missing mysql WITH ROLLUP clause in SQL:\n%s", sql)
	}
}

func TestGeneratePushdownSQL_SQLite(t *testing.T) {
	req := PushdownRequest{
		Query:      "SELECT category, status, count FROM items",
		Dialect:    "sqlite",
		RowFields:  []string{"category"},
		ColField:   "status",
		ValueField: "count",
		Aggregator: "count",
		Subtotals:  false,
		ColValues:  []string{"open", "closed"},
	}

	sql, err := GeneratePushdownSQL(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// SQLite uses double quotes and CASE WHEN without ROLLUP
	if !strings.Contains(sql, `COUNT(CASE WHEN "status" = 'open' THEN "count" ELSE NULL END) AS "open"`) {
		t.Errorf("missing sqlite CASE WHEN COUNT in SQL:\n%s", sql)
	}
	if !strings.Contains(sql, `GROUP BY "category"`) {
		t.Errorf("missing GROUP BY in SQL:\n%s", sql)
	}
	if strings.Contains(sql, "ROLLUP") {
		t.Errorf("sqlite should not have ROLLUP clause:\n%s", sql)
	}
}

func TestGeneratePushdownSQL_Validation(t *testing.T) {
	// Missing query
	_, err := GeneratePushdownSQL(PushdownRequest{ColField: "q", ColValues: []string{"Q1"}})
	if err == nil || !strings.Contains(err.Error(), "query is required") {
		t.Errorf("expected query error, got %v", err)
	}

	// Missing colField
	_, err = GeneratePushdownSQL(PushdownRequest{Query: "SELECT 1", ColValues: []string{"Q1"}})
	if err == nil || !strings.Contains(err.Error(), "colField is required") {
		t.Errorf("expected colField error, got %v", err)
	}

	// Empty colValues
	_, err = GeneratePushdownSQL(PushdownRequest{Query: "SELECT 1", ColField: "q", ColValues: []string{}})
	if err == nil || !strings.Contains(err.Error(), "colValues must contain") {
		t.Errorf("expected colValues error, got %v", err)
	}

	// Numeric agg with empty valueField
	_, err = GeneratePushdownSQL(PushdownRequest{
		Query:      "SELECT 1",
		ColField:   "q",
		ColValues:  []string{"Q1"},
		Aggregator: "sum",
		ValueField: "",
	})
	if err == nil || !strings.Contains(err.Error(), "valueField is required") {
		t.Errorf("expected valueField error, got %v", err)
	}
}
