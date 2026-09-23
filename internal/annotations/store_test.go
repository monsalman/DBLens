package annotations

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := NewStore(filepath.Join(t.TempDir(), "annotations.json"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	return s
}

func TestCreateRequiresNote(t *testing.T) {
	s := newTestStore(t)
	if err := s.Create(&Annotation{TargetType: TargetTable, Table: "orders", Note: "   "}); err == nil {
		t.Fatal("expected error for blank note")
	}
	if err := s.Create(nil); err == nil {
		t.Fatal("expected error for nil annotation")
	}
}

func TestCreateRejectsBadTargetType(t *testing.T) {
	s := newTestStore(t)
	if err := s.Create(&Annotation{TargetType: "banana", Note: "nope"}); err == nil {
		t.Fatal("expected error for invalid target_type")
	}
}

func TestCreateColumnRequiresColumn(t *testing.T) {
	s := newTestStore(t)
	if err := s.Create(&Annotation{TargetType: TargetColumn, Table: "orders", Note: "x"}); err == nil {
		t.Fatal("expected error when column is missing for a column annotation")
	}
}

func TestPersistAndReload(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "annotations.json")

	s, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	if err := s.Create(&Annotation{
		TargetType:   TargetTable,
		ConnectionID: "conn1",
		Schema:       "public",
		Table:        "orders",
		Note:         "  Money in minor units.  ",
		Author:       "ada",
	}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	reloaded, err := NewStore(path)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	list := reloaded.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 annotation after reload, got %d", len(list))
	}
	if list[0].Note != "Money in minor units." {
		t.Fatalf("note was not trimmed: %q", list[0].Note)
	}
	if list[0].ID == "" || list[0].CreatedAt.IsZero() {
		t.Fatal("expected generated id and created_at")
	}
}

func TestUpdateAndDelete(t *testing.T) {
	s := newTestStore(t)
	a := &Annotation{TargetType: TargetTable, ConnectionID: "c1", Table: "orders", Note: "old"}
	if err := s.Create(a); err != nil {
		t.Fatalf("Create: %v", err)
	}

	pinned := true
	updated, err := s.Update(a.ID, &UpdatePatch{Note: "new", Author: "grace", Pinned: &pinned})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Note != "new" || !updated.Pinned || updated.Author != "grace" {
		t.Fatalf("update not applied: %+v", updated)
	}
	if !updated.UpdatedAt.After(updated.CreatedAt) && !updated.UpdatedAt.Equal(updated.CreatedAt) {
		t.Fatal("updated_at should not move backwards")
	}

	if _, err := s.Update("missing", &UpdatePatch{Note: "x"}); err == nil {
		t.Fatal("expected not-found error")
	}
	if err := s.Delete(a.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if err := s.Delete(a.ID); err == nil {
		t.Fatal("expected not-found error on second delete")
	}
	if len(s.List()) != 0 {
		t.Fatal("expected empty store after delete")
	}
}

func TestListByTargetAndSearch(t *testing.T) {
	s := newTestStore(t)
	seed := []*Annotation{
		{TargetType: TargetTable, ConnectionID: "c1", Schema: "public", Table: "orders", Note: "revenue table"},
		{TargetType: TargetColumn, ConnectionID: "c1", Schema: "public", Table: "orders", Column: "total", Note: "minor units"},
		{TargetType: TargetTable, ConnectionID: "c2", Schema: "public", Table: "users", Note: "github OAuth"},
	}
	for _, a := range seed {
		if err := s.Create(a); err != nil {
			t.Fatalf("Create: %v", err)
		}
	}

	if got := len(s.ListByTarget("c1", "", "")); got != 2 {
		t.Fatalf("ListByTarget(c1) = %d, want 2", got)
	}
	if got := len(s.ListByTarget("c1", "public", "orders")); got != 2 {
		t.Fatalf("ListByTarget(c1,public,orders) = %d, want 2", got)
	}
	if got := len(s.ListByTarget("c1", "", "users")); got != 0 {
		t.Fatalf("ListByTarget(c1,,users) = %d, want 0", got)
	}
	if got := len(s.Search("MINOR")); got != 1 {
		t.Fatalf("Search(MINOR) = %d, want 1", got)
	}
	if got := len(s.Search("")); got != 3 {
		t.Fatalf("Search(\"\") = %d, want 3", got)
	}
	if got := len(s.Query("c1", "", "", "minor")); got != 1 {
		t.Fatalf("Query keyword+filters = %d, want 1", got)
	}
	if got := len(s.Query("c2", "", "", "minor")); got != 0 {
		t.Fatalf("Query keyword mismatch conn = %d, want 0", got)
	}
}

func TestListSortsPinnedFirst(t *testing.T) {
	s := newTestStore(t)
	if err := s.Create(&Annotation{TargetType: TargetTable, Table: "t", Note: "unpinned"}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	pinned := &Annotation{TargetType: TargetTable, Table: "t", Note: "pinned", Pinned: true}
	if err := s.Create(pinned); err != nil {
		t.Fatalf("Create: %v", err)
	}
	list := s.List()
	if len(list) != 2 || !list[0].Pinned {
		t.Fatalf("expected pinned annotation first, got %+v", list)
	}
}

func TestExportMarkdown(t *testing.T) {
	s := newTestStore(t)
	empty := s.ExportMarkdown()
	if !strings.Contains(empty, "No annotations recorded yet.") {
		t.Fatalf("empty export missing placeholder: %s", empty)
	}

	if err := s.Create(&Annotation{
		TargetType:   TargetColumn,
		ConnectionID: "c1",
		Schema:       "public",
		Table:        "orders",
		Column:       "total",
		Note:         "Stored in minor units.",
		Author:       "ada",
		Pinned:       true,
	}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	md := s.ExportMarkdown()
	for _, want := range []string{
		"# DBLens Schema Annotations",
		"## Connection: c1",
		"### public.orders.total",
		"**Author:** ada",
		"Stored in minor units.",
		"📌",
	} {
		if !strings.Contains(md, want) {
			t.Fatalf("export missing %q:\n%s", want, md)
		}
	}
}

// TestConcurrentReadsAndUpdates is the H1 regression: List/ListByTarget/Search/
// Query used to hand out the store's own live *Annotation pointers, so the
// handler marshaled them while Update mutated the same structs. Reading the
// returned records while a writer runs trips the race detector on the old code
// and is clean once readers return value copies.
func TestConcurrentReadsAndUpdates(t *testing.T) {
	s := newTestStore(t)
	const seed = 8
	ids := make([]string, 0, seed)
	for i := 0; i < seed; i++ {
		a := &Annotation{
			TargetType:   TargetTable,
			ConnectionID: "c1",
			Schema:       "public",
			Table:        fmt.Sprintf("t%d", i),
			Note:         fmt.Sprintf("seed note %d", i),
			Author:       "ada",
		}
		if err := s.Create(a); err != nil {
			t.Fatalf("Create: %v", err)
		}
		ids = append(ids, a.ID)
	}

	const iters = 50
	var wg sync.WaitGroup
	start := make(chan struct{})

	// Writers: mutate the stored records under Lock.
	for w := 0; w < 2; w++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			<-start
			for i := 0; i < iters; i++ {
				pinned := i%2 == 0
				if _, err := s.Update(ids[i%len(ids)], &UpdatePatch{
					Note:   fmt.Sprintf("writer %d note %d", worker, i),
					Author: "writer",
					Pinned: &pinned,
				}); err != nil {
					t.Errorf("Update: %v", err)
					return
				}
			}
		}(w)
	}

	// Readers: touch every field of the returned records, which is exactly what
	// sendJSON does when it marshals the handler response.
	read := func(a *Annotation) {
		_ = len(a.Note) + len(a.Author) + len(a.Table) + len(a.Column) + len(a.ConnectionID)
		_ = a.Pinned
		_ = a.UpdatedAt.String()
	}
	for r := 0; r < 3; r++ {
		wg.Add(1)
		go func(reader int) {
			defer wg.Done()
			<-start
			for i := 0; i < iters; i++ {
				for _, a := range s.List() {
					read(a)
				}
				for _, a := range s.ListByTarget("c1", "public", "") {
					read(a)
				}
				for _, a := range s.Search("note") {
					read(a)
				}
				for _, a := range s.Query("c1", "", "", "note") {
					read(a)
				}
			}
		}(r)
	}

	close(start)
	wg.Wait()
}

// TestReaderCopiesAreIsolated proves the copies handed out by readers are not
// backed by the store: mutating the returned record must not change the store.
func TestReaderCopiesAreIsolated(t *testing.T) {
	s := newTestStore(t)
	a := &Annotation{TargetType: TargetTable, ConnectionID: "c1", Table: "orders", Note: "original"}
	if err := s.Create(a); err != nil {
		t.Fatalf("Create: %v", err)
	}

	mutate := func(got *Annotation) {
		t.Helper()
		if got == nil {
			t.Fatal("expected an annotation")
		}
		got.Note = "mutated"
		got.Author = "mutated"
		got.Pinned = true
	}
	for _, got := range s.List() {
		mutate(got)
	}
	for _, got := range s.ListByTarget("c1", "", "") {
		mutate(got)
	}
	for _, got := range s.Search("original") {
		mutate(got)
	}
	for _, got := range s.Query("c1", "", "", "") {
		mutate(got)
	}

	stored := s.List()
	if len(stored) != 1 {
		t.Fatalf("expected 1 annotation, got %d", len(stored))
	}
	if stored[0].Note != "original" || stored[0].Author != "" || stored[0].Pinned {
		t.Fatalf("reader handed out a live pointer: %+v", stored[0])
	}
}

// TestUpdatePreservesPinnedWhenOmitted guards M6: omitting pinned from a
// partial update must not silently unpin the record.
func TestUpdatePreservesPinnedWhenOmitted(t *testing.T) {
	s := newTestStore(t)
	a := &Annotation{TargetType: TargetTable, ConnectionID: "c1", Table: "orders", Note: "keep pin"}
	if err := s.Create(a); err != nil {
		t.Fatalf("Create: %v", err)
	}
	yes := true
	if _, err := s.Update(a.ID, &UpdatePatch{Note: "still pinned", Pinned: &yes}); err != nil {
		t.Fatalf("Update(pin): %v", err)
	}

	updated, err := s.Update(a.ID, &UpdatePatch{Note: "note only, no pinned field"})
	if err != nil {
		t.Fatalf("Update(no pinned): %v", err)
	}
	if !updated.Pinned {
		t.Fatal("omitting pinned unpinned the annotation")
	}

	no := false
	updated, err = s.Update(a.ID, &UpdatePatch{Note: "explicit unpin", Pinned: &no})
	if err != nil {
		t.Fatalf("Update(unpin): %v", err)
	}
	if updated.Pinned {
		t.Fatal("explicit pinned=false was ignored")
	}
}

// TestUpdateValidatesMergedRecord guards M6: Update must reject the same shapes
// Create rejects, including when only the merged record is invalid.
func TestUpdateValidatesMergedRecord(t *testing.T) {
	s := newTestStore(t)
	col := &Annotation{TargetType: TargetColumn, ConnectionID: "c1", Table: "orders", Column: "total", Note: "minor units"}
	if err := s.Create(col); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if _, err := s.Update(col.ID, &UpdatePatch{Note: ""}); !errors.Is(err, ErrValidation) {
		t.Fatalf("blank note err = %v, want ErrValidation", err)
	}
	if _, err := s.Update(col.ID, &UpdatePatch{Note: strings.Repeat("x", MaxNoteLen+1)}); !errors.Is(err, ErrValidation) {
		t.Fatalf("oversized note err = %v, want ErrValidation", err)
	}
	if _, err := s.Update(col.ID, &UpdatePatch{Note: "n", TargetType: "banana"}); !errors.Is(err, ErrValidation) {
		t.Fatalf("bad target_type err = %v, want ErrValidation", err)
	}
	// Retargeting to column while the merged record has no column set.
	plain := &Annotation{TargetType: TargetTable, ConnectionID: "c1", Table: "users", Note: "table note"}
	if err := s.Create(plain); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := s.Update(plain.ID, &UpdatePatch{Note: "n", TargetType: TargetColumn}); !errors.Is(err, ErrValidation) {
		t.Fatalf("column without column err = %v, want ErrValidation", err)
	}

	// A rejected update must not have been persisted.
	for _, a := range s.List() {
		if a.ID == plain.ID && a.TargetType != TargetTable {
			t.Fatalf("rejected update was applied: %+v", a)
		}
	}

	if _, err := s.Update("missing", &UpdatePatch{Note: "x"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("not-found err = %v, want ErrNotFound", err)
	}
	if err := s.Delete("missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete not-found err = %v, want ErrNotFound", err)
	}
}
