package connection

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/dblens/dblens/internal/driver"
)

type ConnectionEntry struct {
	ID       string        `json:"id"`
	Label    string        `json:"label"`
	DSN      string        `json:"dsn"`
	Color    string        `json:"color"`
	ReadOnly bool          `json:"readOnly"`
	Driver   driver.Driver `json:"-"`
	LastUsed time.Time     `json:"lastUsed"`
}

type ConnectionSummary struct {
	ID       string    `json:"id"`
	Label    string    `json:"label"`
	DSN      string    `json:"dsn"`
	Color    string    `json:"color"`
	ReadOnly bool      `json:"readOnly"`
	Dialect  string    `json:"dialect"`
	LastUsed time.Time `json:"lastUsed"`
}

type Manager struct {
	mu           sync.RWMutex
	conns        map[string]*ConnectionEntry
	profileStore *ProfileStore
}

func NewManager(dataDir ...string) *Manager {
	var dir string
	if len(dataDir) > 0 {
		dir = dataDir[0]
	}

	m := &Manager{
		conns:        make(map[string]*ConnectionEntry),
		profileStore: NewProfileStore(dir),
	}

	// Load persistent profiles
	if profiles, err := m.profileStore.Load(); err == nil {
		for _, p := range profiles {
			_ = m.Add(p.ID, p.Label, p.DSN, p.Color, p.ReadOnly)
		}
	}

	envConns := os.Getenv("DBLENS_CONNECTIONS")
	if envConns != "" {
		parts := strings.Split(envConns, ",")
		for i, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			label := fmt.Sprintf("Conn %d", i+1)
			dsn := part
			if idx := strings.Index(part, "="); idx != -1 && !strings.Contains(part[:idx], "://") {
				label = strings.TrimSpace(part[:idx])
				dsn = strings.TrimSpace(part[idx+1:])
			}
			id := fmt.Sprintf("env_%d", i+1)
			_ = m.Add(id, label, dsn, "#6366f1", false)
		}
	}

	return m
}

func maskDSN(dsn string) string {
	u, err := url.Parse(dsn)
	if err == nil && u.User != nil {
		if _, hasPass := u.User.Password(); hasPass {
			u.User = url.UserPassword(u.User.Username(), "******")
			return u.String()
		}
		return dsn
	}
	if idx := strings.Index(dsn, "@"); idx != -1 {
		prefixIdx := strings.Index(dsn, "://")
		if prefixIdx != -1 && prefixIdx < idx {
			return dsn[:prefixIdx+3] + "******" + dsn[idx:]
		}
		return "******" + dsn[idx:]
	}
	return dsn
}

func (m *Manager) Get(id string) (*ConnectionEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	entry, ok := m.conns[id]
	if !ok {
		return nil, fmt.Errorf("connection '%s' not found", id)
	}
	entry.LastUsed = time.Now()
	return entry, nil
}

func (m *Manager) AddWithID(id, label, dsn, color string, readOnly bool) (*ConnectionEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if id == "" {
		id = fmt.Sprintf("conn_%d", time.Now().UnixNano())
	}
	if label == "" {
		label = id
	}
	if color == "" {
		color = "#3b82f6"
	}

	drv, err := driver.NewDriver(dsn)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := drv.Ping(ctx); err != nil {
		drv.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	entry := &ConnectionEntry{
		ID:       id,
		Label:    label,
		DSN:      dsn,
		Color:    color,
		ReadOnly: readOnly,
		Driver:   drv,
		LastUsed: time.Now(),
	}

	if old, exists := m.conns[id]; exists {
		_ = old.Driver.Close()
	}
	m.conns[id] = entry
	return entry, nil
}

func (m *Manager) Add(id, label, dsn, color string, readOnly bool) error {
	_, err := m.AddWithID(id, label, dsn, color, readOnly)
	return err
}

func (m *Manager) ConnectProfile(id, label, dsn, color string, readOnly bool) (*ConnectionEntry, error) {
	entry, err := m.AddWithID(id, label, dsn, color, readOnly)
	if err != nil {
		return nil, err
	}

	if m.profileStore != nil {
		profile := Profile{
			ID:       entry.ID,
			Label:    entry.Label,
			DSN:      entry.DSN,
			Color:    entry.Color,
			ReadOnly: entry.ReadOnly,
		}
		// Update or Add profile
		if _, err := m.profileStore.Update(entry.ID, profile); err != nil {
			return nil, fmt.Errorf("failed to save profile: %w", err)
		}
	}

	return entry, nil
}

func (m *Manager) ListProfiles() ([]Profile, error) {
	if m.profileStore == nil {
		return []Profile{}, nil
	}
	return m.profileStore.GetAll()
}

func (m *Manager) RemoveProfile(id string) error {
	_ = m.Remove(id)
	if m.profileStore != nil {
		_, err := m.profileStore.Remove(id)
		return err
	}
	return nil
}

func (m *Manager) Remove(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	entry, ok := m.conns[id]
	if !ok {
		return fmt.Errorf("connection '%s' not found", id)
	}
	_ = entry.Driver.Close()
	delete(m.conns, id)
	if m.profileStore != nil {
		_, _ = m.profileStore.Remove(id)
	}
	return nil
}

func (m *Manager) List() []ConnectionSummary {
	m.mu.RLock()
	defer m.mu.RUnlock()

	list := make([]ConnectionSummary, 0, len(m.conns))
	for _, entry := range m.conns {
		list = append(list, ConnectionSummary{
			ID:       entry.ID,
			Label:    entry.Label,
			DSN:      maskDSN(entry.DSN),
			Color:    entry.Color,
			ReadOnly: entry.ReadOnly,
			Dialect:  entry.Driver.Dialect(),
			LastUsed: entry.LastUsed,
		})
	}
	return list
}

func (m *Manager) Ping(id string) error {
	entry, err := m.Get(id)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return entry.Driver.Ping(ctx)
}
