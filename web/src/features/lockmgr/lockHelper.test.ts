import {
  formatWaitDuration,
  getLockSeverity,
  getSeverityBadgeClass,
  extractDeadlockSummary,
  flattenLockTree,
  calculateLockMetrics,
  filterLockNodes,
  type LockNode,
  type DeadlockCycle,
  type LockTreeResponse,
} from './lockHelper.ts'

declare const process: { exit: (code: number) => void }

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`)
  }
}

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err: any) {
    failed++
    console.error(`  ✗ ${name}: ${err.message}`)
  }
}

console.log('--- Running Lock Manager Helper Unit Tests ---')

test('formatWaitDuration: formats seconds cleanly', () => {
  assert(formatWaitDuration(0) === '0s', '0s')
  assert(formatWaitDuration(-5) === '0s', 'negative to 0s')
  assert(formatWaitDuration(0.4) === '< 1s', 'sub-second')
  assert(formatWaitDuration(14) === '14s', '14s')
  assert(formatWaitDuration(60) === '1m', 'exact 1 minute')
  assert(formatWaitDuration(135) === '2m 15s', '2m 15s')
  assert(formatWaitDuration(3600) === '1h', 'exact 1 hour')
  assert(formatWaitDuration(3665) === '1h 1m', '1h 1m')
})

test('getLockSeverity and badge styling', () => {
  assert(getLockSeverity(5, false, false) === 'normal', 'normal severity')
  assert(getLockSeverity(15, false, false) === 'warning', 'warning severity')
  assert(getLockSeverity(2, true, false) === 'warning', 'root blocker warning')
  assert(getLockSeverity(65, false, false) === 'critical', 'critical severity')
  assert(getLockSeverity(35, true, false) === 'critical', 'root blocker > 30s critical')
  assert(getLockSeverity(5, true, true) === 'deadlock', 'deadlock overrides all')

  assert(getSeverityBadgeClass('deadlock').includes('purple'), 'deadlock badge purple')
  assert(getSeverityBadgeClass('critical').includes('red'), 'critical badge red')
  assert(getSeverityBadgeClass('warning').includes('amber'), 'warning badge amber')
  assert(getSeverityBadgeClass('normal').includes('emerald'), 'normal badge emerald')
})

test('extractDeadlockSummary: formats cycle summaries', () => {
  assert(extractDeadlockSummary([]).length === 0, 'empty deadlocks')

  const cycles: DeadlockCycle[] = [
    { pids: [100, 200, 100], description: 'Mutual deadlock: Session 100 waits on 200' },
    { pids: [1, 2, 3, 1], description: '' },
  ]
  const summaries = extractDeadlockSummary(cycles)
  assert(summaries.length === 2, '2 summaries extracted')
  assert(summaries[0].includes('Mutual deadlock'), 'first summary uses description')
  assert(summaries[1].includes('1 ➔ 2 ➔ 3 ➔ 1'), 'second summary generates chain arrow')
})

test('flattenLockTree: flattens hierarchy with depths and guards against cycles', () => {
  const leaf: LockNode = {
    pid: 300,
    user: 'carol',
    database: 'prod',
    query: 'SELECT * FROM users',
    query_age_seconds: 5,
    wait_duration_seconds: 5,
    lock_type: 'relation',
    lock_mode: 'AccessShareLock',
    granted: false,
    client_addr: '10.0.0.3',
    application_name: 'api',
    transaction_state: 'active',
    is_root_blocker: false,
    children: [],
  }

  const child: LockNode = {
    pid: 200,
    user: 'bob',
    database: 'prod',
    query: 'UPDATE users SET active=1',
    query_age_seconds: 15,
    wait_duration_seconds: 15,
    lock_type: 'tuple',
    lock_mode: 'ExclusiveLock',
    granted: false,
    client_addr: '10.0.0.2',
    application_name: 'worker',
    transaction_state: 'active',
    is_root_blocker: false,
    children: [leaf],
  }

  const root: LockNode = {
    pid: 100,
    user: 'alice',
    database: 'prod',
    query: 'VACUUM FULL users',
    query_age_seconds: 120,
    wait_duration_seconds: 0,
    lock_type: 'relation',
    lock_mode: 'AccessExclusiveLock',
    granted: true,
    client_addr: '10.0.0.1',
    application_name: 'psql',
    transaction_state: 'active',
    is_root_blocker: true,
    children: [child],
  }

  const flat = flattenLockTree([root])
  assert(flat.length === 3, 'flattens to 3 nodes')
  assert(flat[0].node.pid === 100 && flat[0].depth === 0, 'root depth 0')
  assert(flat[1].node.pid === 200 && flat[1].depth === 1, 'child depth 1')
  assert(flat[2].node.pid === 300 && flat[2].depth === 2, 'leaf depth 2')
})

test('calculateLockMetrics: computes KPI metrics', () => {
  assert(calculateLockMetrics(null).totalLocks === 0, 'null resp metrics 0')

  const resp: LockTreeResponse = {
    timestamp: '2026-09-27T00:00:00Z',
    total_locks: 5,
    blocked_sessions: 3,
    root_blockers: [{ pid: 1 } as any],
    all_nodes: [
      { pid: 1, wait_duration_seconds: 10 } as any,
      { pid: 2, wait_duration_seconds: 45 } as any,
      { pid: 3, wait_duration_seconds: 5 } as any,
    ],
    deadlocks: [{ pids: [1, 2, 1], description: '' }],
    dialect: 'postgres',
  }

  const metrics = calculateLockMetrics(resp)
  assert(metrics.totalLocks === 5, 'total locks 5')
  assert(metrics.blockedSessions === 3, 'blocked sessions 3')
  assert(metrics.rootBlockerCount === 1, 'root blocker 1')
  assert(metrics.deadlockCount === 1, 'deadlocks 1')
  assert(metrics.maxWaitSeconds === 45, 'max wait 45s')
})

test('filterLockNodes: filters by keyword across fields', () => {
  const nodes: LockNode[] = [
    {
      pid: 101,
      user: 'alice_admin',
      database: 'sales_db',
      query: 'UPDATE orders SET status=1',
      query_age_seconds: 10,
      wait_duration_seconds: 0,
      lock_type: 'relation',
      lock_mode: 'AccessExclusiveLock',
      granted: true,
      client_addr: '192.168.1.1',
      application_name: 'admin-cli',
      transaction_state: 'active',
      is_root_blocker: true,
      children: [],
    },
    {
      pid: 202,
      user: 'worker_service',
      database: 'analytics_db',
      query: 'SELECT * FROM orders FOR UPDATE',
      query_age_seconds: 25,
      wait_duration_seconds: 25,
      lock_type: 'tuple',
      lock_mode: 'ExclusiveLock',
      granted: false,
      client_addr: '10.0.1.2',
      application_name: 'batch-job',
      transaction_state: 'idle in transaction',
      is_root_blocker: false,
      children: [],
    },
  ]

  assert(filterLockNodes(nodes, '').length === 2, 'empty search returns all')
  assert(filterLockNodes(nodes, '101').length === 1, 'matches PID')
  assert(filterLockNodes(nodes, 'alice').length === 1, 'matches user')
  assert(filterLockNodes(nodes, 'analytics').length === 1, 'matches database')
  assert(filterLockNodes(nodes, 'orders').length === 2, 'matches query in both')
  assert(filterLockNodes(nodes, 'ExclusiveLock').length === 2, 'matches lock mode')
  assert(filterLockNodes(nodes, 'nonexistent').length === 0, 'no matches')
})

console.log(`\nLock Manager Helper Tests: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
