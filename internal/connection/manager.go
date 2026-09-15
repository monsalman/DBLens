package connection

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/dblens/dblens/internal/driver"
	"github.com/dblens/dblens/internal/driver/types"
)

type PoolEntry struct {
	Driver   types.Driver
	DSN      string
	LastUsed time.Time
}

type Manager struct {
	mu    sync.Mutex
	pools map[string]*PoolEntry // key: SHA256(dsn)
}

func NewManager(dataDir ...string) *Manager {
	m := &Manager{
		pools: make(map[string]*PoolEntry),
	}
	// Load server-seeded global connections from DBLENS_CONNECTIONS env
	envConns := os.Getenv("DBLENS_CONNECTIONS")
	if envConns != "" {
		for _, part := range strings.Split(envConns, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			_ = m.openPool(part)
		}
	}
	// Start background idle cleaner
	go m.idleCleaner()
	return m
}

// poolKey returns SHA256 of the DSN to use as map key
func poolKey(dsn string) string {
	h := sha256.Sum256([]byte(dsn))
	return fmt.Sprintf("%x", h)
}

// openPool opens a driver for a DSN without ping (lazy)
func (m *Manager) openPool(dsn string) error {
	key := poolKey(dsn)
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.pools[key]; exists {
		return nil
	}
	drv, err := driver.NewDriver(dsn)
	if err != nil {
		return fmt.Errorf("failed to open driver: %w", err)
	}
	m.pools[key] = &PoolEntry{Driver: drv, DSN: dsn, LastUsed: time.Now()}
	return nil
}

// GetByDSN returns (or creates on-demand) a driver for the given DSN.
// This is the primary method for stateless per-request DSN routing.
func (m *Manager) GetByDSN(dsn string) (*PoolEntry, error) {
	if dsn == "" {
		return nil, fmt.Errorf("X-DBLENS-DSN header is required")
	}
	key := poolKey(dsn)

	m.mu.Lock()
	entry, exists := m.pools[key]
	if exists {
		entry.LastUsed = time.Now()
		m.mu.Unlock()
		// Verify connection still alive, reconnect if not
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := entry.Driver.Ping(ctx); err != nil {
			_ = entry.Driver.Close()
			newDrv, rErr := driver.NewDriver(dsn)
			if rErr != nil {
				m.mu.Lock()
				delete(m.pools, key)
				m.mu.Unlock()
				return nil, fmt.Errorf("reconnect failed: %w", rErr)
			}
			m.mu.Lock()
			entry.Driver = newDrv
			m.mu.Unlock()
		}
		return entry, nil
	}
	m.mu.Unlock()

	// Open new pool on-demand
	drv, err := driver.NewDriver(dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := drv.Ping(ctx); err != nil {
		_ = drv.Close()
		return nil, fmt.Errorf("database ping failed: %w", err)
	}
	newEntry := &PoolEntry{Driver: drv, DSN: dsn, LastUsed: time.Now()}
	m.mu.Lock()
	m.pools[key] = newEntry
	m.mu.Unlock()
	return newEntry, nil
}

// GlobalProfiles returns server-seeded connections (DBLENS_CONNECTIONS only)
// These are the only "shared" profiles that appear in the UI when configured.
func (m *Manager) GlobalProfiles() []map[string]string {
	envConns := os.Getenv("DBLENS_CONNECTIONS")
	if envConns == "" {
		return []map[string]string{}
	}
	var result []map[string]string
	for i, part := range strings.Split(envConns, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		result = append(result, map[string]string{
			"id":    fmt.Sprintf("global_%d", i+1),
			"dsn":   maskDSN(part),
			"label": fmt.Sprintf("Shared DB %d", i+1),
		})
	}
	return result
}

// GetGlobalDSNByID finds the real raw DSN for a global_X or env_X ID
func (m *Manager) GetGlobalDSNByID(id string) (string, bool) {
	envConns := os.Getenv("DBLENS_CONNECTIONS")
	if envConns == "" {
		return "", false
	}
	var targetIdx int = -1
	if strings.HasPrefix(id, "global_") {
		_, _ = fmt.Sscanf(id, "global_%d", &targetIdx)
	} else if strings.HasPrefix(id, "env_") {
		_, _ = fmt.Sscanf(id, "env_%d", &targetIdx)
	}
	if targetIdx <= 0 {
		return "", false
	}
	cur := 0
	for _, part := range strings.Split(envConns, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		cur++
		if cur == targetIdx {
			return part, true
		}
	}
	return "", false
}

// TestDSN tries to connect to a DSN without persisting, returns dialect.
func (m *Manager) TestDSN(dsn string) (string, error) {
	drv, err := driver.NewDriver(dsn)
	if err != nil {
		return "", err
	}
	defer drv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := drv.Ping(ctx); err != nil {
		return drv.Dialect(), err
	}
	return drv.Dialect(), nil
}

// idleCleaner closes pools idle for more than 10 minutes
func (m *Manager) idleCleaner() {
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		m.mu.Lock()
		threshold := time.Now().Add(-10 * time.Minute)
		for key, entry := range m.pools {
			if entry.LastUsed.Before(threshold) {
				_ = entry.Driver.Close()
				delete(m.pools, key)
			}
		}
		m.mu.Unlock()
	}
}

func maskDSN(dsn string) string {
	if idx := strings.Index(dsn, "@"); idx != -1 {
		prefix := strings.Index(dsn, "://")
		if prefix != -1 && prefix < idx {
			credPart := dsn[prefix+3 : idx]
			if colonIdx := strings.LastIndex(credPart, ":"); colonIdx != -1 {
				user := credPart[:colonIdx]
				return dsn[:prefix+3] + user + ":***" + dsn[idx:]
			}
		}
	}
	return dsn
}
