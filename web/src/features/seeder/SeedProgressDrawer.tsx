import React from 'react'
import {
  Gauge,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Layers,
} from 'lucide-react'
import {
  formatNumber,
  formatDuration,
  formatSpeed,
  formatStatusBadge,
  type SeedProgress,
  type SeedResult,
} from './seederHelper'

interface SeedProgressDrawerProps {
  progress: SeedProgress | null
  result: SeedResult | null
  running: boolean
  onClose?: () => void
}

export const SeedProgressDrawer: React.FC<SeedProgressDrawerProps> = ({
  progress,
  result,
  running,
  onClose,
}) => {
  if (!progress && !result && !running) {
    return null
  }

  const status = progress?.status || (result ? 'completed' : 'planning')
  const { label: statusLabel, badgeClass } = formatStatusBadge(status)
  const percentage = progress?.percentage ? Math.min(100, Math.round(progress.percentage)) : (result ? 100 : 0)
  const rowsInserted = progress?.rowsInserted ?? result?.totalInserted ?? 0
  const totalRows = progress?.totalRows ?? result?.totalInserted ?? 0
  const rowsPerSec = progress?.rowsPerSec ?? (result && result.durationMs > 0 ? (Number(result.totalInserted) / (result.durationMs / 1000)) : 0)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4 shadow-xl">
      {/* Header with Status and Speedometer */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {running ? (
            <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
          ) : status === 'completed' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          ) : (
            <XCircle className="w-5 h-5 text-rose-400" />
          )}

          <div>
            <h4 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              Seeding Pipeline Execution
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${badgeClass}`}>
                {statusLabel}
              </span>
            </h4>
            {progress?.table && (
              <p className="text-xs text-zinc-400 mt-0.5">
                Current table: <span className="font-mono text-zinc-200">{progress.table}</span>
              </p>
            )}
          </div>
        </div>

        {/* Speedometer Badge */}
        <div className="flex items-center gap-3 bg-zinc-950/70 border border-zinc-800 px-3 py-1.5 rounded-lg text-xs">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Gauge className="w-4 h-4 text-indigo-400" />
            <span className="font-mono font-medium text-zinc-200">{formatSpeed(rowsPerSec)}</span>
          </div>
          {result && (
            <div className="flex items-center gap-1.5 text-zinc-400 border-l border-zinc-800 pl-3">
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              <span>{formatDuration(result.durationMs)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>Overall Progress ({percentage}%)</span>
          <span className="font-mono font-medium text-zinc-200">
            {formatNumber(Number(rowsInserted))} / {formatNumber(Number(totalRows))} rows
          </span>
        </div>

        <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              status === 'failed'
                ? 'bg-rose-500'
                : status === 'completed'
                ? 'bg-emerald-500'
                : 'bg-indigo-500'
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Table Insertion Summary if completed */}
      {result && result.tablesInserted && Object.keys(result.tablesInserted).length > 0 && (
        <div className="border border-zinc-800/80 rounded-lg p-3 bg-zinc-950/50 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
            <Layers className="w-3.5 h-3.5 text-zinc-400" />
            Tables Populated
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {Object.entries(result.tablesInserted).map(([tbl, cnt]) => (
              <div
                key={tbl}
                className="flex items-center justify-between px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-800"
              >
                <span className="text-zinc-300 truncate">{tbl}</span>
                <span className="font-mono text-zinc-400 text-[11px]">
                  +{formatNumber(cnt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error Message */}
      {progress?.error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-xs text-rose-300">
          {progress.error}
        </div>
      )}

      {/* Close button when finished */}
      {!running && onClose && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
          >
            Close Progress
          </button>
        </div>
      )}
    </div>
  )
}
