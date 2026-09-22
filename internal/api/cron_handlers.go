package api

import (
	"encoding/json"
	"net/http"

	"github.com/dblens/dblens/internal/cron"
	"github.com/go-chi/chi/v5"
)

// ListCronJobs returns all cron jobs.
func (h *Handler) ListCronJobs(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, h.cronScheduler.ListJobs())
}

// CreateCronJob registers a new cron job.
func (h *Handler) CreateCronJob(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var job cron.CronJob
	if err := json.NewDecoder(r.Body).Decode(&job); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if job.Name == "" {
		sendError(w, http.StatusBadRequest, "name is required")
		return
	}
	if job.SQL == "" {
		sendError(w, http.StatusBadRequest, "sql is required")
		return
	}
	created := h.cronScheduler.AddJob(job)
	sendJSON(w, http.StatusCreated, created)
}

// UpdateCronJob replaces an existing cron job.
func (h *Handler) UpdateCronJob(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	id := chi.URLParam(r, "id")
	var job cron.CronJob
	if err := json.NewDecoder(r.Body).Decode(&job); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	job.ID = id
	updated, err := h.cronScheduler.UpdateJob(job)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, updated)
}

// DeleteCronJob removes a cron job.
func (h *Handler) DeleteCronJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.cronScheduler.RemoveJob(id); err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, map[string]string{"id": id, "status": "deleted"})
}

// RunCronJobNow triggers an immediate run.
func (h *Handler) RunCronJobNow(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.cronScheduler.RunNow(id); err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, map[string]string{"id": id, "status": "triggered"})
}

// GetCronJobHistory returns run history for a job.
func (h *Handler) GetCronJobHistory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	job, err := h.cronScheduler.GetJob(id)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}
	history := job.RunHistory
	if history == nil {
		history = []cron.JobRun{}
	}
	sendJSON(w, http.StatusOK, history)
}
