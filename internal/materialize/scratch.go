package materialize

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
)

// ScratchStore tracks temporary and scratchpad tables with TTLs.
type ScratchStore struct {
	mu    sync.RWMutex
	path  string
	items []*ScratchTable
}

// NewScratchStore creates a persistent or memory-backed ScratchStore.
func NewScratchStore(path string) (*ScratchStore, error) {
	s := &ScratchStore{
		path:  path,
		items: make([]*ScratchTable, 0),
	}
	if path != "" {
		if err := s.load(); err != nil {
			return nil, err
		}
	}
	return s, nil
}

// NewInMemoryScratchStore creates an in-memory-only ScratchStore.
func NewInMemoryScratchStore() *ScratchStore {
	return &ScratchStore{items: make([]*ScratchTable, 0)}
}

func (s *ScratchStore) load() error {
	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil
	}
	return json.Unmarshal(data, &s.items)
}

func (s *ScratchStore) save() error {
	if s.path == "" {
		return nil
	}
	data, err := json.MarshalIndent(s.items, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(s.path)
	if dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0700)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// List returns all scratch tables for a connection (or all connections if connID is empty).
func (s *ScratchStore) List(connID string) []ScratchTable {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []ScratchTable
	connID = strings.TrimSpace(connID)
	for _, item := range s.items {
		if item == nil {
			continue
		}
		if connID == "" || strings.EqualFold(item.ConnID, connID) {
			result = append(result, *item)
		}
	}
	return result
}

// Get returns the scratch table matching connID, schema, and table name if it exists.
func (s *ScratchStore) Get(connID, schema, table string) *ScratchTable {
	s.mu.RLock()
	defer s.mu.RUnlock()

	table = strings.TrimSpace(table)
	for _, item := range s.items {
		if item == nil {
			continue
		}
		if (connID == "" || strings.EqualFold(item.ConnID, connID)) &&
			(schema == "" || item.Schema == "" || strings.EqualFold(item.Schema, schema)) &&
			strings.EqualFold(item.Table, table) {
			copied := *item
			return &copied
		}
	}
	return nil
}

// Register adds or updates a scratch table in the store.
func (s *ScratchStore) Register(st ScratchTable) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, item := range s.items {
		if item == nil {
			continue
		}
		if strings.EqualFold(item.ConnID, st.ConnID) &&
			strings.EqualFold(item.Schema, st.Schema) &&
			strings.EqualFold(item.Table, st.Table) {
			s.items[i] = &st
			_ = s.save()
			return
		}
	}

	s.items = append(s.items, &st)
	_ = s.save()
}

// Delete removes a scratch table from the registry.
func (s *ScratchStore) Delete(connID, schema, table string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	idx := -1
	for i, item := range s.items {
		if item == nil {
			continue
		}
		if (connID == "" || strings.EqualFold(item.ConnID, connID)) &&
			(schema == "" || item.Schema == "" || strings.EqualFold(item.Schema, schema)) &&
			strings.EqualFold(item.Table, table) {
			idx = i
			break
		}
	}

	if idx == -1 {
		return fmt.Errorf("scratch table '%s' not found", table)
	}

	s.items = append(s.items[:idx], s.items[idx+1:]...)
	return s.save()
}

// Promote marks a scratch table as permanent and returns the promotion SQL.
func (s *ScratchStore) Promote(connID, schema, table string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	idx := -1
	var target *ScratchTable
	for i, item := range s.items {
		if item == nil {
			continue
		}
		if (connID == "" || strings.EqualFold(item.ConnID, connID)) &&
			(schema == "" || item.Schema == "" || strings.EqualFold(item.Schema, schema)) &&
			strings.EqualFold(item.Table, table) {
			idx = i
			target = item
			break
		}
	}

	if idx == -1 || target == nil {
		return "", fmt.Errorf("scratch table '%s' not found", table)
	}

	// Remove from scratch registry so it is no longer treated as ephemeral
	s.items = append(s.items[:idx], s.items[idx+1:]...)
	_ = s.save()

	// Generate promotion SQL for user reference
	targetRef := QuoteTableRef(schema, table, "postgres")
	if target.IsTemporary {
		return fmt.Sprintf("CREATE TABLE %s_promoted AS SELECT * FROM %s;", QuoteIdent(table, "postgres"), targetRef), nil
	}
	return fmt.Sprintf("-- Promoted: Expiration removed for table %s. Table is now permanent.", targetRef), nil
}

// Expire drops all expired scratch tables on drv and unregisters them.
func (s *ScratchStore) Expire(ctx context.Context, drv types.Driver) (int, error) {
	return s.ExpireConn(ctx, "", drv)
}

// ExpireConn drops expired tables matching connID (or all if connID is empty) on drv.
func (s *ScratchStore) ExpireConn(ctx context.Context, connID string, drv types.Driver) (int, error) {
	now := time.Now()

	s.mu.Lock()
	var toDrop []*ScratchTable
	for _, item := range s.items {
		if item == nil {
			continue
		}
		matchConn := (connID == "" || strings.EqualFold(item.ConnID, connID))
		isExpired := !item.ExpiresAt.IsZero() && now.After(item.ExpiresAt)
		if matchConn && isExpired {
			toDrop = append(toDrop, item)
		}
	}
	s.mu.Unlock()

	if len(toDrop) == 0 {
		return 0, nil
	}

	if drv != nil {
		for _, item := range toDrop {
			targetRef := QuoteTableRef(item.Schema, item.Table, drv.Dialect())
			dropSQL := fmt.Sprintf("DROP TABLE IF EXISTS %s;", targetRef)
			_, _ = drv.ExecuteQuery(ctx, dropSQL)
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	droppedMap := make(map[*ScratchTable]bool, len(toDrop))
	for _, item := range toDrop {
		droppedMap[item] = true
	}

	var remaining []*ScratchTable
	for _, item := range s.items {
		if item != nil && !droppedMap[item] {
			remaining = append(remaining, item)
		}
	}

	s.items = remaining
	_ = s.save()
	return len(toDrop), nil
}
