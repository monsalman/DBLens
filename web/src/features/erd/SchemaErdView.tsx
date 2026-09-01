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
import { Table2, Key, Link2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../../stores/appStore'
import { api, type TableMeta } from '../../lib/api'

// Custom Table Node Component
const TableNode = ({ data }: { data: { table: TableMeta } }) => {
  const { table } = data

  return (
    <div className="bg-zinc-900 border border-zinc-700/80 rounded-lg shadow-xl min-w-[220px] overflow-hidden text-xs">
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-indigo-500!" />

      {/* Header */}
      <div className="bg-zinc-800/90 px-3 py-2 border-b border-zinc-700/80 flex items-center justify-between font-mono font-semibold text-zinc-100">
        <div className="flex items-center gap-1.5 truncate">
          <Table2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="truncate">{table.name}</span>
        </div>
        <span className="text-[10px] text-zinc-400 font-sans font-normal">
          {table.columns.length} cols
        </span>
      </div>

      {/* Column List */}
      <div className="divide-y divide-zinc-800/60 font-mono">
        {table.columns.map((col) => (
          <div
            key={col.name}
            className="px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-zinc-800/40 text-[11px]"
          >
            <div className="flex items-center gap-1.5 truncate">
              {col.isPrimaryKey ? (
                <Key className="w-3 h-3 text-amber-400 shrink-0" />
              ) : col.isForeignKey ? (
                <Link2 className="w-3 h-3 text-indigo-400 shrink-0" />
              ) : (
                <div className="w-3 h-3" />
              )}
              <span
                className={`truncate ${
                  col.isPrimaryKey ? 'text-amber-200 font-medium' : 'text-zinc-300'
                }`}
              >
                {col.name}
              </span>
            </div>

            <div className="flex items-center gap-1 text-[10px] text-zinc-500 shrink-0">
              <span>{col.type}</span>
              {col.nullable && <span className="text-zinc-600">?</span>}
            </div>
          </div>
        ))}
      </div>

      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-indigo-500!" />
    </div>
  )
}

const nodeTypes = {
  tableNode: TableNode,
}

export const SchemaErdView: React.FC = () => {
  const { activeConnectionId, selectedSchema } = useAppStore()

  const { data: schemaMeta } = useQuery({
    queryKey: ['schema', activeConnectionId, selectedSchema],
    queryFn: () => (activeConnectionId ? api.getSchema(activeConnectionId, selectedSchema) : null),
    enabled: !!activeConnectionId,
  })

  const { nodes, edges } = useMemo(() => {
    if (!schemaMeta?.tables) return { nodes: [], edges: [] }

    const tables = schemaMeta.tables.filter((t) => t.type === 'table')
    const calculatedNodes: Node[] = []
    const calculatedEdges: Edge[] = []

    const colsPerRow = 3
    const spacingX = 320
    const spacingY = 280

    tables.forEach((tbl, idx) => {
      const x = (idx % colsPerRow) * spacingX + 50
      const y = Math.floor(idx / colsPerRow) * spacingY + 50

      calculatedNodes.push({
        id: tbl.name,
        type: 'tableNode',
        position: { x, y },
        data: { table: tbl },
      })

      // Generate Foreign Key Edges
      tbl.columns.forEach((col) => {
        if (col.isForeignKey && col.foreignKeyTarget) {
          calculatedEdges.push({
            id: `edge_${tbl.name}_${col.name}_to_${col.foreignKeyTarget.table}`,
            source: tbl.name,
            target: col.foreignKeyTarget.table,
            animated: true,
            style: { stroke: '#818cf8', strokeWidth: 2 },
            label: `${col.name} → ${col.foreignKeyTarget.column}`,
            labelStyle: { fill: '#c7d2fe', fontSize: 10, fontFamily: 'monospace' },
            labelBgStyle: { fill: '#1e1b4b', fillOpacity: 0.9 },
            labelBgPadding: [4, 2] as [number, number],
            labelBgBorderRadius: 4,
          })
        }
      })
    })

    return { nodes: calculatedNodes, edges: calculatedEdges }
  }, [schemaMeta])

  return (
    <div className="flex-1 h-full w-full bg-zinc-950 relative">
      <div className="absolute top-4 left-4 z-10 bg-zinc-900/90 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300 backdrop-blur-xs flex items-center gap-2">
        <span className="font-semibold text-zinc-100">Schema ERD:</span>
        <span className="font-mono text-indigo-400">{selectedSchema}</span>
        <span className="text-zinc-500">({nodes.length} tables, {edges.length} relations)</span>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        className="bg-zinc-950"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#27272a" />
        <Controls className="bg-zinc-900! border-zinc-800! fill-zinc-300!" />
        <MiniMap
          nodeColor="#3f3f46"
          maskColor="rgba(9, 9, 11, 0.7)"
          className="bg-zinc-950! border-zinc-800!"
        />
      </ReactFlow>
    </div>
  )
}
