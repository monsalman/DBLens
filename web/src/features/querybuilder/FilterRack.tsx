import React from 'react'
import { Plus, Trash2, Filter as FilterIcon } from 'lucide-react'
import type { QueryCanvasState, CanvasFilter } from '../../lib/api'
import { SUPPORTED_OPERATORS } from './queryBuilderHelper'

interface FilterRackProps {
  state: QueryCanvasState
  onAddFilter: (filter: Omit<CanvasFilter, 'id'>) => void
  onUpdateFilter: (id: string, partial: Partial<CanvasFilter>) => void
  onRemoveFilter: (id: string) => void
}

export const FilterRack: React.FC<FilterRackProps> = ({
  state,
  onAddFilter,
  onUpdateFilter,
  onRemoveFilter,
}) => {
  const tables = state.tables || []
  const filters = state.filters || []

  const handleAddNew = () => {
    if (tables.length === 0) return
    const firstTable = tables[0]
    const firstCol = firstTable.columns[0]?.name || 'id'
    onAddFilter({
      tableId: firstTable.id,
      column: firstCol,
      operator: '=',
      value: '',
      logic: 'AND',
    })
  }

  if (tables.length === 0) {
    return (
      <div className="p-8 text-center text-[var(--muted)] text-xs flex flex-col items-center justify-center gap-2">
        <FilterIcon className="w-8 h-8 opacity-30 text-indigo-400" />
        <p>Add tables to the canvas first to configure WHERE filter conditions.</p>
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-col gap-3 font-sans text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FilterIcon className="w-4 h-4 text-indigo-400" />
          <span className="font-semibold text-white">WHERE Filters</span>
          <span className="text-[10px] text-[var(--muted)]">({filters.length} conditions)</span>
        </div>
        <button
          type="button"
          onClick={handleAddNew}
          className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Filter</span>
        </button>
      </div>

      {filters.length === 0 ? (
        <div className="border border-dashed border-[var(--border)] rounded-lg p-6 text-center text-[var(--muted)] flex flex-col items-center gap-2">
          <p>No filter conditions defined. All matching rows will be returned.</p>
          <button
            type="button"
            onClick={handleAddNew}
            className="text-indigo-400 hover:underline text-xs cursor-pointer"
          >
            + Add first filter condition
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filters.map((filter, index) => {
            const table = tables.find((t) => t.id === filter.tableId) || tables[0]
            const columns = table?.columns || []
            const isBetween = filter.operator === 'BETWEEN'
            const isNullCheck =
              filter.operator === 'IS NULL' || filter.operator === 'IS NOT NULL'

            return (
              <div
                key={filter.id}
                className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-md p-2 flex-wrap sm:flex-nowrap"
              >
                {/* Logic toggle (AND / OR) */}
                {index > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateFilter(filter.id, {
                        logic: filter.logic === 'OR' ? 'AND' : 'OR',
                      })
                    }
                    className={`w-12 py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer text-center ${
                      filter.logic === 'OR'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                    }`}
                    title="Click to toggle AND/OR logic"
                  >
                    {filter.logic || 'AND'}
                  </button>
                ) : (
                  <span className="w-12 py-1 text-center text-[10px] font-bold text-[var(--muted)]">
                    WHERE
                  </span>
                )}

                {/* Table selector */}
                <select
                  value={filter.tableId}
                  onChange={(e) => {
                    const newTableId = e.target.value
                    const newTable = tables.find((t) => t.id === newTableId)
                    const newCol = newTable?.columns[0]?.name || ''
                    onUpdateFilter(filter.id, { tableId: newTableId, column: newCol })
                  }}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg)] outline-none min-w-[110px]"
                >
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.alias || t.name}
                    </option>
                  ))}
                </select>

                {/* Column selector */}
                <select
                  value={filter.column}
                  onChange={(e) => onUpdateFilter(filter.id, { column: e.target.value })}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg)] outline-none min-w-[120px]"
                >
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} {c.type ? `(${c.type})` : ''}
                    </option>
                  ))}
                </select>

                {/* Operator selector */}
                <select
                  value={filter.operator}
                  onChange={(e) => onUpdateFilter(filter.id, { operator: e.target.value })}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg)] outline-none min-w-[90px] font-mono text-xs"
                >
                  {SUPPORTED_OPERATORS.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>

                {/* Value 1 */}
                {!isNullCheck && (
                  <input
                    type="text"
                    value={filter.value}
                    onChange={(e) => onUpdateFilter(filter.id, { value: e.target.value })}
                    placeholder={filter.operator.includes('IN') ? 'val1, val2...' : 'value...'}
                    className="flex-1 min-w-[100px] bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg)] outline-none focus:border-indigo-500"
                  />
                )}

                {/* Value 2 (for BETWEEN) */}
                {isBetween && (
                  <>
                    <span className="text-[10px] text-[var(--muted)] font-bold">AND</span>
                    <input
                      type="text"
                      value={filter.value2 || ''}
                      onChange={(e) => onUpdateFilter(filter.id, { value2: e.target.value })}
                      placeholder="upper bound..."
                      className="flex-1 min-w-[100px] bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg)] outline-none focus:border-indigo-500"
                    />
                  </>
                )}

                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => onRemoveFilter(filter.id)}
                  className="text-[var(--muted)] hover:text-rose-400 p-1 rounded hover:bg-white/5 transition-colors cursor-pointer"
                  title="Remove filter condition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
