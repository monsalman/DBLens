import React, { useState } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import {
  Table as TableIcon,
  X,
  CheckSquare,
  Square,
  Search,
  Pencil,
  Tag,
} from 'lucide-react'
import type { CanvasTable } from '../../lib/api'
import { SUPPORTED_AGGREGATES } from './queryBuilderHelper'

export type TableNodeData = {
  table: CanvasTable
  onRemoveTable: (id: string) => void
  onToggleColumn: (tableId: string, colName: string) => void
  onSelectAll: (tableId: string, select: boolean) => void
  onSetAggregate: (tableId: string, colName: string, agg: string) => void
  onSetColAlias: (tableId: string, colName: string, alias: string) => void
  onSetTblAlias: (tableId: string, alias: string) => void
}

export type TableNodeType = Node<TableNodeData, 'tableNode'>

export const TableNode: React.FC<NodeProps<TableNodeType>> = ({ data }) => {
  const {
    table,
    onRemoveTable,
    onToggleColumn,
    onSelectAll,
    onSetAggregate,
    onSetColAlias,
    onSetTblAlias,
  } = data

  const [colSearch, setColSearch] = useState('')
  const [editingAlias, setEditingAlias] = useState(false)
  const [activeColAlias, setActiveColAlias] = useState<string | null>(null)

  const allSelected = table.columns.length > 0 && table.columns.every((c) => c.selected)
  const someSelected = table.columns.some((c) => c.selected)

  const filteredColumns = table.columns.filter((c) =>
    c.name.toLowerCase().includes(colSearch.toLowerCase())
  )

  return (
    <div className="bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] rounded-lg shadow-xl min-w-[280px] max-w-[340px] overflow-hidden select-none font-sans text-xs">
      {/* Node Header */}
      <div className="bg-[#181a20] px-3 py-2 border-b border-[var(--border)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 overflow-hidden flex-1">
          <TableIcon className="w-4 h-4 shrink-0 text-indigo-400" />
          <div className="flex flex-col overflow-hidden">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-white truncate text-xs" title={table.name}>
                {table.name}
              </span>
              {table.schema && (
                <span className="text-[10px] text-[var(--muted)] font-mono px-1 py-0.2 rounded bg-black/30 border border-white/5 shrink-0">
                  {table.schema}
                </span>
              )}
            </div>
            {/* Alias preview or edit */}
            {editingAlias ? (
              <input
                type="text"
                value={table.alias || ''}
                onChange={(e) => onSetTblAlias(table.id, e.target.value)}
                onBlur={() => setEditingAlias(false)}
                onKeyDown={(e) => e.key === 'Enter' && setEditingAlias(false)}
                autoFocus
                placeholder="table alias..."
                className="text-[11px] bg-[var(--bg)] border border-indigo-500/50 rounded px-1 py-0.5 text-white outline-none w-24 mt-0.5"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingAlias(true)}
                className="text-[10px] text-indigo-300 hover:text-indigo-200 flex items-center gap-1 text-left mt-0.5 cursor-pointer"
                title="Click to edit table alias"
              >
                <Tag className="w-2.5 h-2.5" />
                <span>as {table.alias || table.name}</span>
                <Pencil className="w-2.5 h-2.5 opacity-60" />
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onRemoveTable(table.id)}
          className="text-[var(--muted)] hover:text-rose-400 p-1 rounded hover:bg-white/5 transition-colors cursor-pointer"
          title="Remove table from canvas"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Subheader: Bulk Select + Search */}
      <div className="px-3 py-1.5 bg-[#121316] border-b border-[var(--border)] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onSelectAll(table.id, !allSelected)}
          className="flex items-center gap-1.5 text-[11px] text-[var(--fg)] hover:text-indigo-400 transition-colors cursor-pointer"
        >
          {allSelected ? (
            <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
          ) : someSelected ? (
            <div className="w-3.5 h-3.5 border border-indigo-400 bg-indigo-400/30 rounded flex items-center justify-center text-[9px] text-indigo-300 font-bold">
              -
            </div>
          ) : (
            <Square className="w-3.5 h-3.5 text-[var(--muted)]" />
          )}
          <span>{allSelected ? 'Deselect All' : 'Select All'}</span>
        </button>

        {table.columns.length > 6 && (
          <div className="relative flex items-center">
            <Search className="w-3 h-3 text-[var(--muted)] absolute left-1.5 pointer-events-none" />
            <input
              type="text"
              value={colSearch}
              onChange={(e) => setColSearch(e.target.value)}
              placeholder="Search..."
              className="w-24 pl-5 pr-1.5 py-0.5 text-[10px] bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--fg)] placeholder-[var(--muted)] outline-none focus:border-indigo-500"
            />
          </div>
        )}
      </div>

      {/* Column rows */}
      <div className="max-h-[280px] overflow-y-auto divide-y divide-white/5">
        {filteredColumns.map((col) => {
          const isSelected = col.selected
          const hasAgg = col.aggregate && col.aggregate !== 'NONE'

          return (
            <div
              key={col.name}
              className={`relative px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-white/[0.03] transition-colors ${
                isSelected ? 'bg-indigo-500/[0.06]' : ''
              }`}
            >
              {/* Left Handle for incoming joins */}
              <Handle
                type="target"
                id={`${table.id}__${col.name}__in`}
                position={Position.Left}
                className="w-2.5 h-2.5 !bg-indigo-500 !border-2 !border-[var(--surface)] hover:!scale-125 transition-transform"
                title={`Join target: ${table.name}.${col.name}`}
              />

              {/* Column Select Checkbox + Name */}
              <div className="flex items-center gap-2 overflow-hidden flex-1">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleColumn(table.id, col.name)}
                  className="rounded border-[var(--border)] text-indigo-500 focus:ring-0 cursor-pointer accent-indigo-500"
                />
                <span
                  onClick={() => onToggleColumn(table.id, col.name)}
                  className={`truncate cursor-pointer text-xs ${
                    isSelected ? 'font-medium text-white' : 'text-[var(--fg)]'
                  }`}
                  title={col.name}
                >
                  {col.name}
                </span>
                {col.type && (
                  <span className="text-[10px] text-[var(--muted)] font-mono shrink-0">
                    {col.type}
                  </span>
                )}
              </div>

              {/* Aggregate & Alias Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {/* Aggregate selector */}
                <select
                  value={col.aggregate || 'NONE'}
                  onChange={(e) => onSetAggregate(table.id, col.name, e.target.value)}
                  className={`text-[10px] px-1 py-0.5 rounded border outline-none font-mono cursor-pointer ${
                    hasAgg
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold'
                      : 'bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-white'
                  }`}
                  title="Aggregate function"
                >
                  {SUPPORTED_AGGREGATES.map((agg) => (
                    <option key={agg} value={agg}>
                      {agg === 'NONE' ? 'agg…' : agg}
                    </option>
                  ))}
                </select>

                {/* Column Alias toggle */}
                {activeColAlias === col.name ? (
                  <input
                    type="text"
                    value={col.alias || ''}
                    onChange={(e) => onSetColAlias(table.id, col.name, e.target.value)}
                    onBlur={() => setActiveColAlias(null)}
                    onKeyDown={(e) => e.key === 'Enter' && setActiveColAlias(null)}
                    autoFocus
                    placeholder="as..."
                    className="w-16 text-[10px] bg-[var(--bg)] border border-indigo-500/50 rounded px-1 py-0.5 text-white outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveColAlias(col.name)}
                    className={`p-1 rounded hover:bg-white/10 cursor-pointer text-[10px] ${
                      col.alias ? 'text-indigo-400 font-semibold' : 'text-[var(--muted)]'
                    }`}
                    title={col.alias ? `Alias: ${col.alias}` : 'Set column alias'}
                  >
                    {col.alias ? col.alias : <Pencil className="w-2.5 h-2.5" />}
                  </button>
                )}
              </div>

              {/* Right Handle for outgoing joins */}
              <Handle
                type="source"
                id={`${table.id}__${col.name}__out`}
                position={Position.Right}
                className="w-2.5 h-2.5 !bg-indigo-500 !border-2 !border-[var(--surface)] hover:!scale-125 transition-transform"
                title={`Join source: ${table.name}.${col.name}`}
              />
            </div>
          )
        })}

        {filteredColumns.length === 0 && (
          <div className="px-3 py-3 text-center text-[10px] text-[var(--muted)]">
            No columns match '{colSearch}'
          </div>
        )}
      </div>
    </div>
  )
}
