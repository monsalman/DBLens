package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/benchmark"
	"github.com/go-chi/chi/v5"
)

// BenchmarkRunRequest defines the request payload to initiate a benchmark.
type BenchmarkRunRequest struct {
	SQL         string  `json:"sql"`
	Concurrency int     `json:"concurrency"`
	DurationSec int     `json:"durationSec,omitempty"`
	Iterations  int     `json:"iterations,omitempty"`
	Rollback    bool    `json:"rollback"`
	AssertP99Lt float64 `json:"assertP99Lt,omitempty"`
	Label       string  `json:"label,omitempty"`
}

// BenchmarkCompareRequest provides baseline and candidate benchmarks for comparison.
type BenchmarkCompareRequest struct {
	BaselineID  string                     `json:"baselineId,omitempty"`
	CandidateID string                     `json:"candidateId,omitempty"`
	Baseline    *benchmark.BenchmarkResult `json:"baseline,omitempty"`
	Candidate   *benchmark.BenchmarkResult `json:"candidate,omitempty"`
}

// BenchmarkExportRequest provides the payload for exporting markdown reports.
type BenchmarkExportRequest struct {
	ID         string                         `json:"id,omitempty"`
	Result     *benchmark.BenchmarkResult     `json:"result,omitempty"`
	Comparison *benchmark.BenchmarkComparison `json:"comparison,omitempty"`
}

// BenchmarkRunHandler starts an asynchronous query concurrency benchmark.
// POST /api/connections/{connId}/benchmark/run
func (h *Handler) BenchmarkRunHandler(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req BenchmarkRunRequest
	if r.Body != nil {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	trimmedSQL := strings.TrimSpace(req.SQL)
	if trimmedSQL == "" {
		sendError(w, http.StatusBadRequest, "SQL query cannot be empty")
		return
	}

	// Safe Mode / Read-Only check:
	isReadOnly := isTruthy(r.Header.Get("X-DBLENS-READONLY")) ||
		strings.EqualFold(r.Header.Get("X-DBLENS-ENVIRONMENT"), "production") ||
		isTruthy(r.URL.Query().Get("readonly")) ||
		strings.EqualFold(r.URL.Query().Get("environment"), "production")

	if isReadOnly {
		if IsDDLStatement(trimmedSQL) {
			sendError(w, http.StatusForbidden, "DDL statements (DROP, ALTER, TRUNCATE, CREATE, RENAME) are prohibited during benchmark on read-only/production databases.")
			return
		}
		if !req.Rollback && IsNonSelectSQL(trimmedSQL) {
			sendError(w, http.StatusForbidden, "Mutating queries during benchmark on read-only/production databases require rollback mode enabled.")
			return
		}
	}

	cfg := benchmark.BenchmarkConfig{
		SQL:         trimmedSQL,
		Concurrency: req.Concurrency,
		DurationSec: req.DurationSec,
		Iterations:  req.Iterations,
		Rollback:    req.Rollback,
		AssertP99Lt: req.AssertP99Lt,
		Label:       req.Label,
	}

	ab, err := h.BenchmarkManager().Start(context.WithoutCancel(r.Context()), entry.Driver, cfg)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "failed to start benchmark: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"id":       ab.ID,
		"status":   "running",
		"progress": ab.GetProgress(),
	})
}

// BenchmarkGetHandler retrieves current status or finalized results of a benchmark.
// GET /api/connections/{connId}/benchmark/{id}
func (h *Handler) BenchmarkGetHandler(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		sendError(w, http.StatusBadRequest, "benchmark ID is required")
		return
	}

	res, found := h.BenchmarkManager().Get(id)
	if !found || res == nil {
		sendError(w, http.StatusNotFound, fmt.Sprintf("benchmark %q not found", id))
		return
	}

	sendJSON(w, http.StatusOK, res)
}

// BenchmarkStreamHandler streams real-time benchmark progress and metrics over Server-Sent Events (SSE).
// GET /api/connections/{connId}/benchmark/{id}/stream
func (h *Handler) BenchmarkStreamHandler(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		sendError(w, http.StatusBadRequest, "benchmark ID is required")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		sendError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// SSE response headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{})

	ab, ok := h.BenchmarkManager().GetActive(id)
	if !ok {
		// Benchmark might already be finished
		res, found := h.BenchmarkManager().Get(id)
		if !found || res == nil {
			sendError(w, http.StatusNotFound, fmt.Sprintf("benchmark %q not found", id))
			return
		}
		w.WriteHeader(http.StatusOK)
		finalProg := benchmark.BenchmarkProgress{
			BenchmarkID:       res.ID,
			Status:            res.Status,
			ElapsedMs:         res.DurationMs,
			Percent:           100,
			TotalQueries:      res.TotalQueries,
			SuccessfulQueries: res.SuccessfulQueries,
			FailedQueries:     res.FailedQueries,
			CurrentQPS:        res.QPS,
			P50LatencyMs:      res.P50LatencyMs,
			P90LatencyMs:      res.P90LatencyMs,
			P95LatencyMs:      res.P95LatencyMs,
			P99LatencyMs:      res.P99LatencyMs,
			Result:            res,
		}
		b, _ := json.Marshal(finalProg)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
		return
	}

	w.WriteHeader(http.StatusOK)

	ch, unsub := ab.Subscribe()
	defer unsub()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-h.shutdownSignal():
			return
		case prog, open := <-ch:
			if !open {
				return
			}
			b, err := json.Marshal(prog)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
				return
			}
			flusher.Flush()

			if prog.Status == "completed" || prog.Status == "cancelled" || prog.Status == "failed" {
				return
			}
		}
	}
}

// BenchmarkCancelHandler cancels an actively running benchmark session.
// POST /api/connections/{connId}/benchmark/{id}/cancel
func (h *Handler) BenchmarkCancelHandler(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		sendError(w, http.StatusBadRequest, "benchmark ID is required")
		return
	}

	cancelled := h.BenchmarkManager().Cancel(id)
	sendJSON(w, http.StatusOK, map[string]interface{}{
		"id":        id,
		"cancelled": cancelled,
	})
}

// BenchmarkCompareHandler calculates performance deltas between baseline and candidate benchmarks.
// POST /api/connections/{connId}/benchmark/compare
func (h *Handler) BenchmarkCompareHandler(w http.ResponseWriter, r *http.Request) {
	var req BenchmarkCompareRequest
	if r.Body != nil {
		r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	var baseline *benchmark.BenchmarkResult
	var candidate *benchmark.BenchmarkResult

	if req.Baseline != nil {
		baseline = req.Baseline
	} else if req.BaselineID != "" {
		b, found := h.BenchmarkManager().Get(req.BaselineID)
		if !found {
			sendError(w, http.StatusNotFound, fmt.Sprintf("baseline benchmark %q not found", req.BaselineID))
			return
		}
		baseline = b
	}

	if req.Candidate != nil {
		candidate = req.Candidate
	} else if req.CandidateID != "" {
		c, found := h.BenchmarkManager().Get(req.CandidateID)
		if !found {
			sendError(w, http.StatusNotFound, fmt.Sprintf("candidate benchmark %q not found", req.CandidateID))
			return
		}
		candidate = c
	}

	if baseline == nil || candidate == nil {
		sendError(w, http.StatusBadRequest, "both baseline and candidate benchmarks must be specified")
		return
	}

	comp := h.BenchmarkManager().Compare(*baseline, *candidate)
	sendJSON(w, http.StatusOK, comp)
}

// BenchmarkExportMDHandler exports single or comparative benchmark results into a Markdown report.
// POST /api/connections/{connId}/benchmark/export.md
func (h *Handler) BenchmarkExportMDHandler(w http.ResponseWriter, r *http.Request) {
	var req BenchmarkExportRequest
	if r.Body != nil {
		r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	var mdReport string

	if req.Comparison != nil {
		mdReport = benchmark.GenerateComparisonMarkdown(*req.Comparison)
	} else {
		res := req.Result
		if res == nil && req.ID != "" {
			b, found := h.BenchmarkManager().Get(req.ID)
			if found {
				res = b
			}
		}
		if res == nil {
			sendError(w, http.StatusBadRequest, "valid benchmark result or comparison is required for markdown export")
			return
		}
		mdReport = benchmark.GenerateMarkdownReport(res)
	}

	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"benchmark_report.md\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(mdReport))
}
