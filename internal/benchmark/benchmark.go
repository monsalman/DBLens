package benchmark

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
)

// BenchmarkConfig defines parameters for a benchmark execution.
type BenchmarkConfig struct {
	ID          string        `json:"id,omitempty"`
	SQL         string        `json:"sql"`
	Concurrency int           `json:"concurrency"`
	DurationSec int           `json:"durationSec,omitempty"`
	Duration    time.Duration `json:"duration,omitempty"`
	Iterations  int           `json:"iterations,omitempty"`
	Rollback    bool          `json:"rollback"`
	AssertP99Lt float64       `json:"assertP99Lt,omitempty"`
	Label       string        `json:"label,omitempty"`
}

// HistogramBucket represents an interval of latencies and total observation count.
type HistogramBucket struct {
	FromMs float64 `json:"fromMs"`
	ToMs   float64 `json:"toMs"`
	Count  int64   `json:"count"`
}

// BenchmarkError aggregates unique error messages encountered during runs.
type BenchmarkError struct {
	Message string `json:"message"`
	Count   int64  `json:"count"`
}

// BenchmarkResult stores the finalized metrics of a completed benchmark.
type BenchmarkResult struct {
	ID                string            `json:"id"`
	SQL               string            `json:"sql"`
	Concurrency       int               `json:"concurrency"`
	Rollback          bool              `json:"rollback"`
	Status            string            `json:"status"` // "running", "completed", "cancelled", "failed"
	TotalQueries      int64             `json:"totalQueries"`
	SuccessfulQueries int64             `json:"successfulQueries"`
	FailedQueries     int64             `json:"failedQueries"`
	DurationMs        float64           `json:"durationMs"`
	QPS               float64           `json:"qps"`
	MinLatencyMs      float64           `json:"minLatencyMs"`
	MeanLatencyMs     float64           `json:"meanLatencyMs"`
	P50LatencyMs      float64           `json:"p50LatencyMs"`
	P90LatencyMs      float64           `json:"p90LatencyMs"`
	P95LatencyMs      float64           `json:"p95LatencyMs"`
	P99LatencyMs      float64           `json:"p99LatencyMs"`
	MaxLatencyMs      float64           `json:"maxLatencyMs"`
	StdDevMs          float64           `json:"stdDevMs"`
	Histogram         []HistogramBucket `json:"histogram"`
	Errors            []BenchmarkError  `json:"errors"`
	StartedAt         time.Time         `json:"startedAt"`
	CompletedAt       *time.Time        `json:"completedAt,omitempty"`
	AssertPassed      *bool             `json:"assertPassed,omitempty"`
	Label             string            `json:"label,omitempty"`
}

// BenchmarkComparison details relative performance deltas between baseline and candidate benchmarks.
type BenchmarkComparison struct {
	Baseline     BenchmarkResult `json:"baseline"`
	Candidate    BenchmarkResult `json:"candidate"`
	QpsDelta     float64         `json:"qpsDelta"`
	QpsDeltaPct  float64         `json:"qpsDeltaPct"`
	P50DeltaMs   float64         `json:"p50DeltaMs"`
	P50DeltaPct  float64         `json:"p50DeltaPct"`
	P95DeltaMs   float64         `json:"p95DeltaMs"`
	P95DeltaPct  float64         `json:"p95DeltaPct"`
	P99DeltaMs   float64         `json:"p99DeltaMs"`
	P99DeltaPct  float64         `json:"p99DeltaPct"`
	MeanDeltaMs  float64         `json:"meanDeltaMs"`
	MeanDeltaPct float64         `json:"meanDeltaPct"`
	Winner       string          `json:"winner"` // "candidate", "baseline", "tie"
	Summary      string          `json:"summary"`
}

// BenchmarkProgress conveys live execution metrics over SSE streams.
type BenchmarkProgress struct {
	BenchmarkID       string           `json:"benchmarkId"`
	Status            string           `json:"status"` // "running", "completed", "cancelled", "failed"
	ElapsedMs         float64          `json:"elapsedMs"`
	Percent           float64          `json:"percent"`
	TotalQueries      int64            `json:"totalQueries"`
	SuccessfulQueries int64            `json:"successfulQueries"`
	FailedQueries     int64            `json:"failedQueries"`
	CurrentQPS        float64          `json:"currentQps"`
	P50LatencyMs      float64          `json:"p50LatencyMs"`
	P90LatencyMs      float64          `json:"p90LatencyMs"`
	P95LatencyMs      float64          `json:"p95LatencyMs"`
	P99LatencyMs      float64          `json:"p99LatencyMs"`
	Result            *BenchmarkResult `json:"result,omitempty"`
	Error             string           `json:"error,omitempty"`
}

// ActiveBenchmark represents a running or freshly completed benchmark task.
type ActiveBenchmark struct {
	ID        string
	Config    BenchmarkConfig
	cancel    context.CancelFunc
	ctx       context.Context
	mu        sync.RWMutex
	status    string
	progress  BenchmarkProgress
	result    *BenchmarkResult
	doneCh    chan struct{}
	listeners map[chan BenchmarkProgress]struct{}
	listMu    sync.Mutex
}

// Subscribe returns a channel receiving progress events and an unsubscribe cleanup function.
func (ab *ActiveBenchmark) Subscribe() (<-chan BenchmarkProgress, func()) {
	ch := make(chan BenchmarkProgress, 64)
	ab.listMu.Lock()
	if ab.listeners == nil {
		ab.listeners = make(map[chan BenchmarkProgress]struct{})
	}
	ab.listeners[ch] = struct{}{}

	// Send current progress immediately upon subscribing
	ab.mu.RLock()
	current := ab.progress
	ab.mu.RUnlock()

	ab.listMu.Unlock()

	select {
	case ch <- current:
	default:
	}

	unsubscribe := func() {
		ab.listMu.Lock()
		defer ab.listMu.Unlock()
		if _, ok := ab.listeners[ch]; ok {
			delete(ab.listeners, ch)
			close(ch)
		}
	}

	return ch, unsubscribe
}

// broadcast publishes a progress update to all active subscribers.
func (ab *ActiveBenchmark) broadcast(p BenchmarkProgress) {
	ab.mu.Lock()
	ab.progress = p
	ab.status = p.Status
	if p.Result != nil {
		ab.result = p.Result
	}
	ab.mu.Unlock()

	ab.listMu.Lock()
	defer ab.listMu.Unlock()
	for ch := range ab.listeners {
		select {
		case ch <- p:
		default:
			// Non-blocking write to avoid stalling on slow receivers
		}
	}
}

// DoneCh returns a channel closed when the benchmark finishes.
func (ab *ActiveBenchmark) DoneCh() <-chan struct{} {
	return ab.doneCh
}

// Cancel terminates execution of this benchmark.
func (ab *ActiveBenchmark) Cancel() {
	ab.cancel()
}

// GetProgress returns the current progress snapshot.
func (ab *ActiveBenchmark) GetProgress() BenchmarkProgress {
	ab.mu.RLock()
	defer ab.mu.RUnlock()
	return ab.progress
}

// GetResult returns the final result if completed.
func (ab *ActiveBenchmark) GetResult() *BenchmarkResult {
	ab.mu.RLock()
	defer ab.mu.RUnlock()
	return ab.result
}

const maxBenchmarkHistory = 50

// BenchmarkManager manages active and historical benchmark sessions in thread-safe manner.
type BenchmarkManager struct {
	mu          sync.RWMutex
	active      map[string]*ActiveBenchmark
	history     map[string]*BenchmarkResult
	historyKeys []string
}

// NewBenchmarkManager initializes a new BenchmarkManager.
func NewBenchmarkManager() *BenchmarkManager {
	return &BenchmarkManager{
		active:      make(map[string]*ActiveBenchmark),
		history:     make(map[string]*BenchmarkResult),
		historyKeys: make([]string, 0, maxBenchmarkHistory),
	}
}

func (m *BenchmarkManager) recordHistory(id string, res *BenchmarkResult) {
	if res == nil {
		return
	}
	if _, exists := m.history[id]; !exists {
		m.historyKeys = append(m.historyKeys, id)
	}
	m.history[id] = res

	for len(m.history) > maxBenchmarkHistory && len(m.historyKeys) > 0 {
		oldest := m.historyKeys[0]
		m.historyKeys = m.historyKeys[1:]
		delete(m.history, oldest)
	}
}

// Start spawns an active benchmark worker pool for the given driver and configuration.
func (m *BenchmarkManager) Start(ctx context.Context, drv types.Driver, cfg BenchmarkConfig) (*ActiveBenchmark, error) {
	if cfg.ID == "" {
		cfg.ID = newBenchmarkID()
	}
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 1
	}
	if cfg.DurationSec <= 0 && cfg.Duration <= 0 && cfg.Iterations <= 0 {
		cfg.DurationSec = 5
	}
	if cfg.DurationSec > 0 && cfg.Duration <= 0 {
		cfg.Duration = time.Duration(cfg.DurationSec) * time.Second
	}

	benchCtx, cancel := context.WithCancel(ctx)
	ab := &ActiveBenchmark{
		ID:        cfg.ID,
		Config:    cfg,
		cancel:    cancel,
		ctx:       benchCtx,
		status:    "running",
		doneCh:    make(chan struct{}),
		listeners: make(map[chan BenchmarkProgress]struct{}),
		progress: BenchmarkProgress{
			BenchmarkID: cfg.ID,
			Status:      "running",
		},
	}

	m.mu.Lock()
	m.active[cfg.ID] = ab
	m.mu.Unlock()

	go func() {
		defer close(ab.doneCh)
		res, err := runWorkerPool(benchCtx, drv, cfg, func(p BenchmarkProgress) {
			ab.broadcast(p)
		})

		now := time.Now()
		if err != nil {
			if benchCtx.Err() != nil {
				if res != nil {
					res.Status = "cancelled"
					res.CompletedAt = &now
				}
				ab.broadcast(BenchmarkProgress{
					BenchmarkID:  cfg.ID,
					Status:       "cancelled",
					ElapsedMs:    resDurationMs(res),
					Percent:      100,
					TotalQueries: resTotal(res),
					Result:       res,
				})
			} else {
				if res != nil {
					res.Status = "failed"
					res.CompletedAt = &now
				}
				ab.broadcast(BenchmarkProgress{
					BenchmarkID:  cfg.ID,
					Status:       "failed",
					ElapsedMs:    resDurationMs(res),
					Percent:      100,
					TotalQueries: resTotal(res),
					Result:       res,
					Error:        err.Error(),
				})
			}
		} else {
			if res != nil {
				res.Status = "completed"
				res.CompletedAt = &now
			}
			ab.broadcast(BenchmarkProgress{
				BenchmarkID:       cfg.ID,
				Status:            "completed",
				ElapsedMs:         resDurationMs(res),
				Percent:           100,
				TotalQueries:      resTotal(res),
				SuccessfulQueries: resSuccess(res),
				FailedQueries:     resFailed(res),
				CurrentQPS:        resQPS(res),
				P50LatencyMs:      resP50(res),
				P95LatencyMs:      resP95(res),
				P99LatencyMs:      resP99(res),
				Result:            res,
			})
		}

		m.mu.Lock()
		m.recordHistory(cfg.ID, res)
		delete(m.active, cfg.ID)
		m.mu.Unlock()
	}()

	return ab, nil
}

// Get returns historical or currently active benchmark result if found.
func (m *BenchmarkManager) Get(id string) (*BenchmarkResult, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if res, ok := m.history[id]; ok {
		return res, true
	}
	if ab, ok := m.active[id]; ok {
		res := ab.GetResult()
		if res != nil {
			return res, true
		}
		prog := ab.GetProgress()
		return &BenchmarkResult{
			ID:                ab.ID,
			SQL:               ab.Config.SQL,
			Concurrency:       ab.Config.Concurrency,
			Rollback:          ab.Config.Rollback,
			Status:            prog.Status,
			TotalQueries:      prog.TotalQueries,
			SuccessfulQueries: prog.SuccessfulQueries,
			FailedQueries:     prog.FailedQueries,
			DurationMs:        prog.ElapsedMs,
			QPS:               prog.CurrentQPS,
			P50LatencyMs:      prog.P50LatencyMs,
			P90LatencyMs:      prog.P90LatencyMs,
			P95LatencyMs:      prog.P95LatencyMs,
			P99LatencyMs:      prog.P99LatencyMs,
			Label:             ab.Config.Label,
		}, true
	}
	return nil, false
}

// GetActive returns an ActiveBenchmark handle if currently executing.
func (m *BenchmarkManager) GetActive(id string) (*ActiveBenchmark, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ab, ok := m.active[id]
	return ab, ok
}

// Cancel requests graceful cancellation of an active benchmark session.
func (m *BenchmarkManager) Cancel(id string) bool {
	m.mu.RLock()
	ab, ok := m.active[id]
	m.mu.RUnlock()
	if !ok {
		return false
	}
	ab.Cancel()
	return true
}

// Compare computes relative differences between baseline and candidate benchmark results.
func (m *BenchmarkManager) Compare(baseline, candidate BenchmarkResult) BenchmarkComparison {
	return CompareBenchmarks(baseline, candidate)
}

// CompareBenchmarks computes performance deltas and decides winner between baseline and candidate runs.
func CompareBenchmarks(baseline, candidate BenchmarkResult) BenchmarkComparison {
	qpsDelta := round2(candidate.QPS - baseline.QPS)
	var qpsDeltaPct float64
	if baseline.QPS > 0 {
		qpsDeltaPct = round2(((candidate.QPS - baseline.QPS) / baseline.QPS) * 100.0)
	}

	p50Delta := round2(candidate.P50LatencyMs - baseline.P50LatencyMs)
	var p50DeltaPct float64
	if baseline.P50LatencyMs > 0 {
		p50DeltaPct = round2(((candidate.P50LatencyMs - baseline.P50LatencyMs) / baseline.P50LatencyMs) * 100.0)
	}

	p95Delta := round2(candidate.P95LatencyMs - baseline.P95LatencyMs)
	var p95DeltaPct float64
	if baseline.P95LatencyMs > 0 {
		p95DeltaPct = round2(((candidate.P95LatencyMs - baseline.P95LatencyMs) / baseline.P95LatencyMs) * 100.0)
	}

	p99Delta := round2(candidate.P99LatencyMs - baseline.P99LatencyMs)
	var p99DeltaPct float64
	if baseline.P99LatencyMs > 0 {
		p99DeltaPct = round2(((candidate.P99LatencyMs - baseline.P99LatencyMs) / baseline.P99LatencyMs) * 100.0)
	}

	meanDelta := round2(candidate.MeanLatencyMs - baseline.MeanLatencyMs)
	var meanDeltaPct float64
	if baseline.MeanLatencyMs > 0 {
		meanDeltaPct = round2(((candidate.MeanLatencyMs - baseline.MeanLatencyMs) / baseline.MeanLatencyMs) * 100.0)
	}

	winner := "tie"
	if candidate.QPS > baseline.QPS*1.02 && candidate.P95LatencyMs <= baseline.P95LatencyMs*1.02 {
		winner = "candidate"
	} else if baseline.QPS > candidate.QPS*1.02 && baseline.P95LatencyMs <= candidate.P95LatencyMs*1.02 {
		winner = "baseline"
	} else if candidate.P95LatencyMs < baseline.P95LatencyMs*0.98 {
		winner = "candidate"
	} else if baseline.P95LatencyMs < candidate.P95LatencyMs*0.98 {
		winner = "baseline"
	}

	var summary string
	switch winner {
	case "candidate":
		summary = fmt.Sprintf("Candidate outperforms baseline with %+.1f%% QPS and %+.2fms P95 latency difference.", qpsDeltaPct, p95Delta)
	case "baseline":
		summary = fmt.Sprintf("Baseline outperforms candidate with %+.1f%% QPS and %+.2fms P95 latency difference.", -qpsDeltaPct, -p95Delta)
	default:
		summary = "Performance is comparable between baseline and candidate (within 2% margin)."
	}

	return BenchmarkComparison{
		Baseline:     baseline,
		Candidate:    candidate,
		QpsDelta:     qpsDelta,
		QpsDeltaPct:  qpsDeltaPct,
		P50DeltaMs:   p50Delta,
		P50DeltaPct:  p50DeltaPct,
		P95DeltaMs:   p95Delta,
		P95DeltaPct:  p95DeltaPct,
		P99DeltaMs:   p99Delta,
		P99DeltaPct:  p99DeltaPct,
		MeanDeltaMs:  meanDelta,
		MeanDeltaPct: meanDeltaPct,
		Winner:       winner,
		Summary:      summary,
	}
}

func newBenchmarkID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "bm_" + hex.EncodeToString(b)
}

func resDurationMs(res *BenchmarkResult) float64 {
	if res == nil {
		return 0
	}
	return res.DurationMs
}

func resTotal(res *BenchmarkResult) int64 {
	if res == nil {
		return 0
	}
	return res.TotalQueries
}

func resSuccess(res *BenchmarkResult) int64 {
	if res == nil {
		return 0
	}
	return res.SuccessfulQueries
}

func resFailed(res *BenchmarkResult) int64 {
	if res == nil {
		return 0
	}
	return res.FailedQueries
}

func resQPS(res *BenchmarkResult) float64 {
	if res == nil {
		return 0
	}
	return res.QPS
}

func resP50(res *BenchmarkResult) float64 {
	if res == nil {
		return 0
	}
	return res.P50LatencyMs
}

func resP95(res *BenchmarkResult) float64 {
	if res == nil {
		return 0
	}
	return res.P95LatencyMs
}

func resP99(res *BenchmarkResult) float64 {
	if res == nil {
		return 0
	}
	return res.P99LatencyMs
}
