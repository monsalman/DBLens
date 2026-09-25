import React, { useState, useMemo } from 'react'
import {
  ArrowRight,
  Database,
  Search,
  RefreshCw,
  GitFork,
  AlertTriangle,
} from 'lucide-react'
import {
  type TableSeedPlan,
} from './seederHelper'

interface TableDAGTimelineProps {
  tables: TableSeedPlan[]
  dagOrder: string[]
  selectedTables: string[]
  onToggleTable: (table: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  customRowCounts: Record<string, number>
  onUpdateRowCount: (table: string, count: number) => void
  defaultRowCount: number
  cyclesDetected?: boolean
}

export const TableDAGTimeline: React.FC<TableDAGTimelineProps> = ({
  tables,
  dagOrder,
  selectedTables,
  onToggleTable,
  onSelectAll,
  onDeselectAll,
  customRowCounts,
  onUpdateRowCount,
  defaultRowCount,
  cyclesDetected,
}) => {
  const [filter, setFilter] = useState('')

  // Group tables by DAG level
  const tablesByLevel = useMemo(() => {
    const tableMap = new Map<string, TableSeedPlan>()
    for (const t of tables) {
      tableMap.set(t.table, t)
    }

    const groups = new Map<number, TableSeedPlan[]>()
    for (const tbl of dagOrder) {
      const t = tableMap.get(tbl)
      if (!t) continue
      if (filter && !t.table.toLowerCase().includes(filter.toLowerCase())) {
        continue
      }
      const lvl = t.level || 0
      if (!groups.has(lvl)) {
        groups.set(lvl, [])
      }
      groups.get(lvl)!.push(t)
    }

    const sortedLevels = Array.from(groups.keys()).sort((a, b) => a - b)
    return sortedLevels.map((lvl) => ({
      level: lvl,
      tables: groups.get(lvl)!,
    }))
  }, [tables, dagOrder, filter])

  return (
    <div className="space-y-4">
      {/* Top Filter and Select Toolbar */}
      <div className="flex items-center justify-between gap-3 bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search tables..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-zinc-800/80 border border-zinc-700/70 rounded-md pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSelectAll}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition"
          >
            Select All
          </button>
          <button
            type="button"
            onClick={onDeselectAll}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition"
          >
            Clear
          </button>
        </div>
      </div>

      {cyclesDetected && (
        <div className="flex items-center gap-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs px-3.5 py-2.5 rounded-lg">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-400" />
          <span>
            Circular or self-referencing foreign keys detected. Resolved automatically via two-pass insertion with deferred updates.
          </span>
        </div>
      )}

      {/* DAG Levels Timeline */}
      <div className="space-y-6">
        {tablesByLevel.map(({ level, tables: lvlTables }) => (
          <div key={level} className="relative">
            {/* Level Tier Header */}
            <div className="flex items-center gap-2 mb-2.5">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-[11px] font-semibold border border-indigo-500/30">
                {level}
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                {level === 0 ? 'Root Tables (Independent)' : `Tier ${level} Dependents`}
              </span>
              <span className="text-[11px] text-zinc-500">
                ({lvlTables.length} {lvlTables.length === 1 ? 'table' : 'tables'})
              </span>
            </div>

            {/* Tables Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pl-3 border-l-2 border-zinc-800/80">
              {lvlTables.map((t) => {
                const isSelected = selectedTables.includes(t.table)
                const rowCount = customRowCounts[t.table] ?? t.rowCount ?? defaultRowCount
                const hasSelfFk = (t.selfFks && t.selfFks.length > 0)
                const hasDeferred = (t.deferredFks && t.deferredFks.length > 0)

                return (
                  <div
                    key={t.table}
                    className={`flex flex-col p-3 rounded-lg border transition-all ${
                      isSelected
                        ? 'bg-zinc-900/90 border-zinc-700/80 shadow-sm'
                        : 'bg-zinc-950/40 border-zinc-800/40 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleTable(t.table)}
                          className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-indigo-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                        <span className="text-xs font-semibold text-zinc-200 hover:text-white flex items-center gap-1.5">
                          <Database className="w-3.5 h-3.5 text-zinc-400" />
                          {t.table}
                        </span>
                      </label>

                      {/* Row count input */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-zinc-500">Rows:</span>
                        <input
                          type="number"
                          min={1}
                          max={100000}
                          value={rowCount}
                          onChange={(e) =>
                            onUpdateRowCount(
                              t.table,
                              Math.max(1, parseInt(e.target.value, 10) || 1)
                            )
                          }
                          disabled={!isSelected}
                          className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-right text-zinc-200 focus:outline-none focus:border-indigo-500 disabled:opacity-40"
                        />
                      </div>
                    </div>

                    {/* Metadata & Dependencies */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                        {t.columns.length} columns
                      </span>

                      {t.pkColumn && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          PK: {t.pkColumn}
                        </span>
                      )}

                      {hasSelfFk && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1">
                          <RefreshCw className="w-2.5 h-2.5" /> Self-FK
                        </span>
                      )}

                      {hasDeferred && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                          <GitFork className="w-2.5 h-2.5" /> 2-Pass FK
                        </span>
                      )}

                      {t.dependencies && t.dependencies.length > 0 && (
                        <div className="flex items-center gap-1 text-zinc-500 ml-auto">
                          <ArrowRight className="w-3 h-3" />
                          <span>depends on {t.dependencies.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
