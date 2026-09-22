package audit

import "time"

// AuditEntry represents one immutable log entry.
type AuditEntry struct {
	ID           string    `json:"id"`
	Timestamp    time.Time `json:"timestamp"`
	ActorIP      string    `json:"actor_ip"`
	UserAgent    string    `json:"user_agent"`
	ConnID       string    `json:"conn_id"`
	DBName       string    `json:"db_name"`
	Schema       string    `json:"schema"`
	QueryType    string    `json:"query_type"` // SELECT, DML, DDL, EXPORT, MUTATION
	QueryText    string    `json:"query_text"`
	RowsAffected int64     `json:"rows_affected"`
	DurationMs   int64     `json:"duration_ms"`
	Error        string    `json:"error"`
	PrevHash     string    `json:"prev_hash"`
	Hash         string    `json:"hash"`
}
