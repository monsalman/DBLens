package livefeed

import "time"

// ChangeEvent represents a single row-level change detected by polling.
type ChangeEvent struct {
	Op        string                 `json:"op"` // INSERT, UPDATE, DELETE
	Table     string                 `json:"table"`
	Schema    string                 `json:"schema"`
	PK        map[string]interface{} `json:"pk"`
	Before    map[string]interface{} `json:"before,omitempty"`
	After     map[string]interface{} `json:"after,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
}

// FeedConfig holds configuration for a single table poll loop.
type FeedConfig struct {
	ConnID       string
	Schema       string
	Table        string
	PollInterval time.Duration // min 500ms, max 30s, default 2s
}
