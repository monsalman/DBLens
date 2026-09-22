// Package annotations provides a JSON-file backed store for database table and
// column annotations ("collaborative notes"). Notes are keyed by target
// (connection / schema / table / column) and persist to ~/.dblens/annotations.json.
package annotations

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// Target types accepted on an Annotation.
const (
	TargetTable      = "table"
	TargetColumn     = "column"
	TargetConnection = "connection"
)

// MaxNoteLen caps the note body so a single record cannot bloat the store file.
const MaxNoteLen = 20000

// Annotation is one collaborative note attached to a schema object.
type Annotation struct {
	ID           string    `json:"id"`
	TargetType   string    `json:"target_type"`
	ConnectionID string    `json:"connection_id"`
	Schema       string    `json:"schema,omitempty"`
	Table        string    `json:"table,omitempty"`
	Column       string    `json:"column,omitempty"`
	Note         string    `json:"note"`
	Author       string    `json:"author,omitempty"`
	Pinned       bool      `json:"pinned"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Store holds annotations in memory and persists them as a JSON array.
type Store struct {
	mu    sync.RWMutex
	path  string
	items []*Annotation
}

// NewStore creates a Store backed by path (file created lazily on first save).
func NewStore(path string) (*Store, error) {
	s := &Store{path: path}
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
	return json.Unmarshal(data, &s.items)
}

// save writes the slice out atomically-ish (0600) and is called with the lock held.
func (s *Store) save() error {
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

func genID() string {
	return fmt.Sprintf("an_%d", time.Now().UnixNano())
}

func normalizeTargetType(t string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(t)) {
	case "", TargetTable:
		return TargetTable, true
	case TargetColumn:
		return TargetColumn, true
	case TargetConnection:
		return TargetConnection, true
	}
	return "", false
}

// Create validates and appends a new annotation.
func (s *Store) Create(a *Annotation) error {
	if a == nil {
		return fmt.Errorf("annotation is required")
	}
	tt, ok := normalizeTargetType(a.TargetType)
	if !ok {
		return fmt.Errorf("invalid target_type: %s (want table, column or connection)", a.TargetType)
	}
	a.TargetType = tt
	a.Note = strings.TrimSpace(a.Note)
	if a.Note == "" {
		return fmt.Errorf("note is required")
	}
	if len(a.Note) > MaxNoteLen {
		return fmt.Errorf("note exceeds %d characters", MaxNoteLen)
	}
	if tt == TargetColumn && strings.TrimSpace(a.Column) == "" {
		return fmt.Errorf("column is required for a column annotation")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	a.ID = genID()
	now := time.Now().UTC()
	a.CreatedAt = now
	a.UpdatedAt = now
	s.items = append(s.items, a)
	return s.save()
}

// Update patches note/author/pinned (and location when supplied) by id.
func (s *Store) Update(id string, patch *Annotation) (*Annotation, error) {
	if patch == nil {
		return nil, fmt.Errorf("annotation is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.items {
		if a.ID != id {
			continue
		}
		note := strings.TrimSpace(patch.Note)
		if note == "" {
			return nil, fmt.Errorf("note is required")
		}
		if len(note) > MaxNoteLen {
			return nil, fmt.Errorf("note exceeds %d characters", MaxNoteLen)
		}
		a.Note = note
		a.Author = strings.TrimSpace(patch.Author)
		a.Pinned = patch.Pinned
		if patch.TargetType != "" {
			tt, ok := normalizeTargetType(patch.TargetType)
			if !ok {
				return nil, fmt.Errorf("invalid target_type: %s", patch.TargetType)
			}
			a.TargetType = tt
		}
		if patch.ConnectionID != "" {
			a.ConnectionID = patch.ConnectionID
		}
		if patch.Schema != "" {
			a.Schema = patch.Schema
		}
		if patch.Table != "" {
			a.Table = patch.Table
		}
		if patch.Column != "" {
			a.Column = patch.Column
		}
		a.UpdatedAt = time.Now().UTC()
		return a, s.save()
	}
	return nil, fmt.Errorf("annotation not found: %s", id)
}

// Delete removes an annotation by id.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, a := range s.items {
		if a.ID == id {
			s.items = append(s.items[:i], s.items[i+1:]...)
			return s.save()
		}
	}
	return fmt.Errorf("annotation not found: %s", id)
}

// List returns all annotations, pinned first then newest first.
func (s *Store) List() []*Annotation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return sortAnnotations(s.items)
}

// ListByTarget returns annotations for a connection, optionally narrowed to a
// schema and/or table. Empty filters are treated as wildcards.
func (s *Store) ListByTarget(connID, schema, table string) []*Annotation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []*Annotation
	for _, a := range s.items {
		if connID != "" && a.ConnectionID != connID {
			continue
		}
		if schema != "" && a.Schema != schema {
			continue
		}
		if table != "" && a.Table != table {
			continue
		}
		out = append(out, a)
	}
	return sortAnnotations(out)
}

// Search matches keyword (case-insensitive) against note, author, table and column.
func (s *Store) Search(keyword string) []*Annotation {
	kw := strings.ToLower(strings.TrimSpace(keyword))
	s.mu.RLock()
	defer s.mu.RUnlock()
	if kw == "" {
		return sortAnnotations(s.items)
	}
	var out []*Annotation
	for _, a := range s.items {
		hay := strings.ToLower(a.Note + " " + a.Author + " " + a.Schema + " " + a.Table + " " + a.Column + " " + a.ConnectionID)
		if strings.Contains(hay, kw) {
			out = append(out, a)
		}
	}
	return sortAnnotations(out)
}

// Query combines location filters with an optional keyword search.
func (s *Store) Query(connID, schema, table, keyword string) []*Annotation {
	matches := s.List()
	if kw := strings.ToLower(strings.TrimSpace(keyword)); kw != "" {
		filtered := matches[:0:0]
		for _, a := range matches {
			hay := strings.ToLower(a.Note + " " + a.Author + " " + a.Schema + " " + a.Table + " " + a.Column + " " + a.ConnectionID)
			if strings.Contains(hay, kw) {
				filtered = append(filtered, a)
			}
		}
		matches = filtered
	}
	out := make([]*Annotation, 0, len(matches))
	for _, a := range matches {
		if connID != "" && a.ConnectionID != connID {
			continue
		}
		if schema != "" && a.Schema != schema {
			continue
		}
		if table != "" && a.Table != table {
			continue
		}
		out = append(out, a)
	}
	return sortAnnotations(out)
}

func sortAnnotations(in []*Annotation) []*Annotation {
	out := make([]*Annotation, len(in))
	copy(out, in)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Pinned != out[j].Pinned {
			return out[i].Pinned
		}
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out
}

// ExportMarkdown renders every annotation as a Markdown runbook grouped by
// connection, then schema/table, with pinned notes called out.
func (s *Store) ExportMarkdown() string {
	items := s.List()
	var sb strings.Builder
	sb.WriteString("# DBLens Schema Annotations\n\n")
	sb.WriteString(fmt.Sprintf("_%d annotation(s) exported %s_\n\n", len(items), time.Now().UTC().Format(time.RFC3339)))
	if len(items) == 0 {
		sb.WriteString("No annotations recorded yet.\n")
		return sb.String()
	}

	byConn := map[string][]*Annotation{}
	var connOrder []string
	for _, a := range items {
		key := a.ConnectionID
		if key == "" {
			key = "(unbound)"
		}
		if _, seen := byConn[key]; !seen {
			connOrder = append(connOrder, key)
		}
		byConn[key] = append(byConn[key], a)
	}

	for _, conn := range connOrder {
		sb.WriteString(fmt.Sprintf("## Connection: %s\n\n", conn))
		for _, a := range byConn[conn] {
			label := a.Table
			if label == "" {
				label = "(connection level)"
			}
			if a.Schema != "" {
				label = a.Schema + "." + label
			}
			if a.Column != "" {
				label += "." + a.Column
			}
			pin := ""
			if a.Pinned {
				pin = " 📌"
			}
			sb.WriteString(fmt.Sprintf("### %s%s\n\n", label, pin))
			if a.Author != "" {
				sb.WriteString(fmt.Sprintf("**Author:** %s · ", a.Author))
			}
			sb.WriteString(fmt.Sprintf("**Updated:** %s\n\n", a.UpdatedAt.Format(time.RFC3339)))
			sb.WriteString(a.Note + "\n\n")
		}
		sb.WriteString("---\n\n")
	}
	return sb.String()
}
