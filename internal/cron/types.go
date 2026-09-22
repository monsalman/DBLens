package cron

import "time"

// AlertRule defines threshold condition and dispatch target.
type AlertRule struct {
	Condition  string  `json:"condition"` // "gt"|"gte"|"lt"|"lte"|"eq"
	Threshold  float64 `json:"threshold"`
	WebhookURL string  `json:"webhook_url"`
	Message    string  `json:"message"`
}

// JobRun captures a single execution result.
type JobRun struct {
	RunAt      time.Time `json:"run_at"`
	DurationMs int64     `json:"duration_ms"`
	Status     string    `json:"status"` // "ok"|"error"|"alert"
	Output     string    `json:"output"`
	Error      string    `json:"error,omitempty"`
}

// CronJob defines a scheduled SQL job.
type CronJob struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	ConnID      string    `json:"conn_id"`
	SQL         string    `json:"sql"`
	IntervalSec int       `json:"interval_sec"` // seconds between runs; 0 = disabled
	Enabled     bool      `json:"enabled"`
	AlertRule   AlertRule `json:"alert_rule"`

	// DSN is the connection string the background runner dials. UI-created
	// connections use browser-local "local_<ts>" ids that the server cannot
	// resolve, so the job must carry the real DSN. Empty = resolve ConnID as a
	// server-seeded global connection. Never returned in API responses.
	DSN string `json:"dsn,omitempty"`

	LastRun    time.Time `json:"last_run"`
	LastStatus string    `json:"last_status"`
	LastError  string    `json:"last_error"`
	RunHistory []JobRun  `json:"run_history"`
}
