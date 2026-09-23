package healthmon

import (
	"context"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/connection"
)

// rec injects a sample at a controlled timestamp, bypassing the wall clock so
// the rolling-window tests stay deterministic and fast.
func rec(m *Monitor, connID string, at time.Time, ms int64, ok bool) {
	m.record(connID, ms, ok, at.UTC())
}

func TestStatusTransitions(t *testing.T) {
	now := time.Now().UTC()
	m := New()

	// Unknown before any probe.
	if got := m.Snapshot(); len(got) != 0 {
		t.Fatalf("expected empty snapshot, got %d entries", len(got))
	}

	// Green: last 3 checks ok and average below the degrade threshold.
	rec(m, "c1", now, 10, true)
	rec(m, "c1", now, 20, true)
	rec(m, "c1", now, 30, true)
	if got := m.Snapshot()[0].Status; got != StatusGreen {
		t.Fatalf("expected green, got %s", got)
	}

	// Yellow: a single failure inside the last three checks.
	rec(m, "c1", now, 0, false)
	if got := m.Snapshot()[0].Status; got != StatusYellow {
		t.Fatalf("expected yellow after one failure, got %s", got)
	}
	if got := m.Snapshot()[0].ConsecutiveFailures; got != 1 {
		t.Fatalf("expected 1 consecutive failure, got %d", got)
	}

	// Red: three consecutive failures.
	rec(m, "c1", now, 0, false)
	rec(m, "c1", now, 0, false)
	snap := m.Snapshot()[0]
	if snap.Status != StatusRed {
		t.Fatalf("expected red after 3 consecutive failures, got %s", snap.Status)
	}
	if snap.ConsecutiveFailures != 3 {
		t.Fatalf("expected 3 consecutive failures, got %d", snap.ConsecutiveFailures)
	}

	// Recovery: one success resets the failure streak -> back to yellow.
	rec(m, "c1", now, 5, true)
	if got := m.Snapshot()[0].Status; got != StatusYellow {
		t.Fatalf("expected yellow after recovery, got %s", got)
	}

	// Three clean, fast checks -> green again.
	rec(m, "c1", now, 5, true)
	rec(m, "c1", now, 5, true)
	if got := m.Snapshot()[0].Status; got != StatusGreen {
		t.Fatalf("expected green after recovery, got %s", got)
	}
}

func TestYellowOnSlowAverage(t *testing.T) {
	now := time.Now().UTC()
	m := New()
	for i := 0; i < 3; i++ {
		// All checks succeed, but the average sits at/above DegradeMs.
		rec(m, "slow", now, DegradeMs, true)
	}
	snap := m.Snapshot()[0]
	if snap.Status != StatusYellow {
		t.Fatalf("expected yellow for slow average, got %s (avg=%v)", snap.Status, snap.AvgPingMs1m)
	}
	if snap.AvgPingMs1m != float64(DegradeMs) {
		t.Fatalf("expected avg %d, got %v", DegradeMs, snap.AvgPingMs1m)
	}
}

func TestRollingWindowCap(t *testing.T) {
	now := time.Now().UTC()
	m := New()
	total := MaxSamples + 25
	for i := 0; i < total; i++ {
		rec(m, "c1", now, int64(i+1), true)
	}
	snap := m.Snapshot()[0]
	if len(snap.Samples) != MaxSamples {
		t.Fatalf("expected %d samples, got %d", MaxSamples, len(snap.Samples))
	}
	// The newest sample must survive the trim and the oldest must be dropped.
	if last := snap.Samples[len(snap.Samples)-1]; last.Ms != int64(total) {
		t.Fatalf("expected newest sample %d, got %d", total, last.Ms)
	}
	if first := snap.Samples[0]; first.Ms != int64(total-MaxSamples+1) {
		t.Fatalf("expected oldest retained sample %d, got %d", total-MaxSamples+1, first.Ms)
	}
	if snap.TotalChecks != int64(total) {
		t.Fatalf("expected %d total checks, got %d", total, snap.TotalChecks)
	}
	if snap.SuccessCount != int64(total) {
		t.Fatalf("expected %d successes, got %d", total, snap.SuccessCount)
	}
}

func TestWindowAveragesAndMax(t *testing.T) {
	now := time.Now().UTC()
	m := New()
	// A stale (90s old) and a fresh (30s old) success plus a fresh failure:
	// only the fresh success inside the 1m average window, both successes count
	// toward the 5m max, and the failure must not become the max.
	rec(m, "c1", now.Add(-90*time.Second), 900, true)
	rec(m, "c1", now.Add(-30*time.Second), 40, true)
	rec(m, "c1", now, 0, false)

	snap := m.Snapshot()[0]
	if snap.AvgPingMs1m != 40 {
		t.Fatalf("expected avg 40 (only samples within 1m), got %v", snap.AvgPingMs1m)
	}
	if snap.MaxPingMs5m != 900 {
		t.Fatalf("expected max 900 across 5m, got %d", snap.MaxPingMs5m)
	}
	if snap.LastPingMs != 0 {
		t.Fatalf("expected last ping 0 after a failure, got %d", snap.LastPingMs)
	}
	if snap.LastCheckedAt.IsZero() {
		t.Fatal("expected LastCheckedAt to be set")
	}
}

func TestSummary(t *testing.T) {
	now := time.Now().UTC()
	m := New()
	// healthy
	for i := 0; i < 3; i++ {
		rec(m, "up", now, 10, true)
	}
	// degraded (single failure)
	rec(m, "degraded", now, 10, true)
	rec(m, "degraded", now, 0, false)
	// down (3 consecutive failures)
	for i := 0; i < 3; i++ {
		rec(m, "down", now, 0, false)
	}

	s := m.Summary()
	if s.Total != 3 || s.Healthy != 1 || s.Degraded != 1 || s.Down != 1 {
		t.Fatalf("unexpected summary counts: %+v", s)
	}
	// 3 successes out of 8 checks.
	if s.TotalChecks != 8 {
		t.Fatalf("expected 8 total checks, got %d", s.TotalChecks)
	}
	if s.SuccessCount != 4 {
		t.Fatalf("expected 4 successes, got %d", s.SuccessCount)
	}
	if s.SuccessRate != 50 {
		t.Fatalf("expected 50%% success rate, got %v", s.SuccessRate)
	}
}

func TestSnapshotIsCopy(t *testing.T) {
	now := time.Now().UTC()
	m := New()
	rec(m, "c1", now, 10, true)
	snap := m.Snapshot()
	snap[0].Samples[0].Ms = 9999
	snap[0].Status = "tampered"
	if again := m.Snapshot()[0]; again.Samples[0].Ms != 10 || again.Status != StatusGreen {
		t.Fatalf("snapshot leaked monitor state: %+v", again)
	}
}

func TestProbeAllSafeWithNoPools(t *testing.T) {
	m := New()
	mgr := connection.NewManager()
	// One pass with an empty pool must not panic and must not create entries.
	m.ProbeAll(context.Background(), mgr)
	if len(m.Snapshot()) != 0 {
		t.Fatalf("expected no tracked connections, got %d", len(m.Snapshot()))
	}
	// A cancelled context is a no-op too.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	m.ProbeAll(ctx, mgr)
	if len(m.Snapshot()) != 0 {
		t.Fatalf("expected no tracked connections after cancel, got %d", len(m.Snapshot()))
	}
}

func TestStartStopsOnContextCancel(t *testing.T) {
	m := New()
	mgr := connection.NewManager()
	ctx, cancel := context.WithCancel(context.Background())
	m.Start(ctx, mgr, 10*time.Millisecond)
	cancel()
	// Give the loop a tick or two to observe cancellation; nothing to assert
	// beyond "did not hang or panic", plus a clean second cancel.
	time.Sleep(30 * time.Millisecond)
	cancel()
	if len(m.Snapshot()) != 0 {
		t.Fatalf("expected no probes with an empty pool, got %d entries", len(m.Snapshot()))
	}
}

func TestNilMonitorIsSafe(t *testing.T) {
	var m *Monitor
	m.Record("c1", 5, true)
	m.SetLabel("c1", "x")
	if len(m.Snapshot()) != 0 {
		t.Fatal("expected an empty snapshot for a nil monitor")
	}
	m.ProbeAll(context.Background(), nil)
	m.Start(nil, nil, 0)
}

func TestConnIDForMasksDSN(t *testing.T) {
	named := map[string]target{"postgres://u:p@host:5432/db": {id: "global_1", label: "Shared DB 1"}}
	if id, label := connIDFor("postgres://u:p@host:5432/db", named); id != "global_1" || label != "Shared DB 1" {
		t.Fatalf("expected the global id for a seeded DSN, got %s/%s", id, label)
	}
	id, label := connIDFor("postgres://user:secret@host:5432/db", named)
	if label == "postgres://user:secret@host:5432/db" {
		t.Fatal("label must not expose the raw DSN password")
	}
	if id == "" || len(id) != len("conn_")+12 {
		t.Fatalf("unexpected derived id %q", id)
	}
	if id2, _ := connIDFor("postgres://user:secret@host:5432/db", named); id2 != id {
		t.Fatalf("expected a stable id, got %s then %s", id, id2)
	}
}
