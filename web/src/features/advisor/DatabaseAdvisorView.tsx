import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  RefreshCw,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Database,
  HardDrive,
  Layers,
  Zap,
  Play,
  ShieldCheck,
  Clock,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  api,
  type HealthReport,
} from '../../lib/api'
import { useAppStore } from '../../stores/appStore'

interface Props {
  connId: string
}

type AdvisorTab = 'recommendations' | 'tables' | 'indexes'

function quoteIdent(name: string, driver?: string): string {
  if (driver === 'mysql') {
    return '`' + name.replace(/`/g, '``') + '`'
  }
  return '"' + name.replace(/"/g, '""') + '"'
}

function getTableRemediationSql(schema: string, table: string, driver?: string): string {
  const target = schema
    ? `${quoteIdent(schema, driver)}.${quoteIdent(table, driver)}`
    : quoteIdent(table, driver)
  return driver === 'mysql'
    ? `OPTIMIZE TABLE ${target};`
    : `ANALYZE ${target};`
}

function getIndexRemediationSql(schema: string, table: string, index: string, driver?: string): string {
  if (driver === 'mysql') {
    const tableTarget = schema
      ? `${quoteIdent(schema, driver)}.${quoteIdent(table, driver)}`
      : quoteIdent(table, driver)
    return `ALTER TABLE ${tableTarget} DROP INDEX ${quoteIdent(index, driver)};`
  }
  const indexTarget = schema
    ? `${quoteIdent(schema, driver)}.${quoteIdent(index, driver)}`
    : quoteIdent(index, driver)
  return `DROP INDEX CONCURRENTLY ${indexTarget};`
}

export const DatabaseAdvisorView: React.FC<Props> = ({ connId }) => {
  const connections = useAppStore((s) => s.connections)
  const activeConn = useMemo(
    () => connections.find((c) => c.id === connId),
    [connections, connId]
  )

  const [activeTab, setActiveTab] = useState<AdvisorTab>('recommendations')
  const [report, setReport] = useState<HealthReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(0) // 0 = off, seconds

  // Filters
  const [tableSearch, setTableSearch] = useState('')
  const [indexSearch, setIndexSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all')

  // Execution states
  const [executingSql, setExecutingSql] = useState<string | null>(null)
  const [copiedSql, setCopiedSql] = useState<string | null>(null)
  const [notification, setNotification] = useState<{
    type: 'success' | 'error'
    message: string
    details?: string
  } | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showNotification = useCallback((type: 'success' | 'error', message: string, details?: string) => {
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current)
    setNotification({ type, message, details })
    notifTimerRef.current = setTimeout(() => {
      setNotification(null)
    }, 6000)
  }, [])

  const fetchHealth = useCallback(async () => {
    try {
      const data = await api.getHealth(connId, connections)
      setReport(data)
      setError(null)
      setLastUpdated(new Date())
    } catch (err: any) {
      setError(err.message || 'Failed to fetch database health report')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [connId, connections])

  const handleManualRefresh = useCallback(() => {
    setRefreshing(true)
    fetchHealth()
  }, [fetchHealth])

  useEffect(() => {
    let active = true
    const run = async () => {
      try {
        const data = await api.getHealth(connId, connections)
        if (!active) return
        setReport(data)
        setError(null)
        setLastUpdated(new Date())
      } catch (err: any) {
        if (!active) return
        setError(err?.message || 'Failed to fetch database health report')
      } finally {
        if (active) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }
    run()
    return () => {
      active = false
    }
  }, [connId, connections])

  // Auto-refresh timer
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (autoRefreshInterval > 0) {
      timerRef.current = setInterval(() => {
        fetchHealth()
      }, autoRefreshInterval * 1000)
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [autoRefreshInterval, fetchHealth])

  // Execute remediation SQL
  const handleExecuteRemediation = async (sql: string, title?: string) => {
    if (!sql || executingSql) return
    setExecutingSql(sql)
    try {
      const res = await api.executeQuery(connId, sql, connections)
      showNotification(
        'success',
        title ? `Remediation executed: ${title}` : 'Remediation completed successfully',
        `Affected rows: ${res.affectedRows ?? 0} (took ${res.durationMs ?? 0}ms)`
      )
      // Refresh report after execution
      await fetchHealth()
    } catch (err: any) {
      showNotification('error', 'Execution failed', err.message || 'SQL execution error')
    } finally {
      setExecutingSql(null)
    }
  }

  // Copy SQL helper
  const handleCopySql = (sql: string) => {
    navigator.clipboard.writeText(sql)
    setCopiedSql(sql)
    setTimeout(() => {
      setCopiedSql(null)
    }, 2000)
  }

  // Filtered recommendations
  const filteredRecommendations = useMemo(() => {
    if (!report) return []
    return report.recommendations.filter((rec) => {
      if (severityFilter === 'all') return true
      return rec.severity === severityFilter
    })
  }, [report, severityFilter])

  // Filtered tables
  const filteredTables = useMemo(() => {
    if (!report) return []
    const q = tableSearch.toLowerCase().trim()
    if (!q) return report.tables
    return report.tables.filter(
      (t) => t.table.toLowerCase().includes(q) || t.schema.toLowerCase().includes(q)
    )
  }, [report, tableSearch])

  // Filtered unused indexes
  const filteredIndexes = useMemo(() => {
    if (!report) return []
    const q = indexSearch.toLowerCase().trim()
    if (!q) return report.unusedIndexes
    return report.unusedIndexes.filter(
      (idx) =>
        idx.index.toLowerCase().includes(q) ||
        idx.table.toLowerCase().includes(q) ||
        idx.schema.toLowerCase().includes(q)
    )
  }, [report, indexSearch])

  // Cache hit ratio formatting and color
  const cacheHitRatio = report?.cacheHitRatio ?? 100
  const cacheColorClass = useMemo(() => {
    if (cacheHitRatio >= 95) return 'text-emerald-500'
    if (cacheHitRatio >= 80) return 'text-amber-500'
    return 'text-rose-500'
  }, [cacheHitRatio])

  const cacheStatusText = useMemo(() => {
    if (cacheHitRatio >= 95) return 'Optimal (Memory-Served)'
    if (cacheHitRatio >= 80) return 'Fair (Moderate Disk I/O)'
    return 'Poor (High Disk I/O)'
  }, [cacheHitRatio])

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] text-[var(--fg)] overflow-hidden">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight">Database Health & Advisor</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider bg-[var(--hover)] text-[var(--muted)] border border-[var(--border)]">
                {activeConn?.driver || activeConn?.dialect || 'Database'}
              </span>
              {activeConn?.label && (
                <span className="text-xs text-[var(--muted)] font-mono">({activeConn.label})</span>
              )}
            </div>
            <p className="text-[11px] text-[var(--muted)]">
              Cache hit ratios, disk bloat, dead tuples, unused indexes, and 1-click remediation.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          {/* Last refreshed indicator */}
          {lastUpdated && (
            <div className="flex items-center gap-1 text-[11px] text-[var(--muted)] mr-2">
              <Clock className="w-3 h-3" />
              <span>{lastUpdated.toLocaleTimeString()}</span>
            </div>
          )}

          {/* Auto refresh select */}
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] bg-[var(--card)] px-2.5 py-1 rounded border border-[var(--border)]">
            <span className="text-[11px]">Auto:</span>
            <select
              value={autoRefreshInterval}
              onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
              className="bg-transparent text-[11px] text-[var(--fg)] outline-none cursor-pointer"
            >
              <option value={0}>Off</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
          </div>

          {/* Refresh button */}
          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-[var(--hover)] hover:bg-[var(--active)] text-[var(--fg)] border border-[var(--border)] transition-colors disabled:opacity-50"
            title="Refresh Advisor Metrics"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div
          className={`flex items-start justify-between px-4 py-2.5 border-b text-xs transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0 text-rose-500" />
            )}
            <div>
              <span className="font-semibold">{notification.message}</span>
              {notification.details && (
                <span className="ml-2 opacity-80 text-[11px] font-mono">{notification.details}</span>
              )}
            </div>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="text-[var(--muted)] hover:text-[var(--fg)] ml-4"
          >
            &times;
          </button>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="m-6 p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-start gap-3 text-xs">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-500 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-sm">Failed to inspect database health</h3>
            <p className="mt-1 text-[11px] opacity-90">{error}</p>
            <button
              onClick={handleManualRefresh}
              className="mt-3 px-3 py-1 bg-rose-500 text-white rounded text-xs font-medium hover:bg-rose-600 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--muted)]">
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-xs">Analyzing database statistics, storage, and indexes...</p>
        </div>
      )}

      {/* Main Content */}
      {!loading && report && (
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Metric Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Cache Hit Ratio */}
            <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                <span className="font-medium">Cache Hit Ratio</span>
                <Zap className="w-4 h-4 text-amber-500" />
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className={`text-3xl font-bold tracking-tight font-mono ${cacheColorClass}`}>
                  {cacheHitRatio.toFixed(1)}%
                </span>
              </div>
              <div className="mt-2.5">
                <div className="w-full bg-[var(--hover)] h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      cacheHitRatio >= 95
                        ? 'bg-emerald-500'
                        : cacheHitRatio >= 80
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, cacheHitRatio))}%` }}
                  />
                </div>
                <div className="flex justify-between items-center mt-1.5 text-[10px] text-[var(--muted)]">
                  <span>{cacheStatusText}</span>
                  <span>Target: 95%+</span>
                </div>
              </div>
            </div>

            {/* 2. Database Size & Total Tables */}
            <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-xs">
              <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                <span className="font-medium">Database Size</span>
                <Database className="w-4 h-4 text-indigo-500" />
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-bold tracking-tight font-mono text-[var(--fg)]">
                  {report.databaseSize || '0 B'}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--muted)] border-t border-[var(--border)] pt-2">
                <span>Total Tables</span>
                <span className="font-mono font-medium text-[var(--fg)]">{report.totalTables}</span>
              </div>
            </div>

            {/* 3. Storage Bloat & Dead Tuples */}
            <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-xs">
              <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                <span className="font-medium">Dead Tuples / Free Space</span>
                <Layers className="w-4 h-4 text-rose-500" />
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span
                  className={`text-3xl font-bold tracking-tight font-mono ${
                    report.deadTuples > 1000
                      ? 'text-rose-500'
                      : report.deadTuples > 0
                      ? 'text-amber-500'
                      : 'text-emerald-500'
                  }`}
                >
                  {report.deadTuples.toLocaleString()}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--muted)] border-t border-[var(--border)] pt-2">
                <span>Fragmentation State</span>
                <span className="text-[10px] font-medium">
                  {report.deadTuples === 0 ? 'Clean' : 'Needs Vacuum / Reclaim'}
                </span>
              </div>
            </div>

            {/* 4. Unused Indexes */}
            <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-xs">
              <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                <span className="font-medium">Unused Indexes (0 Scans)</span>
                <HardDrive className="w-4 h-4 text-blue-500" />
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span
                  className={`text-3xl font-bold tracking-tight font-mono ${
                    report.unusedIndexes.length > 0 ? 'text-amber-500' : 'text-emerald-500'
                  }`}
                >
                  {report.unusedIndexes.length}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--muted)] border-t border-[var(--border)] pt-2">
                <span>Total Indexes</span>
                <span className="font-mono font-medium text-[var(--fg)]">{report.totalIndexes}</span>
              </div>
            </div>
          </div>

          {/* Sub Navigation Tabs */}
          <div className="flex items-center justify-between border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('recommendations')}
                className={`flex items-center gap-2 py-2.5 px-3 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'recommendations'
                    ? 'border-indigo-500 text-indigo-500 font-semibold'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Recommendations</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    report.recommendations.length > 0
                      ? 'bg-indigo-500/15 text-indigo-500'
                      : 'bg-[var(--hover)] text-[var(--muted)]'
                  }`}
                >
                  {report.recommendations.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('tables')}
                className={`flex items-center gap-2 py-2.5 px-3 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'tables'
                    ? 'border-indigo-500 text-indigo-500 font-semibold'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                <span>Table Storage & Bloat</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono bg-[var(--hover)] text-[var(--muted)]">
                  {report.tables.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('indexes')}
                className={`flex items-center gap-2 py-2.5 px-3 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'indexes'
                    ? 'border-indigo-500 text-indigo-500 font-semibold'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>Unused Indexes</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    report.unusedIndexes.length > 0
                      ? 'bg-amber-500/15 text-amber-500'
                      : 'bg-[var(--hover)] text-[var(--muted)]'
                  }`}
                >
                  {report.unusedIndexes.length}
                </span>
              </button>
            </div>

            {/* Severity Filter for Recommendations */}
            {activeTab === 'recommendations' && (
              <div className="flex items-center gap-1 mb-1">
                {(['all', 'critical', 'warning', 'info'] as const).map((sev) => (
                  <button
                    key={sev}
                    onClick={() => setSeverityFilter(sev)}
                    className={`px-2 py-0.5 text-[11px] rounded capitalize transition-colors ${
                      severityFilter === sev
                        ? 'bg-[var(--active)] text-[var(--fg)] font-medium'
                        : 'text-[var(--muted)] hover:text-[var(--fg)]'
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* TAB 1: Recommendations */}
          {activeTab === 'recommendations' && (
            <div className="space-y-4">
              {filteredRecommendations.length === 0 ? (
                <div className="p-8 rounded-xl bg-[var(--card)] border border-[var(--border)] flex flex-col items-center justify-center text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-3" />
                  <h3 className="text-sm font-semibold">Database is Running in Top Condition</h3>
                  <p className="text-xs text-[var(--muted)] mt-1 max-w-md">
                    No active critical performance issues or bloated objects were detected. Your cache hit
                    ratio is healthy and table stats are fresh.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {filteredRecommendations.map((rec) => {
                    const isExecuting = executingSql === rec.sql
                    const isCopied = copiedSql === rec.sql

                    const badgeStyles = {
                      critical: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
                      warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                      info: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
                    }[rec.severity]

                    return (
                      <div
                        key={rec.id}
                        className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] flex flex-col justify-between gap-4 shadow-xs hover:border-[var(--muted)] transition-colors"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${badgeStyles}`}
                              >
                                {rec.severity}
                              </span>
                              <span className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-mono">
                                {rec.category}
                              </span>
                            </div>
                          </div>

                          <h3 className="text-sm font-semibold text-[var(--fg)]">{rec.title}</h3>
                          <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">
                            {rec.description}
                          </p>

                          {/* SQL Preview Box */}
                          <div className="mt-3 relative rounded-lg bg-[var(--bg)] border border-[var(--border)] p-3 font-mono text-xs text-indigo-400 dark:text-indigo-300 overflow-x-auto select-all">
                            <code>{rec.sql}</code>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
                          <button
                            onClick={() => handleCopySql(rec.sql)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border border-[var(--border)] transition-colors"
                            title="Copy SQL to Clipboard"
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy SQL</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => handleExecuteRemediation(rec.sql, rec.title)}
                            disabled={isExecuting}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded bg-indigo-600 hover:bg-indigo-700 text-white transition-colors disabled:opacity-50"
                            title="Run Remediation Command"
                          >
                            {isExecuting ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>Executing...</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5 fill-current" />
                                <span>Run Remediation</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Table Storage & Bloat */}
          {activeTab === 'tables' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    type="text"
                    placeholder="Search table or schema..."
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--card)] border border-[var(--border)] rounded-lg outline-none text-[var(--fg)] placeholder-[var(--muted)] focus:border-indigo-500"
                  />
                </div>
                <div className="text-xs text-[var(--muted)]">
                  Showing {filteredTables.length} of {report.tables.length} tables
                </div>
              </div>

              <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card)] shadow-xs">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] font-medium select-none">
                      <th className="py-2.5 px-3 w-28">Schema</th>
                      <th className="py-2.5 px-3">Table Name</th>
                      <th className="py-2.5 px-3 w-24 text-right">Total Size</th>
                      <th className="py-2.5 px-3 w-24 text-right">Data Size</th>
                      <th className="py-2.5 px-3 w-24 text-right">Index Size</th>
                      <th className="py-2.5 px-3 w-28 text-right">Rows</th>
                      <th className="py-2.5 px-3 w-28 text-right">Dead Tuples</th>
                      <th className="py-2.5 px-3 w-40 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {filteredTables.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-[var(--muted)]">
                          No tables found matching "{tableSearch}"
                        </td>
                      </tr>
                    ) : (
                      filteredTables.map((tbl) => {
                        const sqlToRun =
                          tbl.remediationSql ||
                          getTableRemediationSql(tbl.schema, tbl.table, activeConn?.driver)
                        const isRunning = executingSql === sqlToRun

                        return (
                          <tr
                            key={`${tbl.schema}.${tbl.table}`}
                            className="hover:bg-[var(--hover)] transition-colors group"
                          >
                            <td className="py-2.5 px-3 font-mono text-[11px] text-[var(--muted)]">
                              {tbl.schema || 'default'}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-[var(--fg)]">
                              {tbl.table}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-[11px]">
                              {tbl.totalSize}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-[11px] text-[var(--muted)]">
                              {tbl.dataSize}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-[11px] text-[var(--muted)]">
                              {tbl.indexSize}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-[11px]">
                              {tbl.rowCount.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-[11px]">
                              <span
                                className={
                                  tbl.deadTuples > 1000
                                    ? 'text-rose-500 font-semibold'
                                    : tbl.deadTuples > 0
                                    ? 'text-amber-500'
                                    : 'text-[var(--muted)]'
                                }
                              >
                                {tbl.deadTuples.toLocaleString()}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-center">
                              <button
                                onClick={() =>
                                  handleExecuteRemediation(
                                    sqlToRun,
                                    `Vacuum / Optimize ${tbl.schema}.${tbl.table}`
                                  )
                                }
                                disabled={isRunning}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded bg-[var(--hover)] hover:bg-indigo-600 hover:text-white text-[var(--fg)] border border-[var(--border)] transition-colors disabled:opacity-50"
                                title={`Execute: ${sqlToRun}`}
                              >
                                {isRunning ? (
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Zap className="w-3 h-3 text-amber-500 group-hover:text-white" />
                                )}
                                <span>Vacuum / Optimize</span>
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: Unused Indexes */}
          {activeTab === 'indexes' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    type="text"
                    placeholder="Search index or table..."
                    value={indexSearch}
                    onChange={(e) => setIndexSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--card)] border border-[var(--border)] rounded-lg outline-none text-[var(--fg)] placeholder-[var(--muted)] focus:border-indigo-500"
                  />
                </div>
                <div className="text-xs text-[var(--muted)]">
                  Showing {filteredIndexes.length} of {report.unusedIndexes.length} unused indexes
                </div>
              </div>

              {filteredIndexes.length === 0 ? (
                <div className="p-8 rounded-xl bg-[var(--card)] border border-[var(--border)] flex flex-col items-center justify-center text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-3" />
                  <h3 className="text-sm font-semibold">No Unused Indexes Found</h3>
                  <p className="text-xs text-[var(--muted)] mt-1 max-w-md">
                    All created indexes have been utilized by queries or no redundant indexes were detected.
                  </p>
                </div>
              ) : (
                <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card)] shadow-xs">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] font-medium select-none">
                        <th className="py-2.5 px-3">Index Name</th>
                        <th className="py-2.5 px-3 w-36">Table</th>
                        <th className="py-2.5 px-3 w-28">Schema</th>
                        <th className="py-2.5 px-3 w-28 text-right">Size</th>
                        <th className="py-2.5 px-3 w-24 text-center">Scans</th>
                        <th className="py-2.5 px-3 w-32 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {filteredIndexes.map((idx) => {
                        const sqlToRun =
                          idx.remediationSql ||
                          getIndexRemediationSql(idx.schema, idx.table, idx.index, activeConn?.driver)
                        const isRunning = executingSql === sqlToRun

                        return (
                          <tr
                            key={`${idx.schema}.${idx.table}.${idx.index}`}
                            className="hover:bg-[var(--hover)] transition-colors group"
                          >
                            <td className="py-2.5 px-3 font-mono font-medium text-indigo-400 dark:text-indigo-300">
                              {idx.index}
                            </td>
                            <td className="py-2.5 px-3 text-[var(--fg)] font-medium">
                              {idx.table}
                            </td>
                            <td className="py-2.5 px-3 text-[var(--muted)] font-mono text-[11px]">
                              {idx.schema || 'default'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-[11px] text-[var(--muted)]">
                              {idx.size || 'N/A'}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-rose-500/10 text-rose-500 border border-rose-500/20">
                                {idx.scans} scans
                              </span>
                            </td>
                            <td className="py-2 px-3 text-center">
                              <button
                                onClick={() =>
                                  handleExecuteRemediation(
                                    sqlToRun,
                                    `Drop Index ${idx.index}`
                                  )
                                }
                                disabled={isRunning}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded bg-rose-500/10 hover:bg-rose-600 hover:text-white text-rose-400 border border-rose-500/20 transition-colors disabled:opacity-50"
                                title={`Execute: ${sqlToRun}`}
                              >
                                {isRunning ? (
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3 h-3" />
                                )}
                                <span>Drop Index</span>
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
