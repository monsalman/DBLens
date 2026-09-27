import React, { useState } from 'react'
import { Copy, Trash2, Search, Check, ChevronRight } from 'lucide-react'
import type { PartitionNode } from './partitionHelper'
import {
  formatBytes,
  formatRows,
  formatShare,
  getStatusBadge,
  buildDetachDDL,
} from './partitionHelper'

interface PartitionHierarchyTreeProps {
  partitions: PartitionNode[]
  parentTable: string
  schema: string
  dialect: string
  selectedNode?: PartitionNode | null
  onSelectNode: (node: PartitionNode) => void
  onDetachPartition: (nodeName: string, concurrently: boolean) => Promise<boolean>
  readOnly?: boolean
}

export const PartitionHierarchyTree: React.FC<PartitionHierarchyTreeProps> = ({
  partitions,
  parentTable,
  schema,
  dialect,
  selectedNode,
  onSelectNode,
  onDetachPartition,
  readOnly = false,
}) => {
  const [filter, setFilter] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [detachingNode, setDetachingNode] = useState<string | null>(null)

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const handleDetach = async (node: PartitionNode) => {
    if (readOnly) return
    const isPostgres = dialect.toLowerCase().includes('postgres')
    const msg = isPostgres
      ? `Detach partition "${node.name}" from parent table "${parentTable}"?\nThis converts the partition into an independent standalone table.`
      : `Drop partition "${node.name}" from parent table "${parentTable}"?\nThis will remove the partition slice.`

    if (window.confirm(msg)) {
      setDetachingNode(node.name)
      await onDetachPartition(node.name, isPostgres)
      setDetachingNode(null)
    }
  }

  const filtered = partitions.filter((p) => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      p.boundExpression.toLowerCase().includes(q) ||
      p.status.toLowerCase().includes(q)
    )
  })

  return (
    <div className="flex flex-col h-[420px] rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      {/* Search Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 bg-zinc-900/60">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Filter partition slices..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div className="text-xs text-zinc-400">
          Showing <span className="font-medium text-white">{filtered.length}</span> of{' '}
          <span className="font-medium text-white">{partitions.length}</span> partitions
        </div>
      </div>

      {/* Table Content */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/90 backdrop-blur-sm text-zinc-400 uppercase text-[10px] tracking-wider font-semibold">
            <tr>
              <th className="py-2.5 pl-4 pr-3">Partition Name</th>
              <th className="py-2.5 px-3">Bound Expression</th>
              <th className="py-2.5 px-3">Rows</th>
              <th className="py-2.5 px-3">Storage Size</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 pl-3 pr-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 font-mono">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-zinc-500 font-sans">
                  No matching partition nodes found
                </td>
              </tr>
            ) : (
              filtered.map((p) => {
                const isSelected = selectedNode?.name === p.name
                const status = getStatusBadge(p.status)
                const detachDDL = buildDetachDDL(
                  { parentTable, schema, partitionName: p.name, concurrently: true },
                  dialect
                )

                return (
                  <tr
                    key={p.name}
                    onClick={() => onSelectNode(p)}
                    className={`cursor-pointer transition-colors hover:bg-zinc-900/50 ${
                      isSelected ? 'bg-zinc-800/70 border-l-2 border-emerald-400' : ''
                    }`}
                  >
                    {/* Name */}
                    <td className="py-2.5 pl-4 pr-3 font-medium text-white">
                      <div className="flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 text-zinc-500" />
                        <span className="truncate max-w-[180px]">{p.name}</span>
                      </div>
                    </td>

                    {/* Bound Expression */}
                    <td className="py-2.5 px-3 text-zinc-400 text-[11px]">
                      <span className="truncate block max-w-[220px]" title={p.boundExpression}>
                        {p.boundExpression || '-'}
                      </span>
                    </td>

                    {/* Rows */}
                    <td className="py-2.5 px-3">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-zinc-200">{formatRows(p.rows)}</span>
                          <span className="text-zinc-500 text-[10px]">{formatShare(p.rowSharePct)}</span>
                        </div>
                        <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${Math.min(p.rowSharePct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Storage */}
                    <td className="py-2.5 px-3">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-zinc-200">{formatBytes(p.bytes)}</span>
                          <span className="text-zinc-500 text-[10px]">{formatShare(p.byteSharePct)}</span>
                        </div>
                        <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              p.status === 'hot_skew' ? 'bg-rose-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(p.byteSharePct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-2.5 px-3 font-sans">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold border ${status.badgeClass}`}
                      >
                        {status.label}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 pl-3 pr-4 text-right font-sans">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Copy Detach DDL"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCopy(detachDDL, `ddl_${p.name}`)
                          }}
                          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                        >
                          {copiedId === `ddl_${p.name}` ? (
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          title={readOnly ? 'Disabled in read-only mode' : 'Detach Partition'}
                          disabled={readOnly || detachingNode === p.name}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (readOnly) return
                            handleDetach(p)
                          }}
                          className="rounded p-1 text-zinc-400 hover:bg-rose-900/40 hover:text-rose-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
