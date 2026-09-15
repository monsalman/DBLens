import React, { useEffect } from 'react'
import { X, Table2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../stores/appStore'
import { api } from '../lib/api'

export const PeekDrawer: React.FC = () => {
  const { peekDrawer, closePeekDrawer, activeConnectionId } = useAppStore()
  const { isOpen, targetTable, targetColumn, filterValue } = peekDrawer

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closePeekDrawer()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closePeekDrawer])

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
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity"
        onClick={closePeekDrawer}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-80 sm:w-96 max-w-full bg-[var(--surface)] border-l border-[var(--border)] z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="h-10 px-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg)]">
          <div className="flex items-center gap-1.5 font-mono text-xs text-[var(--fg)] min-w-0">
            <Table2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="truncate font-semibold">{targetTable}</span>
            <span className="text-[10px] text-[var(--muted)] shrink-0">
              ({targetColumn}={String(filterValue)})
            </span>
          </div>
          <button
            onClick={closePeekDrawer}
            className="text-[var(--muted)] hover:text-[var(--fg)] p-1 rounded hover:bg-[var(--hover)] transition-colors"
            title="Close (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {isLoading ? (
            <div className="text-center py-10 text-xs text-[var(--muted)] font-mono">
              Loading referenced record...
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-10 text-xs text-[var(--muted)] font-mono">
              No matching records found in <span className="text-[var(--fg)]">{targetTable}</span>.
            </div>
          ) : (
            rows.map((row: Record<string, any>, idx: number) => (
              <div
                key={idx}
                className="bg-[var(--bg)] border border-[var(--border)] rounded-md p-2.5 space-y-1 text-xs font-mono"
              >
                {Object.entries(row).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-2 py-0.5 border-b border-[var(--border)]/50 last:border-none">
                    <span className="text-[var(--muted)] text-[11px] truncate">{k}:</span>
                    <span className="text-[var(--fg)] text-[11px] truncate select-text font-mono">
                      {v === null ? (
                        <span className="text-[var(--muted)] opacity-50 italic">null</span>
                      ) : typeof v === 'object' ? (
                        JSON.stringify(v)
                      ) : (
                        String(v)
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-2.5 border-t border-[var(--border)] bg-[var(--bg)] flex items-center justify-between">
          <span className="text-[10px] text-[var(--muted)] font-mono">
            {rows.length} {rows.length === 1 ? 'record' : 'records'}
          </span>
          <button
            onClick={closePeekDrawer}
            className="btn-secondary px-3 py-1 text-xs font-mono"
          >
            Close
          </button>
        </div>
      </div>
    </>
  )
}
