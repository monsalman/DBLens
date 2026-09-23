import React from 'react'
import type { ColumnProfile } from './profileHelper'
import {
  formatNumber,
  formatPercentage,
  formatMetricVal,
  flagBadgeStyle,
} from './profileHelper'
import { ShieldAlert, Hash, Type, Sparkles } from 'lucide-react'

interface ColumnProfileCardProps {
  column: ColumnProfile
  isSelected?: boolean
  onSelect?: () => void
}

export const ColumnProfileCard: React.FC<ColumnProfileCardProps> = ({
  column,
  isSelected = false,
  onSelect,
}) => {
  const isNumeric = column.minVal !== undefined && column.maxVal !== undefined

  return (
    <div
      onClick={onSelect}
      className={`group relative p-3.5 rounded-lg border transition-all cursor-pointer select-none text-left ${
        isSelected
          ? 'bg-[var(--surface)] border-indigo-500/60 shadow-sm ring-1 ring-indigo-500/30'
          : 'bg-[var(--bg)] border-[var(--border)] hover:border-[var(--muted)]/40 hover:bg-[var(--surface)]/50'
      }`}
    >
      {/* Top Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isNumeric ? (
            <Hash className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          ) : (
            <Type className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          )}
          <span className="font-mono text-xs font-semibold text-[var(--fg)] truncate">
            {column.columnName}
          </span>
        </div>
        <span className="font-mono text-[10px] text-[var(--muted)] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] shrink-0">
          {column.dataType}
        </span>
      </div>

      {/* Badges: PII and Quality Flags */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {column.piiType && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-purple-500/15 text-purple-400 border border-purple-500/30">
            <ShieldAlert className="w-3 h-3 text-purple-400" />
            {column.piiType.toUpperCase()}
          </span>
        )}
        {column.qualityFlags.map((flag, idx) => {
          const style = flagBadgeStyle(flag)
          return (
            <span
              key={idx}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${style.bg} ${style.text} ${style.border}`}
            >
              {style.label}
            </span>
          )
        })}
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-2 border-t border-[var(--border)]/50">
        <div>
          <span className="text-[var(--muted)] block text-[10px]">Nulls</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="w-12 h-1.5 rounded-full bg-[var(--border)] overflow-hidden shrink-0">
              <div
                className={`h-full ${
                  column.nullPercentage > 50
                    ? 'bg-rose-500'
                    : column.nullPercentage > 20
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, column.nullPercentage)}%` }}
              />
            </div>
            <span className="text-[var(--fg)] text-[10px]">
              {formatPercentage(column.nullPercentage)}
            </span>
          </div>
        </div>

        <div>
          <span className="text-[var(--muted)] block text-[10px]">Uniqueness</span>
          <span className="text-[var(--fg)] text-[10px] font-medium block mt-0.5">
            {formatPercentage(column.uniquenessRatio * 100)} ({formatNumber(column.distinctCount)})
          </span>
        </div>
      </div>

      {/* Numeric stats preview or empty strings */}
      {isNumeric ? (
        <div className="mt-2 text-[10px] font-mono text-[var(--muted)] flex items-center justify-between">
          <span>min: {formatMetricVal(column.minVal)}</span>
          <span>avg: {formatMetricVal(column.avgVal)}</span>
          <span>max: {formatMetricVal(column.maxVal)}</span>
        </div>
      ) : column.emptyCount > 0 ? (
        <div className="mt-2 text-[10px] font-mono text-orange-400 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-orange-400" />
          <span>{formatNumber(column.emptyCount)} empty strings</span>
        </div>
      ) : null}
    </div>
  )
}
