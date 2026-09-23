package playbook

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
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

// maxVersionHistory bounds the append-only version history so a long-lived
// entry cannot grow without limit (one full query copy was kept per PUT).
const maxVersionHistory = 20

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

// UpdatePatch is a partial update for an entry: nil pointer fields are left
// unchanged, so a client can PATCH just the query without wiping the title,
// tags or author.
type UpdatePatch struct {
	Title       *string     `json:"title,omitempty"`
	Description *string     `json:"description,omitempty"`
	Tags        []string    `json:"tags,omitempty"`
	Dialect     *string     `json:"dialect,omitempty"`
	Query       *string     `json:"query,omitempty"`
	Parameters  []Parameter `json:"parameters,omitempty"`
	Author      *string     `json:"author,omitempty"`
	Slug        *string     `json:"slug,omitempty"`
}

// Store holds entries in memory and persists to a JSON-lines file.
type Store struct {
	mu      sync.RWMutex
	path    string
	entries []*Entry
	gitRepo string // optional: path to git repo for auto-commit
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

// save writes the entry slice out atomically (tmp file + rename, mode 0600) and
// is called with the lock held. A crash mid-write can therefore never truncate
// the live library file.
func (s *Store) save() error {
	data, err := json.MarshalIndent(s.entries, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
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

// deepCopyEntry returns a copy of e including its slice fields, so readers
// never hand out pointers into the store's mutable entries.
func deepCopyEntry(e *Entry) *Entry {
	if e == nil {
		return nil
	}
	cp := *e
	cp.Tags = append([]string{}, e.Tags...)
	cp.Parameters = append([]Parameter{}, e.Parameters...)
	cp.VersionHistory = append([]VersionSnapshot{}, e.VersionHistory...)
	return &cp
}

// List returns entries matching optional tag and fuzzy query filters. Each
// element is a deep copy: Update mutates the stored entries under Lock, so
// live pointers would race with a concurrent writer (and its marshaling).
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
		out = append(out, deepCopyEntry(e))
	}
	if out == nil {
		out = []*Entry{}
	}
	return out
}

// Get returns a deep copy of the entry by id, or nil when absent.
func (s *Store) Get(id string) *Entry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, e := range s.entries {
		if e.ID == id {
			return deepCopyEntry(e)
		}
	}
	return nil
}

// Create adds a new entry and persists. The stored value is a deep copy so the
// caller's payload can never alias the library.
func (s *Store) Create(e *Entry) error {
	if e == nil {
		return fmt.Errorf("%w: entry is required", ErrValidation)
	}
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
	s.entries = append(s.entries, deepCopyEntry(e))
	return s.save()
}

// Update modifies an entry by id, appending a version snapshot capped at
// maxVersionHistory entries (newest kept).
func (s *Store) Update(id string, patch *UpdatePatch) (*Entry, error) {
	if patch == nil {
		return nil, fmt.Errorf("%w: patch is required", ErrValidation)
	}
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
		e.VersionHistory = truncateVersionHistory(e.VersionHistory)
		// Only fields present in the patch are applied; omitted fields keep
		// their stored value so a partial update is never destructive.
		if patch.Title != nil {
			if strings.TrimSpace(*patch.Title) == "" {
				return nil, fmt.Errorf("%w: title cannot be empty", ErrValidation)
			}
			e.Title = *patch.Title
		}
		if patch.Description != nil {
			e.Description = *patch.Description
		}
		if patch.Tags != nil {
			e.Tags = append([]string{}, patch.Tags...)
		}
		if patch.Dialect != nil {
			e.Dialect = *patch.Dialect
		}
		if patch.Query != nil {
			e.Query = *patch.Query
		}
		if patch.Parameters != nil {
			e.Parameters = append([]Parameter{}, patch.Parameters...)
		}
		if patch.Author != nil {
			e.Author = *patch.Author
		}
		if patch.Slug != nil && *patch.Slug != "" {
			e.Slug = *patch.Slug
		}
		e.UpdatedAt = now()
		return deepCopyEntry(e), s.save()
	}
	return nil, fmt.Errorf("%w: entry not found: %s", ErrNotFound, id)
}

// truncateVersionHistory keeps only the newest maxVersionHistory snapshots.
func truncateVersionHistory(vh []VersionSnapshot) []VersionSnapshot {
	if len(vh) <= maxVersionHistory {
		return vh
	}
	return append([]VersionSnapshot{}, vh[len(vh)-maxVersionHistory:]...)
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
	return fmt.Errorf("%w: entry not found: %s", ErrNotFound, id)
}

// ExportJSON returns all entries as JSON. The marshal happens inside the RLock
// section over deep copies, so the encoder never reads a struct that a
// concurrent Update is mutating — and never over a half-mutated entry.
func (s *Store) ExportJSON() ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cp := make([]*Entry, 0, len(s.entries))
	for _, e := range s.entries {
		cp = append(cp, deepCopyEntry(e))
	}
	return json.MarshalIndent(map[string]interface{}{"entries": cp}, "", "  ")
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

// Import merges entries from a bundle; existing IDs are skipped. Incoming
// entries are deep-copied before storage so the request payload cannot keep a
// live pointer into the library, and their version history is capped.
func (s *Store) Import(entries []*Entry) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing := map[string]bool{}
	for _, e := range s.entries {
		existing[e.ID] = true
	}
	count := 0
	for _, in := range entries {
		if in == nil {
			continue
		}
		e := deepCopyEntry(in)
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
		e.VersionHistory = truncateVersionHistory(e.VersionHistory)
		s.entries = append(s.entries, e)
		existing[e.ID] = true
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
