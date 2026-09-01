import React, { useMemo } from 'react'
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Table2, Key } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../../stores/appStore'
import type { TableMeta } from '../../lib/api'

const TableNode = ({ data }: { data: { table: TableMeta } }) => {
  const { table } = data
  const colList = table.columns || []

  return (
    <div className="bg-[#16181d] border border-white/[0.08] rounded min-w-[200px] overflow-hidden text-xs">
      <Handle type="target" position={Position.Left} className="w-1.5 h-1.5 bg-indigo-400! border-none!" />

      {/* Header */}
      <div className="bg-white/[0.03] px-2.5 py-1.5 border-b border-white/[0.06] flex items-center justify-between font-mono font-medium text-zinc-200">
        <div className="flex items-center gap-1.5 truncate">
          <Table2 className="w-3 h-3 text-zinc-400 shrink-0" />
          <span className="truncate">{table.name}</span>
        </div>
        <span className="text-[10px] text-zinc-500 font-normal">
          {colList.length}
        </span>
      </div>

      {/* Columns */}
      <div className="divide-y divide-white/[0.03] font-mono text-[11px]">
        {colList.map((col) => (
          <div
            key={col.name}
            className="px-2.5 py-1 flex items-center justify-between gap-2 text-zinc-300"
          >
            <div className="flex items-center gap-1.5 truncate">
              {col.isPrimaryKey || col.isPrimary ? (
                <Key className="w-2.5 h-2.5 text-amber-400 shrink-0" />
              ) : (
                <div className="w-2.5 h-2.5" />
              )}
              <span className={`truncate ${col.isPrimaryKey || col.isPrimary ? 'text-amber-200' : ''}`}>
                {col.name}
              </span>
            </div>

            <span className="text-[10px] text-zinc-500 shrink-0">
              {col.dataType || col.type || 'text'}
            </span>
          </div>
        ))}
      </div>

      <Handle type="source" position={Position.Right} className="w-1.5 h-1.5 bg-indigo-400! border-none!" />
    </div>
  )
}

const nodeTypes = {
  tableNode: TableNode,
}

export const SchemaErdView: React.FC = () => {
  const { activeConnectionId, selectedSchema } = useAppStore()

  const { data: erdData } = useQuery({
    queryKey: ['erd', activeConnectionId, selectedSchema],
    queryFn: async () => {
      if (!activeConnectionId) return null
      const res = await fetch(`/api/connections/${activeConnectionId}/erd`)
      if (!res.ok) throw new Error('Failed to load ERD')
      const json = await res.json()
      return (json.data ?? json) as Array<{
        name: string
        schema: string
        columns: Array<any>
        fks: Array<{ column: string; refTable: string; refColumn: string }>
      }>
    },
    enabled: !!activeConnectionId,
  })

  const { nodes, edges } = useMemo(() => {
    if (!erdData) return { nodes: [], edges: [] }

    const calculatedNodes: Node[] = []
    const calculatedEdges: Edge[] = []

    const colsPerRow = 3
    const spacingX = 280
    const spacingY = 240

    erdData.forEach((tbl, idx) => {
      const x = (idx % colsPerRow) * spacingX + 40
      const y = Math.floor(idx / colsPerRow) * spacingY + 40

      calculatedNodes.push({
        id: tbl.name,
        type: 'tableNode',
        position: { x, y },
        data: {
          table: {
            name: tbl.name,
            schema: tbl.schema,
            type: 'table',
            columns: tbl.columns?.map((c) => ({
              name: c.name,
              type: c.dataType || c.type || 'text',
              dataType: c.dataType,
              nullable: c.isNullable ?? c.nullable,
              isNullable: c.isNullable ?? c.nullable,
              isPrimaryKey: c.isPrimary ?? c.isPrimaryKey,
              isPrimary: c.isPrimary ?? c.isPrimaryKey,
              isForeignKey: !!tbl.fks?.some((fk) => fk.column === c.name),
            })) || [],
          },
        },
      })

      tbl.fks?.forEach((fk) => {
        if (fk.refTable && fk.refColumn) {
          calculatedEdges.push({
            id: `edge_${tbl.name}_${fk.column}_to_${fk.refTable}`,
            source: tbl.name,
            target: fk.refTable,
            style: { stroke: 'rgba(255, 255, 255, 0.2)', strokeWidth: 1 },
          })
        }
      })
    })

    return { nodes: calculatedNodes, edges: calculatedEdges }
  }, [erdData])

  return (
    <div className="flex-1 h-full w-full bg-[#0b0c0e] relative">
      <div className="absolute top-2 left-2 z-10 bg-[#16181d] border border-white/[0.06] rounded px-2 py-1 text-xs text-zinc-400 font-mono">
        {selectedSchema} • {nodes.length} tables
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        className="bg-[#0b0c0e]"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="rgba(255, 255, 255, 0.05)" />
        <Controls className="bg-[#16181d]! border-white/[0.06]! fill-zinc-400!" />
        <MiniMap
          nodeColor="#27272a"
          maskColor="rgba(11, 12, 14, 0.8)"
          className="bg-[#0b0c0e]! border-white/[0.06]!"
        />
      </ReactFlow>
    </div>
  )
}
