package cron

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

const maxHistory = 50

// DriverExec executes a SQL query and returns the first cell of first row as string.
// The caller (Handler) provides this function wired to the connection manager.
type DriverExec func(ctx context.Context, connID, dsn, sql string) (string, error)

// Scheduler manages cron jobs and their background execution.
type Scheduler struct {
	mu      sync.RWMutex
	jobs    map[string]*CronJob
	exec    DriverExec
	stopCh  chan struct{}
}

// NewScheduler creates a Scheduler. exec is called to run SQL against a connection.
func NewScheduler(exec DriverExec) *Scheduler {
	return &Scheduler{
		jobs:   make(map[string]*CronJob),
		exec:   exec,
		stopCh: make(chan struct{}),
	}
}

// Start launches the background ticker (checks every 10s which jobs are due).
func (s *Scheduler) Start() {
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				s.tick()
			case <-s.stopCh:
				return
			}
		}
	}()
}

// Stop shuts down the scheduler goroutine.
func (s *Scheduler) Stop() {
	close(s.stopCh)
}

func (s *Scheduler) tick() {
	s.mu.RLock()
	due := make([]*CronJob, 0)
	now := time.Now()
	for _, j := range s.jobs {
		if !j.Enabled || j.IntervalSec <= 0 {
			continue
		}
		next := j.LastRun.Add(time.Duration(j.IntervalSec) * time.Second)
		if now.After(next) || now.Equal(next) {
			cp := *j
			due = append(due, &cp)
		}
	}
	s.mu.RUnlock()

	for _, j := range due {
		go s.runJob(j)
	}
}

func genID(prefix string) string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%s%d", prefix, time.Now().UnixNano())
	}
	return prefix + hex.EncodeToString(b)
}

// runJob executes a single job and records the result.
func (s *Scheduler) runJob(j *CronJob) {
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	output, err := s.exec(ctx, j.ConnID, "", j.SQL)

	dur := time.Since(start).Milliseconds()
	run := JobRun{
		RunAt:      start,
		DurationMs: dur,
		Output:     output,
	}

	status := "ok"
	if err != nil {
		status = "error"
		run.Error = err.Error()
	} else if j.AlertRule.WebhookURL != "" && j.AlertRule.Condition != "" {
		if evalCondition(output, j.AlertRule) {
			status = "alert"
			go dispatch(context.Background(), *j, output) //nolint:errcheck
		}
	}
	run.Status = status

	s.mu.Lock()
	live, ok := s.jobs[j.ID]
	if ok {
		live.LastRun = start
		live.LastStatus = status
		if err != nil {
			live.LastError = err.Error()
		} else {
			live.LastError = ""
		}
		live.RunHistory = append([]JobRun{run}, live.RunHistory...)
		if len(live.RunHistory) > maxHistory {
			live.RunHistory = live.RunHistory[:maxHistory]
		}
	}
	s.mu.Unlock()
}

// evalCondition parses output as float64 and compares against AlertRule.
func evalCondition(output string, rule AlertRule) bool {
	val, err := strconv.ParseFloat(strings.TrimSpace(output), 64)
	if err != nil {
		return false
	}
	switch rule.Condition {
	case "gt":
		return val > rule.Threshold
	case "gte":
		return val >= rule.Threshold
	case "lt":
		return val < rule.Threshold
	case "lte":
		return val <= rule.Threshold
	case "eq":
		return val == rule.Threshold
	}
	return false
}

// AddJob adds or replaces a job (ID must be non-empty).
func (s *Scheduler) AddJob(job CronJob) CronJob {
	if job.ID == "" {
		job.ID = genID("job_")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs[job.ID] = &job
	return job
}

// UpdateJob replaces an existing job; returns error if not found.
func (s *Scheduler) UpdateJob(job CronJob) (CronJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, ok := s.jobs[job.ID]
	if !ok {
		return CronJob{}, fmt.Errorf("job not found: %s", job.ID)
	}
	job.RunHistory = existing.RunHistory
	job.LastRun = existing.LastRun
	job.LastStatus = existing.LastStatus
	job.LastError = existing.LastError
	s.jobs[job.ID] = &job
	return job, nil
}

// RemoveJob deletes a job by ID.
func (s *Scheduler) RemoveJob(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.jobs[id]; !ok {
		return fmt.Errorf("job not found: %s", id)
	}
	delete(s.jobs, id)
	return nil
}

// GetJob returns a job by ID.
func (s *Scheduler) GetJob(id string) (CronJob, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	j, ok := s.jobs[id]
	if !ok {
		return CronJob{}, fmt.Errorf("job not found: %s", id)
	}
	cp := *j
	return cp, nil
}

// ListJobs returns all jobs.
func (s *Scheduler) ListJobs() []CronJob {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]CronJob, 0, len(s.jobs))
	for _, j := range s.jobs {
		cp := *j
		out = append(out, cp)
	}
	return out
}

// RunNow triggers immediate execution of a job.
func (s *Scheduler) RunNow(id string) error {
	j, err := s.GetJob(id)
	if err != nil {
		return err
	}
	go s.runJob(&j)
	return nil
}
