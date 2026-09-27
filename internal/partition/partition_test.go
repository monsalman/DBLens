package partition

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/driver"
	"github.com/dblens/dblens/internal/driver/types"
)

// mockDriver implements types.Driver for testing Postgres & MySQL queries.
type mockDriver struct {
	dialect    string
	rawHandler func(ctx context.Context, sql string, args ...interface{}) (*types.QueryResult, error)
}

func (m *mockDriver) Dialect() string                                            { return m.dialect }
func (m *mockDriver) InspectDatabases(ctx context.Context) ([]string, error)     { return nil, nil }
func (m *mockDriver) SelectDatabase(ctx context.Context, dbName string) error    { return nil }
func (m *mockDriver) InspectSchemas(ctx context.Context) ([]string, error)       { return []string{"public"}, nil }
func (m *mockDriver) InspectTables(ctx context.Context, schema string) ([]types.TableMeta, error) {
	return nil, nil
}
func (m *mockDriver) InspectTableDetails(ctx context.Context, schema, table string) (*types.TableDetail, error) {
	return nil, nil
}
func (m *mockDriver) GenerateTableDDL(ctx context.Context, schema, table string) (string, error) {
	return "", nil
}
func (m *mockDriver) QueryTableData(ctx context.Context, opts types.QueryOptions) (*types.QueryResult, error) {
	return nil, nil
}
func (m *mockDriver) QueryTableStream(ctx context.Context, schema, table string) (*sql.Rows, error) {
	return nil, nil
}
func (m *mockDriver) ExecuteQuery(ctx context.Context, sql string) (*types.QueryResult, error) {
	return nil, nil
}
func (m *mockDriver) ExecuteQueryWithParams(ctx context.Context, sql string, params map[string]interface{}) (*types.QueryResult, error) {
	return nil, nil
}
func (m *mockDriver) ExecuteRaw(ctx context.Context, sql string, args ...interface{}) (*types.QueryResult, error) {
	if m.rawHandler != nil {
		return m.rawHandler(ctx, sql, args...)
	}
	return &types.QueryResult{}, nil
}
func (m *mockDriver) MutateRow(ctx context.Context, mut types.Mutation) (*types.MutationResult, error) {
	return nil, nil
}
func (m *mockDriver) BatchInsert(ctx context.Context, schema, table string, rows []map[string]interface{}) (*types.MutationResult, error) {
	return nil, nil
}
func (m *mockDriver) GetERDData(ctx context.Context) ([]types.ERDTable, error) { return nil, nil }
func (m *mockDriver) ExplainQuery(ctx context.Context, sql string, opts types.ExplainOptions) (*types.ExplainResult, error) {
	return nil, nil
}
func (m *mockDriver) InspectProcesses(ctx context.Context) ([]types.ProcessInfo, error) {
	return nil, nil
}
func (m *mockDriver) KillProcess(ctx context.Context, id string) error           { return nil }
func (m *mockDriver) InspectHealth(ctx context.Context) (*types.HealthReport, error) {
	return nil, nil
}
func (m *mockDriver) Ping(ctx context.Context) error { return nil }
func (m *mockDriver) Close() error                  { return nil }

func TestCalculateSkewIndex(t *testing.T) {
	// Empty or single item
	if skew := CalculateSkewIndex(nil); skew != 0.0 {
		t.Errorf("expected 0.0 for nil partitions, got %f", skew)
	}
	if skew := CalculateSkewIndex([]PartitionNode{{Bytes: 100}}); skew != 0.0 {
		t.Errorf("expected 0.0 for single partition, got %f", skew)
	}

	// Uniform distribution
	uniform := []PartitionNode{
		{Bytes: 1000, Rows: 100},
		{Bytes: 1000, Rows: 100},
		{Bytes: 1000, Rows: 100},
	}
	if skew := CalculateSkewIndex(uniform); skew != 0.0 {
		t.Errorf("expected 0.0 for uniform, got %f", skew)
	}

	// High skew
	skewed := []PartitionNode{
		{Bytes: 9000, Rows: 900},
		{Bytes: 500, Rows: 50},
		{Bytes: 500, Rows: 50},
	}
	skew := CalculateSkewIndex(skewed)
	if skew < 1.0 {
		t.Errorf("expected high skew index > 1.0, got %f", skew)
	}
}

func TestAssignPartitionStatusAndHealth(t *testing.T) {
	parts := []PartitionNode{
		{Name: "orders_2026_01", Bytes: 8000000, ByteSharePct: 80.0, BoundExpression: "FOR VALUES FROM ('2026-01-01') TO ('2026-02-01')"},
		{Name: "orders_2026_02", Bytes: 500000, ByteSharePct: 5.0, BoundExpression: "FOR VALUES FROM ('2026-02-01') TO ('2026-03-01')"},
		{Name: "orders_2026_03", Bytes: 500000, ByteSharePct: 5.0, BoundExpression: "FOR VALUES FROM ('2026-03-01') TO ('2026-04-01')"},
		{Name: "orders_2026_04", Bytes: 500000, ByteSharePct: 5.0, BoundExpression: "FOR VALUES FROM ('2026-04-01') TO ('2026-05-01')"},
		{Name: "orders_2026_05", Bytes: 500000, ByteSharePct: 5.0, BoundExpression: "FOR VALUES FROM ('2026-05-01') TO ('2026-06-01')"},
	}

	meanBytes := float64(10000000) / 5.0 // 2000000; 8000000 is 4x mean
	evaluated := AssignPartitionStatus(parts, meanBytes)

	if evaluated[0].Status != "hot_skew" {
		t.Errorf("expected orders_2026_01 to be hot_skew, got %s", evaluated[0].Status)
	}
	if evaluated[1].Status != "healthy" {
		t.Errorf("expected orders_2026_02 to be healthy, got %s", evaluated[1].Status)
	}

	// Evaluate health with current time in 2026-06 (so partitions are in the past)
	fixedNow := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	report := EvaluatePartitionHealth("orders", "RANGE", evaluated, fixedNow)

	if !report.HasHotSkew {
		t.Errorf("expected report to have hot skew")
	}
	if !report.MissingFuture {
		t.Errorf("expected report to flag missing future partitions")
	}
	if report.Score >= 100 {
		t.Errorf("expected reduced health score, got %d", report.Score)
	}
	if len(report.Warnings) < 2 {
		t.Errorf("expected at least 2 warnings, got %d", len(report.Warnings))
	}
}

func TestGenerateUpcomingDDL(t *testing.T) {
	// Postgres Monthly
	plan, err := GenerateUpcomingDDL(GeneratePartitionDDLRequest{
		ParentTable:  "events",
		Schema:       "public",
		Dialect:      "postgres",
		Interval:     "month",
		Count:        2,
		StartDate:    "2026-10-01",
		PartitionKey: "created_at",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(plan.GeneratedDDL) != 2 {
		t.Fatalf("expected 2 DDL statements, got %d", len(plan.GeneratedDDL))
	}
	expectedFirst := `CREATE TABLE IF NOT EXISTS "public".events_2026_10 PARTITION OF "public".events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');`
	if plan.GeneratedDDL[0] != expectedFirst {
		t.Errorf("expected %q, got %q", expectedFirst, plan.GeneratedDDL[0])
	}

	// MySQL Range
	mysqlPlan, err := GenerateUpcomingDDL(GeneratePartitionDDLRequest{
		ParentTable: "logs",
		Dialect:     "mysql",
		Interval:    "day",
		Count:       1,
		StartDate:   "2026-12-01",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(mysqlPlan.GeneratedDDL) != 1 {
		t.Fatalf("expected 1 DDL statement, got %d", len(mysqlPlan.GeneratedDDL))
	}
	if !strings.Contains(mysqlPlan.GeneratedDDL[0], "ALTER TABLE `logs` ADD PARTITION") {
		t.Errorf("unexpected MySQL DDL: %s", mysqlPlan.GeneratedDDL[0])
	}

	// SQLite chunk
	sqlitePlan, err := GenerateUpcomingDDL(GeneratePartitionDDLRequest{
		ParentTable: "archive",
		Dialect:     "sqlite",
		Interval:    "year",
		Count:       1,
		StartDate:   "2027-01-01",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(sqlitePlan.GeneratedDDL) != 1 {
		t.Fatalf("expected 1 statement for sqlite, got %d", len(sqlitePlan.GeneratedDDL))
	}
	if !strings.Contains(sqlitePlan.GeneratedDDL[0], "CREATE TABLE IF NOT EXISTS archive_2027") {
		t.Errorf("unexpected SQLite DDL: %s", sqlitePlan.GeneratedDDL[0])
	}
}

func TestGenerateDetachDDL(t *testing.T) {
	// Postgres Concurrently
	ddl, err := GenerateDetachDDL(DetachPartitionRequest{
		ParentTable:   "orders",
		Schema:        "sales",
		PartitionName: "orders_2025_q1",
		Concurrently:  true,
	}, "postgres")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := `ALTER TABLE "sales"."orders" DETACH PARTITION "sales"."orders_2025_q1" CONCURRENTLY;`
	if ddl != expected {
		t.Errorf("expected %q, got %q", expected, ddl)
	}

	// MySQL Drop Partition
	myDDL, err := GenerateDetachDDL(DetachPartitionRequest{
		ParentTable:   "users",
		PartitionName: "p2024",
	}, "mysql")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if myDDL != "ALTER TABLE `users` DROP PARTITION `p2024`;" {
		t.Errorf("unexpected MySQL detach DDL: %s", myDDL)
	}

	// Validation
	_, err = GenerateDetachDDL(DetachPartitionRequest{}, "postgres")
	if err == nil {
		t.Errorf("expected error for empty request")
	}
}

func TestRenderMarkdown(t *testing.T) {
	topo := &PartitionTopology{
		ParentTable:  "metrics",
		Schema:       "public",
		Dialect:      "postgres",
		Strategy:     "RANGE",
		PartitionKey: "timestamp",
		TotalRows:    1500,
		TotalBytes:   1048576,
		SkewIndex:    0.25,
		Partitions: []PartitionNode{
			{
				Name:            "metrics_2026_01",
				BoundExpression: "FOR VALUES FROM ('2026-01-01') TO ('2026-02-01')",
				Rows:            500,
				RowSharePct:     33.3,
				Bytes:           349525,
				ByteSharePct:    33.3,
				Status:          "healthy",
			},
			{
				Name:            "metrics_2026_02",
				BoundExpression: "FOR VALUES FROM ('2026-02-01') TO ('2026-03-01')",
				Rows:            1000,
				RowSharePct:     66.7,
				Bytes:           699051,
				ByteSharePct:    66.7,
				Status:          "healthy",
			},
		},
		HealthReport: &PartitionHealthReport{
			ParentTable: "metrics",
			Score:       95,
			Warnings:    []string{"Upcoming partition headroom low"},
		},
	}

	md := RenderMarkdown(topo)
	if !strings.Contains(md, "# Partition & Shard Topology: public.metrics") {
		t.Errorf("expected markdown title, got:\n%s", md)
	}
	if !strings.Contains(md, "| `metrics_2026_01` |") {
		t.Errorf("expected table row for metrics_2026_01")
	}
	if !strings.Contains(md, "Upcoming partition headroom low") {
		t.Errorf("expected warning in markdown")
	}
}

func TestInspectTopologyPostgresMock(t *testing.T) {
	mock := &mockDriver{
		dialect: "postgres",
		rawHandler: func(ctx context.Context, query string, args ...interface{}) (*types.QueryResult, error) {
			if strings.Contains(query, "pg_partitioned_table") {
				return &types.QueryResult{
					Columns: []string{"partstrat", "partkey"},
					Rows: [][]interface{}{
						{"r", "log_date"},
					},
				}, nil
			}
			if strings.Contains(query, "pg_inherits") {
				return &types.QueryResult{
					Columns: []string{"partition_name", "partition_schema", "bound_expr", "row_count", "total_bytes"},
					Rows: [][]interface{}{
						{"app_logs_2026_01", "public", "FOR VALUES FROM ('2026-01-01') TO ('2026-02-01')", int64(100), int64(8192)},
						{"app_logs_2026_02", "public", "FOR VALUES FROM ('2026-02-01') TO ('2026-03-01')", int64(200), int64(16384)},
					},
				}, nil
			}
			return &types.QueryResult{}, nil
		},
	}

	topo, err := InspectTopology(context.Background(), mock, "public", "app_logs")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if topo.Strategy != "RANGE" {
		t.Errorf("expected RANGE strategy, got %s", topo.Strategy)
	}
	if topo.PartitionKey != "log_date" {
		t.Errorf("expected partition key log_date, got %s", topo.PartitionKey)
	}
	if len(topo.Partitions) != 2 {
		t.Fatalf("expected 2 partitions, got %d", len(topo.Partitions))
	}
	if topo.TotalRows != 300 {
		t.Errorf("expected total rows 300, got %d", topo.TotalRows)
	}
	if topo.TotalBytes != 24576 {
		t.Errorf("expected total bytes 24576, got %d", topo.TotalBytes)
	}
}

func TestInspectTopologyMySQLMock(t *testing.T) {
	mock := &mockDriver{
		dialect: "mysql",
		rawHandler: func(ctx context.Context, query string, args ...interface{}) (*types.QueryResult, error) {
			if strings.Contains(query, "information_schema.PARTITIONS") {
				return &types.QueryResult{
					Columns: []string{"PARTITION_NAME", "PARTITION_METHOD", "PARTITION_EXPRESSION", "PARTITION_DESCRIPTION", "TABLE_ROWS", "TOTAL_BYTES"},
					Rows: [][]interface{}{
						{"p0", "RANGE", "YEAR(created_at)", "2025", int64(500), int64(32768)},
						{"p1", "RANGE", "YEAR(created_at)", "2026", int64(600), int64(65536)},
					},
				}, nil
			}
			return &types.QueryResult{}, nil
		},
	}

	topo, err := InspectTopology(context.Background(), mock, "shop", "orders")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if topo.Strategy != "RANGE" {
		t.Errorf("expected RANGE strategy, got %s", topo.Strategy)
	}
	if len(topo.Partitions) != 2 {
		t.Fatalf("expected 2 partitions, got %d", len(topo.Partitions))
	}
	if topo.Partitions[0].BoundExpression != "VALUES LESS THAN (2025)" {
		t.Errorf("unexpected bound expression: %s", topo.Partitions[0].BoundExpression)
	}
}

func TestInspectTopologySQLiteReal(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_partition.db")
	drv, err := driver.NewDriver("sqlite://" + dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite driver: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()
	// Create base table and shard chunks
	_, err = drv.ExecuteRaw(ctx, `CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, msg TEXT);`)
	if err != nil {
		t.Fatalf("failed to create audit_logs: %v", err)
	}
	_, err = drv.ExecuteRaw(ctx, `CREATE TABLE audit_logs_2026_01 (id INTEGER PRIMARY KEY, msg TEXT);`)
	if err != nil {
		t.Fatalf("failed to create audit_logs_2026_01: %v", err)
	}
	_, err = drv.ExecuteRaw(ctx, `CREATE TABLE audit_logs_2026_02 (id INTEGER PRIMARY KEY, msg TEXT);`)
	if err != nil {
		t.Fatalf("failed to create audit_logs_2026_02: %v", err)
	}
	_, err = drv.ExecuteRaw(ctx, `INSERT INTO audit_logs_2026_01 (msg) VALUES ('test1'), ('test2');`)
	if err != nil {
		t.Fatalf("failed to insert: %v", err)
	}

	topo, err := InspectTopology(ctx, drv, "main", "audit_logs")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if topo.Strategy != "CHUNK" {
		t.Errorf("expected CHUNK strategy for sqlite shards, got %s", topo.Strategy)
	}
	if len(topo.Partitions) != 2 {
		t.Fatalf("expected 2 chunk partitions, got %d", len(topo.Partitions))
	}
}
