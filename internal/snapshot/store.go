package snapshot

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Store provides thread-safe local file persistence for schema snapshots.
type Store struct {
	baseDir string
	mu      sync.RWMutex
}

// NewStore initializes a snapshot store. If baseDir is empty,
// defaults to ~/.dblens/snapshots.
func NewStore(baseDir string) *Store {
	if strings.TrimSpace(baseDir) == "" {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			home = os.TempDir()
		}
		baseDir = filepath.Join(home, ".dblens", "snapshots")
	}
	return &Store{
		baseDir: baseDir,
	}
}

func sanitizePathComponent(s string) string {
	s = strings.TrimSpace(s)
	if s == "" || s == "." || s == ".." {
		return "unknown"
	}
	var sb strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			sb.WriteRune(r)
		}
	}
	res := sb.String()
	if res == "" || res == "." || res == ".." {
		return "unknown"
	}
	return res
}

func (s *Store) connDir(connID string) (string, error) {
	cleanConnID := sanitizePathComponent(connID)
	dir := filepath.Join(s.baseDir, cleanConnID)
	rel, err := filepath.Rel(s.baseDir, dir)
	if err != nil || strings.HasPrefix(rel, "..") || rel == "." {
		return "", fmt.Errorf("connection directory escapes base directory")
	}
	return dir, nil
}

func (s *Store) snapshotPath(connID, id string) (string, error) {
	dir, err := s.connDir(connID)
	if err != nil {
		return "", err
	}
	cleanID := sanitizePathComponent(id)
	targetPath := filepath.Join(dir, cleanID+".json.gz")
	rel, err := filepath.Rel(s.baseDir, targetPath)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("snapshot file path escapes base directory")
	}
	return targetPath, nil
}

// Save persists a SchemaSnapshot compressed as gzip + json.
func (s *Store) Save(snap *SchemaSnapshot) error {
	if snap == nil {
		return fmt.Errorf("snapshot cannot be nil")
	}
	if strings.TrimSpace(snap.ConnID) == "" {
		return fmt.Errorf("snapshot connId is required")
	}
	if strings.TrimSpace(snap.ID) == "" {
		return fmt.Errorf("snapshot id is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	dir, err := s.connDir(snap.ConnID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create snapshot directory: %w", err)
	}

	targetPath, err := s.snapshotPath(snap.ConnID, snap.ID)
	if err != nil {
		return err
	}
	tmpPath := targetPath + ".tmp"

	f, err := os.Create(tmpPath)
	if err != nil {
		return fmt.Errorf("failed to create temporary snapshot file: %w", err)
	}

	gz := gzip.NewWriter(f)
	enc := json.NewEncoder(gz)
	enc.SetIndent("", "  ")

	if err := enc.Encode(snap); err != nil {
		_ = gz.Close()
		_ = f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed to encode snapshot json: %w", err)
	}

	if err := gz.Close(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed to finalize gzip writer: %w", err)
	}

	if err := f.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed to close snapshot file: %w", err)
	}

	if err := os.Rename(tmpPath, targetPath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed to persist snapshot file: %w", err)
	}

	return nil
}

// Get loads a snapshot by connection ID and snapshot ID.
func (s *Store) Get(connID, id string) (*SchemaSnapshot, error) {
	if strings.TrimSpace(connID) == "" || strings.TrimSpace(id) == "" {
		return nil, fmt.Errorf("connId and id are required")
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	filePath, err := s.snapshotPath(connID, id)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("snapshot not found: %s", id)
		}
		return nil, fmt.Errorf("failed to open snapshot file: %w", err)
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer gz.Close()

	var snap SchemaSnapshot
	if err := json.NewDecoder(gz).Decode(&snap); err != nil {
		return nil, fmt.Errorf("failed to decode snapshot json: %w", err)
	}

	return &snap, nil
}

// List returns all snapshots for a given connection, sorted newest to oldest.
func (s *Store) List(connID string) ([]*SchemaSnapshot, error) {
	if strings.TrimSpace(connID) == "" {
		return nil, fmt.Errorf("connId is required")
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	dir, err := s.connDir(connID)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []*SchemaSnapshot{}, nil
		}
		return nil, fmt.Errorf("failed to read snapshot directory: %w", err)
	}

	snapshots := make([]*SchemaSnapshot, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json.gz") {
			continue
		}

		filePath := filepath.Join(dir, entry.Name())
		snap, err := readSnapshotFile(filePath)
		if err != nil {
			// Skip corrupted snapshot files instead of failing entire list
			continue
		}
		snapshots = append(snapshots, snap)
	}

	// Sort newest first
	sort.Slice(snapshots, func(i, j int) bool {
		return snapshots[i].CreatedAt.After(snapshots[j].CreatedAt)
	})

	return snapshots, nil
}

// Delete removes a snapshot file from disk.
func (s *Store) Delete(connID, id string) error {
	if strings.TrimSpace(connID) == "" || strings.TrimSpace(id) == "" {
		return fmt.Errorf("connId and id are required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	filePath, err := s.snapshotPath(connID, id)
	if err != nil {
		return err
	}
	if err := os.Remove(filePath); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("snapshot not found: %s", id)
		}
		return fmt.Errorf("failed to delete snapshot file: %w", err)
	}
	return nil
}

func readSnapshotFile(filePath string) (*SchemaSnapshot, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	defer gz.Close()

	b, err := io.ReadAll(gz)
	if err != nil {
		return nil, err
	}

	var snap SchemaSnapshot
	if err := json.Unmarshal(b, &snap); err != nil {
		return nil, err
	}

	return &snap, nil
}
