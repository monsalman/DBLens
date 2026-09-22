package playbook

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := NewStore(filepath.Join(t.TempDir(), "playbook.json"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	return s
}

func seedEntries(t *testing.T, s *Store, n int) []string {
	t.Helper()
	ids := make([]string, 0, n)
	for i := 0; i < n; i++ {
		e := &Entry{
			Title:       fmt.Sprintf("Entry %d", i),
			Description: fmt.Sprintf("description %d", i),
			Tags:        []string{"ops", fmt.Sprintf("tag%d", i)},
			Query:       fmt.Sprintf("SELECT %d", i),
			Parameters:  []Parameter{{Name: "id", Type: "int"}},
		}
		if err := s.Create(e); err != nil {
			t.Fatalf("Create: %v", err)
		}
		ids = append(ids, e.ID)
	}
	return ids
}

func TestCreatePersistAndReload(t *testing.T) {
	path := filepath.Join(t.TempDir(), "playbook.json")
	s, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	if err := s.Create(&Entry{Title: "Top slow queries", Query: "SELECT 1"}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("expected persisted content")
	}
	if fi, err := os.Stat(path); err == nil && fi.Mode().Perm() != 0600 {
		t.Fatalf("store file mode = %v, want 0600", fi.Mode().Perm())
	}

	reloaded, err := NewStore(path)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	list := reloaded.List("", "")
	if len(list) != 1 {
		t.Fatalf("expected 1 entry after reload, got %d", len(list))
	}
	if list[0].Slug == "" {
		t.Fatal("expected a generated slug")
	}
}

// TestSaveIsAtomic guards M4: save must write via a temp file and rename so a
// truncated write can never replace the live library.
func TestSaveIsAtomic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "playbook.json")
	s, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	ids := seedEntries(t, s, 2)

	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatalf("temp file should not survive a successful save, stat err = %v", err)
	}
	_ = ids

	// The live file must always parse: no half-written JSON is observable.
	for i := 0; i < 20; i++ {
		if err := s.Create(&Entry{Title: fmt.Sprintf("extra %d", i), Query: "SELECT 1"}); err != nil {
			t.Fatalf("Create: %v", err)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("ReadFile: %v", err)
		}
		var parsed []*Entry
		if err := json.Unmarshal(data, &parsed); err != nil {
			t.Fatalf("store file was not valid JSON after save %d: %v", i, err)
		}
	}
}

// TestConcurrentReadsAndUpdates is the H2 regression: List/Get/ExportJSON used
// to return the store's own live *Entry pointers (and marshal them under no
// lock), racing with Update mutating the same structs and slice fields. Reading
// the returned entries while a writer runs trips the race detector on the old
// code and is clean once readers deep-copy.
func TestConcurrentReadsAndUpdates(t *testing.T) {
	s := newTestStore(t)
	ids := seedEntries(t, s, 8)

	const iters = 50
	var wg sync.WaitGroup
	start := make(chan struct{})

	for w := 0; w < 2; w++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			<-start
			for i := 0; i < iters; i++ {
				if _, err := s.Update(ids[i%len(ids)], &Entry{
					Title:       fmt.Sprintf("writer %d title %d", worker, i),
					Description: "updated",
					Tags:        []string{"ops", "updated"},
					Query:       fmt.Sprintf("SELECT %d, %d", worker, i),
					Parameters:  []Parameter{{Name: "id", Type: "int", Default: "1"}},
				}); err != nil {
					t.Errorf("Update: %v", err)
					return
				}
			}
		}(w)
	}

	read := func(e *Entry) {
		_ = len(e.Title) + len(e.Description) + len(e.Query) + len(e.Slug)
		for _, tag := range e.Tags {
			_ = len(tag)
		}
		for _, p := range e.Parameters {
			_ = len(p.Name) + len(p.Default)
		}
		for _, v := range e.VersionHistory {
			_ = len(v.QuerySnapshot)
		}
	}
	for r := 0; r < 3; r++ {
		wg.Add(1)
		go func(reader int) {
			defer wg.Done()
			<-start
			for i := 0; i < iters; i++ {
				for _, e := range s.List("", "") {
					read(e)
				}
				for _, e := range s.List("ops", "") {
					read(e)
				}
				for _, id := range ids {
					if e := s.Get(id); e != nil {
						read(e)
					}
				}
				if _, err := s.ExportJSON(); err != nil {
					t.Errorf("ExportJSON: %v", err)
					return
				}
				_ = s.ExportMarkdown()
			}
		}(r)
	}

	close(start)
	wg.Wait()
}

// TestReaderCopiesAreIsolated proves List/Get/ExportJSON hand out copies: edits
// to the returned entry (including its slice fields) must not touch the store.
func TestReaderCopiesAreIsolated(t *testing.T) {
	s := newTestStore(t)
	e := &Entry{
		Title:      "Original",
		Tags:       []string{"ops"},
		Query:      "SELECT 1",
		Parameters: []Parameter{{Name: "id"}},
	}
	if err := s.Create(e); err != nil {
		t.Fatalf("Create: %v", err)
	}

	mutate := func(got *Entry) {
		t.Helper()
		if got == nil {
			t.Fatal("expected an entry")
		}
		got.Title = "mutated"
		got.Tags[0] = "mutated"
		got.Parameters[0].Name = "mutated"
	}

	listed := s.List("", "")
	if len(listed) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(listed))
	}
	mutate(listed[0])
	mutate(s.Get(e.ID))

	raw, err := s.ExportJSON()
	if err != nil {
		t.Fatalf("ExportJSON: %v", err)
	}
	var bundle struct {
		Entries []*Entry `json:"entries"`
	}
	if err := json.Unmarshal(raw, &bundle); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if len(bundle.Entries) != 1 {
		t.Fatalf("expected 1 exported entry, got %d", len(bundle.Entries))
	}
	got := bundle.Entries[0]
	if got.Title != "Original" || got.Tags[0] != "ops" || got.Parameters[0].Name != "id" {
		t.Fatalf("reader handed out a live pointer: %+v", got)
	}
}

// TestVersionHistoryIsCapped guards M5: the append-only history must not grow
// without bound across repeated PUTs.
func TestVersionHistoryIsCapped(t *testing.T) {
	s := newTestStore(t)
	ids := seedEntries(t, s, 1)

	for i := 0; i < maxVersionHistory+15; i++ {
		if _, err := s.Update(ids[0], &Entry{Title: "t", Query: fmt.Sprintf("SELECT %d", i)}); err != nil {
			t.Fatalf("Update %d: %v", i, err)
		}
	}
	got := s.Get(ids[0])
	if got == nil {
		t.Fatal("entry disappeared")
	}
	if len(got.VersionHistory) != maxVersionHistory {
		t.Fatalf("version history length = %d, want %d", len(got.VersionHistory), maxVersionHistory)
	}
	// Newest snapshots are kept, so the last one holds the pre-update query.
	last := got.VersionHistory[len(got.VersionHistory)-1]
	if last.QuerySnapshot != fmt.Sprintf("SELECT %d", maxVersionHistory+13) {
		t.Fatalf("kept the wrong snapshots; newest = %q", last.QuerySnapshot)
	}
}

// TestImportCapsVersionHistory guards M5 on the import path.
func TestImportCapsVersionHistory(t *testing.T) {
	s := newTestStore(t)
	vh := make([]VersionSnapshot, 0, maxVersionHistory+10)
	for i := 0; i < maxVersionHistory+10; i++ {
		vh = append(vh, VersionSnapshot{Version: i + 1, QuerySnapshot: fmt.Sprintf("SELECT %d", i)})
	}
	count, err := s.Import([]*Entry{{Title: "imported", Query: "SELECT 1", VersionHistory: vh}})
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if count != 1 {
		t.Fatalf("imported = %d, want 1", count)
	}
	got := s.List("", "")
	if len(got) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(got))
	}
	if len(got[0].VersionHistory) != maxVersionHistory {
		t.Fatalf("imported version history length = %d, want %d", len(got[0].VersionHistory), maxVersionHistory)
	}
}

// TestNotImplementedSentinels pins the error classification contract the HTTP
// layer relies on (L7): classification must not depend on message text.
func TestNotImplementedSentinels(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Update("missing", &Entry{Title: "x"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Update missing err = %v, want ErrNotFound", err)
	}
	if err := s.Delete("missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Delete missing err = %v, want ErrNotFound", err)
	}
	if err := s.Create(nil); !errors.Is(err, ErrValidation) {
		t.Fatalf("Create(nil) err = %v, want ErrValidation", err)
	}
	if _, err := s.Update("missing", nil); !errors.Is(err, ErrValidation) {
		t.Fatalf("Update(nil) err = %v, want ErrValidation", err)
	}
}
