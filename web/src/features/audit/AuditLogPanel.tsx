import React, { useEffect, useState, useCallback } from 'react'
import { ShieldCheck, Download, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { api } from '../../lib/api'
import type { AuditEntry } from '../../lib/api'

const QUERY_TYPES = ['ALL', 'SELECT', 'DML', 'DDL', 'EXPORT', 'OTHER']

const QT_BADGE: Record<string, string> = {
  DDL: 'bg-red-500/15 text-red-500 border-red-500/30',
  DML: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
  SELECT: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30',
  EXPORT: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  OTHER: 'bg-[var(--surface)] text-[var(--muted)] border-[var(--border)]',
}

export const AuditLogPanel: React.FC = () => {
  const isOpen = useAppStore((s) => s.isAuditLogOpen)
  const setIsAuditLogOpen = useAppStore((s) => s.setIsAuditLogOpen)
  const connections = useAppStore((s) => s.connections)

  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Filters
  const [connId, setConnId] = useState('')
  const [queryType, setQueryType] = useState('ALL')
  const [actorIp, setActorIp] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [limit, setLimit] = useState('200')

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listAuditLog({ connId, queryType: queryType === 'ALL' ? '' : queryType, actorIp, from, to, limit: Number(limit) })
      setEntries(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [connId, queryType, actorIp, from, to, limit])

  useEffect(() => {
    if (isOpen) fetchEntries()
  }, [isOpen, fetchEntries])

  const handleVerify = async () => {
    try {
      const res = await api.verifyAuditChain()
      if (res.ok) {
        showToast('✅ Chain intact — no tampering detected', true)
      } else {
        showToast(`❌ ${res.tampered_lines?.length ?? 0} tampered entries detected at lines: ${res.tampered_lines?.join(', ')}`, false)
      }
    } catch {
      showToast('❌ Verification failed', false)
    }
  }

  const handleExportCSV = () => {
    const params = new URLSearchParams()
    if (connId) params.set('conn_id', connId)
    if (queryType !== 'ALL') params.set('query_type', queryType)
    if (actorIp) params.set('actor_ip', actorIp)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    window.open(`/api/audit/export.csv?${params.toString()}`, '_blank')
  }

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 5000)
  }

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-6xl h-[90vh] flex flex-col bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--surface)]/40 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-red-500" />
            <span className="font-semibold text-sm">Audit Log</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/20 font-mono">COMPLIANCE</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleVerify} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-[var(--border)] hover:bg-[var(--surface)] transition-colors">
              <ShieldCheck className="w-3.5 h-3.5" /> Verify Chain
            </button>
            <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-[var(--border)] hover:bg-[var(--surface)] transition-colors">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <button onClick={() => setIsAuditLogOpen(false)} className="text-[var(--muted)] hover:text-[var(--fg)] text-lg leading-none px-1">×</button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface)]/20 shrink-0">
          <select value={connId} onChange={e => setConnId(e.target.value)}
            className="bg-[var(--surface)] text-xs text-[var(--fg)] border border-[var(--border)] rounded px-2 py-1 outline-none">
            <option value="">All Connections</option>
            {connections.map(c => <option key={c.id} value={c.id}>{c.label || c.id}</option>)}
          </select>
          <select value={queryType} onChange={e => setQueryType(e.target.value)}
            className="bg-[var(--surface)] text-xs text-[var(--fg)] border border-[var(--border)] rounded px-2 py-1 outline-none">
            {QUERY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={actorIp} onChange={e => setActorIp(e.target.value)} placeholder="Actor IP"
            className="bg-[var(--surface)] text-xs text-[var(--fg)] border border-[var(--border)] rounded px-2 py-1 outline-none w-32" />
          <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value ? new Date(e.target.value).toISOString() : '')}
            className="bg-[var(--surface)] text-xs text-[var(--fg)] border border-[var(--border)] rounded px-2 py-1 outline-none" />
          <span className="text-xs text-[var(--muted)]">→</span>
          <input type="datetime-local" value={to} onChange={e => setTo(e.target.value ? new Date(e.target.value).toISOString() : '')}
            className="bg-[var(--surface)] text-xs text-[var(--fg)] border border-[var(--border)] rounded px-2 py-1 outline-none" />
          <select value={limit} onChange={e => setLimit(e.target.value)}
            className="bg-[var(--surface)] text-xs text-[var(--fg)] border border-[var(--border)] rounded px-2 py-1 outline-none">
            {['50','100','200','500','1000'].map(v => <option key={v} value={v}>{v} rows</option>)}
          </select>
          <button onClick={fetchEntries} className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <span className="text-xs text-[var(--muted)] ml-auto">{entries.length} entries</span>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-[var(--surface)] z-10">
              <tr className="border-b border-[var(--border)]">
                <th className="text-left px-3 py-2 text-[var(--muted)] font-semibold w-6"></th>
                <th className="text-left px-3 py-2 text-[var(--muted)] font-semibold">Timestamp</th>
                <th className="text-left px-3 py-2 text-[var(--muted)] font-semibold">Connection</th>
                <th className="text-left px-3 py-2 text-[var(--muted)] font-semibold">DB</th>
                <th className="text-left px-3 py-2 text-[var(--muted)] font-semibold">Type</th>
                <th className="text-left px-3 py-2 text-[var(--muted)] font-semibold">Duration</th>
                <th className="text-left px-3 py-2 text-[var(--muted)] font-semibold">Rows</th>
                <th className="text-left px-3 py-2 text-[var(--muted)] font-semibold">Error</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr><td colSpan={8} className="text-center text-[var(--muted)] py-12">No audit entries found</td></tr>
              )}
              {entries.map(e => {
                const isExp = expanded.has(e.id)
                const connLabel = connections.find(c => c.id === e.conn_id)?.label || e.conn_id || '—'
                return (
                  <React.Fragment key={e.id}>
                    <tr onClick={() => toggleExpand(e.id)} className="border-b border-[var(--border)]/50 hover:bg-[var(--surface)]/60 cursor-pointer transition-colors">
                      <td className="px-3 py-1.5 text-[var(--muted)]">
                        {isExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[var(--muted)] whitespace-nowrap">
                        {new Date(e.timestamp).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 truncate max-w-[120px]">{connLabel}</td>
                      <td className="px-3 py-1.5 font-mono text-[var(--muted)]">{e.db_name || '—'}</td>
                      <td className="px-3 py-1.5">
                        <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold ${QT_BADGE[e.query_type] || QT_BADGE.OTHER}`}>
                          {e.query_type}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[var(--muted)]">{e.duration_ms}ms</td>
                      <td className="px-3 py-1.5 font-mono text-[var(--muted)]">{e.rows_affected}</td>
                      <td className="px-3 py-1.5">
                        {e.error ? <span className="text-red-500">⚠ {e.error}</span> : <span className="text-[var(--muted)]">—</span>}
                      </td>
                    </tr>
                    {isExp && (
                      <tr className="border-b border-[var(--border)] bg-[var(--surface)]/30">
                        <td colSpan={8} className="px-6 py-3">
                          <div className="space-y-2">
                            <div className="flex gap-4 text-[11px] text-[var(--muted)]">
                              <span><strong className="text-[var(--fg)]">Actor IP:</strong> {e.actor_ip || '—'}</span>
                              <span><strong className="text-[var(--fg)]">User Agent:</strong> {e.user_agent || '—'}</span>
                              <span><strong className="text-[var(--fg)]">ID:</strong> <span className="font-mono">{e.id}</span></span>
                            </div>
                            {e.query_text && (
                              <pre className="bg-[var(--bg)] border border-[var(--border)] rounded p-3 text-[11px] font-mono text-[var(--fg)] overflow-x-auto whitespace-pre-wrap break-all max-h-48">
                                {e.query_text}
                              </pre>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Toast */}
        {toast && (
          <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-lg border text-sm font-medium shadow-lg ${
            toast.ok
              ? 'bg-green-500/10 border-green-500/30 text-green-500'
              : 'bg-red-500/10 border-red-500/30 text-red-500'
          }`}>
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  )
}
