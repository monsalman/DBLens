package lockmgr

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
)

// RawLockInfo holds flat lock and session data extracted from the target database engine.
type RawLockInfo struct {
	PID                 int64
	User                string
	Database            string
	ClientAddr          string
	ApplicationName     string
	TransactionState    string
	Query               string
	QueryAgeSeconds     float64
	WaitDurationSeconds float64
	LockType            string
	LockMode            string
	Granted             bool
	BlockedByPID        *int64
}

// ResolveLocks delegates to dialect-specific lock inspectors.
func ResolveLocks(ctx context.Context, d types.Driver) ([]*RawLockInfo, string, error) {
	dialect := strings.ToLower(strings.TrimSpace(d.Dialect()))
	switch dialect {
	case "postgres", "postgresql", "pg":
		infos, err := inspectPostgresLocks(ctx, d)
		return infos, "postgres", err
	case "mysql", "mariadb":
		infos, err := inspectMySQLLocks(ctx, d)
		return infos, "mysql", err
	case "sqlite", "sqlite3":
		infos, err := inspectSQLiteLocks(ctx, d)
		return infos, "sqlite", err
	default:
		// Generic fallback: check driver processes
		infos, err := inspectFallbackProcesses(ctx, d)
		return infos, dialect, err
	}
}

// inspectPostgresLocks queries pg_locks joined with pg_stat_activity and pg_blocking_pids.
func inspectPostgresLocks(ctx context.Context, d types.Driver) ([]*RawLockInfo, error) {
	// Standard PostgreSQL lock inspection query
	query := `
		SELECT DISTINCT ON (a.pid)
			a.pid,
			COALESCE(a.usename, '') AS usename,
			COALESCE(a.datname, '') AS datname,
			COALESCE(a.client_addr::text, '') AS client_addr,
			COALESCE(a.application_name, '') AS application_name,
			COALESCE(a.state, '') AS state,
			COALESCE(a.query, '') AS query,
			COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - a.query_start)), 0) AS query_age_seconds,
			COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - a.state_change)), 0) AS wait_duration_seconds,
			COALESCE(l.locktype, 'relation') AS lock_type,
			COALESCE(l.mode, 'ExclusiveLock') AS lock_mode,
			COALESCE(l.granted, true) AS granted,
			COALESCE((pg_blocking_pids(a.pid))[1], 0) AS blocking_pid
		FROM pg_stat_activity a
		LEFT JOIN pg_locks l ON a.pid = l.pid AND l.granted = false
		WHERE a.pid <> pg_backend_pid()
		  AND (
			cardinality(pg_blocking_pids(a.pid)) > 0
			OR a.pid IN (SELECT unnest(pg_blocking_pids(p.pid)) FROM pg_stat_activity p)
		  )
		ORDER BY a.pid, l.granted ASC
	`

	res, err := d.ExecuteQuery(ctx, query)
	if err != nil {
		// Fallback for restricted pg permissions: inspect active processes
		return inspectFallbackProcesses(ctx, d)
	}

	if res == nil || len(res.Rows) == 0 {
		return []*RawLockInfo{}, nil
	}

	var results []*RawLockInfo
	colMap := makeColumnMap(res.Columns)

	for _, row := range res.Rows {
		pid := toInt64Val(colVal(row, colMap, "pid"))
		if pid <= 0 {
			continue
		}

		var blockedBy *int64
		blkPID := toInt64Val(colVal(row, colMap, "blocking_pid"))
		if blkPID > 0 && blkPID != pid {
			blockedBy = &blkPID
		}

		granted := toBoolVal(colVal(row, colMap, "granted"), true)
		if blockedBy != nil {
			granted = false
		}

		results = append(results, &RawLockInfo{
			PID:                 pid,
			User:                toStringVal(colVal(row, colMap, "usename")),
			Database:            toStringVal(colVal(row, colMap, "datname")),
			ClientAddr:          toStringVal(colVal(row, colMap, "client_addr")),
			ApplicationName:     toStringVal(colVal(row, colMap, "application_name")),
			TransactionState:    toStringVal(colVal(row, colMap, "state")),
			Query:               toStringVal(colVal(row, colMap, "query")),
			QueryAgeSeconds:     toFloat64Val(colVal(row, colMap, "query_age_seconds")),
			WaitDurationSeconds: toFloat64Val(colVal(row, colMap, "wait_duration_seconds")),
			LockType:            toStringVal(colVal(row, colMap, "lock_type")),
			LockMode:            toStringVal(colVal(row, colMap, "lock_mode")),
			Granted:             granted,
			BlockedByPID:        blockedBy,
		})
	}

	return results, nil
}

// inspectMySQLLocks queries performance_schema or innodb lock wait tables.
func inspectMySQLLocks(ctx context.Context, d types.Driver) ([]*RawLockInfo, error) {
	// 1. MySQL 8.0+: performance_schema.data_lock_waits
	queryPFS := `
		SELECT
			COALESCE(p_req.ID, 0) AS blocked_pid,
			COALESCE(p_req.USER, '') AS blocked_user,
			COALESCE(p_req.DB, '') AS blocked_db,
			COALESCE(p_req.HOST, '') AS blocked_host,
			COALESCE(p_req.INFO, '') AS blocked_query,
			COALESCE(p_req.TIME, 0) AS blocked_wait_seconds,
			COALESCE(p_blk.ID, 0) AS blocking_pid,
			COALESCE(p_blk.USER, '') AS blocking_user,
			COALESCE(p_blk.DB, '') AS blocking_db,
			COALESCE(p_blk.HOST, '') AS blocking_host,
			COALESCE(p_blk.INFO, '') AS blocking_query,
			COALESCE(p_blk.TIME, 0) AS blocking_age_seconds,
			COALESCE(dl.LOCK_TYPE, 'RECORD') AS lock_type,
			COALESCE(dl.LOCK_MODE, 'X') AS lock_mode
		FROM performance_schema.data_lock_waits w
		JOIN performance_schema.threads t_req ON w.REQUESTING_THREAD_ID = t_req.THREAD_ID
		JOIN information_schema.PROCESSLIST p_req ON t_req.PROCESSLIST_ID = p_req.ID
		JOIN performance_schema.threads t_blk ON w.BLOCKING_THREAD_ID = t_blk.THREAD_ID
		JOIN information_schema.PROCESSLIST p_blk ON t_blk.PROCESSLIST_ID = p_blk.ID
		LEFT JOIN performance_schema.data_locks dl ON w.REQUESTING_ENGINE_LOCK_ID = dl.ENGINE_LOCK_ID
	`

	res, err := d.ExecuteQuery(ctx, queryPFS)
	if err == nil && res != nil && len(res.Rows) > 0 {
		return parseMySQLWaitRows(res)
	}

	// 2. MySQL 5.7 / MariaDB fallback: information_schema.innodb_lock_waits
	queryInnoDB := `
		SELECT
			COALESCE(r.trx_mysql_thread_id, 0) AS blocked_pid,
			COALESCE(p_req.USER, '') AS blocked_user,
			COALESCE(p_req.DB, '') AS blocked_db,
			COALESCE(p_req.HOST, '') AS blocked_host,
			COALESCE(p_req.INFO, '') AS blocked_query,
			COALESCE(p_req.TIME, 0) AS blocked_wait_seconds,
			COALESCE(b.trx_mysql_thread_id, 0) AS blocking_pid,
			COALESCE(p_blk.USER, '') AS blocking_user,
			COALESCE(p_blk.DB, '') AS blocking_db,
			COALESCE(p_blk.HOST, '') AS blocking_host,
			COALESCE(p_blk.INFO, '') AS blocking_query,
			COALESCE(p_blk.TIME, 0) AS blocking_age_seconds,
			COALESCE(l.lock_type, 'RECORD') AS lock_type,
			COALESCE(l.lock_mode, 'X') AS lock_mode
		FROM information_schema.INNODB_LOCK_WAITS w
		JOIN information_schema.INNODB_TRX r ON w.requesting_trx_id = r.trx_id
		JOIN information_schema.PROCESSLIST p_req ON r.trx_mysql_thread_id = p_req.ID
		JOIN information_schema.INNODB_TRX b ON w.blocking_trx_id = b.trx_id
		JOIN information_schema.PROCESSLIST p_blk ON b.trx_mysql_thread_id = p_blk.ID
		LEFT JOIN information_schema.INNODB_LOCKS l ON w.requested_lock_id = l.lock_id
	`
	res, err = d.ExecuteQuery(ctx, queryInnoDB)
	if err == nil && res != nil && len(res.Rows) > 0 {
		return parseMySQLWaitRows(res)
	}

	// 3. Fallback: inspect processlist for threads waiting on locks
	return inspectFallbackProcesses(ctx, d)
}

func parseMySQLWaitRows(res *types.QueryResult) ([]*RawLockInfo, error) {
	colMap := makeColumnMap(res.Columns)
	seen := make(map[int64]bool)
	var results []*RawLockInfo

	for _, row := range res.Rows {
		blockedPID := toInt64Val(colVal(row, colMap, "blocked_pid"))
		blockingPID := toInt64Val(colVal(row, colMap, "blocking_pid"))

		// Add blocking session if not seen
		if blockingPID > 0 && !seen[blockingPID] {
			seen[blockingPID] = true
			results = append(results, &RawLockInfo{
				PID:                 blockingPID,
				User:                toStringVal(colVal(row, colMap, "blocking_user")),
				Database:            toStringVal(colVal(row, colMap, "blocking_db")),
				ClientAddr:          toStringVal(colVal(row, colMap, "blocking_host")),
				ApplicationName:     "mysql-client",
				TransactionState:    "HOLDING LOCK",
				Query:               toStringVal(colVal(row, colMap, "blocking_query")),
				QueryAgeSeconds:     toFloat64Val(colVal(row, colMap, "blocking_age_seconds")),
				WaitDurationSeconds: 0,
				LockType:            toStringVal(colVal(row, colMap, "lock_type")),
				LockMode:            toStringVal(colVal(row, colMap, "lock_mode")),
				Granted:             true,
				BlockedByPID:        nil,
			})
		}

		// Add blocked session
		if blockedPID > 0 {
			seen[blockedPID] = true
			var blk *int64
			if blockingPID > 0 {
				blk = &blockingPID
			}
			results = append(results, &RawLockInfo{
				PID:                 blockedPID,
				User:                toStringVal(colVal(row, colMap, "blocked_user")),
				Database:            toStringVal(colVal(row, colMap, "blocked_db")),
				ClientAddr:          toStringVal(colVal(row, colMap, "blocked_host")),
				ApplicationName:     "mysql-client",
				TransactionState:    "WAITING FOR LOCK",
				Query:               toStringVal(colVal(row, colMap, "blocked_query")),
				QueryAgeSeconds:     toFloat64Val(colVal(row, colMap, "blocked_wait_seconds")),
				WaitDurationSeconds: toFloat64Val(colVal(row, colMap, "blocked_wait_seconds")),
				LockType:            toStringVal(colVal(row, colMap, "lock_type")),
				LockMode:            toStringVal(colVal(row, colMap, "lock_mode")),
				Granted:             false,
				BlockedByPID:        blk,
			})
		}
	}

	return results, nil
}

// inspectSQLiteLocks inspects PRAGMAs: busy_timeout, journal_mode, locking_mode, and wal_checkpoint.
func inspectSQLiteLocks(ctx context.Context, d types.Driver) ([]*RawLockInfo, error) {
	busyTimeout := 5000
	if res, err := d.ExecuteQuery(ctx, "PRAGMA busy_timeout;"); err == nil && len(res.Rows) > 0 && len(res.Rows[0]) > 0 {
		busyTimeout = int(toInt64Val(res.Rows[0][0]))
	}

	journalMode := "wal"
	if res, err := d.ExecuteQuery(ctx, "PRAGMA journal_mode;"); err == nil && len(res.Rows) > 0 && len(res.Rows[0]) > 0 {
		journalMode = toStringVal(res.Rows[0][0])
	}

	lockingMode := "normal"
	if res, err := d.ExecuteQuery(ctx, "PRAGMA locking_mode;"); err == nil && len(res.Rows) > 0 && len(res.Rows[0]) > 0 {
		lockingMode = toStringVal(res.Rows[0][0])
	}

	walStatus := "NORMAL"
	if strings.EqualFold(journalMode, "wal") {
		if res, err := d.ExecuteQuery(ctx, "PRAGMA wal_checkpoint(PASSIVE);"); err == nil && len(res.Rows) > 0 {
			walStatus = "CHECKPOINT READY"
		}
	}

	// Single lock coordinator node for SQLite database
	node := &RawLockInfo{
		PID:                 1,
		User:                "sqlite-main",
		Database:            "main",
		ClientAddr:          "local-file",
		ApplicationName:     "sqlite-engine",
		TransactionState:    fmt.Sprintf("mode: %s / journal: %s (%s)", lockingMode, journalMode, walStatus),
		Query:               fmt.Sprintf("PRAGMA busy_timeout = %dms;", busyTimeout),
		QueryAgeSeconds:     0,
		WaitDurationSeconds: 0,
		LockType:            "database",
		LockMode:            strings.ToUpper(lockingMode),
		Granted:             true,
		BlockedByPID:        nil,
	}

	return []*RawLockInfo{node}, nil
}

// inspectFallbackProcesses checks InspectProcesses for threads waiting on locks.
func inspectFallbackProcesses(ctx context.Context, d types.Driver) ([]*RawLockInfo, error) {
	procs, err := d.InspectProcesses(ctx)
	if err != nil {
		return []*RawLockInfo{}, nil
	}

	var results []*RawLockInfo
	for _, p := range procs {
		pid, _ := strconv.ParseInt(p.ID, 10, 64)
		if pid <= 0 {
			continue
		}

		isWaiting := strings.Contains(strings.ToLower(p.State), "wait") ||
			strings.Contains(strings.ToLower(p.State), "lock") ||
			strings.Contains(strings.ToLower(p.Command), "lock")

		results = append(results, &RawLockInfo{
			PID:                 pid,
			User:                p.User,
			Database:            p.Database,
			ClientAddr:          p.Host,
			ApplicationName:     "client",
			TransactionState:    p.State,
			Query:               p.Query,
			QueryAgeSeconds:     float64(p.Time),
			WaitDurationSeconds: float64(p.Time),
			LockType:            "table",
			LockMode:            "ExclusiveLock",
			Granted:             !isWaiting,
			BlockedByPID:        nil,
		})
	}

	return results, nil
}

// Helper utilities for QueryResult column/row parsing
func makeColumnMap(cols []string) map[string]int {
	m := make(map[string]int, len(cols))
	for i, c := range cols {
		m[strings.ToLower(c)] = i
	}
	return m
}

func colVal(row []interface{}, colMap map[string]int, name string) interface{} {
	if idx, ok := colMap[strings.ToLower(name)]; ok && idx < len(row) {
		return row[idx]
	}
	return nil
}

func toStringVal(v interface{}) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	case []byte:
		return string(val)
	default:
		return fmt.Sprintf("%v", val)
	}
}

func toInt64Val(v interface{}) int64 {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case int64:
		return val
	case int:
		return int64(val)
	case int32:
		return int64(val)
	case float64:
		return int64(val)
	case string:
		n, _ := strconv.ParseInt(strings.TrimSpace(val), 10, 64)
		return n
	case []byte:
		n, _ := strconv.ParseInt(strings.TrimSpace(string(val)), 10, 64)
		return n
	default:
		return 0
	}
}

func toFloat64Val(v interface{}) float64 {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int64:
		return float64(val)
	case int:
		return float64(val)
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(val), 64)
		return f
	case []byte:
		f, _ := strconv.ParseFloat(strings.TrimSpace(string(val)), 64)
		return f
	default:
		return 0
	}
}

func toBoolVal(v interface{}, fallback bool) bool {
	if v == nil {
		return fallback
	}
	switch val := v.(type) {
	case bool:
		return val
	case int64:
		return val != 0
	case int:
		return val != 0
	case string:
		s := strings.ToLower(strings.TrimSpace(val))
		return s == "true" || s == "t" || s == "1" || s == "yes"
	default:
		return fallback
	}
}
