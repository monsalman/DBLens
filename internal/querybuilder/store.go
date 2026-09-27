package querybuilder

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	ErrNotFound   = errors.New("visual query not found")
	ErrValidation = errors.New("validation failed")
)

// SavedVisualQuery represents a query persisted in the visual query store.
type SavedVisualQuery struct {
	ID           string           `json:"id"`
	Name         string           `json:"name"`
	Description  string           `json:"description,omitempty"`
	ConnectionID string           `json:"connectionId,omitempty"`
	State        QueryCanvasState `json:"state"`
	SQL          string           `json:"sql,omitempty"`
	CreatedAt    time.Time        `json:"createdAt"`
	UpdatedAt    time.Time        `json:"updatedAt"`
}

// Store persists SavedVisualQuery instances to disk as JSON.
type Store struct {
	mu    sync.RWMutex
	path  string
	items []*SavedVisualQuery
}

// NewStore initializes a store with the specified JSON file path.
func NewStore(path string) (*Store, error) {
	s := &Store{path: path}
	if path != "" {
		if err := s.load(); err != nil {
			return nil, err
		}
	}
	return s, nil
}

// NewInMemoryStore returns a transient in-memory store.
func NewInMemoryStore() *Store {
	return &Store{items: make([]*SavedVisualQuery, 0)}
}

func (s *Store) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		s.items = make([]*SavedVisualQuery, 0)
		return nil
	}
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		s.items = make([]*SavedVisualQuery, 0)
		return nil
	}
	return json.Unmarshal(data, &s.items)
}

func (s *Store) saveLocked() error {
	if s.path == "" {
		return nil
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s.items, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// List returns queries, optionally filtered by connectionID.
func (s *Store) List(connID string) []*SavedVisualQuery {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]*SavedVisualQuery, 0, len(s.items))
	trimmedConn := strings.TrimSpace(connID)
	for _, it := range s.items {
		if trimmedConn == "" || it.ConnectionID == "" || it.ConnectionID == trimmedConn {
			cp := *it
			result = append(result, &cp)
		}
	}
	return result
}

// Get finds a query by ID.
func (s *Store) Get(id string) (*SavedVisualQuery, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, it := range s.items {
		if it.ID == id {
			cp := *it
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}

// Save inserts or updates a SavedVisualQuery.
func (s *Store) Save(q *SavedVisualQuery) (*SavedVisualQuery, error) {
	if q == nil {
		return nil, ErrValidation
	}
	q.Name = strings.TrimSpace(q.Name)
	if q.Name == "" {
		q.Name = "Untitled Query"
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	if q.ID == "" {
		q.ID = fmt.Sprintf("vq_%d", now.UnixNano())
		q.CreatedAt = now
		q.UpdatedAt = now
		s.items = append(s.items, q)
	} else {
		found := false
		for i, it := range s.items {
			if it.ID == q.ID {
				q.CreatedAt = it.CreatedAt
				q.UpdatedAt = now
				s.items[i] = q
				found = true
				break
			}
		}
		if !found {
			q.CreatedAt = now
			q.UpdatedAt = now
			s.items = append(s.items, q)
		}
	}

	if err := s.saveLocked(); err != nil {
		return nil, err
	}
	cp := *q
	return &cp, nil
}

// Delete removes a query by ID.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	idx := -1
	for i, it := range s.items {
		if it.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return ErrNotFound
	}
	s.items = append(s.items[:idx], s.items[idx+1:]...)
	return s.saveLocked()
}
