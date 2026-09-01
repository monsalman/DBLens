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
    <div className="fixed inset-y-0 right-0 w-80 max-w-full bg-[#16181d] border-l border-white/[0.08] z-40 flex flex-col">
      {/* Header */}
      <div className="h-10 px-3 border-b border-white/[0.06] flex items-center justify-between bg-[#0b0c0e]">
        <div className="flex items-center gap-1.5 font-mono text-xs text-zinc-200">
          <Table2 className="w-3.5 h-3.5 text-zinc-400" />
          <span className="truncate">{targetTable}</span>
          <span className="text-[10px] text-zinc-500">
            ({targetColumn}={String(filterValue)})
          </span>
        </div>
        <button
          onClick={closePeekDrawer}
          className="text-zinc-500 hover:text-zinc-300 p-0.5"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {isLoading ? (
          <div className="text-center py-6 text-xs text-zinc-500 font-mono">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-xs text-zinc-500 font-mono">No matching records</div>
        ) : (
          rows.map((row: Record<string, any>, idx: number) => (
            <div
              key={idx}
              className="bg-[#0b0c0e] border border-white/[0.06] rounded p-2 space-y-1 text-xs font-mono"
            >
              {Object.entries(row).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-2">
                  <span className="text-zinc-500 truncate">{k}:</span>
                  <span className="text-zinc-200 truncate select-text">
                    {v === null ? <span className="text-zinc-600 italic">null</span> : String(v)}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-white/[0.06] bg-[#0b0c0e] text-right">
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
