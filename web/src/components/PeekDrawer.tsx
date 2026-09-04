import React from 'react'
import { X, Table2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../stores/appStore'
import { api } from '../lib/api'

export const PeekDrawer: React.FC = () => {
  const { peekDrawer, closePeekDrawer, activeConnectionId } = useAppStore()
  const { isOpen, targetTable, targetColumn, filterValue } = peekDrawer

  const { data: relatedData, isLoading } = useQuery({
    queryKey: ['peekData', activeConnectionId, targetTable, targetColumn, filterValue],
    queryFn: () =>
      activeConnectionId && targetTable
        ? api.queryTableData(activeConnectionId, targetTable, {
            filters: targetColumn ? [{ column: targetColumn, operator: '=', value: String(filterValue) }] : [],
            limit: 10,
          })
        : null,
    enabled: isOpen && !!activeConnectionId && !!targetTable,
  })

  if (!isOpen || !targetTable) return null

  const rows = relatedData?.rows || []

  return (
    <div className="fixed inset-y-0 right-0 w-80 max-w-full bg-[var(--surface)] border-l border-[var(--border)] z-40 flex flex-col">
      {/* Header */}
      <div className="h-10 px-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg)]">
        <div className="flex items-center gap-1.5 font-mono text-xs text-[var(--fg)]">
          <Table2 className="w-3.5 h-3.5 text-[var(--muted)]" />
          <span className="truncate">{targetTable}</span>
          <span className="text-[10px] text-[var(--muted)]">
            ({targetColumn}={String(filterValue)})
          </span>
        </div>
        <button
          onClick={closePeekDrawer}
          className="text-[var(--muted)] hover:text-[var(--fg)] p-0.5"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {isLoading ? (
          <div className="text-center py-6 text-xs text-[var(--muted)] font-mono">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-xs text-[var(--muted)] font-mono">No matching records</div>
        ) : (
          rows.map((row: Record<string, any>, idx: number) => (
            <div
              key={idx}
              className="bg-[var(--bg)] border border-[var(--border)] rounded p-2 space-y-1 text-xs font-mono"
            >
              {Object.entries(row).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-2">
                  <span className="text-[var(--muted)] truncate">{k}:</span>
                  <span className="text-[var(--fg)] truncate select-text">
                    {v === null ? <span className="text-[var(--muted)] opacity-60 italic">null</span> : String(v)}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-[var(--border)] bg-[var(--bg)] text-right">
        <button
          onClick={closePeekDrawer}
          className="btn-secondary px-2.5 py-0.5 text-xs font-mono"
        >
          Close
        </button>
      </div>
    </div>
  )
}
