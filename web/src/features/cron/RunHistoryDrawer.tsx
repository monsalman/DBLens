import React from 'react'
import { X, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react'
import type { CronJobRun } from '../../lib/api'

interface Props {
  jobName: string
  runs: CronJobRun[]
  onClose: () => void
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'ok') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
  if (status === 'alert') return <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
  return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
}

export const RunHistoryDrawer: React.FC<Props> = ({ jobName, runs, onClose }) => (
  <div className="fixed inset-0 z-50 flex justify-end">
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
    <div className="relative w-full max-w-md bg-[var(--bg)] border-l border-[var(--border)] shadow-2xl flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
        <div>
          <h2 className="font-semibold text-[var(--fg)] text-sm">Run History</h2>
          <p className="text-[11px] text-[var(--muted)] mt-0.5">{jobName}</p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-[var(--hover)] text-[var(--muted)]">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Runs */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {runs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-[var(--muted)]">
            <Clock className="w-8 h-8 opacity-30" />
            <p className="text-sm">No runs yet</p>
          </div>
        )}
        {runs.map((run, i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 space-y-1.5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <StatusIcon status={run.status} />
                <span className="text-xs font-medium text-[var(--fg)]">{run.status}</span>
              </div>
              <span className="text-[10px] text-[var(--muted)]">{run.duration_ms}ms</span>
            </div>
            <div className="text-[10px] text-[var(--muted)]">
              {new Date(run.run_at).toLocaleString()}
            </div>
            {run.output && (
              <div className="text-[11px] font-mono bg-[var(--hover)] px-2 py-1 rounded text-emerald-400 break-all">
                {run.output}
              </div>
            )}
            {run.error && (
              <div className="text-[11px] font-mono bg-red-500/10 px-2 py-1 rounded text-red-400 break-all">
                {run.error}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  </div>
)
