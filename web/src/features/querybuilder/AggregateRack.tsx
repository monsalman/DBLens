import React from 'react'
import { Plus, Trash2, ArrowUpDown, Layers } from 'lucide-react'
import type {
  QueryCanvasState,
  CanvasHaving,
  CanvasOrderBy,
} from '../../lib/api'
import { SUPPORTED_AGGREGATES, SUPPORTED_OPERATORS } from './queryBuilderHelper'

interface AggregateRackProps {
  state: QueryCanvasState
  onAddHaving: (having: Omit<CanvasHaving, 'id'>) => void
  onUpdateHaving: (id: string, partial: Partial<CanvasHaving>) => void
  onRemoveHaving: (id: string) => void
  onAddOrderBy: (order: Omit<CanvasOrderBy, 'id'>) => void
  onUpdateOrderBy: (id: string, partial: Partial<CanvasOrderBy>) => void
  onRemoveOrderBy: (id: string) => void
  onSetDistinct: (distinct: boolean) => void
  onSetLimit: (limit?: number) => void
  onSetOffset: (offset?: number) => void
}

export const AggregateRack: React.FC<AggregateRackProps> = ({
  state,
  onAddHaving,
  onUpdateHaving,
  onRemoveHaving,
  onAddOrderBy,
  onUpdateOrderBy,
  onRemoveOrderBy,
  onSetDistinct,
  onSetLimit,
  onSetOffset,
}) => {
  const tables = state.tables || []
  const havings = state.havings || []
  const orderBy = state.orderBy || []

  const handleAddHaving = () => {
    if (tables.length === 0) return
    const firstTable = tables[0]
    const firstCol = firstTable.columns[0]?.name || 'id'
    onAddHaving({
      aggregate: 'COUNT',
      tableId: firstTable.id,
      column: firstCol,
      operator: '>',
      value: '0',
      logic: 'AND',
    })
  }

  const handleAddOrder = () => {
    if (tables.length === 0) return
    const firstTable = tables[0]
    const firstCol = firstTable.columns[0]?.name || 'id'
    onAddOrderBy({
      tableId: firstTable.id,
      column: firstCol,
      direction: 'ASC',
      nulls: '',
    })
  }

  if (tables.length === 0) {
    return (
      <div className="p-8 text-center text-[var(--muted)] text-xs flex flex-col items-center justify-center gap-2">
        <Layers className="w-8 h-8 opacity-30 text-indigo-400" />
        <p>Add tables to the canvas first to configure Ordering, Having, and Limit modifiers.</p>
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-col gap-6 font-sans text-xs">
      {/* Query Modifiers (DISTINCT, LIMIT, OFFSET) */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-md p-3 flex items-center justify-between gap-4 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer text-xs text-white">
          <input
            type="checkbox"
            checked={Boolean(state.distinct)}
            onChange={(e) => onSetDistinct(e.target.checked)}
            className="rounded border-[var(--border)] text-indigo-500 focus:ring-0 cursor-pointer accent-indigo-500"
          />
          <span className="font-semibold">SELECT DISTINCT</span>
          <span className="text-[10px] text-[var(--muted)]">(Eliminate duplicate result rows)</span>
        </label>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--muted)]">LIMIT:</span>
            <input
              type="number"
              min="0"
              value={state.limit !== undefined ? state.limit : 100}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                onSetLimit(isNaN(val) ? undefined : val)
              }}
              className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded px-1.5 py-0.5 text-center text-white outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--muted)]">OFFSET:</span>
            <input
              type="number"
              min="0"
              value={state.offset !== undefined ? state.offset : 0}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                onSetOffset(isNaN(val) ? undefined : val)
              }}
              className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded px-1.5 py-0.5 text-center text-white outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* ORDER BY section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-white">ORDER BY Sorting</span>
            <span className="text-[10px] text-[var(--muted)]">({orderBy.length} clauses)</span>
          </div>
          <button
            type="button"
            onClick={handleAddOrder}
            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Sorting</span>
          </button>
        </div>

        {orderBy.length === 0 ? (
          <div className="border border-dashed border-[var(--border)] rounded-lg p-3 text-center text-[var(--muted)] text-[11px]">
            No sorting specified (rows returned in storage order).
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {orderBy.map((ob) => {
              const table = tables.find((t) => t.id === ob.tableId) || tables[0]
              const columns = table?.columns || []

              return (
                <div
                  key={ob.id}
                  className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-md p-2"
                >
                  <span className="text-[10px] text-[var(--muted)] font-mono w-6">SORT</span>
                  {/* Table selector */}
                  <select
                    value={ob.tableId}
                    onChange={(e) => {
                      const newTableId = e.target.value
                      const newTable = tables.find((t) => t.id === newTableId)
                      const newCol = newTable?.columns[0]?.name || ''
                      onUpdateOrderBy(ob.id, { tableId: newTableId, column: newCol })
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
                    value={ob.column}
                    onChange={(e) => onUpdateOrderBy(ob.id, { column: e.target.value })}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg)] outline-none min-w-[120px]"
                  >
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  {/* Direction ASC/DESC */}
                  <select
                    value={ob.direction || 'ASC'}
                    onChange={(e) => onUpdateOrderBy(ob.id, { direction: e.target.value })}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg)] outline-none font-semibold text-xs"
                  >
                    <option value="ASC">ASC (A-Z, 0-9)</option>
                    <option value="DESC">DESC (Z-A, 9-0)</option>
                  </select>

                  {/* NULLS FIRST/LAST */}
                  <select
                    value={ob.nulls || ''}
                    onChange={(e) => onUpdateOrderBy(ob.id, { nulls: e.target.value })}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg)] outline-none text-xs"
                  >
                    <option value="">Default Nulls</option>
                    <option value="FIRST">NULLS FIRST</option>
                    <option value="LAST">NULLS LAST</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => onRemoveOrderBy(ob.id)}
                    className="text-[var(--muted)] hover:text-rose-400 p-1 rounded hover:bg-white/5 transition-colors cursor-pointer ml-auto"
                    title="Remove sort"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* HAVING section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-400" />
            <span className="font-semibold text-white">HAVING Filters</span>
            <span className="text-[10px] text-[var(--muted)]">({havings.length} conditions)</span>
          </div>
          <button
            type="button"
            onClick={handleAddHaving}
            className="flex items-center gap-1 px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-medium transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add HAVING</span>
          </button>
        </div>

        {havings.length === 0 ? (
          <div className="border border-dashed border-[var(--border)] rounded-lg p-3 text-center text-[var(--muted)] text-[11px]">
            No HAVING aggregate filter applied.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {havings.map((h, i) => {
              const table = tables.find((t) => t.id === h.tableId) || tables[0]
              const columns = table?.columns || []

              return (
                <div
                  key={h.id}
                  className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-md p-2 flex-wrap sm:flex-nowrap"
                >
                  {/* Logic */}
                  {i > 0 ? (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateHaving(h.id, { logic: h.logic === 'OR' ? 'AND' : 'OR' })
                      }
                      className="w-12 py-1 rounded text-[10px] font-bold border text-center bg-purple-500/20 text-purple-300 border-purple-500/40 cursor-pointer"
                    >
                      {h.logic || 'AND'}
                    </button>
                  ) : (
                    <span className="w-12 py-1 text-center text-[10px] font-bold text-[var(--muted)]">
                      HAVING
                    </span>
                  )}

                  {/* Aggregate */}
                  <select
                    value={h.aggregate}
                    onChange={(e) => onUpdateHaving(h.id, { aggregate: e.target.value })}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-amber-300 font-semibold outline-none text-xs"
                  >
                    {SUPPORTED_AGGREGATES.filter((a) => a !== 'NONE').map((agg) => (
                      <option key={agg} value={agg}>
                        {agg}
                      </option>
                    ))}
                  </select>

                  {/* Table */}
                  <select
                    value={h.tableId}
                    onChange={(e) => {
                      const newTableId = e.target.value
                      const newTable = tables.find((t) => t.id === newTableId)
                      const newCol = newTable?.columns[0]?.name || ''
                      onUpdateHaving(h.id, { tableId: newTableId, column: newCol })
                    }}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg)] outline-none min-w-[100px]"
                  >
                    {tables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.alias || t.name}
                      </option>
                    ))}
                  </select>

                  {/* Column */}
                  <select
                    value={h.column}
                    onChange={(e) => onUpdateHaving(h.id, { column: e.target.value })}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg)] outline-none min-w-[110px]"
                  >
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  {/* Operator */}
                  <select
                    value={h.operator}
                    onChange={(e) => onUpdateHaving(h.id, { operator: e.target.value })}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg)] outline-none font-mono text-xs"
                  >
                    {SUPPORTED_OPERATORS.map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>

                  {/* Value */}
                  <input
                    type="text"
                    value={h.value}
                    onChange={(e) => onUpdateHaving(h.id, { value: e.target.value })}
                    placeholder="value..."
                    className="flex-1 min-w-[80px] bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg)] outline-none focus:border-purple-500"
                  />

                  <button
                    type="button"
                    onClick={() => onRemoveHaving(h.id)}
                    className="text-[var(--muted)] hover:text-rose-400 p-1 rounded hover:bg-white/5 transition-colors cursor-pointer"
                    title="Remove HAVING condition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
