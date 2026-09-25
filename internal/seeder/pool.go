package seeder

import (
	"context"
	"fmt"
	"math/rand"
	"sync"

	"github.com/dblens/dblens/internal/driver/types"
)

// KeyPool maintains an in-memory referential pool / ring buffer of primary key values
// generated for parent tables so that child foreign keys can be populated with valid references.
type KeyPool struct {
	mu   sync.RWMutex
	keys map[string][]interface{}
}

// NewKeyPool creates a new empty KeyPool.
func NewKeyPool() *KeyPool {
	return &KeyPool{
		keys: make(map[string][]interface{}),
	}
}

func poolKey(table, col string) string {
	return fmt.Sprintf("%s.%s", table, col)
}

// AddKey records a single generated key value into the pool.
func (p *KeyPool) AddKey(table, col string, val interface{}) {
	if val == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	k := poolKey(table, col)
	p.keys[k] = append(p.keys[k], val)

	// Also index under table alone with empty col as fallback
	tk := poolKey(table, "")
	p.keys[tk] = append(p.keys[tk], val)
}

// AddKeys records a slice of generated key values into the pool.
func (p *KeyPool) AddKeys(table, col string, vals []interface{}) {
	if len(vals) == 0 {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	k := poolKey(table, col)
	p.keys[k] = append(p.keys[k], vals...)

	tk := poolKey(table, "")
	p.keys[tk] = append(p.keys[tk], vals...)
}

// Sample randomly retrieves a valid parent key from the pool.
func (p *KeyPool) Sample(table, col string, rng *rand.Rand) (interface{}, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	vals := p.keys[poolKey(table, col)]
	if len(vals) == 0 {
		vals = p.keys[poolKey(table, "")]
	}
	if len(vals) == 0 {
		return nil, false
	}

	idx := rng.Intn(len(vals))
	return vals[idx], true
}

// SampleSequential ring-buffers through keys using modulo index for even distribution.
func (p *KeyPool) SampleSequential(table, col string, idx int) (interface{}, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	vals := p.keys[poolKey(table, col)]
	if len(vals) == 0 {
		vals = p.keys[poolKey(table, "")]
	}
	if len(vals) == 0 {
		return nil, false
	}

	return vals[idx%len(vals)], true
}

// GetKeys returns a copy of all recorded keys for a table and column.
func (p *KeyPool) GetKeys(table, col string) []interface{} {
	p.mu.RLock()
	defer p.mu.RUnlock()

	vals := p.keys[poolKey(table, col)]
	if len(vals) == 0 {
		vals = p.keys[poolKey(table, "")]
	}
	res := make([]interface{}, len(vals))
	copy(res, vals)
	return res
}

// Count returns the count of keys in the pool for a given table and column.
func (p *KeyPool) Count(table, col string) int {
	p.mu.RLock()
	defer p.mu.RUnlock()

	vals := p.keys[poolKey(table, col)]
	if len(vals) == 0 {
		vals = p.keys[poolKey(table, "")]
	}
	return len(vals)
}

// LoadExistingKeys queries the database for existing parent keys if the parent was not seeded in this run.
func (p *KeyPool) LoadExistingKeys(ctx context.Context, drv types.Driver, schema, table, col string, limit int) error {
	if limit <= 0 {
		limit = 100
	}
	dialect := drv.Dialect()
	quotedCol := quoteIdent(dialect, col)
	quotedTable := quoteTable(dialect, schema, table)

	query := fmt.Sprintf("SELECT %s FROM %s WHERE %s IS NOT NULL LIMIT %d", quotedCol, quotedTable, quotedCol, limit)
	res, err := drv.ExecuteQuery(ctx, query)
	if err != nil {
		return err
	}

	var loaded []interface{}
	colIdx := -1
	for i, c := range res.Columns {
		if c == col {
			colIdx = i
			break
		}
	}
	if colIdx == -1 && len(res.Columns) > 0 {
		colIdx = 0
	}

	if colIdx >= 0 {
		for _, row := range res.Rows {
			if colIdx < len(row) && row[colIdx] != nil {
				loaded = append(loaded, row[colIdx])
			}
		}
	}

	p.AddKeys(table, col, loaded)
	return nil
}

func quoteIdent(dialect, name string) string {
	switch dialect {
	case "mysql":
		return fmt.Sprintf("`%s`", name)
	default:
		return fmt.Sprintf(`"%s"`, name)
	}
}

func quoteTable(dialect, schema, table string) string {
	if schema == "" {
		return quoteIdent(dialect, table)
	}
	switch dialect {
	case "mysql":
		return fmt.Sprintf("`%s`.`%s`", schema, table)
	default:
		return fmt.Sprintf(`"%s"."%s"`, schema, table)
	}
}
