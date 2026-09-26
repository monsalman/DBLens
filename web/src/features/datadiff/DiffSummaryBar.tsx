import React from 'react'
import {
  PlusCircle,
  AlertCircle,
  MinusCircle,
  CheckCircle2,
  Layers,
  Search,
  CheckSquare,
  Square,
} from 'lucide-react'
import type { DataDiffSummary } from './dataDiffHelper'

export interface DiffSummaryBarProps {
  summary: DataDiffSummary
  selectedFilter: 'all' | 'added' | 'deleted' | 'modified' | 'identical'
  onSelectFilter: (filter: 'all' | 'added' | 'deleted' | 'modified' | 'identical') => void
  selectedRowsCount: number
  totalRowsCount: number
  onToggleSelectAll: () => void
  isAllSelected: boolean
  searchTerm: string
  onSearchChange: (term: string) => void
}

export const DiffSummaryBar: React.FC<DiffSummaryBarProps> = ({
  summary,
  selectedFilter,
  onSelectFilter,
  selectedRowsCount,
  totalRowsCount,
  onToggleSelectAll,
  isAllSelected,
  searchTerm,
  onSearchChange,
}) => {
  return (
    <div className="flex flex-col gap-2.5 p-3 rounded-lg border border-[var(--border)] bg-[var(--hover)]/30 font-mono text-xs">
      {/* KPI filter pills */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* ALL */}
          <button
            type="button"
            onClick={() => onSelectFilter('all')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-all cursor-pointer ${
              selectedFilter === 'all'
                ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-xs'
                : 'bg-[var(--bg)] border-[var(--border)] text-[var(--fg)] hover:border-[var(--muted)]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>All Rows</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-black/20 text-inherit font-bold">
              {summary.addedCount + summary.modifiedCount + summary.deletedCount + summary.identicalCount}
            </span>
          </button>

          {/* ADDED */}
          <button
            type="button"
            onClick={() => onSelectFilter('added')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-all cursor-pointer ${
              selectedFilter === 'added'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:border-emerald-500/40'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>+{summary.addedCount} to Insert</span>
          </button>

          {/* MODIFIED */}
          <button
            type="button"
            onClick={() => onSelectFilter('modified')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-all cursor-pointer ${
              selectedFilter === 'modified'
                ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:border-amber-500/40'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>~{summary.modifiedCount} to Update</span>
          </button>

          {/* DELETED */}
          <button
            type="button"
            onClick={() => onSelectFilter('deleted')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-all cursor-pointer ${
              selectedFilter === 'deleted'
                ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-400 hover:border-rose-500/40'
            }`}
          >
            <MinusCircle className="w-3.5 h-3.5" />
            <span>-{summary.deletedCount} to Delete</span>
          </button>

          {/* IDENTICAL */}
          <button
            type="button"
            onClick={() => onSelectFilter('identical')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-all cursor-pointer ${
              selectedFilter === 'identical'
                ? 'bg-zinc-600 text-white border-zinc-600 shadow-xs'
                : 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400 hover:border-zinc-500/40'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>={summary.identicalCount} Identical</span>
          </button>
        </div>

        <div className="text-[11px] text-[var(--muted)]">
          Compared in <span className="font-semibold text-[var(--fg)]">{summary.durationMs}ms</span>
        </div>
      </div>

      {/* Row selection toggle & Search filter */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--border)]/40">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleSelectAll}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover)] text-[11px] text-[var(--fg)] cursor-pointer"
          >
            {isAllSelected ? (
              <CheckSquare className="w-3.5 h-3.5 text-[var(--accent)]" />
            ) : (
              <Square className="w-3.5 h-3.5 text-[var(--muted)]" />
            )}
            <span>
              {isAllSelected ? 'Deselect All' : 'Select All'} ({selectedRowsCount}/{totalRowsCount})
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-[var(--border)] bg-[var(--bg)] w-64">
          <Search className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search rows or values..."
            className="w-full bg-transparent text-[11px] text-[var(--fg)] focus:outline-hidden placeholder:text-[var(--muted)]"
          />
        </div>
      </div>
    </div>
  )
}
