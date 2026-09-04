import React, { useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useQuery } from '@tanstack/react-query'
import { Table, Key } from 'lucide-react'
import { api, type ERDTable, type ColumnMeta } from '../../lib/api'

interface Props {
  connId: string
  schema?: string
}

type TableNodeData = {
  table: ERDTable
}

type TableNodeType = Node<TableNodeData, 'tableNode'>

const TableNode: React.FC<NodeProps<TableNodeType>> = ({ data }) => {
  const { table } = data
  const hasManyColumns = table.columns.length > 12

  return (
    <div className="bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] rounded-md shadow-md overflow-hidden min-w-[220px] select-none">
      <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-indigo-500 !border-0" />
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-indigo-500 !border-0" />

      <div className="bg-[#16181d] px-3 py-1.5 border-b border-[var(--border)] font-semibold text-xs flex items-center justify-between">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <Table className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
          <span className="truncate text-white font-bold">{table.name}</span>
        </div>
        {table.schema && (
          <span className="text-[10px] text-[var(--muted)] font-mono px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] shrink-0 ml-2">
            {table.schema}
          </span>
        )}
      </div>

      <div className={`px-3 py-2 flex flex-col gap-1 text-[11px] ${hasManyColumns ? 'max-h-[300px] overflow-y-auto' : ''}`}>
        {table.columns.map((col: ColumnMeta) => {
          const isPk = col.isPrimaryKey || col.isPrimary
          const isFk = col.isForeignKey
          const dataTypeStr = col.dataType || col.type || ''

          return (
            <div key={col.name} className="flex items-center justify-between gap-2 py-0.5">
              <div className="flex items-center gap-1.5 overflow-hidden">
                {isPk && <Key className="w-3 h-3 text-amber-500 shrink-0" />}
                <span className="truncate font-mono text-xs">{col.name}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {isFk && (
                  <span className="text-[9px] px-1 bg-indigo-500/20 text-indigo-400 rounded">
                    FK
                  </span>
                )}
                <span className="font-mono text-[10px] text-[var(--muted)]">{dataTypeStr}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const nodeTypes = {
  tableNode: TableNode,
}

export const SchemaErdView: React.FC<Props> = ({ connId, schema }) => {
  const { data: erdTables } = useQuery({
    queryKey: ['erd', connId],
    queryFn: () => api.getERDData(connId),
  })

  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeType>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const filteredTables = useMemo(() => {
    if (!erdTables) return []
    const targetSchema = schema || 'public'
    return erdTables.filter((t) => !t.schema || t.schema === targetSchema)
  }, [erdTables, schema])

  useEffect(() => {
    if (!filteredTables) return

    const initialNodes: TableNodeType[] = filteredTables.map((t, i) => ({
      id: t.name,
      type: 'tableNode',
      position: {
        x: (i % 3) * 320 + 40,
        y: Math.floor(i / 3) * 260 + 40,
      },
      data: {
        table: t,
      },
    }))

    const initialEdges: Edge[] = filteredTables.flatMap((table: ERDTable) =>
      (table.fks || []).map((fk) => ({
        id: `e-${table.name}.${fk.column}-${fk.refTable}.${fk.refColumn}`,
        source: table.name,
        target: fk.refTable,
        label: `${fk.column} → ${fk.refColumn}`,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#6366f1', strokeWidth: 1.5 },
        labelStyle: { fill: '#a1a1a1', fontSize: 10, fontFamily: 'monospace' },
        labelBgStyle: { fill: '#0c0c0c', fillOpacity: 0.8 },
      }))
    )

    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [filteredTables, setNodes, setEdges])

  return (
    <div className="w-full h-full relative bg-[var(--bg)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.2}
          color="var(--muted)"
          className="opacity-40"
        />
        <Controls className="bg-[var(--surface)] border border-[var(--border)]" />
      </ReactFlow>
    </div>
  )
}
