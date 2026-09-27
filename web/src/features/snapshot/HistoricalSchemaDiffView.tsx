import React, { useState } from 'react'
import {
  Plus,
  Minus,
  AlertTriangle,
  CheckCircle2,
  Table as TableIcon,
  Columns,
  Layers,
  ChevronDown,
  ChevronRight,
  FileCode2,
} from 'lucide-react'
import {
  formatDriftSummary,
  getDeltaBadgeClass,
  type SnapshotDiff,
  type TableNode,
  type TableDrift,
} from './snapshotHelper'

interface Props {
  diff: SnapshotDiff
  onGenerateRollback: () => void
  isGeneratingPlan: boolean
}

export const HistoricalSchemaDiffView: React.FC<Props> = ({
  diff,
  onGenerateRollback,
  isGeneratingPlan,
}) => {
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({})

  const toggleTable = (key: string) => {
    setExpandedTables((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const { summary, totalDrifts } = diff

  if (totalDrifts === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-[var(--muted)] border border-[var(--border)] rounded-lg bg-[var(--card)] my-4">
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-3 opacity-90" />
        <h4 className="text-base font-semibold text-[var(--fg)]">No Schema Drift Detected</h4>
        <p className="text-xs max-w-md mt-1">
          Base and target schema points are structurally identical across all tables, columns, indexes, and constraints.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4 text-xs">
      {/* Drift Summary KPI Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 p-3 rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div>
          <div className="text-sm font-semibold text-[var(--fg)] flex items-center gap-2">
            <span>Detected Drifts: {totalDrifts}</span>
            <span className="text-[11px] font-normal text-[var(--muted)]">
              ({formatDriftSummary(summary)})
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[11px]">
            <span className={`px-2 py-0.5 rounded ${getDeltaBadgeClass(summary.addedTables, 'added')}`}>
              +{summary.addedTables} Added Tables
            </span>
            <span className={`px-2 py-0.5 rounded ${getDeltaBadgeClass(summary.droppedTables, 'dropped')}`}>
              -{summary.droppedTables} Dropped Tables
            </span>
            <span className={`px-2 py-0.5 rounded ${getDeltaBadgeClass(summary.alteredTables, 'altered')}`}>
              ~{summary.alteredTables} Altered Tables
            </span>
            <span className="text-[var(--muted)]">|</span>
            <span className={`px-1.5 py-0.5 rounded ${getDeltaBadgeClass(summary.addedColumns, 'added')}`}>
              +{summary.addedColumns} Cols
            </span>
            <span className={`px-1.5 py-0.5 rounded ${getDeltaBadgeClass(summary.droppedColumns, 'dropped')}`}>
              -{summary.droppedColumns} Cols
            </span>
            <span className={`px-1.5 py-0.5 rounded ${getDeltaBadgeClass(summary.alteredColumns, 'altered')}`}>
              ~{summary.alteredColumns} Col Mods
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onGenerateRollback}
          disabled={isGeneratingPlan}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors shadow-sm cursor-pointer disabled:opacity-50"
        >
          <FileCode2 className="w-4 h-4" />
          <span>{isGeneratingPlan ? 'Generating...' : 'Generate Rollback DDL'}</span>
        </button>
      </div>

      {/* Added Tables */}
      {diff.addedTables.length > 0 && (
        <div className="space-y-2">
          <div className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 px-1">
            <Plus className="w-3.5 h-3.5" />
            <span>Added Tables ({diff.addedTables.length})</span>
          </div>
          <div className="space-y-2">
            {diff.addedTables.map((tbl) => (
              <AddedTableCard
                key={tbl.name}
                table={tbl}
                isExpanded={!!expandedTables[`added_${tbl.name}`]}
                onToggle={() => toggleTable(`added_${tbl.name}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Dropped Tables */}
      {diff.droppedTables.length > 0 && (
        <div className="space-y-2">
          <div className="font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5 px-1">
            <Minus className="w-3.5 h-3.5" />
            <span>Dropped Tables ({diff.droppedTables.length})</span>
          </div>
          <div className="space-y-2">
            {diff.droppedTables.map((tbl) => (
              <DroppedTableCard
                key={tbl.name}
                table={tbl}
                isExpanded={!!expandedTables[`dropped_${tbl.name}`]}
                onToggle={() => toggleTable(`dropped_${tbl.name}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Altered Tables */}
      {diff.alteredTables.length > 0 && (
        <div className="space-y-2">
          <div className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 px-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Altered Tables ({diff.alteredTables.length})</span>
          </div>
          <div className="space-y-2">
            {diff.alteredTables.map((drift) => (
              <AlteredTableCard
                key={drift.tableName}
                drift={drift}
                isExpanded={expandedTables[`altered_${drift.tableName}`] !== false}
                onToggle={() => toggleTable(`altered_${drift.tableName}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AddedTableCard({
  table,
  isExpanded,
  onToggle,
}: {
  table: TableNode
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-lg overflow-hidden">
      <div
        onClick={onToggle}
        className="flex items-center justify-between p-2.5 cursor-pointer hover:bg-emerald-500/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <TableIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="font-medium text-[var(--fg)]">{table.name}</span>
          <span className="text-[11px] text-[var(--muted)]">({table.columns.length} columns)</span>
        </div>
        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
          NEW TABLE
        </span>
      </div>

      {isExpanded && (
        <div className="p-3 border-t border-emerald-500/20 space-y-2 text-[11px]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {table.columns.map((col) => (
              <div key={col.name} className="flex items-center gap-1.5 font-mono text-[var(--fg)]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="font-semibold">{col.name}</span>
                <span className="text-[var(--muted)]">{col.type}</span>
                {col.isPrimary && <span className="text-[10px] text-amber-500 font-sans">[PK]</span>}
                {!col.isNullable && <span className="text-[10px] text-rose-500 font-sans">[NOT NULL]</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DroppedTableCard({
  table,
  isExpanded,
  onToggle,
}: {
  table: TableNode
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="border border-rose-500/30 bg-rose-500/5 rounded-lg overflow-hidden">
      <div
        onClick={onToggle}
        className="flex items-center justify-between p-2.5 cursor-pointer hover:bg-rose-500/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <TableIcon className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          <span className="font-medium text-[var(--fg)] line-through opacity-80">{table.name}</span>
          <span className="text-[11px] text-[var(--muted)]">({table.columns.length} columns lost)</span>
        </div>
        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-700 dark:text-rose-300">
          DROPPED TABLE
        </span>
      </div>

      {isExpanded && (
        <div className="p-3 border-t border-rose-500/20 space-y-2 text-[11px]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {table.columns.map((col) => (
              <div key={col.name} className="flex items-center gap-1.5 font-mono text-[var(--muted)]">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                <span className="line-through">{col.name}</span>
                <span>{col.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AlteredTableCard({
  drift,
  isExpanded,
  onToggle,
}: {
  drift: TableDrift
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg overflow-hidden">
      <div
        onClick={onToggle}
        className="flex items-center justify-between p-2.5 cursor-pointer hover:bg-amber-500/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <TableIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span className="font-semibold text-[var(--fg)]">{drift.tableName}</span>
        </div>

        <div className="flex items-center gap-2 text-[10px]">
          {(drift.addedColumns?.length || 0) > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium">
              +{drift.addedColumns?.length} cols
            </span>
          )}
          {(drift.droppedColumns?.length || 0) > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-700 dark:text-rose-300 font-medium">
              -{drift.droppedColumns?.length} cols
            </span>
          )}
          {(drift.alteredColumns?.length || 0) > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium">
              ~{drift.alteredColumns?.length} modified
            </span>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="p-3 border-t border-amber-500/20 space-y-3">
          {/* Added Columns */}
          {drift.addedColumns && drift.addedColumns.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <Columns className="w-3 h-3" />
                <span>Added Columns</span>
              </div>
              <div className="space-y-1 pl-4">
                {drift.addedColumns.map((col) => (
                  <div key={col.name} className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-emerald-500 font-bold">+</span>
                    <span className="text-[var(--fg)] font-medium">{col.name}</span>
                    <span className="text-[var(--muted)]">{col.type}</span>
                    {!col.isNullable && <span className="text-[10px] text-rose-500">[NOT NULL]</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dropped Columns */}
          {drift.droppedColumns && drift.droppedColumns.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                <Columns className="w-3 h-3" />
                <span>Dropped Columns</span>
              </div>
              <div className="space-y-1 pl-4">
                {drift.droppedColumns.map((col) => (
                  <div key={col.name} className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-rose-500 font-bold">-</span>
                    <span className="text-[var(--fg)] line-through">{col.name}</span>
                    <span className="text-[var(--muted)]">{col.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Altered Columns */}
          {drift.alteredColumns && drift.alteredColumns.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <Columns className="w-3 h-3" />
                <span>Modified Columns</span>
              </div>
              <div className="space-y-1 pl-4">
                {drift.alteredColumns.map((col) => (
                  <div key={col.columnName} className="font-mono text-[11px] space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-500 font-bold">~</span>
                      <span className="text-[var(--fg)] font-medium">{col.columnName}</span>
                    </div>
                    <div className="pl-4 text-[10px] text-amber-700 dark:text-amber-300">
                      {col.changes.join(' • ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Added & Dropped Indexes */}
          {((drift.addedIndexes?.length || 0) > 0 || (drift.droppedIndexes?.length || 0) > 0) && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-[var(--muted)] flex items-center gap-1">
                <Layers className="w-3 h-3" />
                <span>Index Changes</span>
              </div>
              <div className="space-y-1 pl-4 font-mono text-[11px]">
                {drift.addedIndexes?.map((idx) => (
                  <div key={idx.name} className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <span>+ Index</span>
                    <span className="font-semibold">{idx.name}</span>
                    <span>({idx.columns.join(', ')})</span>
                  </div>
                ))}
                {drift.droppedIndexes?.map((idx) => (
                  <div key={idx.name} className="text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                    <span>- Index</span>
                    <span className="line-through">{idx.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
