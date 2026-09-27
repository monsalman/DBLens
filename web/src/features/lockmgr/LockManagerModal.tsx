import React, { useState, useMemo, useEffect } from 'react'
import {
  X,
  RefreshCw,
  Download,
  Search,
  Radio,
  Clock,
  Lock,
  Users,
  AlertTriangle,
  ShieldAlert,
  Skull,
  Activity,
} from 'lucide-react'
import { useLockManager } from './useLockManager'
import { DeadlockBanner } from './DeadlockBanner'
import { LockDependencyTree } from './LockDependencyTree'
import { BlockerCard } from './BlockerCard'
import { calculateLockMetrics, type LockNode } from './lockHelper'
import type { ConnectionConfig } from '../../lib/api'

interface LockManagerModalProps {
  isOpen: boolean
  onClose: () => void
  connId: string | null
  profiles?: ConnectionConfig[]
}

export const LockManagerModal: React.FC<LockManagerModalProps> = ({
  isOpen,
  onClose,
  connId,
  profiles,
}) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [killTargetPID, setKillTargetPID] = useState<number | null>(null)
  const [forceKill, setForceKill] = useState(false)

  const activeConnection = useMemo(() => {
    return profiles?.find(c => c.id === connId) || null
  }, [profiles, connId])

  const isReadOnly = activeConnection?.readOnly ?? false

  const {
    data,
    loading,
    error,
    live,
    autoRefresh,
    setAutoRefresh,
    selectedPID,
    setSelectedPID,
    selectedNode,
    isTerminating,
    refresh,
    terminateSession,
    exportJSON,
  } = useLockManager({
    connId,
    profiles,
    enabled: isOpen,
    initialAutoRefresh: true,
  })

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (killTargetPID !== null) {
          setKillTargetPID(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, killTargetPID, onClose])

  const metrics = useMemo(() => calculateLockMetrics(data), [data])

  const deadlockPIDs = useMemo(() => {
    const s = new Set<number>()
    for (const dl of data?.deadlocks || []) {
      for (const p of dl.pids) {
        s.add(p)
      }
    }
    return s
  }, [data?.deadlocks])

  const killTargetNode = useMemo<LockNode | null>(() => {
    if (!killTargetPID) return null
    return data?.all_nodes?.find(n => n.pid === killTargetPID) || null
  }, [killTargetPID, data?.all_nodes])

  const handleConfirmKill = async () => {
    if (!killTargetPID) return
    const ok = await terminateSession(killTargetPID, forceKill)
    if (ok) {
      setKillTargetPID(null)
      setForceKill(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-6xl h-[92vh] max-h-[900px] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-500/15 text-blue-500">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-[var(--fg)]">
                  Database Lock Tree & Deadlock Investigator
                </h3>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--hover)] text-[var(--muted)] border border-[var(--border)]">
                  Alt+L
                </span>
                {live ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE SSE
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--hover)] text-[var(--muted)]">
                    POLLING
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--muted)]">
                Inspect lock wait hierarchies, identify root blocking sessions, and resolve circular deadlocks.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Auto refresh toggle */}
            <button
              type="button"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-2.5 py-1 text-xs rounded-md border flex items-center gap-1.5 transition-colors cursor-pointer ${
                autoRefresh
                  ? 'bg-blue-500/15 border-blue-500/30 text-blue-500'
                  : 'bg-[var(--bg)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
              title="Toggle automatic real-time SSE stream"
            >
              <Radio className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Auto-refresh</span>
            </button>

            {/* Manual refresh */}
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="p-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer disabled:opacity-40"
              title="Refresh lock snapshot"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* Export JSON */}
            <button
              type="button"
              onClick={exportJSON}
              disabled={!connId || !data}
              className="px-2.5 py-1 text-xs rounded-md border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
              title="Export lock tree snapshot as JSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-md bg-red-500/15 border border-red-500/30 text-red-500 text-xs flex items-center justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={refresh}
              className="underline hover:text-red-400 font-medium cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col p-5 overflow-hidden gap-4 min-h-0">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 shrink-0">
            <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <span className="text-xs text-[var(--muted)] flex items-center gap-1">
                <Lock className="w-3.5 h-3.5 text-blue-500" /> Total Locks
              </span>
              <div className="text-xl font-bold font-mono text-[var(--fg)] mt-1">
                {metrics.totalLocks}
              </div>
            </div>

            <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <span className="text-xs text-[var(--muted)] flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-amber-500" /> Blocked Sessions
              </span>
              <div className="text-xl font-bold font-mono text-[var(--fg)] mt-1">
                {metrics.blockedSessions}
              </div>
            </div>

            <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <span className="text-xs text-[var(--muted)] flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-orange-500" /> Root Blockers
              </span>
              <div className="text-xl font-bold font-mono text-[var(--fg)] mt-1">
                {metrics.rootBlockerCount}
              </div>
            </div>

            <div className={`p-3 rounded-lg border ${metrics.deadlockCount > 0 ? 'border-red-500/40 bg-red-500/10' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
              <span className="text-xs text-[var(--muted)] flex items-center gap-1">
                <ShieldAlert className={`w-3.5 h-3.5 ${metrics.deadlockCount > 0 ? 'text-red-500' : 'text-purple-500'}`} /> Deadlocks
              </span>
              <div className={`text-xl font-bold font-mono mt-1 ${metrics.deadlockCount > 0 ? 'text-red-500' : 'text-[var(--fg)]'}`}>
                {metrics.deadlockCount}
              </div>
            </div>

            <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] col-span-2 sm:col-span-1">
              <span className="text-xs text-[var(--muted)] flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-cyan-500" /> Max Wait Time
              </span>
              <div className="text-xl font-bold font-mono text-[var(--fg)] mt-1">
                {metrics.maxWaitSeconds > 0 ? `${Math.round(metrics.maxWaitSeconds)}s` : '0s'}
              </div>
            </div>
          </div>

          {/* Deadlock Banner */}
          {data?.deadlocks && data.deadlocks.length > 0 && (
            <DeadlockBanner
              deadlocks={data.deadlocks}
              onSelectPID={pid => setSelectedPID(pid)}
              onKillPID={pid => setKillTargetPID(pid)}
            />
          )}

          {/* Search bar */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                type="text"
                placeholder="Filter by PID, user, query text, or lock mode..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--fg)] placeholder-[var(--muted)] focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--fg)]"
              >
                Clear
              </button>
            )}
          </div>

          {/* Split Pane: Left Tree (60%), Right Detail Card (40%) */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4 min-h-0 overflow-hidden">
            <div className="md:col-span-7 h-full min-h-0 overflow-hidden">
              <LockDependencyTree
                rootBlockers={data?.root_blockers ?? []}
                allNodes={data?.all_nodes ?? []}
                selectedPID={selectedPID}
                deadlockPIDs={deadlockPIDs}
                onSelectPID={pid => setSelectedPID(pid)}
                onKillPID={pid => setKillTargetPID(pid)}
                searchQuery={searchQuery}
                readOnly={isReadOnly}
              />
            </div>

            <div className="md:col-span-5 h-full min-h-0 overflow-hidden">
              <BlockerCard
                node={selectedNode}
                isDeadlocked={selectedPID ? deadlockPIDs.has(selectedPID) : false}
                onKill={pid => setKillTargetPID(pid)}
                onSelectPID={pid => setSelectedPID(pid)}
                readOnly={isReadOnly}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Kill Session Confirmation Dialog */}
      {killTargetPID !== null && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-100">
          <div className="w-full max-w-md rounded-xl border border-red-500/40 bg-[var(--bg)] p-5 shadow-2xl text-[var(--fg)]">
            <div className="flex items-center gap-3 text-red-500 mb-3">
              <div className="p-2 rounded-lg bg-red-500/15">
                <Skull className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-sm sm:text-base">Terminate Session PID {killTargetPID}?</h4>
                <p className="text-xs text-[var(--muted)]">This will immediately terminate the backend transaction.</p>
              </div>
            </div>

            {killTargetNode && (
              <div className="my-3 p-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-xs space-y-1 font-mono">
                <div><span className="text-[var(--muted)]">User:</span> {killTargetNode.user || 'unknown'}</div>
                <div><span className="text-[var(--muted)]">Database:</span> {killTargetNode.database || 'default'}</div>
                <div className="truncate"><span className="text-[var(--muted)]">Query:</span> {killTargetNode.query || 'idle'}</div>
              </div>
            )}

            <div className="flex items-center gap-2 my-3 text-xs">
              <input
                type="checkbox"
                id="forceKillCheck"
                checked={forceKill}
                onChange={e => setForceKill(e.target.checked)}
                className="rounded border-[var(--border)] text-red-600 focus:ring-red-500 cursor-pointer"
              />
              <label htmlFor="forceKillCheck" className="text-[var(--muted)] cursor-pointer select-none">
                Force terminate (harsh termination if cancellation is ignored)
              </label>
            </div>

            <div className="flex justify-end items-center gap-2 mt-4 pt-3 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => setKillTargetPID(null)}
                className="px-3 py-1.5 rounded-md border border-[var(--border)] hover:bg-[var(--hover)] text-xs font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmKill}
                disabled={isTerminating}
                className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
              >
                {isTerminating ? (
                  <Activity className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Skull className="w-3.5 h-3.5" />
                )}
                {isTerminating ? 'Terminating...' : 'Terminate Session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
