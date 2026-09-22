package playbook

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

// VersionSnapshot is one entry in append-only version history.
type VersionSnapshot struct {
	Version       int    `json:"version"`
	QuerySnapshot string `json:"query_snapshot"`
	UpdatedAt     string `json:"updated_at"`
}

// Parameter is a named query parameter with optional default.
type Parameter struct {
	Name    string `json:"name"`
	Type    string `json:"type,omitempty"`
	Default string `json:"default,omitempty"`
}

// Entry is a single playbook query entry.
type Entry struct {
	ID             string            `json:"id"`
	Slug           string            `json:"slug"`
	Title          string            `json:"title"`
	Description    string            `json:"description,omitempty"`
	Tags           []string          `json:"tags"`
	Dialect        string            `json:"dialect,omitempty"`
	Query          string            `json:"query"`
	Parameters     []Parameter       `json:"parameters,omitempty"`
	Author         string            `json:"author,omitempty"`
	CreatedAt      string            `json:"created_at"`
	UpdatedAt      string            `json:"updated_at"`
	VersionHistory []VersionSnapshot `json:"version_history"`
}

// Store holds entries in memory and persists to a JSON-lines file.
type Store struct {
	mu       sync.RWMutex
	path     string
	entries  []*Entry
	gitRepo  string // optional: path to git repo for auto-commit
}

var reSlugBad = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	s = strings.ToLower(s)
	s = reSlugBad.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

func genID() string {
	return fmt.Sprintf("pb_%d", time.Now().UnixNano())
}

func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// NewStore creates a Store backed by path (created if missing).
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
	// stored as a JSON array for simplicity
	return json.Unmarshal(data, &s.entries)
}

func (s *Store) save() error {
	data, err := json.MarshalIndent(s.entries, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(s.path, data, 0600); err != nil {
		return err
	}
	s.gitCommit()
	return nil
}

// gitCommit shells out to git; errors are silently ignored (best-effort).
func (s *Store) gitCommit() {
	if s.gitRepo == "" {
		return
	}
	_ = exec.Command("git", "-C", s.gitRepo, "add", s.path).Run()
	_ = exec.Command("git", "-C", s.gitRepo, "commit", "-m", "chore: update playbook").Run()
}

// List returns entries matching optional tag and fuzzy query filters.
func (s *Store) List(tag, q string) []*Entry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []*Entry
	ql := strings.ToLower(q)
	for _, e := range s.entries {
		if tag != "" {
			found := false
			for _, t := range e.Tags {
				if t == tag {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		if ql != "" {
			if !strings.Contains(strings.ToLower(e.Title), ql) &&
				!strings.Contains(strings.ToLower(e.Description), ql) {
				continue
			}
		}
		out = append(out, e)
	}
	if out == nil {
		out = []*Entry{}
	}
	return out
}

// Get returns entry by id or nil.
func (s *Store) Get(id string) *Entry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, e := range s.entries {
		if e.ID == id {
			return e
		}
	}
	return nil
}

// Create adds a new entry and persists.
func (s *Store) Create(e *Entry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	e.ID = genID()
	e.CreatedAt = now()
	e.UpdatedAt = e.CreatedAt
	if e.Slug == "" {
		e.Slug = slugify(e.Title)
	}
	if e.Tags == nil {
		e.Tags = []string{}
	}
	if e.Parameters == nil {
		e.Parameters = []Parameter{}
	}
	e.VersionHistory = []VersionSnapshot{}
	s.entries = append(s.entries, e)
	return s.save()
}

// Update modifies an entry by id, appending a version snapshot.
func (s *Store) Update(id string, patch *Entry) (*Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.entries {
		if e.ID != id {
			continue
		}
		// Save snapshot before mutating
		e.VersionHistory = append(e.VersionHistory, VersionSnapshot{
			Version:       len(e.VersionHistory) + 1,
			QuerySnapshot: e.Query,
			UpdatedAt:     e.UpdatedAt,
		})
		e.Title = patch.Title
		e.Description = patch.Description
		e.Tags = patch.Tags
		e.Dialect = patch.Dialect
		e.Query = patch.Query
		e.Parameters = patch.Parameters
		e.Author = patch.Author
		if patch.Slug != "" {
			e.Slug = patch.Slug
		}
		e.UpdatedAt = now()
		return e, s.save()
	}
	return nil, fmt.Errorf("entry not found: %s", id)
}

// Delete removes an entry by id.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, e := range s.entries {
		if e.ID == id {
			s.entries = append(s.entries[:i], s.entries[i+1:]...)
			return s.save()
		}
	}
	return fmt.Errorf("entry not found: %s", id)
}

// ExportJSON returns all entries as JSON.
func (s *Store) ExportJSON() ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return json.MarshalIndent(map[string]interface{}{"entries": s.entries}, "", "  ")
}

// ExportMarkdown renders a playbook.md with fenced SQL blocks.
func (s *Store) ExportMarkdown() []byte {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var sb strings.Builder
	sb.WriteString("# DBLens Playbook\n\n")
	for _, e := range s.entries {
		sb.WriteString(fmt.Sprintf("## %s\n\n", e.Title))
		if e.Description != "" {
			sb.WriteString(e.Description + "\n\n")
		}
		if len(e.Tags) > 0 {
			sb.WriteString("**Tags:** " + strings.Join(e.Tags, ", ") + "\n\n")
		}
		dialect := e.Dialect
		if dialect == "" {
			dialect = "sql"
		}
		sb.WriteString(fmt.Sprintf("```%s\n%s\n```\n\n", dialect, e.Query))
		sb.WriteString("---\n\n")
	}
	return []byte(sb.String())
}

// Import merges entries from a bundle; existing IDs are skipped.
func (s *Store) Import(entries []*Entry) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing := map[string]bool{}
	for _, e := range s.entries {
		existing[e.ID] = true
	}
	count := 0
	for _, e := range entries {
		if e.ID != "" && existing[e.ID] {
			continue
		}
		e.ID = genID()
		e.CreatedAt = now()
		e.UpdatedAt = e.CreatedAt
		if e.Slug == "" {
			e.Slug = slugify(e.Title)
		}
		if e.Tags == nil {
			e.Tags = []string{}
		}
		if e.VersionHistory == nil {
			e.VersionHistory = []VersionSnapshot{}
		}
		s.entries = append(s.entries, e)
		count++
	}
	if count > 0 {
		return count, s.save()
	}
	return 0, nil
}

// ImportSQL creates an entry from a raw SQL string and title.
func (s *Store) ImportSQL(title, sql string) (*Entry, error) {
	e := &Entry{Title: title, Query: sql}
	return e, s.Create(e)
}
