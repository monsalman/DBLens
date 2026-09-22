package livefeed

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

// ExecFunc runs a SQL query for a given connection and returns rows as maps.
type ExecFunc func(connID, sql string, args []interface{}) ([]map[string]interface{}, error)

// Poller manages polling a single table for row-level changes.
type Poller struct {
	cfg      FeedConfig
	execFunc ExecFunc
	cancel   context.CancelFunc
}

// NewPoller constructs a Poller. Call Start to begin polling.
func NewPoller(cfg FeedConfig, execFunc ExecFunc) *Poller {
	// Enforce interval bounds.
	if cfg.PollInterval < 500*time.Millisecond {
		cfg.PollInterval = 500 * time.Millisecond
	}
	if cfg.PollInterval > 30*time.Second {
		cfg.PollInterval = 30 * time.Second
	}
	if cfg.PollInterval == 0 {
		cfg.PollInterval = 2 * time.Second
	}
	return &Poller{cfg: cfg, execFunc: execFunc}
}

// Start begins the poll loop in a goroutine. It returns immediately.
// Events are sent to the provided channel; slow consumers drop events (non-blocking send).
// The loop exits when ctx is cancelled. Call Stop() to cancel.
func (p *Poller) Start(ctx context.Context, events chan<- ChangeEvent) error {
	ctx, p.cancel = context.WithCancel(ctx)
	go p.loop(ctx, events)
	return nil
}

// Stop cancels the poll loop.
func (p *Poller) Stop() {
	if p.cancel != nil {
		p.cancel()
	}
}

// loop runs the differential poll until ctx is done.
func (p *Poller) loop(ctx context.Context, events chan<- ChangeEvent) {
	ticker := time.NewTicker(p.cfg.PollInterval)
	defer ticker.Stop()

	// snapshot: pk-string → json-encoded row
	snapshot := map[string]string{}
	// pkCols: detected pk column names
	var pkCols []string
	first := true

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			rows, err := p.fetchRows()
			if err != nil {
				continue // transient error; try next tick
			}

			if first && len(rows) > 0 {
				pkCols = detectPKCols(rows[0])
			}

			newSnap := make(map[string]string, len(rows))
			for _, row := range rows {
				pk := buildPKMap(row, pkCols)
				key := pkKey(pk)
				encoded, _ := json.Marshal(row)
				newSnap[key] = string(encoded)

				if first {
					continue
				}

				oldEncoded, existed := snapshot[key]
				if !existed {
					// INSERT
					emit(events, ChangeEvent{
						Op:        "INSERT",
						Table:     p.cfg.Table,
						Schema:    p.cfg.Schema,
						PK:        pk,
						After:     row,
						Timestamp: time.Now(),
					})
				} else if oldEncoded != string(encoded) {
					// UPDATE
					var before map[string]interface{}
					_ = json.Unmarshal([]byte(oldEncoded), &before)
					emit(events, ChangeEvent{
						Op:        "UPDATE",
						Table:     p.cfg.Table,
						Schema:    p.cfg.Schema,
						PK:        pk,
						Before:    before,
						After:     row,
						Timestamp: time.Now(),
					})
				}
			}

			if !first {
				// Find DELETEs: keys in old snapshot not in new.
				for key, oldEncoded := range snapshot {
					if _, ok := newSnap[key]; !ok {
						var before map[string]interface{}
						_ = json.Unmarshal([]byte(oldEncoded), &before)
						pk := buildPKMap(before, pkCols)
						emit(events, ChangeEvent{
							Op:        "DELETE",
							Table:     p.cfg.Table,
							Schema:    p.cfg.Schema,
							PK:        pk,
							Before:    before,
							Timestamp: time.Now(),
						})
					}
				}
			}

			snapshot = newSnap
			first = false
		}
	}
}

// fetchRows runs SELECT ... LIMIT 200 ORDER BY pk col.
func (p *Poller) fetchRows() ([]map[string]interface{}, error) {
	var q string
	if p.cfg.Schema != "" {
		q = `SELECT * FROM "` + p.cfg.Schema + `"."` + p.cfg.Table + `" LIMIT 200`
	} else {
		q = `SELECT * FROM "` + p.cfg.Table + `" LIMIT 200`
	}
	return p.execFunc(p.cfg.ConnID, q, nil)
}

// detectPKCols finds the best PK column(s) from a sample row.
func detectPKCols(row map[string]interface{}) []string {
	// 1. column named exactly "id"
	if _, ok := row["id"]; ok {
		return []string{"id"}
	}
	// 2. column with "id" suffix
	for k := range row {
		if strings.HasSuffix(strings.ToLower(k), "id") && k != "id" {
			return []string{k}
		}
	}
	// 3. first column (maps are unordered so just pick any — best-effort)
	for k := range row {
		return []string{k}
	}
	return nil
}

// buildPKMap extracts pk columns from a row.
func buildPKMap(row map[string]interface{}, pkCols []string) map[string]interface{} {
	pk := make(map[string]interface{}, len(pkCols))
	for _, col := range pkCols {
		pk[col] = row[col]
	}
	return pk
}

// pkKey produces a stable string key from a pk map.
func pkKey(pk map[string]interface{}) string {
	b, _ := json.Marshal(pk)
	return string(b)
}

// emit sends an event non-blocking; drops if channel is full.
func emit(ch chan<- ChangeEvent, ev ChangeEvent) {
	select {
	case ch <- ev:
	default:
	}
}
