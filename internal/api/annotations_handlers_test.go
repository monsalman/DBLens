package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/annotations"
	"github.com/go-chi/chi/v5"
)

func newAnnotationHandler(t *testing.T) (*Handler, chi.Router) {
	t.Helper()
	store, err := annotations.NewStore(filepath.Join(t.TempDir(), "annotations.json"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	h := &Handler{annotationsStore: store}
	r := chi.NewRouter()
	r.Get("/api/annotations", h.AnnotationsList)
	r.Post("/api/annotations", h.AnnotationCreate)
	r.Put("/api/annotations/{id}", h.AnnotationUpdate)
	r.Delete("/api/annotations/{id}", h.AnnotationDelete)
	r.Get("/api/annotations/export.md", h.AnnotationsExportMD)
	return h, r
}

func doJSON(t *testing.T, r http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestAnnotationCRUD(t *testing.T) {
	_, r := newAnnotationHandler(t)

	// create
	w := doJSON(t, r, http.MethodPost, "/api/annotations",
		`{"target_type":"table","connection_id":"c1","schema":"public","table":"orders","note":"revenue","author":"ada"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", w.Code, w.Body.String())
	}
	var created struct {
		Data annotations.Annotation `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.Data.ID == "" {
		t.Fatal("expected generated id")
	}

	// create with empty note -> 400
	if w := doJSON(t, r, http.MethodPost, "/api/annotations", `{"target_type":"table","note":"  "}`); w.Code != http.StatusBadRequest {
		t.Fatalf("empty note status = %d, want 400", w.Code)
	}

	// list with filters
	w = doJSON(t, r, http.MethodGet, "/api/annotations?conn=c1&q=revenue", "")
	if w.Code != http.StatusOK {
		t.Fatalf("list status = %d", w.Code)
	}
	var list struct {
		Data []annotations.Annotation `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list.Data) != 1 {
		t.Fatalf("list length = %d, want 1 (body=%s)", len(list.Data), w.Body.String())
	}
	if w := doJSON(t, r, http.MethodGet, "/api/annotations?conn=other", ""); !strings.Contains(w.Body.String(), `"data":[]`) {
		t.Fatalf("unfiltered list should be empty, got %s", w.Body.String())
	}

	// update
	w = doJSON(t, r, http.MethodPut, "/api/annotations/"+created.Data.ID, `{"note":"updated","pinned":true}`)
	if w.Code != http.StatusOK {
		t.Fatalf("update status = %d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"pinned":true`) {
		t.Fatalf("update did not pin: %s", w.Body.String())
	}

	// update unknown -> 404
	if w := doJSON(t, r, http.MethodPut, "/api/annotations/nope", `{"note":"x"}`); w.Code != http.StatusNotFound {
		t.Fatalf("update unknown status = %d, want 404", w.Code)
	}

	// export markdown
	w = doJSON(t, r, http.MethodGet, "/api/annotations/export.md", "")
	if w.Code != http.StatusOK {
		t.Fatalf("export status = %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/markdown") {
		t.Fatalf("export content-type = %q", ct)
	}
	if !strings.Contains(w.Body.String(), "### public.orders") {
		t.Fatalf("export body missing header: %s", w.Body.String())
	}

	// delete
	if w := doJSON(t, r, http.MethodDelete, "/api/annotations/"+created.Data.ID, ""); w.Code != http.StatusOK {
		t.Fatalf("delete status = %d", w.Code)
	}
	if w := doJSON(t, r, http.MethodDelete, "/api/annotations/"+created.Data.ID, ""); w.Code != http.StatusNotFound {
		t.Fatalf("second delete status = %d, want 404", w.Code)
	}
}

func TestAnnotationHandlersWithoutStore(t *testing.T) {
	h := &Handler{}
	for _, tc := range []struct {
		name string
		call func(http.ResponseWriter, *http.Request)
	}{
		{"list", h.AnnotationsList},
		{"create", h.AnnotationCreate},
		{"delete", h.AnnotationDelete},
		{"export", h.AnnotationsExportMD},
	} {
		w := httptest.NewRecorder()
		tc.call(w, httptest.NewRequest(http.MethodGet, "/api/annotations", nil))
		if w.Code != http.StatusInternalServerError {
			t.Fatalf("%s status = %d, want 500", tc.name, w.Code)
		}
	}
}

// TestAnnotationsRoutesRegistered guards the router wiring: an unregistered
// path would 404, a registered one returns 500 here because this Handler has no
// stores/managers configured.
func TestAnnotationsRoutesRegistered(t *testing.T) {
	_, store := mustStore(t)
	seed := &annotations.Annotation{TargetType: annotations.TargetTable, ConnectionID: "c1", Table: "t", Note: "seed"}
	if err := store.Create(seed); err != nil {
		t.Fatalf("seed annotation: %v", err)
	}
	h := &Handler{annotationsStore: store}
	router := SetupRouter(h, RouterConfig{})

	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/annotations"},
		{http.MethodPost, "/api/annotations"},
		{http.MethodPut, "/api/annotations/" + seed.ID},
		{http.MethodDelete, "/api/annotations/" + seed.ID},
		{http.MethodGet, "/api/annotations/export.md"},
	} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{"note":"x"}`))
		router.ServeHTTP(w, req)
		if w.Code == http.StatusNotFound {
			t.Fatalf("%s %s is not registered (404)", tc.method, tc.path)
		}
	}
}

func mustStore(t *testing.T) (string, *annotations.Store) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "annotations.json")
	store, err := annotations.NewStore(path)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	return path, store
}
