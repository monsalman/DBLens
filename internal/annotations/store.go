// Package annotations provides a JSON-file backed store for database table and
// column annotations ("collaborative notes"). Notes are keyed by target
// (connection / schema / table / column) and persist to ~/.dblens/annotations.json.
package annotations

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// Sentinel errors let the HTTP layer map store failures to status codes with
// errors.Is instead of matching on message text, and let it return a generic
// client message without leaking internal detail.
var (
	ErrNotFound   = errors.New("not found")
	ErrValidation = errors.New("validation")
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

func validateAnnotation(a *Annotation) error {
	if a == nil {
		return fmt.Errorf("%w: annotation is required", ErrValidation)
	}
	tt, ok := normalizeTargetType(a.TargetType)
	if !ok {
		return fmt.Errorf("%w: invalid target_type: %s (want table, column or connection)", ErrValidation, a.TargetType)
	}
	a.TargetType = tt
	a.Note = strings.TrimSpace(a.Note)
	if a.Note == "" {
		return fmt.Errorf("%w: note is required", ErrValidation)
	}
	if len(a.Note) > MaxNoteLen {
		return fmt.Errorf("%w: note exceeds %d characters", ErrValidation, MaxNoteLen)
	}
	if tt == TargetColumn && strings.TrimSpace(a.Column) == "" {
		return fmt.Errorf("%w: column is required for a column annotation", ErrValidation)
	}
	return nil
}

// Create validates and appends a new annotation.
func (s *Store) Create(a *Annotation) error {
	if err := validateAnnotation(a); err != nil {
		return err
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

// UpdatePatch is the partial-update payload for Update. Non-pointer fields that
// are left empty are treated as "unchanged"; Pinned is a pointer so that
// omitting it never silently unpins the record.
type UpdatePatch struct {
	TargetType   string `json:"target_type"`
	ConnectionID string `json:"connection_id"`
	Schema       string `json:"schema"`
	Table        string `json:"table"`
	Column       string `json:"column"`
	Note         string `json:"note"`
	Author       string `json:"author"`
	Pinned       *bool  `json:"pinned"`
}

// Update patches note/author/pinned (and location when supplied) by id. The
// merged record is re-validated before it is persisted, so an update cannot
// leave the store holding a record Create would have rejected.
func (s *Store) Update(id string, patch *UpdatePatch) (*Annotation, error) {
	if patch == nil {
		return nil, fmt.Errorf("%w: annotation is required", ErrValidation)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.items {
		if a.ID != id {
			continue
		}
		// Build the merged record and validate it as a whole, so an update
		// cannot leave the store holding an invalid annotation.
		merged := *a
		merged.Note = strings.TrimSpace(patch.Note)
		if merged.Note == "" {
			return nil, fmt.Errorf("%w: note is required", ErrValidation)
		}
		merged.Author = strings.TrimSpace(patch.Author)
		if patch.Pinned != nil {
			merged.Pinned = *patch.Pinned
		}
		if patch.TargetType != "" {
			merged.TargetType = patch.TargetType
		}
		if patch.ConnectionID != "" {
			merged.ConnectionID = patch.ConnectionID
		}
		if patch.Schema != "" {
			merged.Schema = patch.Schema
		}
		if patch.Table != "" {
			merged.Table = patch.Table
		}
		if patch.Column != "" {
			merged.Column = patch.Column
		}
		if err := validateAnnotation(&merged); err != nil {
			return nil, err
		}
		merged.UpdatedAt = time.Now().UTC()
		*a = merged
		cp := merged
		return &cp, s.save()
	}
	return nil, fmt.Errorf("%w: annotation not found: %s", ErrNotFound, id)
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
	return fmt.Errorf("%w: annotation not found: %s", ErrNotFound, id)
}

// List returns all annotations, pinned first then newest first. Every element
// is a value copy: the store keeps mutating its own records under Lock, so
// handing out live pointers would race with concurrent writers.
func (s *Store) List() []*Annotation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return sortAnnotations(copyAnnotations(s.items))
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
		out = append(out, copyAnnotation(a))
	}
	return sortAnnotations(out)
}

// Search matches keyword (case-insensitive) against note, author, table and column.
func (s *Store) Search(keyword string) []*Annotation {
	kw := strings.ToLower(strings.TrimSpace(keyword))
	s.mu.RLock()
	defer s.mu.RUnlock()
	if kw == "" {
		return sortAnnotations(copyAnnotations(s.items))
	}
	var out []*Annotation
	for _, a := range s.items {
		hay := strings.ToLower(a.Note + " " + a.Author + " " + a.Schema + " " + a.Table + " " + a.Column + " " + a.ConnectionID)
		if strings.Contains(hay, kw) {
			out = append(out, copyAnnotation(a))
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

// copyAnnotation returns a value copy of a so callers never hold a pointer into
// the store's mutable slice.
func copyAnnotation(a *Annotation) *Annotation {
	if a == nil {
		return nil
	}
	cp := *a
	return &cp
}

// copyAnnotations value-copies every element; the caller must hold at least the
// read lock so the copies are taken from a stable slice.
func copyAnnotations(in []*Annotation) []*Annotation {
	out := make([]*Annotation, 0, len(in))
	for _, a := range in {
		out = append(out, copyAnnotation(a))
	}
	return out
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
