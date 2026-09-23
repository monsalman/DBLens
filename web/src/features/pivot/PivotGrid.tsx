import React from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import {
  formatPivotValue,
  computeCellHeat,
  type PivotMatrix,
  type PivotConfig,
} from './pivotHelper'

interface PivotGridProps {
  matrix: PivotMatrix
  config: PivotConfig
  heatShading: boolean
  minVal: number
  maxVal: number
}

export const PivotGrid: React.FC<PivotGridProps> = ({
  matrix,
  config,
  heatShading,
  minVal,
  maxVal,
}) => {
  const hasRowTotals = matrix.rowTotals !== undefined && matrix.rowTotals.length > 0
  const hasColTotals = matrix.colTotals !== undefined && matrix.colTotals.length > 0
  const rowFieldCount = matrix.rowHeaders.length > 0 ? matrix.rowHeaders[0].length : 0

  if (!config.colField) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-[var(--muted)] text-center">
        <AlertCircle className="w-8 h-8 text-indigo-400 mb-2" />
        <p className="text-sm font-medium text-[var(--fg)]">No column selected for cross-tabulation</p>
        <p className="text-xs mt-1 max-w-sm">
          Select a column field in the rack above to pivot query results horizontally.
        </p>
      </div>
    )
  }

  if (matrix.colHeaders.length === 0 || matrix.cells.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-[var(--muted)] text-center">
        <AlertCircle className="w-8 h-8 text-amber-400 mb-2" />
        <p className="text-sm font-medium text-[var(--fg)]">No pivot results for current configuration</p>
        <p className="text-xs mt-1">Adjust row, column, or value fields to view data.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[var(--bg)]">
      {/* Truncation notification banner */}
      {matrix.truncatedAt !== undefined && matrix.truncatedAt > 0 && (
        <div className="px-3 py-1 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-[11px] flex items-center gap-1.5 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>
            Displaying the first <strong>{matrix.truncatedAt}</strong> distinct columns (configured limit). Increase max columns in the rack above to see more.
          </span>
        </div>
      )}

      {/* Scrollable Pivot Table Container */}
      <div className="flex-1 overflow-auto relative">
        <table className="w-full text-xs border-separate border-spacing-0 font-mono">
          <thead>
            {/* Top Table Header */}
            <tr className="bg-[var(--surface)] sticky top-0 z-20 shadow-xs">
              {/* Row Field Headers */}
              {Array.from({ length: rowFieldCount }).map((_, i) => (
                <th
                  key={`rf-hdr-${i}`}
                  className="px-3 py-2 text-left font-semibold text-[var(--muted)] border-b border-r border-[var(--border)] sticky left-0 z-30 bg-[var(--surface)] select-none uppercase text-[10px] tracking-wider"
                  style={{
                    left: `${i * 120}px`,
                    minWidth: '120px',
                  }}
                >
                  {config.rowFields[i] || `Row ${i + 1}`}
                </th>
              ))}

              {/* Pivot Column Headers */}
              {matrix.colHeaders.map((colName) => (
                <th
                  key={`col-hdr-${colName}`}
                  className="px-3 py-2 text-right font-semibold text-[var(--fg)] border-b border-r border-[var(--border)] whitespace-nowrap min-w-[100px] select-none"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>{colName}</span>
                  </div>
                </th>
              ))}

              {/* Total Column Header */}
              {hasRowTotals && (
                <th className="px-3 py-2 text-right font-bold text-indigo-400 border-b border-[var(--border)] bg-indigo-500/5 whitespace-nowrap min-w-[100px] select-none">
                  Total ({config.aggregator.toUpperCase()})
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {matrix.cells.map((rowCells, rIdx) => {
              const rowHeader = matrix.rowHeaders[rIdx] || []
              return (
                <tr
                  key={`row-${rIdx}`}
                  className="hover:bg-[var(--hover)]/40 transition-colors group"
                >
                  {/* Row Header Cells */}
                  {rowHeader.map((hdrVal, hIdx) => (
                    <td
                      key={`r-hdr-${rIdx}-${hIdx}`}
                      className="px-3 py-1.5 text-left font-medium text-[var(--fg)] border-b border-r border-[var(--border)] bg-[var(--bg)] group-hover:bg-[var(--surface)] sticky left-0 z-10 whitespace-nowrap"
                      style={{
                        left: `${hIdx * 120}px`,
                        minWidth: '120px',
                      }}
                    >
                      {hdrVal}
                    </td>
                  ))}

                  {/* Data Cells */}
                  {rowCells.map((cellVal, cIdx) => {
                    const numVal = typeof cellVal === 'number' ? cellVal : null
                    const heat = heatShading ? computeCellHeat(numVal, minVal, maxVal) : null

                    return (
                      <td
                        key={`cell-${rIdx}-${cIdx}`}
                        className="px-3 py-1.5 text-right border-b border-r border-[var(--border)] text-[var(--fg)] font-mono whitespace-nowrap transition-colors"
                        style={{
                          backgroundColor: heat ? heat.bg : undefined,
                          color: heat?.text ? heat.text : undefined,
                        }}
                      >
                        {formatPivotValue(cellVal, config.aggregator)}
                      </td>
                    )
                  })}

                  {/* Row Total Cell */}
                  {hasRowTotals && (
                    <td className="px-3 py-1.5 text-right border-b border-[var(--border)] font-bold text-indigo-300 bg-indigo-500/5 whitespace-nowrap">
                      {formatPivotValue(matrix.rowTotals?.[rIdx], config.aggregator)}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>

          {/* Subtotals Footer Row */}
          {hasColTotals && (
            <tfoot>
              <tr className="bg-[var(--surface)] font-bold sticky bottom-0 z-20 border-t-2 border-[var(--border)] shadow-xs">
                {/* Total label across row field headers */}
                {Array.from({ length: rowFieldCount }).map((_, i) => (
                  <td
                    key={`ft-lbl-${i}`}
                    className="px-3 py-2 text-left font-bold text-indigo-400 border-r border-[var(--border)] bg-[var(--surface)] sticky left-0 z-30 select-none uppercase text-[10px] tracking-wider"
                    style={{
                      left: `${i * 120}px`,
                      minWidth: '120px',
                    }}
                  >
                    {i === 0 ? 'Total' : ''}
                  </td>
                ))}

                {/* Column Totals */}
                {matrix.colTotals?.map((colTotal, cIdx) => (
                  <td
                    key={`ft-col-${cIdx}`}
                    className="px-3 py-2 text-right font-bold text-indigo-300 border-r border-[var(--border)] bg-[var(--surface)] whitespace-nowrap"
                  >
                    {formatPivotValue(colTotal, config.aggregator)}
                  </td>
                ))}

                {/* Grand Total */}
                {hasRowTotals && (
                  <td className="px-3 py-2 text-right font-extrabold text-indigo-400 bg-indigo-500/15 whitespace-nowrap">
                    {formatPivotValue(matrix.grandTotal, config.aggregator)}
                  </td>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
