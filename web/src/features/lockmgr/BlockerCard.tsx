import React, { useState } from 'react'
import {
  Skull,
  Clock,
  Database,
  User,
  Activity,
  Copy,
  Check,
  ShieldAlert,
  ArrowRight,
  Monitor,
  Lock,
} from 'lucide-react'
import {
  formatWaitDuration,
  getLockSeverity,
  getSeverityBadgeClass,
  type LockNode,
} from './lockHelper'

interface BlockerCardProps {
  node: LockNode | null
  isDeadlocked: boolean
  onKill: (pid: number) => void
  onSelectPID?: (pid: number) => void
  readOnly?: boolean
}

export const BlockerCard: React.FC<BlockerCardProps> = ({
  node,
  isDeadlocked,
  onKill,
  onSelectPID,
  readOnly = false,
}) => {
  const [copied, setCopied] = useState(false)

  if (!node) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[var(--muted)] p-6 text-center border border-[var(--border)] rounded-lg bg-[var(--surface)]">
        <Lock className="w-10 h-10 opacity-30 mb-2" />
        <p className="text-sm font-medium text-[var(--fg)]">No Session Selected</p>
        <p className="text-xs mt-1">Select a session from the lock tree to view transaction details, query text, and blocker status.</p>
      </div>
    )
  }

  const severity = getLockSeverity(node.wait_duration_seconds, node.is_root_blocker, isDeadlocked)
  const badgeClass = getSeverityBadgeClass(severity)

  const handleCopyQuery = () => {
    if (!node.query) return
    navigator.clipboard.writeText(node.query)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="h-full flex flex-col border border-[var(--border)] rounded-lg bg-[var(--surface)] overflow-hidden shadow-xs">
      {/* Header */}
      <div className="p-3.5 border-b border-[var(--border)] bg-[var(--bg)] flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-[var(--fg)]">
              PID {node.pid}
            </span>
            {node.is_root_blocker && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                Root Blocker
              </span>
            )}
            {isDeadlocked && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" />
                Deadlock
              </span>
            )}
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${badgeClass}`}>
              {node.granted ? 'Lock Granted' : 'Waiting for Lock'}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs text-[var(--muted)] mt-1.5 flex-wrap">
            {node.user && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {node.user}
              </span>
            )}
            {node.database && (
              <span className="flex items-center gap-1">
                <Database className="w-3 h-3" />
                {node.database}
              </span>
            )}
            {node.client_addr && (
              <span className="flex items-center gap-1">
                <Monitor className="w-3 h-3" />
                {node.client_addr}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onKill(node.pid)}
          disabled={readOnly}
          className="px-2.5 py-1.5 rounded bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-xs flex items-center gap-1.5 transition-colors shadow-xs shrink-0 cursor-pointer"
          title={readOnly ? 'Disabled in Read-Only Mode' : `Terminate session ${node.pid}`}
        >
          <Skull className="w-3.5 h-3.5" />
          Terminate
        </button>
      </div>

      {/* Body / Details */}
      <div className="p-3.5 flex-1 overflow-y-auto space-y-4 text-xs">
        {/* Metric Grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-md bg-[var(--bg)] border border-[var(--border)]">
            <span className="text-[var(--muted)] text-[11px] block">Wait Duration</span>
            <div className="font-mono text-sm font-semibold text-[var(--fg)] mt-0.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-500" />
              {formatWaitDuration(node.wait_duration_seconds)}
            </div>
          </div>
          <div className="p-2.5 rounded-md bg-[var(--bg)] border border-[var(--border)]">
            <span className="text-[var(--muted)] text-[11px] block">Query Running Age</span>
            <div className="font-mono text-sm font-semibold text-[var(--fg)] mt-0.5 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-blue-500" />
              {formatWaitDuration(node.query_age_seconds)}
            </div>
          </div>
        </div>

        {/* Lock Metadata */}
        <div className="space-y-1.5 border border-[var(--border)] rounded-md p-2.5 bg-[var(--bg)]">
          <div className="flex justify-between items-center py-0.5">
            <span className="text-[var(--muted)]">Lock Type</span>
            <span className="font-mono font-medium text-[var(--fg)]">{node.lock_type || 'relation'}</span>
          </div>
          <div className="flex justify-between items-center py-0.5 border-t border-[var(--border)]/50">
            <span className="text-[var(--muted)]">Lock Mode</span>
            <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
              {node.lock_mode || 'Exclusive'}
            </span>
          </div>
          <div className="flex justify-between items-center py-0.5 border-t border-[var(--border)]/50">
            <span className="text-[var(--muted)]">Transaction State</span>
            <span className="font-medium text-[var(--fg)]">{node.transaction_state || 'active'}</span>
          </div>
          {node.application_name && (
            <div className="flex justify-between items-center py-0.5 border-t border-[var(--border)]/50">
              <span className="text-[var(--muted)]">Application</span>
              <span className="text-[var(--fg)]">{node.application_name}</span>
            </div>
          )}
        </div>

        {/* Blocker Links */}
        {node.blocked_by_pid && node.blocked_by_pid > 0 && (
          <div className="p-2.5 rounded-md bg-amber-500/10 border border-amber-500/25 flex items-center justify-between">
            <span className="text-amber-700 dark:text-amber-300 font-medium">Blocked By:</span>
            <button
              type="button"
              onClick={() => onSelectPID?.(node.blocked_by_pid!)}
              className="font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-500/30 flex items-center gap-1 transition-colors cursor-pointer"
            >
              PID {node.blocked_by_pid}
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Children Waiting */}
        {node.children && node.children.length > 0 && (
          <div className="p-2.5 rounded-md bg-[var(--bg)] border border-[var(--border)]">
            <span className="text-[var(--muted)] font-medium block mb-1.5">
              Directly Blocking ({node.children.length} {node.children.length === 1 ? 'session' : 'sessions'}):
            </span>
            <div className="flex flex-wrap gap-1.5">
              {node.children.map(child => (
                <button
                  key={child.pid}
                  type="button"
                  onClick={() => onSelectPID?.(child.pid)}
                  className="font-mono text-[11px] px-2 py-0.5 rounded bg-[var(--hover)] hover:bg-[var(--active)] text-[var(--fg)] border border-[var(--border)] flex items-center gap-1 transition-colors cursor-pointer"
                  title={`Waiting ${formatWaitDuration(child.wait_duration_seconds)}`}
                >
                  PID {child.pid}
                  <span className="text-[10px] text-amber-500">
                    ({formatWaitDuration(child.wait_duration_seconds)})
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Query Text */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[var(--muted)] font-medium">Current SQL Query</span>
            {node.query && (
              <button
                type="button"
                onClick={handleCopyQuery}
                className="text-[11px] text-[var(--muted)] hover:text-[var(--fg)] flex items-center gap-1 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          <pre className="p-2.5 rounded-md bg-[var(--bg)] border border-[var(--border)] font-mono text-[11px] text-[var(--fg)] whitespace-pre-wrap break-all max-h-48 overflow-y-auto leading-relaxed select-text">
            {node.query || '-- [No query text available or session is idle in transaction]'}
          </pre>
        </div>
      </div>
    </div>
  )
}
