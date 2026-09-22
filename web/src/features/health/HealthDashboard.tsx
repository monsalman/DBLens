import React from 'react'
import { Activity, RefreshCw, X } from 'lucide-react'
import { HealthStatusDot } from './HealthStatusDot'
import { LatencySparkline } from './LatencySparkline'
import { latencySeries, statusLabel, uptimePct } from './healthHelper'
import { useHealth } from './useHealth'
import type { HealthStatus } from '../../lib/api'

interface Props {
  isOpen: boolean
  onClose: () => void
}

const CARD_STYLES: Array<{ key: 'healthy' | 'degraded' | 'down' | 'unknown'; label: string; cls: string }> = [
  { key: 'healthy', label: 'Healthy', cls: 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10' },
  { key: 'degraded', label: 'Degraded', cls: 'text-amber-500 border-amber-500/30 bg-amber-500/10' },
  { key: 'down', label: 'Down', cls: 'text-red-500 border-red-500/30 bg-red-500/10' },
  { key: 'unknown', label: 'Unknown', cls: 'text-zinc-400 border-zinc-500/30 bg-zinc-500/10' },
]

/** "Database Observatory": live per-connection latency and liveness monitor. */
export const HealthDashboard: React.FC<Props> = ({ isOpen, onClose }) => {
  const { connections, summary, loading, error, live, reload } = useHealth(isOpen)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-500" />
            <h1 className="font-semibold text-[var(--fg)]">Database Observatory</h1>
            <span
              className={`flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full border ${
                live
                  ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                  : 'bg-zinc-500/10 text-[var(--muted)] border-[var(--border)]'
              }`}
              title={live ? 'Receiving live probe updates from /api/health/stream' : 'Live stream idle — showing the last snapshot'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
              {live ? 'LIVE' : 'IDLE'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={reload}
              disabled={loading}
              className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] transition-colors"
              title="Refresh snapshot"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)]" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-5 py-4 shrink-0">
          {CARD_STYLES.map(c => (
            <div key={c.key} className={`rounded-xl border px-3 py-2 ${c.cls}`}>
              <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{c.label}</div>
              <div className="text-xl font-mono font-bold">{summary[c.key]}</div>
            </div>
          ))}
        </div>

        <div className="px-5 pb-2 text-[11px] text-[var(--muted)] shrink-0">
          {summary.total} monitored connection{summary.total === 1 ? '' : 's'} ·{' '}
          {summary.total_checks} probe{summary.total_checks === 1 ? '' : 's'} ·{' '}
          <span className={summary.success_rate < 95 ? 'text-amber-500' : 'text-emerald-500'}>
            {summary.success_rate}% success rate
          </span>
        </div>

        {error && <div className="px-5 pb-2 text-xs text-red-400 shrink-0">{error}</div>}

        {/* Table */}
        <div className="flex-1 overflow-auto px-5 pb-5 min-h-0">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--bg)] text-[10px] uppercase tracking-wider text-[var(--muted)]">
              <tr className="border-b border-[var(--border)]">
                <th className="text-left font-semibold py-2 px-2">Connection</th>
                <th className="text-left font-semibold py-2 px-2">Status</th>
                <th className="text-right font-semibold py-2 px-2">Last</th>
                <th className="text-right font-semibold py-2 px-2">Avg 1m</th>
                <th className="text-right font-semibold py-2 px-2">Max 5m</th>
                <th className="text-right font-semibold py-2 px-2">Uptime</th>
                <th className="text-right font-semibold py-2 px-2">Checks</th>
                <th className="text-left font-semibold py-2 px-2">Latency</th>
              </tr>
            </thead>
            <tbody>
              {connections.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-[var(--muted)]">
                    No probed connections yet. The monitor starts reporting as soon as a connection is in use.
                  </td>
                </tr>
              )}
              {connections.map(c => (
                <tr key={c.connection_id} className="border-b border-[var(--border)]/60 hover:bg-[var(--hover)]">
                  <td className="py-1.5 px-2">
                    <div className="font-mono text-[var(--fg)] truncate max-w-[240px]" title={c.label || c.connection_id}>
                      {c.label || c.connection_id}
                    </div>
                    <div className="text-[10px] text-[var(--muted)] font-mono truncate max-w-[240px]">{c.connection_id}</div>
                  </td>
                  <td className="py-1.5 px-2">
                    <HealthStatusDot status={c.status} label={statusLabel(c.status)} />
                    <span className="ml-1.5 text-[11px] text-[var(--muted)]">{statusLabel(c.status)}</span>
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono">{c.last_ping_ms} ms</td>
                  <td className="py-1.5 px-2 text-right font-mono">{c.avg_ping_ms_1m.toFixed(1)} ms</td>
                  <td className="py-1.5 px-2 text-right font-mono">{c.max_ping_ms_5m} ms</td>
                  <td className={`py-1.5 px-2 text-right font-mono ${uptimePct(c) < 100 ? 'text-amber-500' : ''}`}>
                    {uptimePct(c)}%
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-[var(--muted)]">{c.total_checks}</td>
                  <td className="py-1.5 px-2">
                    <LatencySparkline samples={latencySeries(c)} status={c.status as HealthStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
