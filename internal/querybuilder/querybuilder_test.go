package querybuilder

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestGenerateSQL_SingleTable(t *testing.T) {
	limit := 10
	offset := 20
	state := QueryCanvasState{
		Tables: []CanvasTable{
			{
				ID:     "t1",
				Name:   "users",
				Schema: "public",
				Alias:  "u",
				Columns: []CanvasColumn{
					{Name: "id", Selected: true},
					{Name: "email", Selected: true, Alias: "user_email"},
					{Name: "status", Selected: false},
				},
			},
		},
		Filters: []CanvasFilter{
			{
				TableID:  "t1",
				Column:   "status",
				Operator: "=",
				Value:    "active",
			},
		},
		OrderBy: []CanvasOrderBy{
			{
				TableID:   "t1",
				Column:    "id",
				Direction: "DESC",
				Nulls:     "LAST",
			},
		},
		Limit:  &limit,
		Offset: &offset,
	}

	// Postgres
	pgRes, err := GenerateSQL(state, "postgres")
	if err != nil {
		t.Fatalf("postgres GenerateSQL failed: %v", err)
	}
	if !strings.Contains(pgRes.SQL, `SELECT`) ||
		!strings.Contains(pgRes.SQL, `"u"."id"`) ||
		!strings.Contains(pgRes.SQL, `"u"."email" AS "user_email"`) ||
		!strings.Contains(pgRes.SQL, `FROM "public"."users" AS "u"`) ||
		!strings.Contains(pgRes.SQL, `WHERE "u"."status" = 'active'`) ||
		!strings.Contains(pgRes.SQL, `ORDER BY "u"."id" DESC NULLS LAST`) ||
		!strings.Contains(pgRes.SQL, `LIMIT 10 OFFSET 20;`) {
		t.Errorf("unexpected postgres SQL: %s", pgRes.SQL)
	}

	// MySQL
	myRes, err := GenerateSQL(state, "mysql")
	if err != nil {
		t.Fatalf("mysql GenerateSQL failed: %v", err)
	}
	if !strings.Contains(myRes.SQL, "`u`.`id`") ||
		!strings.Contains(myRes.SQL, "`public`.`users` AS `u`") ||
		!strings.Contains(myRes.SQL, "`u`.`status` = 'active'") {
		t.Errorf("unexpected mysql SQL: %s", myRes.SQL)
	}

	// SQLite
	sqRes, err := GenerateSQL(state, "sqlite")
	if err != nil {
		t.Fatalf("sqlite GenerateSQL failed: %v", err)
	}
	if !strings.Contains(sqRes.SQL, `"u"."id"`) ||
		!strings.Contains(sqRes.SQL, `FROM "public"."users" AS "u"`) {
		t.Errorf("unexpected sqlite SQL: %s", sqRes.SQL)
	}
}

func TestGenerateSQL_JoinsAndAggregates(t *testing.T) {
	state := QueryCanvasState{
		Tables: []CanvasTable{
			{
				ID:    "t1",
				Name:  "departments",
				Alias: "d",
				Columns: []CanvasColumn{
					{Name: "id", Selected: false},
					{Name: "name", Selected: true},
				},
			},
			{
				ID:    "t2",
				Name:  "employees",
				Alias: "e",
				Columns: []CanvasColumn{
					{Name: "id", Selected: true, Aggregate: "COUNT", Alias: "emp_count"},
					{Name: "salary", Selected: true, Aggregate: "AVG", Alias: "avg_salary"},
					{Name: "department_id", Selected: false},
				},
			},
		},
		Joins: []CanvasJoin{
			{
				ID:            "j1",
				SourceTableID: "t1",
				SourceColumn:  "id",
				TargetTableID: "t2",
				TargetColumn:  "department_id",
				JoinType:      "LEFT",
			},
		},
		Havings: []CanvasHaving{
			{
				Aggregate: "COUNT",
				TableID:   "t2",
				Column:    "id",
				Operator:  ">",
				Value:     "5",
			},
		},
		OrderBy: []CanvasOrderBy{
			{
				TableID:   "t1",
				Column:    "name",
				Direction: "ASC",
			},
		},
	}

	res, err := GenerateSQL(state, "postgres")
	if err != nil {
		t.Fatalf("GenerateSQL failed: %v", err)
	}

	sql := res.SQL
	if !strings.Contains(sql, `"d"."name"`) ||
		!strings.Contains(sql, `COUNT("e"."id") AS "emp_count"`) ||
		!strings.Contains(sql, `AVG("e"."salary") AS "avg_salary"`) ||
		!strings.Contains(sql, `FROM "departments" AS "d"`) ||
		!strings.Contains(sql, `LEFT JOIN "employees" AS "e" ON "d"."id" = "e"."department_id"`) ||
		!strings.Contains(sql, `GROUP BY "d"."name"`) ||
		!strings.Contains(sql, `HAVING COUNT("e"."id") > 5`) ||
		!strings.Contains(sql, `ORDER BY "d"."name" ASC`) {
		t.Errorf("SQL missing expected clauses:\n%s", sql)
	}
}

func TestGenerateSQL_FilterOperators(t *testing.T) {
	state := QueryCanvasState{
		Tables: []CanvasTable{
			{
				ID:   "t1",
				Name: "products",
				Columns: []CanvasColumn{
					{Name: "id", Selected: true},
					{Name: "price", Selected: true},
					{Name: "category", Selected: true},
					{Name: "deleted_at", Selected: true},
				},
			},
		},
		Filters: []CanvasFilter{
			{
				TableID:  "t1",
				Column:   "price",
				Operator: "BETWEEN",
				Value:    "10",
				Value2:   "100",
			},
			{
				TableID:  "t1",
				Column:   "category",
				Operator: "IN",
				Value:    "books, electronics",
				Logic:    "AND",
			},
			{
				TableID:  "t1",
				Column:   "deleted_at",
				Operator: "IS NULL",
				Logic:    "AND",
			},
		},
	}

	res, err := GenerateSQL(state, "postgres")
	if err != nil {
		t.Fatalf("GenerateSQL failed: %v", err)
	}

	sql := res.SQL
	if !strings.Contains(sql, `"products"."price" BETWEEN 10 AND 100`) ||
		!strings.Contains(sql, `"products"."category" IN ('books', 'electronics')`) ||
		!strings.Contains(sql, `"products"."deleted_at" IS NULL`) {
		t.Errorf("unexpected filter SQL:\n%s", sql)
	}
}

func TestGenerateSQL_Validation(t *testing.T) {
	// Empty state
	_, err := GenerateSQL(QueryCanvasState{}, "postgres")
	if err == nil {
		t.Errorf("expected error on empty state, got nil")
	}

	// Invalid join reference
	badState := QueryCanvasState{
		Tables: []CanvasTable{
			{ID: "t1", Name: "users"},
		},
		Joins: []CanvasJoin{
			{
				SourceTableID: "t1",
				SourceColumn:  "id",
				TargetTableID: "nonexistent",
				TargetColumn:  "user_id",
			},
		},
	}
	_, err = GenerateSQL(badState, "postgres")
	if err == nil {
		t.Errorf("expected error on invalid join target, got nil")
	}
}

func TestStore_SaveGetListDelete(t *testing.T) {
	tmpDir := t.TempDir()
	storePath := filepath.Join(tmpDir, "visual_queries.json")

	store, err := NewStore(storePath)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}

	// Save query 1
	q1 := &SavedVisualQuery{
		Name:         "User Report",
		ConnectionID: "conn_1",
		State: QueryCanvasState{
			Tables: []CanvasTable{{ID: "t1", Name: "users"}},
		},
	}
	saved1, err := store.Save(q1)
	if err != nil {
		t.Fatalf("Save failed: %v", err)
	}
	if saved1.ID == "" {
		t.Errorf("expected generated ID")
	}

	// Save query 2 for different connection
	q2 := &SavedVisualQuery{
		Name:         "Order Summary",
		ConnectionID: "conn_2",
		State: QueryCanvasState{
			Tables: []CanvasTable{{ID: "t2", Name: "orders"}},
		},
	}
	_, err = store.Save(q2)
	if err != nil {
		t.Fatalf("Save q2 failed: %v", err)
	}

	// List all
	all := store.List("")
	if len(all) != 2 {
		t.Errorf("expected 2 queries, got %d", len(all))
	}

	// List filtered
	conn1List := store.List("conn_1")
	if len(conn1List) != 1 || conn1List[0].Name != "User Report" {
		t.Errorf("expected 1 query for conn_1, got %v", conn1List)
	}

	// Get by ID
	fetched, err := store.Get(saved1.ID)
	if err != nil || fetched.Name != "User Report" {
		t.Errorf("Get failed: %v, fetched: %v", err, fetched)
	}

	// Reload store from disk
	reloadedStore, err := NewStore(storePath)
	if err != nil {
		t.Fatalf("reload NewStore failed: %v", err)
	}
	reloadedList := reloadedStore.List("")
	if len(reloadedList) != 2 {
		t.Errorf("expected 2 reloaded queries, got %d", len(reloadedList))
	}

	// Delete
	if err := store.Delete(saved1.ID); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if len(store.List("")) != 1 {
		t.Errorf("expected 1 query after delete, got %d", len(store.List("")))
	}
}
