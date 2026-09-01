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
        ? api.getTableData(activeConnectionId, targetTable, {
            filter: String(filterValue),
            limit: 10,
          })
        : null,
    enabled: isOpen && !!activeConnectionId && !!targetTable,
  })

  if (!isOpen || !targetTable) return null

  const rows = relatedData?.rows || []

  return (
    <div className="fixed inset-y-0 right-0 w-96 max-w-full bg-zinc-900 border-l border-zinc-800 shadow-2xl z-40 flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="h-14 px-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
        <div className="flex items-center gap-2">
          <Table2 className="w-4 h-4 text-indigo-400" />
          <div>
            <h3 className="text-xs font-semibold text-zinc-100 font-mono">
              {targetTable}
            </h3>
            <p className="text-[10px] text-zinc-400 font-mono">
              WHERE {targetColumn} = {String(filterValue)}
            </p>
          </div>
        </div>
        <button
          onClick={closePeekDrawer}
          className="text-zinc-400 hover:text-zinc-200 p-1 rounded hover:bg-zinc-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <div className="text-center py-8 text-xs text-zinc-500">Loading relation data...</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-xs text-zinc-500">No matching record found</div>
        ) : (
          rows.map((row: Record<string, any>, idx: number) => (
            <div
              key={idx}
              className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2 text-xs font-mono"
            >
              {Object.entries(row).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-2">
                  <span className="text-zinc-500 truncate">{k}:</span>
                  <span className="text-zinc-200 truncate select-text">
                    {v === null ? <span className="text-zinc-600 italic">NULL</span> : String(v)}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-zinc-800 bg-zinc-950 text-right">
        <button
          onClick={closePeekDrawer}
          className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded transition-colors"
        >
          Close Drawer
        </button>
      </div>
    </div>
  )
}
