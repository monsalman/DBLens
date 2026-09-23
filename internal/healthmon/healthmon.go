// Package healthmon tracks per-connection probe latency for the Connection
// Health Dashboard and derives a rolling green / yellow / red status.
//
// State lives in memory only: the prober pings every pooled connection with
// SELECT 1 on a ticker, and both the REST snapshot and the SSE stream read the
// same guarded state. A nil-safe, non-invasive design keeps the monitor from
// dialling databases of its own — it only probes what the pool already holds.
package healthmon

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/driver"
)

// Health status values reported per connection.
const (
	StatusGreen   = "green"
	StatusYellow  = "yellow"
	StatusRed     = "red"
	StatusUnknown = "unknown"
)

const (
	// MaxSamples is the size of the rolling sample window kept per connection.
	MaxSamples = 60
	// DegradeMs is the average latency (ms) at or above which a connection degrades.
	DegradeMs = 50
	// RedAfterFailures is the consecutive-failure count that marks a connection down.
	RedAfterFailures = 3
	// DefaultInterval is the prober's probe cadence unless Start says otherwise.
	DefaultInterval = 30 * time.Second

	avgWindow    = time.Minute
	maxWindow    = 5 * time.Minute
	sampleWindow = 3 // "last N checks" used by the status rules
	probeSQL     = "SELECT 1"
	probeTimeout = 5 * time.Second
	pruneAfter   = 10 * time.Minute
)

// Sample is one probe result for a connection.
type Sample struct {
	At time.Time `json:"at"`
	Ms int64     `json:"ms"`
	OK bool      `json:"ok"`
}

// ConnectionHealth is the derived state of one monitored connection.
type ConnectionHealth struct {
	ConnectionID        string    `json:"connection_id"`
	Label               string    `json:"label,omitempty"`
	Status              string    `json:"status"`
	LastPingMs          int64     `json:"last_ping_ms"`
	AvgPingMs1m         float64   `json:"avg_ping_ms_1m"`
	MaxPingMs5m         int64     `json:"max_ping_ms_5m"`
	ConsecutiveFailures int       `json:"consecutive_failures"`
	Samples             []Sample  `json:"samples"`
	LastCheckedAt       time.Time `json:"last_checked_at"`
	TotalChecks         int64     `json:"total_checks"`
	SuccessCount        int64     `json:"success_count"`
}

// Summary aggregates every tracked connection for the dashboard header cards.
type Summary struct {
	Healthy      int     `json:"healthy"`
	Degraded     int     `json:"degraded"`
	Down         int     `json:"down"`
	Unknown      int     `json:"unknown"`
	Total        int     `json:"total"`
	TotalChecks  int64   `json:"total_checks"`
	SuccessCount int64   `json:"success_count"`
	SuccessRate  float64 `json:"success_rate"`
}

// Monitor holds the in-memory health state of every tracked connection.
type Monitor struct {
	mu    sync.Mutex
	conns map[string]*ConnectionHealth
	now   func() time.Time
}

// New returns an empty monitor.
func New() *Monitor {
	return &Monitor{conns: make(map[string]*ConnectionHealth), now: time.Now}
}

// SetLabel attaches a human-readable name (masked DSN or global profile label).
func (m *Monitor) SetLabel(connID, label string) {
	if m == nil || connID == "" || label == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.entry(connID).Label = label
}

// Record appends one probe result and recomputes the derived fields.
func (m *Monitor) Record(connID string, latencyMs int64, ok bool) {
	if m == nil || connID == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.record(connID, latencyMs, ok, m.now().UTC())
}

// record is Record with an injectable timestamp so tests can drive the clock.
func (m *Monitor) record(connID string, latencyMs int64, ok bool, at time.Time) {
	if latencyMs < 0 {
		latencyMs = 0
	}
	h := m.entry(connID)
	h.Samples = append(h.Samples, Sample{At: at, Ms: latencyMs, OK: ok})
	if len(h.Samples) > MaxSamples { // keep only the newest window
		h.Samples = append(h.Samples[:0], h.Samples[len(h.Samples)-MaxSamples:]...)
	}
	h.LastCheckedAt = at
	h.TotalChecks++
	if ok {
		h.SuccessCount++
		h.ConsecutiveFailures = 0
		h.LastPingMs = latencyMs
	} else {
		h.ConsecutiveFailures++
		h.LastPingMs = 0
	}
	m.derive(h, at)
}

// entry returns the tracked state for connID, creating it on first sight.
// Callers must hold m.mu.
func (m *Monitor) entry(connID string) *ConnectionHealth {
	h := m.conns[connID]
	if h == nil {
		h = &ConnectionHealth{
			ConnectionID: connID,
			Status:       StatusUnknown,
			Samples:      make([]Sample, 0, MaxSamples),
		}
		m.conns[connID] = h
	}
	return h
}

// derive recomputes averages, window maximum and status. Callers hold m.mu.
func (m *Monitor) derive(h *ConnectionHealth, now time.Time) {
	var sum float64
	var count int64
	var max int64
	for _, s := range h.Samples {
		if !s.OK {
			continue
		}
		age := now.Sub(s.At)
		if age <= maxWindow && s.Ms > max {
			max = s.Ms
		}
		if age <= avgWindow {
			sum += float64(s.Ms)
			count++
		}
	}
	h.MaxPingMs5m = max
	if count > 0 {
		h.AvgPingMs1m = round2(sum / float64(count))
	} else {
		h.AvgPingMs1m = 0
	}
	h.Status = StatusUnknown
	if len(h.Samples) == 0 {
		return
	}
	if h.ConsecutiveFailures >= RedAfterFailures {
		h.Status = StatusRed
		return
	}
	tail := h.Samples
	if len(tail) > sampleWindow {
		tail = tail[len(tail)-sampleWindow:]
	}
	allOK := true
	for _, s := range tail {
		if !s.OK {
			allOK = false
			break
		}
	}
	if allOK && h.AvgPingMs1m < DegradeMs {
		h.Status = StatusGreen
		return
	}
	h.Status = StatusYellow
}

// Snapshot returns a deep copy of the current state, ordered by connection id.
func (m *Monitor) Snapshot() []ConnectionHealth {
	if m == nil {
		return []ConnectionHealth{}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]ConnectionHealth, 0, len(m.conns))
	for _, h := range m.conns {
		cp := *h
		cp.Samples = append([]Sample(nil), h.Samples...)
		out = append(out, cp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ConnectionID < out[j].ConnectionID })
	return out
}

// Summary counts connections per status and the overall probe success rate.
func (m *Monitor) Summary() Summary {
	var s Summary
	for _, h := range m.Snapshot() {
		s.Total++
		s.TotalChecks += h.TotalChecks
		s.SuccessCount += h.SuccessCount
		switch h.Status {
		case StatusGreen:
			s.Healthy++
		case StatusYellow:
			s.Degraded++
		case StatusRed:
			s.Down++
		default:
			s.Unknown++
		}
	}
	if s.TotalChecks > 0 {
		s.SuccessRate = round2(float64(s.SuccessCount) / float64(s.TotalChecks) * 100)
	}
	return s
}

// Start launches the prober loop in the background. It returns immediately and
// the loop stops when ctx is cancelled. Safe with no connections at all.
func (m *Monitor) Start(ctx context.Context, mgr *connection.Manager, interval time.Duration) {
	if m == nil || ctx == nil || mgr == nil {
		return
	}
	if interval <= 0 {
		interval = DefaultInterval
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.ProbeAll(ctx, mgr)
			}
		}
	}()
}

// ProbeAll pings every pooled connection once and records the result. It is
// exported so a caller (or a test) can force a single probe round.
func (m *Monitor) ProbeAll(ctx context.Context, mgr *connection.Manager) {
	if m == nil || mgr == nil || ctx.Err() != nil {
		return
	}
	m.pruneStale()
	pooled := mgr.PooledConnections()
	if len(pooled) == 0 {
		return // nothing pooled yet: skip without dialling anything
	}
	named := globalTargets(mgr)
	for _, pc := range pooled {
		if ctx.Err() != nil {
			return
		}
		id, label := connIDFor(pc.DSN, named)
		m.SetLabel(id, label)
		start := m.now()
		ok := ping(ctx, pc)
		m.Record(id, m.now().Sub(start).Milliseconds(), ok)
	}
}

// ping runs the SELECT 1 probe on an already-pooled driver.
func ping(ctx context.Context, pc connection.PooledConn) bool {
	if pc.Driver == nil {
		return false
	}
	pctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	_, err := pc.Driver.ExecuteQuery(pctx, probeSQL)
	return err == nil
}

// target is the dashboard identity of a server-seeded (global_*) connection.
type target struct{ id, label string }

// globalTargets maps a raw DSN to its global_* id/label so shared connections
// show up under the id the UI already knows.
func globalTargets(mgr *connection.Manager) map[string]target {
	out := map[string]target{}
	for _, p := range mgr.GlobalProfiles() {
		id := p["id"]
		if id == "" {
			continue
		}
		raw, ok := mgr.GetGlobalDSNByID(id)
		if !ok {
			continue
		}
		out[raw] = target{id: id, label: p["label"]}
	}
	return out
}

// connIDFor resolves the stable tracking id and display label for a pooled DSN.
// Global connections keep their global_* id; everything else (per-request DSNs
// from the browser) is keyed by a short DSN hash and labelled with a masked DSN
// so no credential ever reaches the client.
func connIDFor(dsn string, named map[string]target) (string, string) {
	if t, ok := named[dsn]; ok {
		return t.id, t.label
	}
	return "conn_" + shortHash(dsn), driver.MaskDSN(dsn)
}

// pruneStale drops connections that have not been probed recently (their pool
// entry was evicted), so the dashboard never reports a ghost connection.
func (m *Monitor) pruneStale() {
	cutoff := m.now().UTC().Add(-pruneAfter)
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, h := range m.conns {
		if !h.LastCheckedAt.IsZero() && h.LastCheckedAt.Before(cutoff) {
			delete(m.conns, id)
		}
	}
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// shortHash is a stable 12-hex-char digest of a DSN, used as a tracking id for
// per-request connections that have no server-side id. Never reversible to the
// original DSN in practice, and the label is masked regardless.
func shortHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])[:12]
}
