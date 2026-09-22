package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/dblens/dblens/internal/cron"
	"github.com/dblens/dblens/internal/driver"
	"github.com/dblens/dblens/internal/webhook"
	"github.com/go-chi/chi/v5"
)

// sanitizeJobForResponse replaces the job's stored DSN with its masked form so
// credentials never travel back to the browser. The live value stays in memory
// for the scheduler.
func sanitizeJobForResponse(job cron.CronJob) cron.CronJob {
	if job.DSN != "" {
		job.DSN = driver.MaskDSN(job.DSN)
	}
	return job
}

// applyJobRequestValidate enforces the create/update invariants: interval
// bounds, SSRF-safe alert webhook, and DSN resolution order.
func (h *Handler) applyJobRequestValidate(r *http.Request, job *cron.CronJob) error {
	job.IntervalSec = cron.ClampIntervalSec(job.IntervalSec)
	job.DSN = strings.TrimSpace(job.DSN)
	job.ConnID = strings.TrimSpace(job.ConnID)

	// Accept the DSN through the project's usual header as well, so the
	// frontend can use the same convention it already uses everywhere else.
	if job.DSN == "" {
		if hdr := strings.TrimSpace(r.Header.Get("X-DBLENS-DSN")); hdr != "" {
			job.DSN = hdr
		}
	}

	if job.AlertRule.WebhookURL != "" {
		if err := webhook.ValidateWebhookURL(job.AlertRule.WebhookURL); err != nil {
			return err
		}
	}
	return nil
}

// ListCronJobs returns all cron jobs.
func (h *Handler) ListCronJobs(w http.ResponseWriter, r *http.Request) {
	jobs := h.cronScheduler.ListJobs()
	out := make([]cron.CronJob, 0, len(jobs))
	for _, j := range jobs {
		out = append(out, sanitizeJobForResponse(j))
	}
	sendJSON(w, http.StatusOK, out)
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
	if err := h.applyJobRequestValidate(r, &job); err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	created := h.cronScheduler.AddJob(job)
	sendJSON(w, http.StatusCreated, sanitizeJobForResponse(created))
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
	if err := h.applyJobRequestValidate(r, &job); err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := h.cronScheduler.UpdateJob(job)
	if err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, sanitizeJobForResponse(updated))
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
	limit := 0
	if s := r.URL.Query().Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 {
			limit = v
		}
	}
	if limit > 0 && len(history) > limit {
		history = history[:limit]
	}
	sendJSON(w, http.StatusOK, history)
}
