package lockmgr_test

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/driver/types"
	"github.com/dblens/dblens/internal/lockmgr"
)

// MockDriver implements types.Driver for comprehensive unit testing
type mockDriver struct {
	dialect    string
	queries    []string
	queryRes   map[string]*types.QueryResult
	killPID    string
	killCalled bool
}

func (m *mockDriver) Dialect() string                                            { return m.dialect }
func (m *mockDriver) InspectDatabases(ctx context.Context) ([]string, error)     { return nil, nil }
func (m *mockDriver) SelectDatabase(ctx context.Context, dbName string) error    { return nil }
func (m *mockDriver) InspectSchemas(ctx context.Context) ([]string, error)       { return nil, nil }
func (m *mockDriver) InspectTables(ctx context.Context, schema string) ([]types.TableMeta, error) {
	return nil, nil
}
func (m *mockDriver) InspectTableDetails(ctx context.Context, schema, table string) (*types.TableDetail, error) {
	return nil, nil
}
func (m *mockDriver) GenerateTableDDL(ctx context.Context, schema, table string) (string, error) {
	return "", nil
}
func (m *mockDriver) QueryTableData(ctx context.Context, opts types.QueryOptions) (*types.QueryResult, error) {
	return nil, nil
}
func (m *mockDriver) QueryTableStream(ctx context.Context, schema, table string) (*sql.Rows, error) {
	return nil, nil
}
func (m *mockDriver) ExecuteQuery(ctx context.Context, query string) (*types.QueryResult, error) {
	m.queries = append(m.queries, query)
	for pattern, res := range m.queryRes {
		if strings.Contains(strings.ToLower(query), strings.ToLower(pattern)) {
			return res, nil
		}
	}
	return &types.QueryResult{Columns: []string{}, Rows: [][]interface{}{}}, nil
}
func (m *mockDriver) ExecuteQueryWithParams(ctx context.Context, sql string, params map[string]interface{}) (*types.QueryResult, error) {
	return m.ExecuteQuery(ctx, sql)
}
func (m *mockDriver) ExecuteRaw(ctx context.Context, sql string, args ...interface{}) (*types.QueryResult, error) {
	return m.ExecuteQuery(ctx, sql)
}
func (m *mockDriver) MutateRow(ctx context.Context, mutation types.Mutation) (*types.MutationResult, error) {
	return nil, nil
}
func (m *mockDriver) BatchInsert(ctx context.Context, schema, table string, rows []map[string]interface{}) (*types.MutationResult, error) {
	return nil, nil
}
func (m *mockDriver) GetERDData(ctx context.Context) ([]types.ERDTable, error) {
	return nil, nil
}
func (m *mockDriver) ExplainQuery(ctx context.Context, sql string, opts types.ExplainOptions) (*types.ExplainResult, error) {
	return nil, nil
}
func (m *mockDriver) InspectProcesses(ctx context.Context) ([]types.ProcessInfo, error) {
	return []types.ProcessInfo{
		{ID: "10", User: "app", Database: "db", Host: "10.0.0.1", Time: 25, State: "Waiting for table metadata lock", Query: "ALTER TABLE users ADD COLUMN age INT"},
	}, nil
}
func (m *mockDriver) KillProcess(ctx context.Context, id string) error {
	m.killCalled = true
	m.killPID = id
	return nil
}
func (m *mockDriver) InspectHealth(ctx context.Context) (*types.HealthReport, error) {
	return nil, nil
}
func (m *mockDriver) Ping(ctx context.Context) error { return nil }
func (m *mockDriver) Close() error                   { return nil }

func ptr(v int64) *int64 { return &v }

func TestDeadlockDetection(t *testing.T) {
	t.Run("Mutual 2-node deadlock A -> B -> A", func(t *testing.T) {
		nodes := map[int64]*lockmgr.LockNode{
			101: {PID: 101, User: "alice", BlockedByPID: ptr(202)},
			202: {PID: 202, User: "bob", BlockedByPID: ptr(101)},
		}

		cycles := lockmgr.DetectDeadlocks(nodes)
		if len(cycles) != 1 {
			t.Fatalf("expected 1 deadlock cycle, got %d", len(cycles))
		}
		expectedPIDs := []int64{101, 202, 101}
		if len(cycles[0].PIDs) != len(expectedPIDs) {
			t.Fatalf("expected cycle length %d, got %d", len(expectedPIDs), len(cycles[0].PIDs))
		}
		for i, p := range expectedPIDs {
			if cycles[0].PIDs[i] != p {
				t.Errorf("at index %d expected PID %d, got %d", i, p, cycles[0].PIDs[i])
			}
		}
		if !strings.Contains(cycles[0].Description, "101") || !strings.Contains(cycles[0].Description, "202") {
			t.Errorf("unexpected description: %s", cycles[0].Description)
		}
	})

	t.Run("3-node circular deadlock A -> B -> C -> A", func(t *testing.T) {
		nodes := map[int64]*lockmgr.LockNode{
			10: {PID: 10, User: "u1", BlockedByPID: ptr(20)},
			20: {PID: 20, User: "u2", BlockedByPID: ptr(30)},
			30: {PID: 30, User: "u3", BlockedByPID: ptr(10)},
		}

		cycles := lockmgr.DetectDeadlocks(nodes)
		if len(cycles) != 1 {
			t.Fatalf("expected 1 cycle, got %d", len(cycles))
		}
		expected := []int64{10, 20, 30, 10}
		for i, p := range expected {
			if cycles[0].PIDs[i] != p {
				t.Errorf("expected PID %d at %d, got %d", p, i, cycles[0].PIDs[i])
			}
		}
	})

	t.Run("Acyclic wait chain: A -> B -> C (no deadlock)", func(t *testing.T) {
		nodes := map[int64]*lockmgr.LockNode{
			10: {PID: 10, BlockedByPID: ptr(20)},
			20: {PID: 20, BlockedByPID: ptr(30)},
			30: {PID: 30, BlockedByPID: nil}, // Root blocker
		}

		cycles := lockmgr.DetectDeadlocks(nodes)
		if len(cycles) != 0 {
			t.Fatalf("expected 0 deadlock cycles in acyclic chain, got %d", len(cycles))
		}
	})

	t.Run("Multiple independent cycles", func(t *testing.T) {
		nodes := map[int64]*lockmgr.LockNode{
			1: {PID: 1, BlockedByPID: ptr(2)},
			2: {PID: 2, BlockedByPID: ptr(1)},
			3: {PID: 3, BlockedByPID: ptr(4)},
			4: {PID: 4, BlockedByPID: ptr(3)},
		}

		cycles := lockmgr.DetectDeadlocks(nodes)
		if len(cycles) != 2 {
			t.Fatalf("expected 2 deadlock cycles, got %d", len(cycles))
		}
	})
}

func TestBuildLockGraph(t *testing.T) {
	t.Run("Linear tree with root blocker and children", func(t *testing.T) {
		raw := []*lockmgr.RawLockInfo{
			{PID: 100, User: "admin", Database: "prod", Query: "UPDATE accounts SET balance = balance - 100", WaitDurationSeconds: 0, Granted: true, BlockedByPID: nil},
			{PID: 101, User: "alice", Database: "prod", Query: "SELECT * FROM accounts FOR UPDATE", WaitDurationSeconds: 15.2, Granted: false, BlockedByPID: ptr(100)},
			{PID: 102, User: "bob", Database: "prod", Query: "DELETE FROM accounts WHERE id = 1", WaitDurationSeconds: 8.5, Granted: false, BlockedByPID: ptr(100)},
			{PID: 103, User: "charlie", Database: "prod", Query: "ALTER TABLE accounts ADD c INT", WaitDurationSeconds: 22.0, Granted: false, BlockedByPID: ptr(101)},
		}

		resp := lockmgr.BuildLockGraph(raw, "postgres")
		if resp.TotalLocks != 4 {
			t.Errorf("expected 4 total locks, got %d", resp.TotalLocks)
		}
		if resp.BlockedSessions != 3 {
			t.Errorf("expected 3 blocked sessions, got %d", resp.BlockedSessions)
		}
		if len(resp.RootBlockers) != 1 {
			t.Fatalf("expected 1 root blocker, got %d", len(resp.RootBlockers))
		}

		root := resp.RootBlockers[0]
		if root.PID != 100 {
			t.Errorf("expected root PID 100, got %d", root.PID)
		}
		if !root.IsRootBlocker {
			t.Errorf("expected IsRootBlocker to be true")
		}
		if len(root.Children) != 2 {
			t.Fatalf("expected root to have 2 direct children, got %d", len(root.Children))
		}

		// Children sorted by wait duration descending
		if root.Children[0].PID != 101 || root.Children[1].PID != 102 {
			t.Errorf("children sort order unexpected: got %d, %d", root.Children[0].PID, root.Children[1].PID)
		}

		// Nested child under PID 101
		child101 := root.Children[0]
		if len(child101.Children) != 1 || child101.Children[0].PID != 103 {
			t.Errorf("expected PID 103 under PID 101, got %+v", child101.Children)
		}
	})

	t.Run("Deadlock cycle included as root blocker", func(t *testing.T) {
		raw := []*lockmgr.RawLockInfo{
			{PID: 50, User: "u1", Query: "UPDATE t1 SET a=1", WaitDurationSeconds: 10, Granted: false, BlockedByPID: ptr(60)},
			{PID: 60, User: "u2", Query: "UPDATE t2 SET b=2", WaitDurationSeconds: 12, Granted: false, BlockedByPID: ptr(50)},
		}

		resp := lockmgr.BuildLockGraph(raw, "mysql")
		if len(resp.Deadlocks) != 1 {
			t.Fatalf("expected 1 deadlock cycle, got %d", len(resp.Deadlocks))
		}
		if len(resp.RootBlockers) == 0 {
			t.Fatalf("expected cycle to be anchored in RootBlockers")
		}
		if resp.BlockedSessions != 2 {
			t.Errorf("expected 2 blocked sessions, got %d", resp.BlockedSessions)
		}
	})
}

func TestInspectLocksResolvers(t *testing.T) {
	ctx := context.Background()

	t.Run("PostgreSQL Lock Inspection", func(t *testing.T) {
		mock := &mockDriver{
			dialect: "postgres",
			queryRes: map[string]*types.QueryResult{
				"pg_locks": {
					Columns: []string{"pid", "usename", "datname", "client_addr", "application_name", "state", "query", "query_age_seconds", "wait_duration_seconds", "lock_type", "lock_mode", "granted", "blocking_pid"},
					Rows: [][]interface{}{
						{int64(200), "dba", "sales", "127.0.0.1", "psql", "active", "VACUUM FULL orders", 120.0, 0.0, "relation", "AccessExclusiveLock", true, int64(0)},
						{int64(201), "app", "sales", "10.0.0.2", "node-app", "active", "SELECT * FROM orders", 45.0, 45.0, "relation", "AccessShareLock", false, int64(200)},
					},
				},
			},
		}

		resp, err := lockmgr.InspectLocks(ctx, mock)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.Dialect != "postgres" {
			t.Errorf("expected dialect postgres, got %s", resp.Dialect)
		}
		if resp.TotalLocks != 2 {
			t.Errorf("expected 2 locks, got %d", resp.TotalLocks)
		}
		if len(resp.RootBlockers) != 1 || resp.RootBlockers[0].PID != 200 {
			t.Errorf("expected root blocker PID 200, got %+v", resp.RootBlockers)
		}
	})

	t.Run("MySQL Lock Inspection", func(t *testing.T) {
		mock := &mockDriver{
			dialect: "mysql",
			queryRes: map[string]*types.QueryResult{
				"data_lock_waits": {
					Columns: []string{"blocked_pid", "blocked_user", "blocked_db", "blocked_host", "blocked_query", "blocked_wait_seconds", "blocking_pid", "blocking_user", "blocking_db", "blocking_host", "blocking_query", "blocking_age_seconds", "lock_type", "lock_mode"},
					Rows: [][]interface{}{
						{int64(45), "worker", "app_db", "10.0.1.5", "INSERT INTO orders VALUES (1)", 14.0, int64(40), "writer", "app_db", "10.0.1.2", "UPDATE orders SET status='DONE'", 30.0, "RECORD", "X"},
					},
				},
			},
		}

		resp, err := lockmgr.InspectLocks(ctx, mock)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.Dialect != "mysql" {
			t.Errorf("expected dialect mysql, got %s", resp.Dialect)
		}
		if resp.TotalLocks != 2 {
			t.Errorf("expected 2 locks (1 blocker + 1 waiter), got %d", resp.TotalLocks)
		}
		if len(resp.RootBlockers) != 1 || resp.RootBlockers[0].PID != 40 {
			t.Errorf("expected root blocker PID 40, got %+v", resp.RootBlockers)
		}
	})

	t.Run("SQLite PRAGMA Inspection", func(t *testing.T) {
		mock := &mockDriver{
			dialect: "sqlite",
			queryRes: map[string]*types.QueryResult{
				"busy_timeout": {
					Columns: []string{"timeout"},
					Rows:    [][]interface{}{{int64(6000)}},
				},
				"journal_mode": {
					Columns: []string{"journal_mode"},
					Rows:    [][]interface{}{{"wal"}},
				},
				"locking_mode": {
					Columns: []string{"locking_mode"},
					Rows:    [][]interface{}{{"normal"}},
				},
			},
		}

		resp, err := lockmgr.InspectLocks(ctx, mock)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.Dialect != "sqlite" {
			t.Errorf("expected dialect sqlite, got %s", resp.Dialect)
		}
		if resp.TotalLocks != 1 {
			t.Errorf("expected 1 SQLite coordinator node, got %d", resp.TotalLocks)
		}
	})
}

func TestTerminateSession(t *testing.T) {
	ctx := context.Background()

	t.Run("PostgreSQL cancel (force=false)", func(t *testing.T) {
		mock := &mockDriver{dialect: "postgres"}
		err := lockmgr.TerminateSession(ctx, mock, 555, false)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(mock.queries) == 0 || !strings.Contains(mock.queries[0], "pg_cancel_backend(555)") {
			t.Errorf("expected pg_cancel_backend(555), got: %+v", mock.queries)
		}
	})

	t.Run("PostgreSQL terminate (force=true)", func(t *testing.T) {
		mock := &mockDriver{dialect: "postgres"}
		err := lockmgr.TerminateSession(ctx, mock, 555, true)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !mock.killCalled || mock.killPID != "555" {
			t.Errorf("expected KillProcess with 555, got: %s", mock.killPID)
		}
	})

	t.Run("MySQL kill query (force=false)", func(t *testing.T) {
		mock := &mockDriver{dialect: "mysql"}
		err := lockmgr.TerminateSession(ctx, mock, 888, false)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(mock.queries) == 0 || !strings.Contains(mock.queries[0], "KILL QUERY 888") {
			t.Errorf("expected KILL QUERY 888, got: %+v", mock.queries)
		}
	})

	t.Run("MySQL kill connection (force=true)", func(t *testing.T) {
		mock := &mockDriver{dialect: "mysql"}
		err := lockmgr.TerminateSession(ctx, mock, 888, true)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !mock.killCalled || mock.killPID != "888" {
			t.Errorf("expected KillProcess with 888, got: %s", mock.killPID)
		}
	})

	t.Run("SQLite terminate returns error", func(t *testing.T) {
		mock := &mockDriver{dialect: "sqlite"}
		err := lockmgr.TerminateSession(ctx, mock, 1, true)
		if err == nil {
			t.Fatalf("expected error terminating sqlite session, got nil")
		}
	})
}
