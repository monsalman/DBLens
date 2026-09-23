package profile_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/driver/sqlite"
	"github.com/dblens/dblens/internal/profile"
)

func TestProfileSQLBuilder(t *testing.T) {
	// Quoting & dialect normalization
	if profile.NormalizeDialect("PostgreSQL") != "postgres" {
		t.Fatalf("expected postgres")
	}
	if profile.NormalizeDialect("mariadb") != "mysql" {
		t.Fatalf("expected mysql")
	}
	if profile.NormalizeDialect("sqlite3") != "sqlite" {
		t.Fatalf("expected sqlite")
	}

	pgCol := profile.QuoteIdentifier("postgres", "user")
	if pgCol != `"user"` {
		t.Fatalf("unexpected pg quote: %s", pgCol)
	}
	myCol := profile.QuoteIdentifier("mysql", "order")
	if myCol != "`order`" {
		t.Fatalf("unexpected mysql quote: %s", myCol)
	}

	tbl := profile.QualifyTable("postgres", "public", "accounts")
	if tbl != `"public"."accounts"` {
		t.Fatalf("unexpected pg table: %s", tbl)
	}

	sqTbl := profile.QualifyTable("sqlite", "main", "users")
	if sqTbl != `"users"` {
		t.Fatalf("unexpected sqlite table: %s", sqTbl)
	}

	metricsQ := profile.BuildColumnMetricsQuery("postgres", `"users"`, `"age"`, false, true)
	if !strings.Contains(metricsQ, "MIN(") || !strings.Contains(metricsQ, "STDDEV_POP(") {
		t.Fatalf("unexpected metrics query: %s", metricsQ)
	}

	textQ := profile.BuildColumnMetricsQuery("sqlite", `"users"`, `"bio"`, true, false)
	if !strings.Contains(textQ, "SUM(CASE WHEN") {
		t.Fatalf("unexpected text query: %s", textQ)
	}

	topQ := profile.BuildTopValuesQuery(`"users"`, `"country"`, 10)
	if !strings.Contains(topQ, "GROUP BY") || !strings.Contains(topQ, "LIMIT 10") {
		t.Fatalf("unexpected top values query: %s", topQ)
	}
}

func TestRunProfileOnSQLite(t *testing.T) {
	dbFile := "/tmp/dblens_profile_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	drv, err := sqlite.New("sqlite://" + dbFile)
	if err != nil {
		t.Fatalf("failed to init sqlite: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()

	// Seed test schema and data
	_, err = drv.ExecuteQuery(ctx, `
		CREATE TABLE customers (
			id INTEGER PRIMARY KEY,
			email TEXT,
			age INTEGER,
			country TEXT,
			status TEXT,
			notes TEXT
		);
	`)
	if err != nil {
		t.Fatalf("failed to create table: %v", err)
	}

	// 5 rows:
	// id: 1, 2, 3, 4, 5 (unique, 0 nulls)
	// email: valid emails, 1 null (PII detection)
	// age: 20, 25, 30, null, 40 (min 20, max 40, avg 28.75)
	// country: 'US', 'US', 'US', 'US', 'US' (constant)
	// status: 'active', 'active', 'inactive', 'pending', 'pending' (low cardinality)
	// notes: 'hello', '', '', null, 'world' (empty strings & nulls)
	_, err = drv.ExecuteQuery(ctx, `
		INSERT INTO customers (id, email, age, country, status, notes) VALUES
		(1, 'alice@example.com', 20, 'US', 'active', 'hello'),
		(2, 'bob@company.org', 25, 'US', 'active', ''),
		(3, 'carol@domain.io', 30, 'US', 'inactive', ''),
		(4, NULL, NULL, 'US', 'pending', NULL),
		(5, 'eve@test.com', 40, 'US', 'pending', 'world');
	`)
	if err != nil {
		t.Fatalf("failed to insert test data: %v", err)
	}

	rep, err := profile.RunProfile(ctx, drv, profile.ProfileRequest{
		Table: "customers",
	})
	if err != nil {
		t.Fatalf("RunProfile failed: %v", err)
	}

	if rep == nil {
		t.Fatalf("expected non-nil report")
	}
	if rep.TotalRows != 5 {
		t.Fatalf("expected 5 rows, got %d", rep.TotalRows)
	}
	if len(rep.Columns) != 6 {
		t.Fatalf("expected 6 columns, got %d", len(rep.Columns))
	}

	colMap := make(map[string]profile.ColumnProfile)
	for _, c := range rep.Columns {
		colMap[c.ColumnName] = c
	}

	// Verify id
	idCol := colMap["id"]
	if idCol.NullCount != 0 {
		t.Errorf("id: expected 0 nulls, got %d", idCol.NullCount)
	}
	if idCol.DistinctCount != 5 {
		t.Errorf("id: expected 5 distinct, got %d", idCol.DistinctCount)
	}
	if !hasFlag(idCol.QualityFlags, "unique_candidate") {
		t.Errorf("id: expected unique_candidate flag, got %v", idCol.QualityFlags)
	}

	// Verify email (PII)
	emailCol := colMap["email"]
	if emailCol.PIIType != "email" {
		t.Errorf("email: expected email PII, got %q", emailCol.PIIType)
	}
	if !hasFlag(emailCol.QualityFlags, "potential_pii") {
		t.Errorf("email: expected potential_pii flag, got %v", emailCol.QualityFlags)
	}
	if emailCol.NullCount != 1 {
		t.Errorf("email: expected 1 null, got %d", emailCol.NullCount)
	}

	// Verify age (numeric)
	ageCol := colMap["age"]
	if ageCol.MinVal == nil || *ageCol.MinVal != 20 {
		t.Errorf("age: expected min 20, got %v", ageCol.MinVal)
	}
	if ageCol.MaxVal == nil || *ageCol.MaxVal != 40 {
		t.Errorf("age: expected max 40, got %v", ageCol.MaxVal)
	}
	if len(ageCol.Histogram) == 0 {
		t.Errorf("age: expected histogram buckets, got none")
	}

	// Verify country (constant)
	countryCol := colMap["country"]
	if !hasFlag(countryCol.QualityFlags, "constant") {
		t.Errorf("country: expected constant flag, got %v", countryCol.QualityFlags)
	}

	// Verify notes (empty strings)
	notesCol := colMap["notes"]
	if notesCol.EmptyCount != 2 {
		t.Errorf("notes: expected 2 empty strings, got %d", notesCol.EmptyCount)
	}
	if !hasFlag(notesCol.QualityFlags, "empty_strings") {
		t.Errorf("notes: expected empty_strings flag, got %v", notesCol.QualityFlags)
	}

	// Suggestions check
	if len(rep.Suggestions) == 0 {
		t.Errorf("expected suggestions, got none")
	}

	// Markdown export
	md := profile.ExportMarkdown(rep)
	if !strings.Contains(md, "# Data Profile Report: customers") {
		t.Errorf("markdown missing title: %s", md)
	}
	if !strings.Contains(md, "alice@example.com") {
		t.Errorf("markdown missing top value: %s", md)
	}

	// CompareReports test
	targetRep := *rep
	targetRep.TotalRows = 10
	diff := profile.CompareReports(rep, &targetRep)
	if diff.RowDiff != 5 {
		t.Errorf("expected row diff 5, got %d", diff.RowDiff)
	}
}

func hasFlag(flags []string, target string) bool {
	for _, f := range flags {
		if f == target {
			return true
		}
	}
	return false
}
