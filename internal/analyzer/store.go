package analyzer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type StoreData struct {
	Rules map[string]RuleSetting `json:"rules"`
}

type Store struct {
	mu      sync.RWMutex
	path    string
	configs map[string]RuleSetting
}

func DefaultStorePath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = os.TempDir()
	}
	return filepath.Join(home, ".dblens", "analyzer.json")
}

func NewStore(path string) (*Store, error) {
	if path == "" {
		path = DefaultStorePath()
	}
	s := &Store{
		path:    path,
		configs: make(map[string]RuleSetting),
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) load() error {
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
	var stored StoreData
	if err := json.Unmarshal(data, &stored); err != nil {
		return err
	}
	s.configs = stored.Rules
	if s.configs == nil {
		s.configs = make(map[string]RuleSetting)
	}
	return nil
}

func (s *Store) save() error {
	if dir := filepath.Dir(s.path); dir != "" {
		_ = os.MkdirAll(dir, 0700)
	}
	stored := StoreData{Rules: s.configs}
	data, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) GetRules() []RuleMeta {
	s.mu.RLock()
	defer s.mu.RUnlock()

	metas := make([]RuleMeta, 0, len(AllRules))
	for _, r := range AllRules {
		m := r.Meta()
		if cfg, ok := s.configs[m.ID]; ok {
			m.Enabled = cfg.Enabled
			if cfg.Severity.IsValid() {
				m.Severity = cfg.Severity
			}
		}
		metas = append(metas, m)
	}
	return metas
}

func (s *Store) GetRuleConfig() map[string]RuleSetting {
	s.mu.RLock()
	defer s.mu.RUnlock()

	res := make(map[string]RuleSetting, len(AllRules))
	// Initialize with defaults
	for _, r := range AllRules {
		m := r.Meta()
		res[m.ID] = RuleSetting{
			Enabled:  m.Enabled,
			Severity: m.Severity,
		}
	}
	// Overlay stored overrides
	for k, v := range s.configs {
		res[k] = v
	}
	return res
}

func (s *Store) UpdateRules(updates map[string]RuleSetting) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.configs == nil {
		s.configs = make(map[string]RuleSetting)
	}
	for id, setting := range updates {
		s.configs[id] = setting
	}
	return s.save()
}
