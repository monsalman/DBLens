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

// ErrorEvent is emitted to the client when the poll loop gives up. Without it a
// permanently failing feed looks identical to a healthy idle one.
type ErrorEvent struct {
	Type      string `json:"type"` // always "error"
	Message   string `json:"message"`
	Failures  int    `json:"failures"`
	Timestamp string `json:"timestamp"`
}

// FeedConfig holds configuration for a single table poll loop.
type FeedConfig struct {
	ConnID       string
	Schema       string
	Table        string
	PollInterval time.Duration // min 500ms, max 30s, default 2s
	Dialect      string        // driver dialect used for identifier quoting
	MaxFailures  int           // consecutive fetch failures before giving up (default 3)
}
