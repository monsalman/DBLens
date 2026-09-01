package connection

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Profile represents a saved connection that persists across restarts
type Profile struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	DSN      string `json:"dsn"`
	Color    string `json:"color"`
	ReadOnly bool   `json:"readOnly,omitempty"`
}

// ProfileStore handles persistent storage of connection profiles as JSON file
type ProfileStore struct {
	mu       sync.RWMutex
	path     string
	profiles []Profile
}

func NewProfileStore(dataDir string) *ProfileStore {
	if dataDir == "" {
		// Default: ~/.config/dblens/connections.json
		home, err := os.UserHomeDir()
		if err != nil {
			home = "."
		}
		dataDir = filepath.Join(home, ".config", "dblens")
	}

	if err := os.MkdirAll(dataDir, 0755); err != nil {
		dataDir = "/tmp/dblens"
		_ = os.MkdirAll(dataDir, 0755)
	}

	return &ProfileStore{
		path: filepath.Join(dataDir, "connections.json"),
	}
}

// Load reads profiles from disk. Returns empty slice if file doesn't exist.
func (s *ProfileStore) Load() ([]Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			s.profiles = []Profile{}
			return []Profile{}, nil
		}
		return nil, fmt.Errorf("failed to read profiles: %w", err)
	}

	var profiles []Profile
	if err := json.Unmarshal(data, &profiles); err != nil {
		return nil, fmt.Errorf("failed to parse profiles: %w", err)
	}

	s.profiles = profiles
	return profiles, nil
}

// Save writes all profiles to disk atomically
func (s *ProfileStore) Save(profiles []Profile) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal profiles: %w", err)
	}

	tmpPath := s.path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write profiles: %w", err)
	}

	// Atomic rename
	if err := os.Rename(tmpPath, s.path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed to rename profiles: %w", err)
	}

	s.profiles = profiles
	return nil
}

// Add saves a new profile to disk
func (s *ProfileStore) Add(p Profile) ([]Profile, error) {
	profiles, err := s.Load()
	if err != nil {
		return nil, err
	}

	for _, existing := range profiles {
		if existing.ID == p.ID {
			return nil, fmt.Errorf("profile with id '%s' already exists", p.ID)
		}
	}

	profiles = append(profiles, p)
	if err := s.Save(profiles); err != nil {
		return nil, err
	}

	return profiles, nil
}

// Update modifies an existing profile
func (s *ProfileStore) Update(id string, updated Profile) ([]Profile, error) {
	profiles, err := s.Load()
	if err != nil {
		return nil, err
	}

	found := false
	for i, p := range profiles {
		if p.ID == id {
			profiles[i] = updated
			found = true
			break
		}
	}
	if !found {
		profiles = append(profiles, updated)
	}

	return profiles, s.Save(profiles)
}

// Remove deletes a profile from disk
func (s *ProfileStore) Remove(id string) ([]Profile, error) {
	profiles, err := s.Load()
	if err != nil {
		return nil, err
	}

	filtered := make([]Profile, 0, len(profiles))
	for _, p := range profiles {
		if p.ID != id {
			filtered = append(filtered, p)
		}
	}

	return filtered, s.Save(filtered)
}

// GetAll returns all profiles
func (s *ProfileStore) GetAll() ([]Profile, error) {
	return s.Load()
}
