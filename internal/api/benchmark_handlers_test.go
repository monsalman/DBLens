package api_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/benchmark"
	"github.com/dblens/dblens/internal/connection"
)

func setupBenchmarkTestEnv(t *testing.T) (http.Handler, *api.Handler, string, func()) {
	t.Helper()
	dbFile := filepath.Join(t.TempDir(), fmt.Sprintf("dblens_bench_%d.db", time.Now().UnixNano()))
	dsn := "sqlite://" + dbFile

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to init db: %v", err)
	}

	ctx := context.Background()
	initSQL := `
		CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL,
			email TEXT NOT NULL,
			score INTEGER DEFAULT 0
		);
		INSERT INTO users (username, email, score) VALUES ('alice', 'alice@test.com', 100);
		INSERT INTO users (username, email, score) VALUES ('bob', 'bob@test.com', 200);
	`
	if _, err := entry.Driver.ExecuteQuery(ctx, initSQL); err != nil {
		t.Fatalf("failed to create tables: %v", err)
	}

	h, err := api.NewHandler(mgr)
	if err != nil {
		t.Fatalf("failed to create api handler: %v", err)
	}

	router := api.SetupRouter(h, api.RouterConfig{})
	cleanup := func() {
		h.Shutdown()
		_ = os.Remove(dbFile)
	}

	return router, h, dsn, cleanup
}

func TestBenchmarkRunAndGetHandler(t *testing.T) {
	router, _, dsn, cleanup := setupBenchmarkTestEnv(t)
	defer cleanup()

	// 1. Run benchmark
	reqBody, _ := json.Marshal(api.BenchmarkRunRequest{
		SQL:         "SELECT id, username FROM users WHERE score > 50;",
		Concurrency: 2,
		Iterations:  15,
		Rollback:    false,
		Label:       "Score Query",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/connections/test_conn/benchmark/run", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DBLENS-DSN", dsn)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var runEnvelope struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &runEnvelope); err != nil {
		t.Fatalf("failed to parse run response: %v", err)
	}

	benchID := runEnvelope.Data.ID
	if benchID == "" {
		t.Fatalf("expected benchmark id in response: %s", w.Body.String())
	}

	// Wait briefly for completion
	time.Sleep(200 * time.Millisecond)

	// 2. Get benchmark
	getReq := httptest.NewRequest(http.MethodGet, "/api/connections/test_conn/benchmark/"+benchID, nil)
	getReq.Header.Set("X-DBLENS-DSN", dsn)
	getW := httptest.NewRecorder()
	router.ServeHTTP(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("expected status 200 for get benchmark, got %d: %s", getW.Code, getW.Body.String())
	}

	var getEnvelope struct {
		Data benchmark.BenchmarkResult `json:"data"`
	}
	if err := json.Unmarshal(getW.Body.Bytes(), &getEnvelope); err != nil {
		t.Fatalf("failed to unmarshal benchmark result: %v", err)
	}

	res := getEnvelope.Data
	if res.ID != benchID {
		t.Errorf("expected ID %s, got %s", benchID, res.ID)
	}
	if res.TotalQueries == 0 {
		t.Error("expected totalQueries > 0")
	}
}

func TestBenchmarkStreamHandler(t *testing.T) {
	router, _, dsn, cleanup := setupBenchmarkTestEnv(t)
	defer cleanup()

	// Start a benchmark that runs for 2 seconds
	reqBody, _ := json.Marshal(api.BenchmarkRunRequest{
		SQL:         "SELECT count(*) FROM users;",
		Concurrency: 2,
		DurationSec: 2,
	})

	runReq := httptest.NewRequest(http.MethodPost, "/api/connections/test_conn/benchmark/run", bytes.NewReader(reqBody))
	runReq.Header.Set("Content-Type", "application/json")
	runReq.Header.Set("X-DBLENS-DSN", dsn)
	runW := httptest.NewRecorder()
	router.ServeHTTP(runW, runReq)

	var runEnvelope struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(runW.Body.Bytes(), &runEnvelope)
	benchID := runEnvelope.Data.ID

	// Connect SSE stream
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	streamReq := httptest.NewRequest(http.MethodGet, "/api/connections/test_conn/benchmark/"+benchID+"/stream", nil).WithContext(ctx)
	streamReq.Header.Set("X-DBLENS-DSN", dsn)
	streamW := httptest.NewRecorder()

	doneCh := make(chan struct{})
	go func() {
		router.ServeHTTP(streamW, streamReq)
		close(doneCh)
	}()

	<-doneCh

	bodyStr := streamW.Body.String()
	if !strings.Contains(bodyStr, "data:") {
		t.Fatalf("expected SSE data in stream response, got: %s", bodyStr)
	}
	if !strings.Contains(bodyStr, benchID) {
		t.Fatalf("expected benchID in stream response, got: %s", bodyStr)
	}
}

func TestBenchmarkCancelHandler(t *testing.T) {
	router, _, dsn, cleanup := setupBenchmarkTestEnv(t)
	defer cleanup()

	// Start long running benchmark
	reqBody, _ := json.Marshal(api.BenchmarkRunRequest{
		SQL:         "SELECT * FROM users;",
		Concurrency: 2,
		DurationSec: 30,
	})

	runReq := httptest.NewRequest(http.MethodPost, "/api/connections/test_conn/benchmark/run", bytes.NewReader(reqBody))
	runReq.Header.Set("Content-Type", "application/json")
	runReq.Header.Set("X-DBLENS-DSN", dsn)
	runW := httptest.NewRecorder()
	router.ServeHTTP(runW, runReq)

	var runEnvelope struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(runW.Body.Bytes(), &runEnvelope)
	benchID := runEnvelope.Data.ID

	// Cancel it
	cancelReq := httptest.NewRequest(http.MethodPost, "/api/connections/test_conn/benchmark/"+benchID+"/cancel", nil)
	cancelReq.Header.Set("X-DBLENS-DSN", dsn)
	cancelW := httptest.NewRecorder()
	router.ServeHTTP(cancelW, cancelReq)

	if cancelW.Code != http.StatusOK {
		t.Fatalf("expected 200 on cancel, got %d", cancelW.Code)
	}

	var cancelEnvelope struct {
		Data struct {
			Cancelled bool   `json:"cancelled"`
			ID        string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(cancelW.Body.Bytes(), &cancelEnvelope)
	if !cancelEnvelope.Data.Cancelled {
		t.Errorf("expected cancelled true, got: %v", cancelEnvelope)
	}
}

func TestBenchmarkCompareHandler(t *testing.T) {
	router, _, dsn, cleanup := setupBenchmarkTestEnv(t)
	defer cleanup()

	base := benchmark.BenchmarkResult{
		ID:           "b1",
		SQL:          "SELECT * FROM users",
		QPS:          500,
		P50LatencyMs: 4.0,
		P95LatencyMs: 10.0,
		P99LatencyMs: 15.0,
	}
	cand := benchmark.BenchmarkResult{
		ID:           "b2",
		SQL:          "SELECT id FROM users",
		QPS:          1000,
		P50LatencyMs: 2.0,
		P95LatencyMs: 5.0,
		P99LatencyMs: 8.0,
	}

	compareBody, _ := json.Marshal(api.BenchmarkCompareRequest{
		Baseline:  &base,
		Candidate: &cand,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/connections/test_conn/benchmark/compare", bytes.NewReader(compareBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DBLENS-DSN", dsn)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var compEnvelope struct {
		Data benchmark.BenchmarkComparison `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &compEnvelope); err != nil {
		t.Fatalf("failed to unmarshal comparison: %v", err)
	}

	comp := compEnvelope.Data
	if comp.Winner != "candidate" {
		t.Errorf("expected candidate winner, got %s", comp.Winner)
	}
	if comp.QpsDelta != 500 {
		t.Errorf("expected qpsDelta 500, got %.2f", comp.QpsDelta)
	}
}

func TestBenchmarkExportMDHandler(t *testing.T) {
	router, _, dsn, cleanup := setupBenchmarkTestEnv(t)
	defer cleanup()

	res := benchmark.BenchmarkResult{
		ID:                "export_test",
		SQL:               "SELECT 1",
		Concurrency:       4,
		DurationMs:        1000,
		QPS:               2000,
		TotalQueries:      2000,
		SuccessfulQueries: 2000,
		P50LatencyMs:      0.4,
		P95LatencyMs:      0.9,
		P99LatencyMs:      1.5,
		Histogram: []benchmark.HistogramBucket{
			{FromMs: 0.1, ToMs: 1.0, Count: 1950},
			{FromMs: 1.0, ToMs: 2.0, Count: 50},
		},
	}

	reqBody, _ := json.Marshal(api.BenchmarkExportRequest{
		Result: &res,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/connections/test_conn/benchmark/export.md", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DBLENS-DSN", dsn)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	contentType := w.Header().Get("Content-Type")
	if !strings.Contains(contentType, "text/markdown") {
		t.Errorf("expected Content-Type text/markdown, got: %s", contentType)
	}

	body := w.Body.String()
	if !strings.Contains(body, "# DBLens Latency Benchmark Report") {
		t.Errorf("expected markdown report heading, got: %s", body)
	}
	if !strings.Contains(body, "2000.0 queries/sec") {
		t.Errorf("expected QPS in report, got: %s", body)
	}
}

func TestBenchmarkSafeMode(t *testing.T) {
	router, _, dsn, cleanup := setupBenchmarkTestEnv(t)
	defer cleanup()

	// 1. Mutating query with ReadOnly and Rollback = false should be rejected with 403
	reqBody, _ := json.Marshal(api.BenchmarkRunRequest{
		SQL:         "DELETE FROM users WHERE id = 1;",
		Concurrency: 1,
		DurationSec: 1,
		Rollback:    false,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/connections/test_conn/benchmark/run", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("X-DBLENS-READONLY", "true")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for mutating query in read-only mode without rollback, got %d", w.Code)
	}

	// 2. Mutating query with ReadOnly and Rollback = true should be permitted
	reqBodyRollback, _ := json.Marshal(api.BenchmarkRunRequest{
		SQL:         "DELETE FROM users WHERE id = 1;",
		Concurrency: 1,
		Iterations:  2,
		Rollback:    true,
	})

	reqRollback := httptest.NewRequest(http.MethodPost, "/api/connections/test_conn/benchmark/run", bytes.NewReader(reqBodyRollback))
	reqRollback.Header.Set("Content-Type", "application/json")
	reqRollback.Header.Set("X-DBLENS-DSN", dsn)
	reqRollback.Header.Set("X-DBLENS-READONLY", "true")
	wRollback := httptest.NewRecorder()
	router.ServeHTTP(wRollback, reqRollback)

	if wRollback.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for rollback write in read-only mode, got %d: %s", wRollback.Code, wRollback.Body.String())
	}
}

// suppress unused import warnings if any
var _ = bufio.ScanLines
