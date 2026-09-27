import React from 'react'
import {
  Clock,
  Database,
  Hash,
  Trash2,
  Sparkles,
} from 'lucide-react'
import {
  formatSnapshotDate,
  formatRelativeTime,
  getTagBadgeStyle,
  type SchemaSnapshot,
} from './snapshotHelper'

interface Props {
  snapshots: SchemaSnapshot[]
  baseId: string | null
  targetId: string | null
  onSelectBase: (id: string) => void
  onSelectTarget: (id: string | null) => void
  onDelete: (id: string) => void
  onCompareWithLive: (baseId: string) => void
  isDiffing: boolean
  readOnly?: boolean
}

export const SnapshotTimelineSlider: React.FC<Props> = ({
  snapshots,
  baseId,
  targetId,
  onSelectBase,
  onSelectTarget,
  onDelete,
  onCompareWithLive,
  isDiffing,
  readOnly = false,
}) => {
  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-[var(--muted)] border border-dashed border-[var(--border)] rounded-lg my-4">
        <Database className="w-10 h-10 mb-2 opacity-40 text-emerald-500" />
        <h4 className="text-sm font-semibold text-[var(--fg)]">No Snapshots Captured Yet</h4>
        <p className="text-xs max-w-sm mt-1">
          Capture your first schema point-in-time snapshot to track structural evolution and audit historical schema drift.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-[var(--muted)] px-1">
        <span>Timeline Vault ({snapshots.length} snapshots)</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Base (Point A)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Target (Point B)
          </span>
        </span>
      </div>

      <div className="relative border-l-2 border-[var(--border)] ml-4 pl-4 space-y-4 py-2">
        {snapshots.map((snap) => {
          const isBase = baseId === snap.id
          const isTarget = targetId === snap.id
          const tagStyle = getTagBadgeStyle(snap.tag)

          return (
            <div
              key={snap.id}
              className={`relative group rounded-lg p-3 border transition-all text-xs ${
                isBase
                  ? 'border-blue-500/60 bg-blue-500/5 shadow-sm'
                  : isTarget
                  ? 'border-emerald-500/60 bg-emerald-500/5 shadow-sm'
                  : 'border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted)]'
              }`}
            >
              {/* Timeline dot */}
              <div
                className={`absolute -left-[23px] top-4 w-3.5 h-3.5 rounded-full border-2 transition-colors ${
                  isBase
                    ? 'border-blue-500 bg-blue-500'
                    : isTarget
                    ? 'border-emerald-500 bg-emerald-500'
                    : 'border-[var(--border)] bg-[var(--bg)] group-hover:border-emerald-500'
                }`}
              />

              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-[var(--fg)] truncate">
                      {snap.label}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${tagStyle.bg} ${tagStyle.text} ${tagStyle.border}`}
                    >
                      {tagStyle.label}
                    </span>
                    <span className="text-[11px] text-[var(--muted)] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(snap.createdAt)}
                    </span>
                  </div>

                  {snap.description && (
                    <p className="text-[11px] text-[var(--muted)] line-clamp-2">
                      {snap.description}
                    </p>
                  )}

                  <div className="flex items-center gap-3 text-[11px] text-[var(--muted)] pt-1">
                    <span className="flex items-center gap-1 font-mono">
                      <Hash className="w-3 h-3 opacity-60" />
                      {snap.checksum.slice(0, 10)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Database className="w-3 h-3 opacity-60" />
                      {snap.tablesCount} tables
                      {snap.viewsCount > 0 && `, ${snap.viewsCount} views`}
                    </span>
                    <span className="hidden sm:inline text-[10px] opacity-75">
                      {formatSnapshotDate(snap.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Selection Controls */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onSelectBase(snap.id)}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                      isBase
                        ? 'bg-blue-600 text-white'
                        : 'border border-[var(--border)] text-[var(--muted)] hover:text-blue-500 hover:border-blue-500/40'
                    }`}
                    title="Select as Base comparison snapshot (Point A)"
                  >
                    {isBase ? 'Base (A)' : 'Set Base'}
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectTarget(isTarget ? null : snap.id)}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                      isTarget
                        ? 'bg-emerald-600 text-white'
                        : 'border border-[var(--border)] text-[var(--muted)] hover:text-emerald-500 hover:border-emerald-500/40'
                    }`}
                    title="Select as Target comparison snapshot (Point B)"
                  >
                    {isTarget ? 'Target (B)' : 'Set Target'}
                  </button>

                  <button
                    type="button"
                    onClick={() => onCompareWithLive(snap.id)}
                    disabled={isDiffing}
                    className="p-1 rounded text-[var(--muted)] hover:text-emerald-500 hover:bg-[var(--hover)] transition-colors cursor-pointer"
                    title="Compare this snapshot against current Live DB"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                  </button>

                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => {
                      if (readOnly) return
                      if (confirm(`Delete snapshot "${snap.label}"?`)) {
                        onDelete(snap.id)
                      }
                    }}
                    className="p-1 rounded text-[var(--muted)] hover:text-rose-500 hover:bg-[var(--hover)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title={readOnly ? 'Disabled in read-only mode' : 'Delete snapshot from vault'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
