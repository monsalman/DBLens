package audit

import "time"

// AuditEntry represents one immutable log entry.
// Fields added after the log format shipped MUST stay `omitempty`: the chain
// hash is computed over the marshalled entry, so an omitted zero value keeps
// previously written entries verifiable (and keeps old entries recomputing to
// their stored hash).
type AuditEntry struct {
	ID           string    `json:"id"`
	Timestamp    time.Time `json:"timestamp"`
	ActorIP      string    `json:"actor_ip"`
	ForwardedFor string    `json:"forwarded_for,omitempty"` // untrusted XFF chain, kept apart from actor_ip
	UserAgent    string    `json:"user_agent"`
	ConnID       string    `json:"conn_id"`
	DBName       string    `json:"db_name"`
	Schema       string    `json:"schema"`
	QueryType    string    `json:"query_type"` // SELECT, DML, DDL, EXPORT, MUTATION
	QueryText    string    `json:"query_text"`
	RowsAffected int64     `json:"rows_affected"`
	RespBytes    int64     `json:"resp_bytes,omitempty"`
	DurationMs   int64     `json:"duration_ms"`
	Error        string    `json:"error"`
	PrevHash     string    `json:"prev_hash"`
	Hash         string    `json:"hash"`
}
