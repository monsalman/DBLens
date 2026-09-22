package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/playbook"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) PlaybookList(w http.ResponseWriter, r *http.Request) {
	if h.playbookStore == nil {
		sendError(w, http.StatusInternalServerError, "playbook store unavailable")
		return
	}
	tag := r.URL.Query().Get("tag")
	q := r.URL.Query().Get("q")
	sendJSON(w, http.StatusOK, h.playbookStore.List(tag, q))
}

func (h *Handler) PlaybookCreate(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var e playbook.Entry
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		sendError(w, http.StatusBadRequest, "invalid body: "+err.Error())
		return
	}
	if strings.TrimSpace(e.Title) == "" {
		sendError(w, http.StatusBadRequest, "title is required")
		return
	}
	if err := h.playbookStore.Create(&e); err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusCreated, e)
}

func (h *Handler) PlaybookGet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	e := h.playbookStore.Get(id)
	if e == nil {
		sendError(w, http.StatusNotFound, "entry not found")
		return
	}
	sendJSON(w, http.StatusOK, e)
}

func (h *Handler) PlaybookUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var patch playbook.Entry
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		sendError(w, http.StatusBadRequest, "invalid body: "+err.Error())
		return
	}
	updated, err := h.playbookStore.Update(id, &patch)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, updated)
}

func (h *Handler) PlaybookDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.playbookStore.Delete(id); err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) PlaybookExportJSON(w http.ResponseWriter, r *http.Request) {
	data, err := h.playbookStore.ExportJSON()
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="playbook.dblens.json"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (h *Handler) PlaybookExportMD(w http.ResponseWriter, r *http.Request) {
	data := h.playbookStore.ExportMarkdown()
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="playbook.md"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (h *Handler) PlaybookImport(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var body struct {
		Entries []*playbook.Entry `json:"entries"`
		SQL     string            `json:"sql"`
		Title   string            `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		sendError(w, http.StatusBadRequest, "invalid body: "+err.Error())
		return
	}
	if body.SQL != "" {
		title := body.Title
		if title == "" {
			title = "Imported Query"
		}
		e, err := h.playbookStore.ImportSQL(title, body.SQL)
		if err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
		sendJSON(w, http.StatusCreated, map[string]interface{}{"imported": 1, "entry": e})
		return
	}
	count, err := h.playbookStore.Import(body.Entries)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, map[string]int{"imported": count})
}

func (h *Handler) PlaybookShare(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	e := h.playbookStore.Get(id)
	if e == nil {
		sendError(w, http.StatusNotFound, "entry not found")
		return
	}
	sendJSON(w, http.StatusOK, map[string]string{
		"uri": "dblens://playbook/" + e.Slug,
	})
}
