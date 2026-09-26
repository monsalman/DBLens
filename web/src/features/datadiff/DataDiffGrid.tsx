import React, { useState } from 'react'
import {
  Key,
  Columns as ColumnsIcon,
  ListFilter,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import {
  formatRowStatus,
  formatCellVal,
  isCellChanged,
  getRowKey,
  type RowDiffItem,
} from './dataDiffHelper'

export interface DataDiffGridProps {
  columns: string[]
  primaryKeys: string[]
  rows: RowDiffItem[]
  selectedRowKeys: Set<string>
  onToggleRow: (key: string) => void
  sourceLabel?: string
  targetLabel?: string
}

export const DataDiffGrid: React.FC<DataDiffGridProps> = ({
  columns,
  primaryKeys,
  rows,
  selectedRowKeys,
  onToggleRow,
  sourceLabel = 'Source',
  targetLabel = 'Target',
}) => {
  const [viewMode, setViewMode] = useState<'side-by-side' | 'unified'>('side-by-side')
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const pkSet = new Set(primaryKeys)
  const nonPkCols = columns.filter((c) => !pkSet.has(c))

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border border-[var(--border)] rounded-lg bg-[var(--bg)] text-[var(--muted)] font-mono text-xs">
        <ListFilter className="w-8 h-8 opacity-40 mb-2" />
        <p>No rows match the selected filter.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col border border-[var(--border)] rounded-lg bg-[var(--bg)] overflow-hidden font-mono text-xs">
      {/* Grid Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--hover)]/20">
        <div className="flex items-center gap-2 text-[var(--muted)] text-[11px]">
          <span>Showing {rows.length} rows</span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Key className="w-3 h-3 text-amber-400" />
            <span>PK: {primaryKeys.join(', ')}</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5 bg-[var(--bg)] p-0.5 rounded-md border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setViewMode('side-by-side')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${
              viewMode === 'side-by-side'
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            <ColumnsIcon className="w-3 h-3" />
            <span>Side-by-Side</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('unified')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${
              viewMode === 'unified'
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            <ListFilter className="w-3 h-3" />
            <span>Unified</span>
          </button>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto max-h-[550px] overflow-y-auto">
        {viewMode === 'side-by-side' ? (
          <table className="w-full text-left border-collapse select-text">
            <thead className="sticky top-0 z-10 bg-[var(--hover)] border-b border-[var(--border)] text-[var(--muted)] text-[11px] uppercase tracking-wider">
              <tr>
                <th className="w-10 px-3 py-2 text-center">#</th>
                <th className="w-24 px-3 py-2">Status</th>
                {primaryKeys.map((pk) => (
                  <th key={pk} className="px-3 py-2 text-[var(--fg)] font-semibold bg-amber-500/5">
                    <div className="flex items-center gap-1">
                      <Key className="w-3 h-3 text-amber-400" />
                      <span>{pk}</span>
                    </div>
                  </th>
                ))}
                {nonPkCols.map((col) => (
                  <th key={col} colSpan={2} className="px-3 py-2 text-center border-l border-[var(--border)]/50">
                    <div className="font-semibold text-[var(--fg)]">{col}</div>
                    <div className="flex items-center justify-around text-[10px] text-[var(--muted)] font-normal mt-0.5">
                      <span className="text-indigo-400">{sourceLabel}</span>
                      <span>↔</span>
                      <span className="text-cyan-400">{targetLabel}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]/40">
              {rows.map((row) => {
                const rKey = getRowKey(row, primaryKeys)
                const isSelected = selectedRowKeys.has(rKey)
                const statusMeta = formatRowStatus(row.status)

                let rowBg = 'hover:bg-[var(--hover)]/30'
                if (row.status === 'added') rowBg = 'bg-emerald-500/5 hover:bg-emerald-500/10'
                if (row.status === 'deleted') rowBg = 'bg-rose-500/5 hover:bg-rose-500/10'
                if (row.status === 'modified') rowBg = 'bg-amber-500/5 hover:bg-amber-500/10'

                return (
                  <tr key={rKey} className={`transition-colors ${rowBg}`}>
                    {/* Checkbox */}
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => onToggleRow(rKey)}
                        className="cursor-pointer text-[var(--muted)] hover:text-[var(--fg)]"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-3.5 h-3.5 text-[var(--accent)]" />
                        ) : (
                          <Square className="w-3.5 h-3.5 opacity-60" />
                        )}
                      </button>
                    </td>

                    {/* Status Badge */}
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusMeta.badgeClass}`}>
                        {statusMeta.label}
                      </span>
                    </td>

                    {/* PK values */}
                    {primaryKeys.map((pk) => (
                      <td key={pk} className="px-3 py-2 font-bold text-[var(--fg)] bg-amber-500/5 whitespace-nowrap">
                        {formatCellVal(row.pkValues?.[pk])}
                      </td>
                    ))}

                    {/* Non-PK columns: Source vs Target */}
                    {nonPkCols.map((col) => {
                      const isChanged = isCellChanged(col, row.changedColumns)
                      const srcVal = formatCellVal(row.sourceValues?.[col])
                      const tgtVal = formatCellVal(row.targetValues?.[col])

                      return (
                        <React.Fragment key={col}>
                          {/* Source cell */}
                          <td
                            className={`px-3 py-2 border-l border-[var(--border)]/40 max-w-[200px] truncate ${
                              isChanged ? 'bg-amber-500/20 text-amber-300 font-medium' : 'text-[var(--fg)]'
                            }`}
                            title={srcVal}
                          >
                            {row.sourceValues !== undefined ? srcVal : <span className="opacity-30">—</span>}
                          </td>
                          {/* Target cell */}
                          <td
                            className={`px-3 py-2 max-w-[200px] truncate ${
                              isChanged ? 'bg-amber-500/20 text-amber-300 font-medium' : 'text-[var(--fg)]'
                            }`}
                            title={tgtVal}
                          >
                            {row.targetValues !== undefined ? tgtVal : <span className="opacity-30">—</span>}
                          </td>
                        </React.Fragment>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          /* Unified View */
          <table className="w-full text-left border-collapse select-text">
            <thead className="sticky top-0 z-10 bg-[var(--hover)] border-b border-[var(--border)] text-[var(--muted)] text-[11px] uppercase tracking-wider">
              <tr>
                <th className="w-10 px-3 py-2 text-center">#</th>
                <th className="w-24 px-3 py-2">Status</th>
                {primaryKeys.map((pk) => (
                  <th key={pk} className="px-3 py-2 text-[var(--fg)] font-semibold">
                    {pk}
                  </th>
                ))}
                {nonPkCols.map((col) => (
                  <th key={col} className="px-3 py-2 font-semibold">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]/40">
              {rows.map((row) => {
                const rKey = getRowKey(row, primaryKeys)
                const isSelected = selectedRowKeys.has(rKey)
                const statusMeta = formatRowStatus(row.status)
                const isExpanded = expandedKeys.has(rKey)

                return (
                  <React.Fragment key={rKey}>
                    <tr className="hover:bg-[var(--hover)]/30 transition-colors">
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => onToggleRow(rKey)}
                          className="cursor-pointer text-[var(--muted)] hover:text-[var(--fg)]"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-[var(--accent)]" />
                          ) : (
                            <Square className="w-3.5 h-3.5 opacity-60" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {row.status === 'modified' && (
                            <button
                              type="button"
                              onClick={() => toggleExpand(rKey)}
                              className="text-[var(--muted)] hover:text-[var(--fg)] cursor-pointer"
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-3 h-3" />
                              ) : (
                                <ChevronRight className="w-3 h-3" />
                              )}
                            </button>
                          )}
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusMeta.badgeClass}`}>
                            {statusMeta.label}
                          </span>
                        </div>
                      </td>
                      {primaryKeys.map((pk) => (
                        <td key={pk} className="px-3 py-2 font-bold text-[var(--fg)] whitespace-nowrap">
                          {formatCellVal(row.pkValues?.[pk])}
                        </td>
                      ))}
                      {nonPkCols.map((col) => {
                        const isChanged = isCellChanged(col, row.changedColumns)
                        const srcVal = formatCellVal(row.sourceValues?.[col])
                        const tgtVal = formatCellVal(row.targetValues?.[col])

                        if (row.status === 'added') {
                          return (
                            <td key={col} className="px-3 py-2 text-emerald-400">
                              + {srcVal}
                            </td>
                          )
                        }
                        if (row.status === 'deleted') {
                          return (
                            <td key={col} className="px-3 py-2 text-rose-400 line-through">
                              - {tgtVal}
                            </td>
                          )
                        }
                        if (row.status === 'modified' && isChanged) {
                          return (
                            <td key={col} className="px-3 py-2 bg-amber-500/20 text-amber-300">
                              <span className="line-through opacity-70 text-rose-300 mr-1.5">{tgtVal}</span>
                              <span className="text-emerald-300 font-bold">{srcVal}</span>
                            </td>
                          )
                        }
                        return (
                          <td key={col} className="px-3 py-2 text-[var(--fg)]">
                            {srcVal}
                          </td>
                        )
                      })}
                    </tr>

                    {/* Detailed Row expansion for modified rows */}
                    {isExpanded && row.status === 'modified' && (
                      <tr className="bg-[var(--hover)]/40 text-[11px]">
                        <td colSpan={columns.length + 2} className="px-6 py-2">
                          <div className="flex flex-col gap-1 text-[var(--muted)]">
                            <span className="font-semibold text-[var(--fg)]">Changed Columns:</span>
                            <div className="flex flex-wrap gap-2">
                              {row.changedColumns?.map((col) => (
                                <div key={col} className="p-1.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">
                                  <strong className="text-[var(--fg)]">{col}:</strong>{' '}
                                  <span className="line-through text-rose-400">{formatCellVal(row.targetValues?.[col])}</span>{' '}
                                  <span>→</span>{' '}
                                  <span className="text-emerald-400 font-semibold">{formatCellVal(row.sourceValues?.[col])}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
