package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/cron"
	"github.com/go-chi/chi/v5"
)

// newTestCronHandler builds a Handler wired with a real Scheduler using a no-op exec.
func newTestCronHandler() *Handler {
	mgr := connection.NewManager()
	exec := func(_ context.Context, _, _ string, _ string) (string, error) {
		return "42", nil
	}
	sched := cron.NewScheduler(exec)
	return &Handler{mgr: mgr, cronScheduler: sched}
}

func cronRouter(h *Handler) http.Handler {
	r := chi.NewRouter()
	r.Get("/api/cron/jobs", h.ListCronJobs)
	r.Post("/api/cron/jobs", h.CreateCronJob)
	r.Put("/api/cron/jobs/{id}", h.UpdateCronJob)
	r.Delete("/api/cron/jobs/{id}", h.DeleteCronJob)
	r.Post("/api/cron/jobs/{id}/run", h.RunCronJobNow)
	r.Get("/api/cron/jobs/{id}/history", h.GetCronJobHistory)
	return r
}

func TestListCronJobs_empty(t *testing.T) {
	h := newTestCronHandler()
	req := httptest.NewRequest(http.MethodGet, "/api/cron/jobs", nil)
	rr := httptest.NewRecorder()
	cronRouter(h).ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestCreateCronJob(t *testing.T) {
	h := newTestCronHandler()
	job := cron.CronJob{Name: "heartbeat", SQL: "SELECT 1", ConnID: "global_1", IntervalSec: 60, Enabled: true}
	body, _ := json.Marshal(job)
	req := httptest.NewRequest(http.MethodPost, "/api/cron/jobs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	cronRouter(h).ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp Response
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestCreateCronJob_missingName(t *testing.T) {
	h := newTestCronHandler()
	job := cron.CronJob{SQL: "SELECT 1"}
	body, _ := json.Marshal(job)
	req := httptest.NewRequest(http.MethodPost, "/api/cron/jobs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	cronRouter(h).ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestDeleteCronJob(t *testing.T) {
	h := newTestCronHandler()
	// Create first
	job := h.cronScheduler.AddJob(cron.CronJob{Name: "del-test", SQL: "SELECT 1"})

	req := httptest.NewRequest(http.MethodDelete, "/api/cron/jobs/"+job.ID, nil)
	rr := httptest.NewRecorder()
	cronRouter(h).ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	// Verify gone
	_, err := h.cronScheduler.GetJob(job.ID)
	if err == nil {
		t.Fatal("expected job to be deleted")
	}
}

func TestRunCronJobNow(t *testing.T) {
	h := newTestCronHandler()
	job := h.cronScheduler.AddJob(cron.CronJob{Name: "run-test", SQL: "SELECT 1", ConnID: "global_1"})

	req := httptest.NewRequest(http.MethodPost, "/api/cron/jobs/"+job.ID+"/run", nil)
	rr := httptest.NewRecorder()
	cronRouter(h).ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestGetCronJobHistory_notFound(t *testing.T) {
	h := newTestCronHandler()
	req := httptest.NewRequest(http.MethodGet, "/api/cron/jobs/nonexistent/history", nil)
	rr := httptest.NewRecorder()
	cronRouter(h).ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
}
