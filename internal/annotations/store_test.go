package annotations

import (
	"path/filepath"
	"strings"
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

	updated, err := s.Update(a.ID, &Annotation{Note: "new", Author: "grace", Pinned: true})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Note != "new" || !updated.Pinned || updated.Author != "grace" {
		t.Fatalf("update not applied: %+v", updated)
	}
	if !updated.UpdatedAt.After(updated.CreatedAt) && !updated.UpdatedAt.Equal(updated.CreatedAt) {
		t.Fatal("updated_at should not move backwards")
	}

	if _, err := s.Update("missing", &Annotation{Note: "x"}); err == nil {
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
