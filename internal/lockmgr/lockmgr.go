package lockmgr

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
)

// LockNode represents a single session/process and its lock status within the dependency tree.
type LockNode struct {
	PID                 int64       `json:"pid"`
	User                string      `json:"user"`
	Database            string      `json:"database"`
	Query               string      `json:"query"`
	QueryAgeSeconds     float64     `json:"query_age_seconds"`
	WaitDurationSeconds float64     `json:"wait_duration_seconds"`
	LockType            string      `json:"lock_type"`
	LockMode            string      `json:"lock_mode"`
	Granted             bool        `json:"granted"`
	BlockedByPID        *int64      `json:"blocked_by_pid,omitempty"`
	ClientAddr          string      `json:"client_addr"`
	ApplicationName     string      `json:"application_name"`
	TransactionState    string      `json:"transaction_state"`
	IsRootBlocker       bool        `json:"is_root_blocker"`
	Children            []*LockNode `json:"children"`
}

// DeadlockCycle represents an identified circular dependency chain.
type DeadlockCycle struct {
	PIDs        []int64     `json:"pids"`
	Nodes       []*LockNode `json:"nodes,omitempty"`
	Description string      `json:"description"`
}

// LockTreeResponse is the top-level payload containing root blockers and deadlock cycles.
type LockTreeResponse struct {
	Timestamp       time.Time       `json:"timestamp"`
	TotalLocks      int             `json:"total_locks"`
	BlockedSessions int             `json:"blocked_sessions"`
	RootBlockers    []*LockNode     `json:"root_blockers"`
	AllNodes        []*LockNode     `json:"all_nodes"`
	Deadlocks       []DeadlockCycle `json:"deadlocks"`
	Dialect         string          `json:"dialect"`
}

// TerminateLockRequest is the payload for terminating or cancelling a blocking lock session.
type TerminateLockRequest struct {
	PID   int64 `json:"pid"`
	Force bool  `json:"force"`
}

// InspectLocks queries dialect locks, builds the lock dependency tree, and detects deadlocks.
func InspectLocks(ctx context.Context, d types.Driver) (*LockTreeResponse, error) {
	if d == nil {
		return nil, fmt.Errorf("driver is nil")
	}

	rawInfos, dialect, err := ResolveLocks(ctx, d)
	if err != nil {
		return nil, err
	}

	resp := BuildLockGraph(rawInfos, dialect)
	return resp, nil
}

// TerminateSession terminates or cancels a session holding or waiting on a lock.
func TerminateSession(ctx context.Context, d types.Driver, pid int64, force bool) error {
	if d == nil {
		return fmt.Errorf("driver is nil")
	}
	if pid <= 0 {
		return fmt.Errorf("invalid pid: %d", pid)
	}

	dialect := strings.ToLower(strings.TrimSpace(d.Dialect()))
	switch dialect {
	case "postgres", "postgresql", "pg":
		if force {
			return d.KillProcess(ctx, strconv.FormatInt(pid, 10))
		}
		cancelSQL := fmt.Sprintf("SELECT pg_cancel_backend(%d)", pid)
		_, err := d.ExecuteQuery(ctx, cancelSQL)
		if err != nil {
			return fmt.Errorf("failed to cancel postgres backend %d: %w", pid, err)
		}
		return nil

	case "mysql", "mariadb":
		if force {
			return d.KillProcess(ctx, strconv.FormatInt(pid, 10))
		}
		killQuerySQL := fmt.Sprintf("KILL QUERY %d", pid)
		_, err := d.ExecuteQuery(ctx, killQuerySQL)
		if err != nil {
			return fmt.Errorf("failed to kill query for mysql thread %d: %w", pid, err)
		}
		return nil

	case "sqlite", "sqlite3":
		return fmt.Errorf("terminating sessions is not supported for sqlite")

	default:
		if force {
			return d.KillProcess(ctx, strconv.FormatInt(pid, 10))
		}
		return fmt.Errorf("unsupported dialect for session termination: %s", dialect)
	}
}
