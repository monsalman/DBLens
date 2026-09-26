export interface LockNode {
  pid: number
  user: string
  database: string
  query: string
  query_age_seconds: number
  wait_duration_seconds: number
  lock_type: string
  lock_mode: string
  granted: boolean
  blocked_by_pid?: number
  client_addr: string
  application_name: string
  transaction_state: string
  is_root_blocker: boolean
  children: LockNode[]
}

export interface DeadlockCycle {
  pids: number[]
  nodes?: LockNode[]
  description: string
}

export interface LockTreeResponse {
  timestamp: string
  total_locks: number
  blocked_sessions: number
  root_blockers: LockNode[]
  all_nodes: LockNode[]
  deadlocks: DeadlockCycle[]
  dialect: string
}

export interface TerminateLockRequest {
  pid: number
  force: boolean
}

/**
 * Formats wait or query duration in seconds to clean human-readable duration strings (e.g. "4m 12s", "35s").
 */
export function formatWaitDuration(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null || seconds < 0) return '0s'
  if (seconds < 1 && seconds > 0) return '< 1s'
  const s = Math.floor(seconds)
  if (s < 60) return `${s}s`
  const mins = Math.floor(s / 60)
  const remSec = s % 60
  if (mins < 60) {
    return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`
  }
  const hours = Math.floor(mins / 60)
  const remMin = mins % 60
  return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`
}

export type LockSeverity = 'normal' | 'warning' | 'critical' | 'deadlock'

/**
 * Calculates severity based on wait duration, blocker status, and cycle membership.
 */
export function getLockSeverity(
  waitDurationSeconds: number,
  isRootBlocker: boolean,
  isDeadlocked: boolean
): LockSeverity {
  if (isDeadlocked) return 'deadlock'
  if (waitDurationSeconds >= 60 || (isRootBlocker && waitDurationSeconds >= 30)) {
    return 'critical'
  }
  if (waitDurationSeconds >= 10 || isRootBlocker) {
    return 'warning'
  }
  return 'normal'
}

/**
 * Returns Tailwind CSS badge classes corresponding to lock severity.
 */
export function getSeverityBadgeClass(severity: LockSeverity): string {
  switch (severity) {
    case 'deadlock':
      return 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30'
    case 'critical':
      return 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
    case 'warning':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
    case 'normal':
    default:
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
  }
}

/**
 * Extracts formatted one-line summaries of detected deadlocks.
 */
export function extractDeadlockSummary(deadlocks: DeadlockCycle[]): string[] {
  if (!deadlocks || deadlocks.length === 0) return []
  return deadlocks.map((dl, idx) => {
    if (dl.description) {
      return dl.description
    }
    const chain = dl.pids.join(' ➔ ')
    return `Cycle #${idx + 1}: ${chain}`
  })
}

export interface FlattenedLockNode {
  node: LockNode
  depth: number
  isLastChild: boolean
}

/**
 * Flattens the hierarchical lock tree into a linear list with depth indicators for tree rendering.
 */
export function flattenLockTree(roots: LockNode[]): FlattenedLockNode[] {
  const result: FlattenedLockNode[] = []
  const visited = new Set<number>()

  function walk(node: LockNode, depth: number, isLast: boolean) {
    if (!node || visited.has(node.pid)) return
    visited.add(node.pid)

    result.push({
      node,
      depth,
      isLastChild: isLast,
    })

    const children = node.children || []
    for (let i = 0; i < children.length; i++) {
      walk(children[i], depth + 1, i === children.length - 1)
    }
  }

  const safeRoots = roots || []
  for (let i = 0; i < safeRoots.length; i++) {
    walk(safeRoots[i], 0, i === safeRoots.length - 1)
  }

  return result
}

export interface LockSummaryMetrics {
  totalLocks: number
  blockedSessions: number
  rootBlockerCount: number
  deadlockCount: number
  maxWaitSeconds: number
}

/**
 * Calculates top-level metrics for KPI cards.
 */
export function calculateLockMetrics(resp: LockTreeResponse | null | undefined): LockSummaryMetrics {
  if (!resp) {
    return {
      totalLocks: 0,
      blockedSessions: 0,
      rootBlockerCount: 0,
      deadlockCount: 0,
      maxWaitSeconds: 0,
    }
  }

  let maxWait = 0
  for (const node of resp.all_nodes || []) {
    if (node.wait_duration_seconds > maxWait) {
      maxWait = node.wait_duration_seconds
    }
  }

  return {
    totalLocks: resp.total_locks || (resp.all_nodes ? resp.all_nodes.length : 0),
    blockedSessions: resp.blocked_sessions || 0,
    rootBlockerCount: resp.root_blockers ? resp.root_blockers.length : 0,
    deadlockCount: resp.deadlocks ? resp.deadlocks.length : 0,
    maxWaitSeconds: maxWait,
  }
}

/**
 * Filters lock nodes by search term (matching PID, user, database, query, or lock mode).
 */
export function filterLockNodes(nodes: LockNode[], query: string): LockNode[] {
  if (!nodes) return []
  const q = query.trim().toLowerCase()
  if (!q) return nodes

  return nodes.filter(n => {
    return (
      String(n.pid).includes(q) ||
      (n.user && n.user.toLowerCase().includes(q)) ||
      (n.database && n.database.toLowerCase().includes(q)) ||
      (n.query && n.query.toLowerCase().includes(q)) ||
      (n.lock_mode && n.lock_mode.toLowerCase().includes(q)) ||
      (n.lock_type && n.lock_type.toLowerCase().includes(q)) ||
      (n.transaction_state && n.transaction_state.toLowerCase().includes(q))
    )
  })
}
