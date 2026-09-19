import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Activity,
  RefreshCw,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  Copy,
  Check,
  Clock,
  Users,
  Flame,
  Trash2,
  Terminal,
  Info,
  ShieldAlert,
} from 'lucide-react'
import { api, type ProcessInfo } from '../../lib/api'
import { useAppStore } from '../../stores/appStore'

interface Props {
  connId: string
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s'
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const remSecs = seconds % 60
  if (mins < 60) return `${mins}m ${remSecs}s`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  return `${hours}h ${remMins}m`
}

function getStateBadgeClass(state: string): string {
  const lower = (state || '').toLowerCase()
  if (lower === 'active' || lower === 'executing' || lower === 'running') {
    return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
  }
  if (lower.includes('idle') || lower === 'sleep') {
    return 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30'
  }
  if (lower.includes('lock') || lower.includes('wait') || lower.includes('blocked')) {
    return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
  }
  return 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30'
}

export const ProcessMonitorView: React.FC<Props> = ({ connId }) => {
  const connections = useAppStore((s) => s.connections)
  const activeConn = useMemo(
    () => connections.find((c) => c.id === connId),
    [connections, connId]
  )

  const isSQLite = useMemo(() => {
    if (!activeConn) return false
    const d = (activeConn.dialect || activeConn.driver || '').toLowerCase()
    const dsn = (activeConn.dsn || '').toLowerCase()
    return (
      d === 'sqlite' ||
      dsn.startsWith('sqlite://') ||
      dsn.startsWith('file:') ||
      dsn.endsWith('.db') ||
      dsn.endsWith('.sqlite') ||
      dsn.endsWith('.sqlite3')
    )
  }, [activeConn])

  const isReadOnly = activeConn?.readOnly ?? false

  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [autoRefreshSec, setAutoRefreshSec] = useState<number>(5)

  // Modals
  const [selectedProcess, setSelectedProcess] = useState<ProcessInfo | null>(null)
  const [processToKill, setProcessToKill] = useState<ProcessInfo | null>(null)
  const [isKilling, setIsKilling] = useState(false)
  const [killError, setKillError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)
  const [copiedQuery, setCopiedQuery] = useState(false)

  const reqSeqRef = useRef(0)

  const openKillModal = (process: ProcessInfo) => {
    setKillError(null)
    setProcessToKill(process)
  }

  const closeKillModal = useCallback(() => {
    if (isKilling) return
    setProcessToKill(null)
    setKillError(null)
  }, [isKilling])

  const fetchProcesses = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setIsRefreshing(true)
      }
      const seq = ++reqSeqRef.current
      try {
        const data = await api.getProcesses(connId, connections)
        if (seq !== reqSeqRef.current) return
        setProcesses(data)
        setError(null)
        setLastUpdated(new Date())
      } catch (err: any) {
        if (seq !== reqSeqRef.current) return
        setError(err?.message || 'Failed to fetch process list')
      } finally {
        if (seq === reqSeqRef.current) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    },
    [connId, connections]
  )

  // Initial load
  useEffect(() => {
    fetchProcesses()
  }, [fetchProcesses])

  // Auto-refresh timer via chained timeout
  useEffect(() => {
    if (autoRefreshSec <= 0) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let active = true

    const scheduleNext = () => {
      if (!active) return
      timer = setTimeout(async () => {
        try {
          await fetchProcesses()
        } finally {
          if (active) {
            scheduleNext()
          }
        }
      }, autoRefreshSec * 1000)
    }

    scheduleNext()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [autoRefreshSec, fetchProcesses])

  // Escape key handler to close modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (processToKill && !isKilling) {
          closeKillModal()
        } else if (selectedProcess) {
          setSelectedProcess(null)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [processToKill, isKilling, selectedProcess, closeKillModal])

  // Clear action alert after 5s
  useEffect(() => {
    if (!actionMessage) return
    const timer = setTimeout(() => {
      setActionMessage(null)
    }, 5000)
    return () => clearInterval(timer)
  }, [actionMessage])

  // Terminate handler
  const handleConfirmKill = async () => {
    if (!processToKill) return
    setIsKilling(true)
    setKillError(null)
    try {
      const res = await api.killProcess(connId, processToKill.id, connections, isReadOnly)
      setActionMessage({
        type: 'success',
        text: res?.message || `Terminated process #${processToKill.id}`,
      })
      setProcessToKill(null)
      setKillError(null)
      if (selectedProcess?.id === processToKill.id) {
        setSelectedProcess(null)
      }
      await fetchProcesses(true)
    } catch (err: any) {
      setKillError(err?.message || `Failed to terminate process #${processToKill.id}`)
    } finally {
      setIsKilling(false)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedQuery(true)
    setTimeout(() => setCopiedQuery(false), 2000)
  }

  // Filtered list & metrics
  const filteredProcesses = useMemo(() => {
    return processes.filter((p) => {
      if (activeOnly) {
        const stateLower = (p.state || '').toLowerCase()
        const isAct =
          stateLower === 'active' ||
          stateLower === 'running' ||
          stateLower === 'executing' ||
          (p.query && p.query.trim().length > 0 && !stateLower.includes('idle'))
        if (!isAct) return false
      }

      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (
        p.id.toLowerCase().includes(q) ||
        p.user.toLowerCase().includes(q) ||
        p.database.toLowerCase().includes(q) ||
        p.host.toLowerCase().includes(q) ||
        p.state.toLowerCase().includes(q) ||
        p.query.toLowerCase().includes(q) ||
        (p.command && p.command.toLowerCase().includes(q))
      )
    })
  }, [processes, activeOnly, searchQuery])

  const totalConnections = processes.length
  const activeQueries = useMemo(() => {
    return processes.filter((p) => {
      const st = (p.state || '').toLowerCase()
      return (
        st === 'active' ||
        st === 'running' ||
        st === 'executing' ||
        (p.query && p.query.trim().length > 0 && !st.includes('idle'))
      )
    }).length
  }, [processes])

  const longestDuration = useMemo(() => {
    return processes.reduce((max, p) => Math.max(max, p.time || 0), 0)
  }, [processes])

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 gap-3">
        <div className="flex items-center gap-2.5">
          <Activity className="w-4 h-4 text-emerald-500 animate-pulse" />
          <h2 className="text-sm font-semibold tracking-tight">Process Activity & Query Killer</h2>
          {lastUpdated && (
            <span className="text-[11px] text-[var(--muted)] font-mono ml-2 hidden sm:inline">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Action Controls: Auto-refresh & Manual Refresh */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] px-2 py-1 rounded-md">
            <Clock className="w-3.5 h-3.5" />
            <span className="text-[11px]">Auto:</span>
            <select
              value={autoRefreshSec}
              onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
              className="bg-transparent text-[11px] font-medium text-[var(--fg)] focus:outline-none cursor-pointer"
            >
              <option value={0}>Off</option>
              <option value={2}>2s</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => fetchProcesses(true)}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-[var(--bg)] hover:bg-[var(--hover)] border border-[var(--border)] rounded-md transition-colors disabled:opacity-50 cursor-pointer"
            title="Refresh process list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-500' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Action Notifications / Banner */}
      {actionMessage && (
        <div
          className={`flex items-center justify-between px-4 py-2 text-xs border-b ${
            actionMessage.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
              : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="p-0.5 hover:opacity-75"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* SQLite Warning Banner */}
      {isSQLite && (
        <div className="flex items-start gap-2.5 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
          <div className="flex-1 leading-relaxed">
            <span className="font-semibold">SQLite In-Process Database:</span> SQLite operates
            as an embedded engine within the DBLens application. It does not run background
            server daemon processes or remote client connections. Process termination is disabled.
          </div>
        </div>
      )}

      {/* Read-only Warning Banner if applicable */}
      {isReadOnly && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-blue-500/10 border-b border-blue-500/20 text-blue-700 dark:text-blue-300 text-xs">
          <ShieldAlert className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span>Connection is configured as <strong>Read-Only</strong>. Process termination is restricted.</span>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 shrink-0">
        <div className="flex items-center gap-3 p-3 bg-[var(--surface)] border border-[var(--border)] rounded-lg">
          <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-500">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
              Active Queries
            </div>
            <div className="text-xl font-bold font-mono tracking-tight">{activeQueries}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 bg-[var(--surface)] border border-[var(--border)] rounded-lg">
          <div className="p-2 rounded-md bg-blue-500/10 text-blue-500">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
              Total Connections
            </div>
            <div className="text-xl font-bold font-mono tracking-tight">{totalConnections}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 bg-[var(--surface)] border border-[var(--border)] rounded-lg">
          <div className="p-2 rounded-md bg-amber-500/10 text-amber-500">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
              Longest Duration
            </div>
            <div className="text-xl font-bold font-mono tracking-tight">
              {formatDuration(longestDuration)}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between px-4 pb-3 gap-2 shrink-0">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by query, user, db, state, or ID..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-[var(--surface)] border border-[var(--border)] rounded-md focus:outline-none focus:border-emerald-500 text-[var(--fg)] placeholder-[var(--muted)]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--fg)]"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setActiveOnly((prev) => !prev)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
              activeOnly
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 font-semibold'
                : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)] border-[var(--border)]'
            }`}
          >
            Active Only
          </button>
        </div>

        <div className="text-xs text-[var(--muted)] font-mono">
          Showing {filteredProcesses.length} of {processes.length} processes
        </div>
      </div>

      {/* Table Section */}
      <div className="flex-1 overflow-auto border-t border-[var(--border)] bg-[var(--bg)]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-48 text-[var(--muted)] gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-emerald-500" />
            <span className="text-xs">Loading active processes...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-48 text-rose-500 gap-2 p-4 text-center">
            <AlertTriangle className="w-6 h-6" />
            <p className="text-xs font-medium">{error}</p>
            <button
              onClick={() => fetchProcesses(true)}
              className="mt-2 px-3 py-1 text-xs bg-[var(--surface)] hover:bg-[var(--hover)] border border-[var(--border)] rounded text-[var(--fg)]"
            >
              Retry
            </button>
          </div>
        ) : filteredProcesses.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-[var(--muted)] gap-2">
            <Terminal className="w-6 h-6 opacity-40" />
            <p className="text-xs">No matching processes found.</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] font-medium select-none sticky top-0 z-10">
                <th className="py-2 px-3 w-16">ID</th>
                <th className="py-2 px-3 w-28">User</th>
                <th className="py-2 px-3 w-28">Database</th>
                <th className="py-2 px-3 w-36">Host</th>
                <th className="py-2 px-3 w-24">Duration</th>
                <th className="py-2 px-3 w-28">State</th>
                <th className="py-2 px-3">Current Query</th>
                <th className="py-2 px-3 w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] font-mono">
              {filteredProcesses.map((p) => {
                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-[var(--hover)] transition-colors group cursor-pointer ${
                      selectedProcess?.id === p.id ? 'bg-[var(--active)]' : ''
                    }`}
                    onClick={() => setSelectedProcess(p)}
                  >
                    <td className="py-2 px-3 font-semibold text-[var(--fg)]">{p.id}</td>
                    <td className="py-2 px-3 text-[var(--fg)] truncate max-w-[7rem]">
                      {p.user || '—'}
                    </td>
                    <td className="py-2 px-3 text-[var(--fg)] truncate max-w-[7rem]">
                      {p.database || '—'}
                    </td>
                    <td className="py-2 px-3 text-[var(--muted)] truncate max-w-[9rem]">
                      {p.host || 'local'}
                    </td>
                    <td className="py-2 px-3 font-medium text-[var(--fg)] whitespace-nowrap">
                      <span className={p.time > 30 ? 'text-amber-500 font-bold' : ''}>
                        {formatDuration(p.time)}
                      </span>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-sans border font-medium ${getStateBadgeClass(
                          p.state
                        )}`}
                      >
                        {p.state || 'idle'}
                      </span>
                    </td>
                    <td className="py-2 px-3 max-w-md font-sans">
                      {p.query ? (
                        <span
                          className="font-mono text-[11px] truncate block text-[var(--fg)]"
                          title={p.query}
                        >
                          {p.query}
                        </span>
                      ) : (
                        <span className="text-[var(--muted)] italic text-[11px]">
                          {p.command ? `<${p.command}>` : '<idle>'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {!isSQLite && (
                        <button
                          type="button"
                          onClick={() => openKillModal(p)}
                          disabled={isReadOnly}
                          title={
                            isReadOnly
                              ? 'Connection is read-only'
                              : `Terminate process #${p.id}`
                          }
                          className="px-2 py-1 text-[11px] font-sans text-rose-500 hover:text-white hover:bg-rose-500 rounded border border-rose-500/30 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-rose-500 cursor-pointer"
                        >
                          Kill
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Query Detail Modal */}
      {selectedProcess && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setSelectedProcess(null)}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl max-w-2xl w-full flex flex-col max-h-[85vh] overflow-hidden text-[var(--fg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg)]">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-500" />
                <h3 className="text-sm font-semibold">
                  Process Details: #{selectedProcess.id}
                </h3>
                <span
                  className={`ml-2 px-2 py-0.5 rounded text-[10px] border font-medium ${getStateBadgeClass(
                    selectedProcess.state
                  )}`}
                >
                  {selectedProcess.state}
                </span>
              </div>
              <button
                onClick={() => setSelectedProcess(null)}
                className="p-1 text-[var(--muted)] hover:text-[var(--fg)] rounded hover:bg-[var(--hover)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto">
              {/* Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-[var(--bg)] p-3 rounded-md border border-[var(--border)] font-mono">
                <div>
                  <span className="text-[var(--muted)] block text-[10px] uppercase font-sans">User</span>
                  <span className="font-semibold">{selectedProcess.user || '—'}</span>
                </div>
                <div>
                  <span className="text-[var(--muted)] block text-[10px] uppercase font-sans">Database</span>
                  <span className="font-semibold">{selectedProcess.database || '—'}</span>
                </div>
                <div>
                  <span className="text-[var(--muted)] block text-[10px] uppercase font-sans">Host</span>
                  <span className="font-semibold truncate block" title={selectedProcess.host}>
                    {selectedProcess.host || 'local'}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--muted)] block text-[10px] uppercase font-sans">Active Duration</span>
                  <span className="font-semibold text-emerald-500">
                    {formatDuration(selectedProcess.time)} ({selectedProcess.time}s)
                  </span>
                </div>
              </div>

              {/* SQL Statement Box */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
                    Query Text
                  </span>
                  {selectedProcess.query && (
                    <button
                      onClick={() => handleCopy(selectedProcess.query)}
                      className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--fg)] px-2 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] transition-colors cursor-pointer"
                    >
                      {copiedQuery ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span className="text-emerald-500 font-medium">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy SQL</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div className="p-3 bg-[var(--bg)] border border-[var(--border)] rounded-md font-mono text-xs overflow-x-auto max-h-64 whitespace-pre-wrap select-text leading-relaxed">
                  {selectedProcess.query || (
                    <span className="text-[var(--muted)] italic">
                      No active query statement executing on this process.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--bg)]">
              <div className="text-xs text-[var(--muted)]">
                {selectedProcess.command && `Command: ${selectedProcess.command}`}
              </div>
              <div className="flex items-center gap-2">
                {!isSQLite && (
                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => {
                      openKillModal(selectedProcess)
                      setSelectedProcess(null)
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-rose-500 hover:text-white hover:bg-rose-500 rounded border border-rose-500/40 transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    Kill Process
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedProcess(null)}
                  className="px-3 py-1.5 text-xs font-medium bg-[var(--surface)] hover:bg-[var(--hover)] border border-[var(--border)] rounded transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Terminate Process Confirmation Modal */}
      {processToKill && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={closeKillModal}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl max-w-md w-full overflow-hidden text-[var(--fg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)] bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 text-rose-500" />
                <h3 className="text-sm font-semibold">Terminate Process #{processToKill.id}?</h3>
              </div>
              <button
                type="button"
                onClick={closeKillModal}
                disabled={isKilling}
                className="p-1 text-[var(--muted)] hover:text-[var(--fg)] rounded hover:bg-rose-500/15 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
              {killError && (
                <div className="flex items-start gap-2 p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-tight">{killError}</span>
                </div>
              )}

              <p className="text-[var(--muted)]">
                Are you sure you want to terminate this connection? Any uncommitted transaction
                on this session will be rolled back immediately.
              </p>

              <div className="bg-[var(--bg)] p-2.5 rounded border border-[var(--border)] space-y-1 font-mono text-[11px]">
                <div>
                  <span className="text-[var(--muted)]">User: </span>
                  {processToKill.user || '—'}
                </div>
                <div>
                  <span className="text-[var(--muted)]">Database: </span>
                  {processToKill.database || '—'}
                </div>
                <div>
                  <span className="text-[var(--muted)]">Duration: </span>
                  {formatDuration(processToKill.time)}
                </div>
                {processToKill.query && (
                  <div className="pt-1">
                    <span className="text-[var(--muted)] block mb-0.5">Query:</span>
                    <div className="truncate text-[10px] text-[var(--fg)] max-h-16 overflow-hidden">
                      {processToKill.query}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border)] bg-[var(--bg)]">
              <button
                type="button"
                onClick={closeKillModal}
                disabled={isKilling}
                className="px-3 py-1.5 text-xs font-medium bg-[var(--surface)] hover:bg-[var(--hover)] border border-[var(--border)] rounded transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmKill}
                disabled={isKilling}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 rounded transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isKilling ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Terminating...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Terminate Process</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
