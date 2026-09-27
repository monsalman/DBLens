package benchmark

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/driver"
	"github.com/dblens/dblens/internal/driver/types"
	_ "modernc.org/sqlite"
)

func TestCalculateLatencyStats(t *testing.T) {
	// 1. Empty slice
	min, p50, p90, p95, p99, max, mean, stddev, buckets := CalculateLatencyStats(nil, 10)
	if min != 0 || p50 != 0 || max != 0 || mean != 0 || buckets != nil {
		t.Fatalf("expected all zeros for empty latencies, got min=%.2f, max=%.2f", min, max)
	}

	// 2. Single item
	min, p50, p90, p95, p99, max, mean, stddev, buckets = CalculateLatencyStats([]float64{42.5}, 5)
	if min != 42.5 || max != 42.5 || p50 != 42.5 || p90 != 42.5 || p95 != 42.5 || p99 != 42.5 || mean != 42.5 || stddev != 0 {
		t.Fatalf("unexpected single value stats: min=%.2f, p50=%.2f, max=%.2f, mean=%.2f", min, p50, max, mean)
	}
	if len(buckets) != 1 || buckets[0].Count != 1 {
		t.Fatalf("expected 1 bucket for single item, got %d", len(buckets))
	}

	// 3. Known distribution: 1 to 100
	lats := make([]float64, 100)
	for i := 0; i < 100; i++ {
		lats[i] = float64(i + 1)
	}
	min, p50, p90, p95, p99, max, mean, stddev, buckets = CalculateLatencyStats(lats, 10)
	if min != 1.0 {
		t.Errorf("expected min 1.0, got %.2f", min)
	}
	if max != 100.0 {
		t.Errorf("expected max 100.0, got %.2f", max)
	}
	if mean != 50.5 {
		t.Errorf("expected mean 50.5, got %.2f", mean)
	}
	if math.Abs(p50-50.5) > 0.6 {
		t.Errorf("expected p50 around 50.5, got %.2f", p50)
	}
	if math.Abs(p95-95.05) > 1.0 {
		t.Errorf("expected p95 around 95.05, got %.2f", p95)
	}
	if math.Abs(p99-99.01) > 1.0 {
		t.Errorf("expected p99 around 99.01, got %.2f", p99)
	}
	if len(buckets) != 10 {
		t.Errorf("expected 10 buckets, got %d", len(buckets))
	}

	var bucketSum int64
	for _, b := range buckets {
		bucketSum += b.Count
	}
	if bucketSum != 100 {
		t.Errorf("expected bucket sum 100, got %d", bucketSum)
	}
}

func TestCompareBenchmarks(t *testing.T) {
	base := BenchmarkResult{
		ID:            "base",
		SQL:           "SELECT 1",
		QPS:           1000.0,
		P50LatencyMs:  5.0,
		P95LatencyMs:  12.0,
		P99LatencyMs:  20.0,
		MeanLatencyMs: 6.0,
		TotalQueries:  5000,
	}

	candBetter := BenchmarkResult{
		ID:            "cand",
		SQL:           "SELECT 1 /* indexed */",
		QPS:           1500.0,
		P50LatencyMs:  3.0,
		P95LatencyMs:  7.0,
		P99LatencyMs:  11.0,
		MeanLatencyMs: 3.5,
		TotalQueries:  7500,
	}

	comp := CompareBenchmarks(base, candBetter)
	if comp.Winner != "candidate" {
		t.Fatalf("expected candidate to win, got %s", comp.Winner)
	}
	if comp.QpsDelta != 500.0 {
		t.Errorf("expected qpsDelta 500.0, got %.2f", comp.QpsDelta)
	}
	if comp.QpsDeltaPct != 50.0 {
		t.Errorf("expected qpsDeltaPct 50.0, got %.2f", comp.QpsDeltaPct)
	}
	if comp.P95DeltaMs != -5.0 {
		t.Errorf("expected p95DeltaMs -5.0, got %.2f", comp.P95DeltaMs)
	}

	// Inverse: base is better
	comp2 := CompareBenchmarks(candBetter, base)
	if comp2.Winner != "baseline" {
		t.Fatalf("expected baseline to win, got %s", comp2.Winner)
	}

	// Tie
	compTie := CompareBenchmarks(base, base)
	if compTie.Winner != "tie" {
		t.Fatalf("expected tie, got %s", compTie.Winner)
	}
}

func TestReporter_Markdown(t *testing.T) {
	now := time.Now()
	passed := true
	res := &BenchmarkResult{
		ID:                "bm_test123",
		SQL:               "SELECT id, name FROM users WHERE active = 1",
		Concurrency:       8,
		Rollback:          false,
		Status:            "completed",
		TotalQueries:      1200,
		SuccessfulQueries: 1200,
		FailedQueries:     0,
		DurationMs:        1500.25,
		QPS:               800.0,
		MinLatencyMs:      0.5,
		MeanLatencyMs:     2.1,
		P50LatencyMs:      1.8,
		P90LatencyMs:      3.5,
		P95LatencyMs:      4.2,
		P99LatencyMs:      7.8,
		MaxLatencyMs:      15.4,
		StdDevMs:          1.2,
		Histogram: []HistogramBucket{
			{FromMs: 0.5, ToMs: 5.0, Count: 1100},
			{FromMs: 5.0, ToMs: 16.0, Count: 100},
		},
		StartedAt:    now,
		CompletedAt:  &now,
		AssertPassed: &passed,
		Label:        "User Query Benchmark",
	}

	md := GenerateMarkdownReport(res)
	if !strings.Contains(md, "User Query Benchmark") {
		t.Error("expected label in report")
	}
	if !strings.Contains(md, "bm_test123") {
		t.Error("expected benchmark ID in report")
	}
	if !strings.Contains(md, "800.0 queries/sec") {
		t.Error("expected QPS in report")
	}
	if !strings.Contains(md, "PASSED") {
		t.Error("expected quality gate pass in report")
	}

	// Comparison report
	comp := CompareBenchmarks(*res, *res)
	compMd := GenerateComparisonMarkdown(comp)
	if !strings.Contains(compMd, "Head-to-Head Comparison") {
		t.Error("expected comparison section in compMd")
	}
	if !strings.Contains(compMd, "TIE") {
		t.Error("expected tie winner in compMd")
	}
}

func setupTestDB(t *testing.T) (*driver.Driver, string) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "bench_test.db")
	dsn := fmt.Sprintf("sqlite://%s", dbPath)

	drv, err := driver.NewDriver(dsn)
	if err != nil {
		t.Fatalf("failed to create sqlite driver: %v", err)
	}

	// Create test table
	ctx := context.Background()
	_, err = drv.ExecuteQuery(ctx, "CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, val INT);")
	if err != nil {
		t.Fatalf("failed to create items table: %v", err)
	}

	// Seed 20 rows
	for i := 1; i <= 20; i++ {
		_, err = drv.ExecuteQuery(ctx, fmt.Sprintf("INSERT INTO items (name, val) VALUES ('item_%d', %d);", i, i*10))
		if err != nil {
			t.Fatalf("failed to seed row: %v", err)
		}
	}

	return &drv, dbPath
}

func TestBenchmarkWorker_Iterations(t *testing.T) {
	drvPtr, _ := setupTestDB(t)
	drv := *drvPtr
	defer drv.Close()

	cfg := BenchmarkConfig{
		ID:          "bm_iter_test",
		SQL:         "SELECT id, name, val FROM items WHERE val > 50;",
		Concurrency: 4,
		Iterations:  40,
		Rollback:    false,
		AssertP99Lt: 500.0,
	}

	ctx := context.Background()
	res, err := runWorkerPool(ctx, drv, cfg, nil)
	if err != nil {
		t.Fatalf("runWorkerPool failed: %v", err)
	}

	if res.Status != "completed" {
		t.Errorf("expected status completed, got %s", res.Status)
	}
	if res.SuccessfulQueries != 40 {
		t.Errorf("expected exactly 40 successful queries, got %d", res.SuccessfulQueries)
	}
	if res.FailedQueries != 0 {
		t.Errorf("expected 0 failed queries, got %d", res.FailedQueries)
	}
	if res.QPS <= 0 {
		t.Errorf("expected positive QPS, got %.2f", res.QPS)
	}
	if res.AssertPassed == nil || !*res.AssertPassed {
		t.Error("expected assertion to pass")
	}
}

func TestBenchmarkWorker_RollbackMode(t *testing.T) {
	drvPtr, dbPath := setupTestDB(t)
	drv := *drvPtr
	defer drv.Close()

	// Initial count
	rawDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("failed to open raw sqlite: %v", err)
	}
	defer rawDB.Close()

	var initCount int
	if err := rawDB.QueryRow("SELECT COUNT(*) FROM items;").Scan(&initCount); err != nil {
		t.Fatalf("query count failed: %v", err)
	}
	if initCount != 20 {
		t.Fatalf("expected initial count 20, got %d", initCount)
	}

	// Benchmark with INSERT query and Rollback = true
	cfg := BenchmarkConfig{
		ID:          "bm_rollback_test",
		SQL:         "INSERT INTO items (name, val) VALUES ('stress_write', 999);",
		Concurrency: 2,
		Iterations:  25,
		Rollback:    true,
	}

	ctx := context.Background()
	res, err := runWorkerPool(ctx, drv, cfg, nil)
	if err != nil {
		t.Fatalf("runWorkerPool failed: %v", err)
	}

	if res.SuccessfulQueries != 25 {
		t.Fatalf("expected 25 successful rollback writes, got %d (failed: %d)", res.SuccessfulQueries, res.FailedQueries)
	}

	// Verify table count did NOT increase
	var postCount int
	if err := rawDB.QueryRow("SELECT COUNT(*) FROM items;").Scan(&postCount); err != nil {
		t.Fatalf("post query count failed: %v", err)
	}
	if postCount != 20 {
		t.Fatalf("SAFEGUARD FAILED: table rows modified during rollback benchmark! Expected 20, found %d", postCount)
	}
}

func TestBenchmarkWorker_Cancellation(t *testing.T) {
	drvPtr, _ := setupTestDB(t)
	drv := *drvPtr
	defer drv.Close()

	cfg := BenchmarkConfig{
		ID:          "bm_cancel_test",
		SQL:         "SELECT count(*) FROM items;",
		Concurrency: 2,
		Duration:    10 * time.Second,
	}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	res, _ := runWorkerPool(ctx, drv, cfg, nil)
	if res == nil {
		t.Fatal("expected result even after cancellation")
	}
	if res.TotalQueries == 0 {
		t.Fatal("expected some queries executed before cancel")
	}
}

func TestBenchmarkManager_Lifecycle(t *testing.T) {
	drvPtr, _ := setupTestDB(t)
	drv := *drvPtr
	defer drv.Close()

	mgr := NewBenchmarkManager()

	cfg := BenchmarkConfig{
		SQL:         "SELECT id FROM items LIMIT 5;",
		Concurrency: 2,
		DurationSec: 1,
	}

	ctx := context.Background()
	ab, err := mgr.Start(ctx, drv, cfg)
	if err != nil {
		t.Fatalf("failed to start benchmark: %v", err)
	}

	if ab.ID == "" {
		t.Fatal("expected generated benchmark ID")
	}

	// Test subscription
	ch, unsub := ab.Subscribe()
	defer unsub()

	var gotProgress bool
	select {
	case p := <-ch:
		if p.BenchmarkID == ab.ID {
			gotProgress = true
		}
	case <-time.After(500 * time.Millisecond):
	}
	if !gotProgress {
		t.Error("expected to receive initial progress via subscriber")
	}

	// Wait for completion
	select {
	case <-ab.doneCh:
	case <-time.After(3 * time.Second):
		t.Fatal("benchmark did not finish in time")
	}

	// Check history
	res, found := mgr.Get(ab.ID)
	if !found || res == nil {
		t.Fatalf("expected benchmark %s in manager history", ab.ID)
	}
	if res.Status != "completed" {
		t.Errorf("expected status completed, got %s", res.Status)
	}
	if res.TotalQueries <= 0 {
		t.Errorf("expected total queries > 0, got %d", res.TotalQueries)
	}
}

type driverWithoutRawDB struct {
	types.Driver
}

func TestBenchmarkWorker_RollbackRequiresRawDB(t *testing.T) {
	drvPtr, _ := setupTestDB(t)
	drv := *drvPtr
	defer drv.Close()

	d := driverWithoutRawDB{Driver: drv}

	cfg := BenchmarkConfig{
		ID:          "bm_no_rawdb_rollback",
		SQL:         "INSERT INTO items (name, val) VALUES ('test', 123);",
		Concurrency: 1,
		Iterations:  5,
		Rollback:    true,
	}

	_, err := runWorkerPool(context.Background(), d, cfg, nil)
	if err == nil {
		t.Fatal("expected error when rawDB is nil in rollback mode, got nil")
	}
	if !strings.Contains(err.Error(), "transactional rollback requires raw database connection") {
		t.Errorf("expected descriptive rollback error, got: %v", err)
	}
}

func TestBenchmarkManager_HistoryCap50(t *testing.T) {
	mgr := NewBenchmarkManager()

	for i := 1; i <= 60; i++ {
		id := fmt.Sprintf("bench_%02d", i)
		mgr.recordHistory(id, &BenchmarkResult{
			ID:     id,
			Status: "completed",
		})
	}

	if len(mgr.history) != 50 {
		t.Fatalf("expected history capped at 50, got %d", len(mgr.history))
	}

	// First 10 items (bench_01 to bench_10) should have been evicted
	for i := 1; i <= 10; i++ {
		id := fmt.Sprintf("bench_%02d", i)
		if _, found := mgr.Get(id); found {
			t.Errorf("expected %s to be evicted from history", id)
		}
	}

	// Last 50 items (bench_11 to bench_60) should exist
	for i := 11; i <= 60; i++ {
		id := fmt.Sprintf("bench_%02d", i)
		if _, found := mgr.Get(id); !found {
			t.Errorf("expected %s to be present in history", id)
		}
	}
}
