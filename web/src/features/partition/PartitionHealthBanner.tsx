import React from 'react'
import { AlertTriangle, Flame, Clock, Sparkles } from 'lucide-react'
import type { PartitionHealthReport } from './partitionHelper'
import { getHealthScoreColor } from './partitionHelper'

interface PartitionHealthBannerProps {
  healthReport?: PartitionHealthReport
  onOpenGenerator?: () => void
}

export const PartitionHealthBanner: React.FC<PartitionHealthBannerProps> = ({
  healthReport,
  onOpenGenerator,
}) => {
  if (!healthReport) return null

  const { hasHotSkew, missingFuture, warnings, score } = healthReport
  const hasWarnings = warnings && warnings.length > 0
  const scoreColors = getHealthScoreColor(score)

  if (!hasWarnings && score >= 90) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-xs text-emerald-400">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-medium">Partition storage and growth headroom are healthy.</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-zinc-500">Score</span>
          <span className={`font-semibold ${scoreColors.textClass}`}>{score}/100</span>
        </div>
      </div>
    )
  }

  const isSevere = hasHotSkew || score < 60

  return (
    <div
      className={`rounded-lg border px-4 py-3 text-xs transition-colors ${
        isSevere
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2.5">
          {hasHotSkew ? (
            <Flame className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
          ) : missingFuture ? (
            <Clock className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          )}

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">
                {hasHotSkew
                  ? 'Hot Storage Skew Detected'
                  : missingFuture
                    ? 'Upcoming Partition Headroom Critical'
                    : 'Partition Health Warning'}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold border ${scoreColors.borderClass} ${scoreColors.bgClass} ${scoreColors.textClass}`}
              >
                Health Score: {score}/100
              </span>
            </div>

            <ul className="list-inside list-disc space-y-0.5 text-zinc-300">
              {warnings.map((w, idx) => (
                <li key={idx} className="leading-relaxed">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {onOpenGenerator && (
          <button
            type="button"
            onClick={onOpenGenerator}
            className="flex items-center gap-1.5 shrink-0 rounded-md border border-white/20 bg-white/10 px-2.5 py-1.5 font-medium text-white hover:bg-white/20 transition-colors shadow-sm"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Generate Partitions</span>
          </button>
        )}
      </div>
    </div>
  )
}
