import React from 'react'
import { Clock, Play, Pencil, Trash2, CheckCircle2, AlertTriangle, XCircle, Loader2, History } from 'lucide-react'
import type { CronJob } from '../../lib/api'

interface Props {
  job: CronJob
  onRun: (id: string) => void
  onEdit: (job: CronJob) => void
  onDelete: (id: string) => void
  onHistory?: (job: CronJob) => void
  running?: boolean
}

function StatusBadge({ status }: { status: string }) {
  if (!status) return null
  if (status === 'ok') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400">
      <CheckCircle2 className="w-3 h-3" /> ok
    </span>
  )
  if (status === 'alert') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400">
      <AlertTriangle className="w-3 h-3" /> alert
    </span>
  )
  if (status === 'error') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/10 text-red-400">
      <XCircle className="w-3 h-3" /> error
    </span>
  )
  return <span className="text-[11px] text-[var(--muted)]">{status}</span>
}

export const JobCard: React.FC<Props> = ({ job, onRun, onEdit, onDelete, onHistory, running }) => {
  const interval = job.interval_sec
  const schedLabel = interval > 0
    ? interval >= 3600 ? `every ${Math.round(interval / 3600)}h`
      : interval >= 60 ? `every ${Math.round(interval / 60)}m`
      : `every ${interval}s`
    : 'manual'

  const lastRun = job.last_run && job.last_run !== '0001-01-01T00:00:00Z'
    ? new Date(job.last_run).toLocaleString()
    : 'never'

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 flex flex-col gap-3 hover:border-indigo-500/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="font-medium text-sm truncate text-[var(--fg)]">{job.name}</span>
          {!job.enabled && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--hover)] text-[var(--muted)]">disabled</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onRun(job.id)}
            disabled={running}
            title="Run now"
            className="p-1.5 rounded hover:bg-indigo-500/10 text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition-colors"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          {onHistory && (
            <button
              onClick={() => onHistory(job)}
              title="View history"
              className="p-1.5 rounded hover:bg-indigo-500/10 text-[var(--muted)] hover:text-indigo-400 transition-colors"
            >
              <History className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => onEdit(job)}
            title="Edit"
            className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(job.id)}
            title="Delete"
            className="p-1.5 rounded hover:bg-red-500/10 text-[var(--muted)] hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <pre className="text-[11px] text-[var(--muted)] bg-[var(--hover)] rounded px-2 py-1.5 overflow-hidden line-clamp-2 font-mono whitespace-pre-wrap break-all">
        {job.sql}
      </pre>

      <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
        <div className="flex items-center gap-3">
          <span>⏱ {schedLabel}</span>
          {job.conn_id && <span className="truncate max-w-[120px]">🔌 {job.conn_id}</span>}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={job.last_status} />
          <span>{lastRun}</span>
        </div>
      </div>
    </div>
  )
}
