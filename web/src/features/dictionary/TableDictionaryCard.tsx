import React, { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Key,
  Link as LinkIcon,
  ShieldAlert,
  Layers,
  Database,
  Table as TableIcon,
} from 'lucide-react'
import type { DictionaryTable, CommentUpdateRequest } from './dictionaryHelper'
import { PiiTagBadge } from './PiiTagBadge'
import { ColumnCommentEditor } from './ColumnCommentEditor'

interface TableDictionaryCardProps {
  table: DictionaryTable
  onUpdateComment: (req: CommentUpdateRequest) => Promise<boolean>
  searchQuery?: string
  defaultExpanded?: boolean
}

export const TableDictionaryCard: React.FC<TableDictionaryCardProps> = ({
  table,
  onUpdateComment,
  searchQuery = '',
  defaultExpanded = true,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [showIndexes, setShowIndexes] = useState(false)
  const [showFKs, setShowFKs] = useState(false)

  const isView = table.type.toLowerCase() === 'view'
  const q = searchQuery.toLowerCase().trim()

  return (
    <div
      className={`border rounded-lg overflow-hidden bg-[var(--card)] transition-colors ${
        table.piiCount > 0 ? 'border-rose-500/30' : 'border-[var(--border)]'
      }`}
    >
      {/* Table Header */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-4 py-3 bg-[var(--surface)] hover:bg-[var(--hover)] border-b border-[var(--border)] flex items-center justify-between cursor-pointer select-none transition-colors"
      >
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            className="text-[var(--muted)] hover:text-[var(--fg)] p-0.5"
            aria-label={isExpanded ? 'Collapse table' : 'Expand table'}
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          {isView ? (
            <Layers className="w-4 h-4 text-purple-500 shrink-0" />
          ) : (
            <TableIcon className="w-4 h-4 text-blue-500 shrink-0" />
          )}

          <span className="font-mono text-sm font-bold text-[var(--fg)]">
            {table.schema}.{table.name}
          </span>

          <span
            className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold uppercase ${
              isView
                ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30'
                : 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30'
            }`}
          >
            {table.type}
          </span>

          {table.piiCount > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"
              title={`${table.piiCount} Personally Identifiable Information column(s) detected`}
            >
              <ShieldAlert className="w-3 h-3" />
              <span>{table.piiCount} PII</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
          <span title="Estimated row count">
            <strong>{table.rowCount.toLocaleString()}</strong> rows
          </span>
          <span>•</span>
          <span title="Total storage size">{table.sizeFormatted}</span>
          <span>•</span>
          <span>{table.columns.length} cols</span>
        </div>
      </div>

      {/* Table Body */}
      {isExpanded && (
        <div className="p-4 flex flex-col gap-4">
          {/* Table Comment / Description */}
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-md p-2.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] mb-1 flex items-center gap-1">
              <Database className="w-3 h-3" />
              <span>Table Documentation</span>
            </div>
            <ColumnCommentEditor
              schema={table.schema}
              table={table.name}
              initialComment={table.comment}
              onSave={onUpdateComment}
              placeholder="+ Add table documentation / purpose / SLA rules..."
            />
          </div>

          {/* Columns Table */}
          <div className="overflow-x-auto border border-[var(--border)] rounded-md">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[var(--surface)] text-[var(--muted)] uppercase text-[10px] tracking-wider border-b border-[var(--border)]">
                  <th className="py-2 px-3 w-[22%]">Column</th>
                  <th className="py-2 px-3 w-[15%]">Type</th>
                  <th className="py-2 px-3 w-[9%]">Nullable</th>
                  <th className="py-2 px-3 w-[14%]">Default</th>
                  <th className="py-2 px-3 w-[15%]">PII Classification</th>
                  <th className="py-2 px-3 w-[25%]">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {table.columns.map((col) => {
                  const isMatchingSearch =
                    q &&
                    (col.name.toLowerCase().includes(q) ||
                      col.type.toLowerCase().includes(q) ||
                      (col.piiType || '').toLowerCase().includes(q) ||
                      (col.comment || '').toLowerCase().includes(q))

                  return (
                    <tr
                      key={col.name}
                      className={`hover:bg-[var(--hover)] transition-colors ${
                        isMatchingSearch ? 'bg-blue-500/10 dark:bg-blue-900/20' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 font-mono">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {col.isPrimary && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                              title="Primary Key"
                            >
                              <Key className="w-2.5 h-2.5" />
                              <span>PK</span>
                            </span>
                          )}
                          {col.isForeignKey && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-bold bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30"
                              title="Foreign Key"
                            >
                              <LinkIcon className="w-2.5 h-2.5" />
                              <span>FK</span>
                            </span>
                          )}
                          <span className="font-semibold text-[var(--fg)]">{col.name}</span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 font-mono text-blue-600 dark:text-blue-400">
                        {col.type}
                      </td>

                      <td className="py-2.5 px-3">
                        {col.isNullable ? (
                          <span className="text-[var(--muted)] text-[11px]">YES</span>
                        ) : (
                          <span className="font-semibold text-[var(--fg)] text-[11px]">NO</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 font-mono text-[11px] text-[var(--muted)] truncate max-w-[140px]" title={col.default || ''}>
                        {col.default || '-'}
                      </td>

                      <td className="py-2.5 px-3">
                        {col.piiType ? (
                          <PiiTagBadge piiType={col.piiType} />
                        ) : (
                          <span className="text-[var(--muted)]">-</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3">
                        <ColumnCommentEditor
                          schema={table.schema}
                          table={table.name}
                          column={col.name}
                          initialComment={col.comment}
                          onSave={onUpdateComment}
                          placeholder="+ Add column note..."
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Indexes & Foreign Keys Toggle Bars */}
          <div className="flex items-center gap-4 flex-wrap pt-1 text-xs">
            {table.indexes && table.indexes.length > 0 && (
              <div className="flex-1 min-w-[280px]">
                <button
                  type="button"
                  onClick={() => setShowIndexes(!showIndexes)}
                  className="flex items-center gap-1.5 text-[var(--muted)] hover:text-[var(--fg)] font-semibold text-[11px] mb-2 cursor-pointer"
                >
                  {showIndexes ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <span>Indexes ({table.indexes.length})</span>
                </button>

                {showIndexes && (
                  <div className="flex flex-wrap gap-1.5">
                    {table.indexes.map((idx) => (
                      <span
                        key={idx.name}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface)] border border-[var(--border)] font-mono text-[10px]"
                      >
                        <strong className="text-[var(--fg)]">{idx.name}</strong>: ({idx.columns.join(', ')})
                        {idx.isUnique && (
                          <span className="text-amber-500 font-bold ml-1 text-[9px]">UNIQUE</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {table.foreignKeys && table.foreignKeys.length > 0 && (
              <div className="flex-1 min-w-[280px]">
                <button
                  type="button"
                  onClick={() => setShowFKs(!showFKs)}
                  className="flex items-center gap-1.5 text-[var(--muted)] hover:text-[var(--fg)] font-semibold text-[11px] mb-2 cursor-pointer"
                >
                  {showFKs ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <span>Foreign Keys ({table.foreignKeys.length})</span>
                </button>

                {showFKs && (
                  <div className="flex flex-wrap gap-1.5">
                    {table.foreignKeys.map((fk, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface)] border border-[var(--border)] font-mono text-[10px]"
                      >
                        <span className="text-blue-500">{fk.column}</span>
                        <span>→</span>
                        <strong className="text-[var(--fg)]">
                          {fk.refTable}({fk.refColumn})
                        </strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
