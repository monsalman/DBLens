package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

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
// and 400 otherwise (validation failures). Classification uses sentinels, never
// message text.
func annotationErrorStatus(err error) int {
	switch {
	case errors.Is(err, annotations.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, annotations.ErrValidation):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

// annotationErrorMessage returns a generic client-facing message; the real error
// is logged server-side.
func annotationErrorMessage(status int) string {
	switch status {
	case http.StatusNotFound:
		return "annotation not found"
	case http.StatusBadRequest:
		return "invalid request"
	default:
		return "annotations store error"
	}
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
	var patch annotations.UpdatePatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		sendError(w, http.StatusBadRequest, "invalid body: "+err.Error())
		return
	}
	updated, err := h.annotationsStore.Update(id, &patch)
	if err != nil {
		status := annotationErrorStatus(err)
		log.Printf("annotation update failed: %v", err)
		sendError(w, status, annotationErrorMessage(status))
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
		status := annotationErrorStatus(err)
		log.Printf("annotation delete failed: %v", err)
		sendError(w, status, annotationErrorMessage(status))
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
