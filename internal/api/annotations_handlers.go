package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/annotations"
	"github.com/go-chi/chi/v5"
)

// requireAnnotationStore reports the response and returns false when the store
// failed to initialise at startup.
func (h *Handler) requireAnnotationStore(w http.ResponseWriter) bool {
	if h == nil || h.annotationsStore == nil {
		sendError(w, http.StatusInternalServerError, "annotations store unavailable")
		return false
	}
	return true
}

// annotationErrorStatus maps a store error to 404 when the record is missing
// and 400 otherwise (validation failures).
func annotationErrorStatus(err error) int {
	if strings.Contains(err.Error(), "not found") {
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}

func (h *Handler) AnnotationsList(w http.ResponseWriter, r *http.Request) {
	if !h.requireAnnotationStore(w) {
		return
	}
	q := r.URL.Query()
	sendJSON(w, http.StatusOK, h.annotationsStore.Query(
		q.Get("conn"), q.Get("schema"), q.Get("table"), q.Get("q"),
	))
}

func (h *Handler) AnnotationCreate(w http.ResponseWriter, r *http.Request) {
	if !h.requireAnnotationStore(w) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var a annotations.Annotation
	if err := json.NewDecoder(r.Body).Decode(&a); err != nil {
		sendError(w, http.StatusBadRequest, "invalid body: "+err.Error())
		return
	}
	if err := h.annotationsStore.Create(&a); err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	sendJSON(w, http.StatusCreated, a)
}

func (h *Handler) AnnotationUpdate(w http.ResponseWriter, r *http.Request) {
	if !h.requireAnnotationStore(w) {
		return
	}
	id := chi.URLParam(r, "id")
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var patch annotations.Annotation
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		sendError(w, http.StatusBadRequest, "invalid body: "+err.Error())
		return
	}
	updated, err := h.annotationsStore.Update(id, &patch)
	if err != nil {
		sendError(w, annotationErrorStatus(err), err.Error())
		return
	}
	sendJSON(w, http.StatusOK, updated)
}

func (h *Handler) AnnotationDelete(w http.ResponseWriter, r *http.Request) {
	if !h.requireAnnotationStore(w) {
		return
	}
	id := chi.URLParam(r, "id")
	if err := h.annotationsStore.Delete(id); err != nil {
		sendError(w, annotationErrorStatus(err), err.Error())
		return
	}
	sendJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) AnnotationsExportMD(w http.ResponseWriter, r *http.Request) {
	if !h.requireAnnotationStore(w) {
		return
	}
	md := h.annotationsStore.ExportMarkdown()
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="annotations.md"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(md))
}
