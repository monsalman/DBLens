package benchmark

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
)

type dbProvider interface {
	DB() *sql.DB
}

type progressCallback func(progress BenchmarkProgress)

// runWorkerPool orchestrates concurrent workers executing the benchmark query.
func runWorkerPool(ctx context.Context, drv types.Driver, cfg BenchmarkConfig, onProgress progressCallback) (*BenchmarkResult, error) {
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 1
	}

	var ctxRun context.Context
	var cancelRun context.CancelFunc

	if cfg.Duration > 0 {
		ctxRun, cancelRun = context.WithTimeout(ctx, cfg.Duration)
	} else {
		ctxRun, cancelRun = context.WithCancel(ctx)
	}
	defer cancelRun()

	var (
		totalCount   int64
		successCount int64
		failedCount  int64
		workerLats   = make([][]float64, cfg.Concurrency)
		errMapMu     sync.Mutex
		errMap       = make(map[string]int64)
		wg           sync.WaitGroup
		startTime    = time.Now()
	)

	// Check if driver exposes raw *sql.DB for robust transaction rollbacks
	dbProv, hasDB := drv.(dbProvider)
	var rawDB *sql.DB
	if hasDB && dbProv != nil {
		rawDB = dbProv.DB()
	}

	if cfg.Rollback && rawDB == nil {
		return nil, fmt.Errorf("transactional rollback requires raw database connection")
	}

	// Progress ticker
	tickerDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(150 * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-tickerDone:
				return
			case <-ctxRun.Done():
				return
			case <-ticker.C:
				if onProgress == nil {
					continue
				}
				elapsed := time.Since(startTime)
				elapsedMs := float64(elapsed.Microseconds()) / 1000.0
				tot := atomic.LoadInt64(&totalCount)
				succ := atomic.LoadInt64(&successCount)
				fail := atomic.LoadInt64(&failedCount)

				var currentQps float64
				if elapsed.Seconds() > 0 {
					currentQps = round2(float64(succ) / elapsed.Seconds())
				}

				var pct float64
				if cfg.Iterations > 0 {
					pct = math.Min(100.0, round2((float64(tot)/float64(cfg.Iterations))*100.0))
				} else if cfg.Duration > 0 {
					pct = math.Min(100.0, round2((elapsed.Seconds()/cfg.Duration.Seconds())*100.0))
				}

				onProgress(BenchmarkProgress{
					BenchmarkID:       cfg.ID,
					Status:            "running",
					ElapsedMs:         elapsedMs,
					Percent:           pct,
					TotalQueries:      tot,
					SuccessfulQueries: succ,
					FailedQueries:     fail,
					CurrentQPS:        currentQps,
				})
			}
		}
	}()

	// Launch workers
	for w := 0; w < cfg.Concurrency; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()

			latencies := make([]float64, 0, 1024)

			for {
				if ctxRun.Err() != nil {
					break
				}

				// Check iteration bounds
				if cfg.Iterations > 0 {
					cur := atomic.AddInt64(&totalCount, 1)
					if cur > int64(cfg.Iterations) {
						break
					}
				} else {
					atomic.AddInt64(&totalCount, 1)
				}

				queryStart := time.Now()
				var queryErr error

				if cfg.Rollback {
					queryErr = executeWithRollback(ctxRun, drv, rawDB, cfg.SQL)
				} else {
					_, queryErr = drv.ExecuteQuery(ctxRun, cfg.SQL)
				}

				queryDuration := time.Since(queryStart)
				durMs := float64(queryDuration.Microseconds()) / 1000.0

				if queryErr != nil {
					atomic.AddInt64(&failedCount, 1)
					recordError(&errMapMu, errMap, queryErr.Error())
				} else {
					atomic.AddInt64(&successCount, 1)
					latencies = append(latencies, durMs)
				}
			}

			workerLats[workerID] = latencies
		}(w)
	}

	wg.Wait()
	close(tickerDone)

	totalElapsed := time.Since(startTime)
	durationMs := float64(totalElapsed.Microseconds()) / 1000.0

	// Aggregate latencies
	var totalSuccessful int
	for _, lats := range workerLats {
		totalSuccessful += len(lats)
	}

	allLatencies := make([]float64, 0, totalSuccessful)
	for _, lats := range workerLats {
		allLatencies = append(allLatencies, lats...)
	}

	min, p50, p90, p95, p99, max, mean, stddev, buckets := CalculateLatencyStats(allLatencies, 15)

	var qps float64
	if totalElapsed.Seconds() > 0 {
		qps = round2(float64(len(allLatencies)) / totalElapsed.Seconds())
	}

	errorsList := extractErrors(&errMapMu, errMap)

	completedAt := time.Now()
	res := &BenchmarkResult{
		ID:                cfg.ID,
		SQL:               cfg.SQL,
		Concurrency:       cfg.Concurrency,
		Rollback:          cfg.Rollback,
		Status:            "completed",
		TotalQueries:      atomic.LoadInt64(&totalCount),
		SuccessfulQueries: int64(len(allLatencies)),
		FailedQueries:     atomic.LoadInt64(&failedCount),
		DurationMs:        durationMs,
		QPS:               qps,
		MinLatencyMs:      min,
		MeanLatencyMs:     mean,
		P50LatencyMs:      p50,
		P90LatencyMs:      p90,
		P95LatencyMs:      p95,
		P99LatencyMs:      p99,
		MaxLatencyMs:      max,
		StdDevMs:          stddev,
		Histogram:         buckets,
		Errors:            errorsList,
		StartedAt:         startTime,
		CompletedAt:       &completedAt,
		Label:             cfg.Label,
	}

	// Adjust total count if iterations limit caused extra increment
	if cfg.Iterations > 0 && res.TotalQueries > int64(cfg.Iterations) {
		res.TotalQueries = int64(cfg.Iterations)
	}

	if cfg.AssertP99Lt > 0 {
		pass := res.P99LatencyMs < cfg.AssertP99Lt
		res.AssertPassed = &pass
	}

	return res, nil
}

func executeWithRollback(ctx context.Context, drv types.Driver, rawDB *sql.DB, query string) error {
	if rawDB == nil {
		return fmt.Errorf("transactional rollback requires raw database connection")
	}

	tx, err := rawDB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	rows, err := tx.QueryContext(ctx, query)
	if err == nil {
		for rows.Next() {
		}
		_ = rows.Close()
		return nil
	}

	// Try ExecContext if QueryContext failed (e.g. non-SELECT queries)
	_, execErr := tx.ExecContext(ctx, query)
	return execErr
}

func recordError(mu *sync.Mutex, errMap map[string]int64, msg string) {
	mu.Lock()
	defer mu.Unlock()
	if len(msg) > 200 {
		msg = msg[:197] + "..."
	}
	errMap[msg]++
}

func extractErrors(mu *sync.Mutex, errMap map[string]int64) []BenchmarkError {
	mu.Lock()
	defer mu.Unlock()
	if len(errMap) == 0 {
		return nil
	}
	out := make([]BenchmarkError, 0, len(errMap))
	for msg, count := range errMap {
		out = append(out, BenchmarkError{
			Message: msg,
			Count:   count,
		})
	}
	return out
}

func (b *BenchmarkResult) String() string {
	return fmt.Sprintf("Benchmark[%s]: %d queries in %.2fms (%.1f QPS), P50=%.2fms, P95=%.2fms, P99=%.2fms",
		b.ID, b.TotalQueries, b.DurationMs, b.QPS, b.P50LatencyMs, b.P95LatencyMs, b.P99LatencyMs)
}
