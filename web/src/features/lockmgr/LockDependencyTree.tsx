import React, { useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Lock,
  Skull,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import {
  formatWaitDuration,
  getLockSeverity,
  getSeverityBadgeClass,
  type LockNode,
} from './lockHelper'

interface LockDependencyTreeProps {
  rootBlockers: LockNode[]
  allNodes: LockNode[]
  selectedPID: number | null
  deadlockPIDs: Set<number>
  onSelectPID: (pid: number) => void
  onKillPID: (pid: number) => void
  searchQuery: string
  readOnly?: boolean
}

export const LockDependencyTree: React.FC<LockDependencyTreeProps> = ({
  rootBlockers,
  allNodes,
  selectedPID,
  deadlockPIDs,
  onSelectPID,
  onKillPID,
  searchQuery,
  readOnly = false,
}) => {
  const [collapsedPIDs, setCollapsedPIDs] = useState<Set<number>>(new Set())

  const toggleCollapse = (pid: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setCollapsedPIDs(prev => {
      const next = new Set(prev)
      if (next.has(pid)) {
        next.delete(pid)
      } else {
        next.add(pid)
      }
      return next
    })
  }

  // If no locks exist at all
  if (!allNodes || allNodes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center text-[var(--muted)] border border-[var(--border)] rounded-lg bg-[var(--surface)]">
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-3 opacity-90" />
        <h4 className="text-base font-semibold text-[var(--fg)]">No Database Locks Active</h4>
        <p className="text-xs text-[var(--muted)] max-w-sm mt-1">
          The database currently has no locks waiting for release or blocking other transactions. Real-time updates will appear here automatically.
        </p>
      </div>
    )
  }

  // Recursive renderer for tree nodes
  const renderNode = (node: LockNode, depth: number, parentKey: string) => {
    const isSelected = selectedPID === node.pid
    const isDeadlocked = deadlockPIDs.has(node.pid)
    const hasChildren = node.children && node.children.length > 0
    const isCollapsed = collapsedPIDs.has(node.pid)
    const severity = getLockSeverity(node.wait_duration_seconds, node.is_root_blocker, isDeadlocked)
    const badgeClass = getSeverityBadgeClass(severity)
    const nodeKey = `${parentKey}-${node.pid}`

    // Search query filter check
    const matchesSearch =
      !searchQuery.trim() ||
      String(node.pid).includes(searchQuery.trim()) ||
      (node.user && node.user.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (node.query && node.query.toLowerCase().includes(searchQuery.toLowerCase()))

    return (
      <div key={nodeKey} className="flex flex-col">
        <div
          onClick={() => onSelectPID(node.pid)}
          className={`group flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-xs cursor-pointer transition-colors ${
            isSelected
              ? 'bg-[var(--active)] border-blue-500/50 shadow-xs'
              : 'border-[var(--border)]/60 hover:bg-[var(--hover)] hover:border-[var(--border)]'
          } ${!matchesSearch && searchQuery ? 'opacity-40' : ''}`}
          style={{ marginLeft: `${depth * 20}px` }}
        >
          {/* Left: Expand toggle + PID + Details */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Collapse / branch indicator */}
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => toggleCollapse(node.pid, e)}
                className="p-0.5 rounded text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <span className="w-3.5 h-3.5 flex items-center justify-center text-[var(--muted)]">
                {depth > 0 ? '└' : '•'}
              </span>
            )}

            {/* Icon */}
            {isDeadlocked ? (
              <ShieldAlert className="w-4 h-4 text-purple-500 shrink-0" />
            ) : node.is_root_blocker ? (
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
            )}

            {/* PID & Tags */}
            <span className="font-mono font-bold text-[var(--fg)] shrink-0">
              PID {node.pid}
            </span>

            {node.is_root_blocker && (
              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0">
                Root Blocker
              </span>
            )}

            {isDeadlocked && (
              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30 shrink-0">
                Deadlock
              </span>
            )}

            {/* Lock Mode */}
            {node.lock_mode && (
              <span className="font-mono text-[10px] text-[var(--muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)] shrink-0">
                {node.lock_mode}
              </span>
            )}

            {/* User / Database */}
            <span className="text-[var(--muted)] truncate shrink-0 max-w-[120px]">
              {node.user ? `${node.user}@${node.database || 'db'}` : node.database || ''}
            </span>

            {/* Query snippet */}
            {node.query && (
              <span className="font-mono text-[11px] text-[var(--muted)] truncate max-w-[200px] hidden md:inline">
                {node.query}
              </span>
            )}
          </div>

          {/* Right: Wait Duration + Kill Button */}
          <div className="flex items-center gap-2 shrink-0">
            {node.wait_duration_seconds > 0 ? (
              <span className={`px-2 py-0.5 text-[11px] font-mono font-medium rounded flex items-center gap-1 ${badgeClass}`}>
                <Clock className="w-3 h-3" />
                {formatWaitDuration(node.wait_duration_seconds)}
              </span>
            ) : (
              <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Granted
              </span>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onKillPID(node.pid)
              }}
              disabled={readOnly}
              className="p-1 rounded text-[var(--muted)] hover:text-red-500 hover:bg-red-500/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title={readOnly ? 'Disabled in Read-Only Mode' : `Terminate PID ${node.pid}`}
            >
              <Skull className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Nested children */}
        {hasChildren && !isCollapsed && (
          <div className="mt-1 space-y-1">
            {node.children.map(child => renderNode(child, depth + 1, nodeKey))}
          </div>
        )}
      </div>
    )
  }

  // Display roots or all nodes
  const displayRoots = rootBlockers.length > 0 ? rootBlockers : allNodes

  return (
    <div className="h-full overflow-y-auto space-y-1 p-2 border border-[var(--border)] rounded-lg bg-[var(--surface)]">
      {displayRoots.map(root => renderNode(root, 0, 'root'))}
    </div>
  )
}
