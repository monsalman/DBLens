import React, { useMemo, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { TableNode, type TableNodeData } from './TableNode'
import { JoinEdge } from './JoinEdge'
import type { QueryCanvasState, TableMeta, ERDTable } from '../../lib/api'

interface VisualQueryCanvasProps {
  state: QueryCanvasState
  onRemoveTable: (id: string) => void
  onToggleColumn: (tableId: string, colName: string) => void
  onSelectAll: (tableId: string, select: boolean) => void
  onSetAggregate: (tableId: string, colName: string, agg: string) => void
  onSetColAlias: (tableId: string, colName: string, alias: string) => void
  onSetTblAlias: (tableId: string, alias: string) => void
  onUpdatePosition: (tableId: string, pos: { x: number; y: number }) => void
  onConnectJoin: (
    sourceTableId: string,
    sourceColumn: string,
    targetTableId: string,
    targetColumn: string,
    joinType?: string
  ) => void
  onChangeJoinType: (joinId: string, newType: string) => void
  onDeleteJoin: (joinId: string) => void
  onAddTable: (table: TableMeta | ERDTable, position?: { x: number; y: number }) => void
  availableTables: (TableMeta | ERDTable)[]
}

const nodeTypes = {
  tableNode: TableNode,
}

const edgeTypes = {
  joinEdge: JoinEdge,
}

export const VisualQueryCanvas: React.FC<VisualQueryCanvasProps> = ({
  state,
  onRemoveTable,
  onToggleColumn,
  onSelectAll,
  onSetAggregate,
  onSetColAlias,
  onSetTblAlias,
  onUpdatePosition,
  onConnectJoin,
  onChangeJoinType,
  onDeleteJoin,
  onAddTable,
  availableTables,
}) => {
  // Convert tables to Flow Nodes
  const nodes: Node<TableNodeData>[] = useMemo(() => {
    return state.tables.map((table) => ({
      id: table.id,
      type: 'tableNode',
      position: table.position || { x: 50, y: 50 },
      data: {
        table,
        onRemoveTable,
        onToggleColumn,
        onSelectAll,
        onSetAggregate,
        onSetColAlias,
        onSetTblAlias,
      },
    }))
  }, [
    state.tables,
    onRemoveTable,
    onToggleColumn,
    onSelectAll,
    onSetAggregate,
    onSetColAlias,
    onSetTblAlias,
  ])

  // Convert joins to Flow Edges
  const edges: Edge[] = useMemo(() => {
    const tableMap = new Map(state.tables.map((t) => [t.id, t]))

    return state.joins.map((join) => {
      const srcT = tableMap.get(join.sourceTableId)
      const tgtT = tableMap.get(join.targetTableId)

      return {
        id: join.id,
        source: join.sourceTableId,
        target: join.targetTableId,
        sourceHandle: `${join.sourceTableId}__${join.sourceColumn}__out`,
        targetHandle: `${join.targetTableId}__${join.targetColumn}__in`,
        type: 'joinEdge',
        data: {
          joinId: join.id,
          joinType: join.joinType || 'INNER',
          sourceTable: srcT?.name || '',
          sourceColumn: join.sourceColumn,
          targetTable: tgtT?.name || '',
          targetColumn: join.targetColumn,
          onChangeJoinType,
          onDeleteJoin,
        },
      }
    })
  }, [state.tables, state.joins, onChangeJoinType, onDeleteJoin])

  // Handle connecting handles
  const handleConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) {
        return
      }
      // Handle ID pattern: `${tableId}__${colName}__${in|out}`
      const srcParts = conn.sourceHandle.split('__')
      const tgtParts = conn.targetHandle.split('__')

      const srcTableId = srcParts[0]
      const srcCol = srcParts[1]
      const tgtTableId = tgtParts[0]
      const tgtCol = tgtParts[1]

      if (srcTableId && srcCol && tgtTableId && tgtCol) {
        onConnectJoin(srcTableId, srcCol, tgtTableId, tgtCol, 'INNER')
      }
    },
    [onConnectJoin]
  )

  // Drag-and-drop table from sidebar onto canvas
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const tableName = event.dataTransfer.getData('application/dblens-table')
      if (!tableName) return

      const tableMeta = availableTables.find((t) => t.name === tableName)
      if (!tableMeta) return

      const bounds = event.currentTarget.getBoundingClientRect()
      const x = event.clientX - bounds.left
      const y = event.clientY - bounds.top

      onAddTable(tableMeta, { x, y })
    },
    [availableTables, onAddTable]
  )

  return (
    <div
      className="w-full h-full relative"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={handleConnect}
        onNodeDragStop={(_, node) => {
          onUpdatePosition(node.id, node.position)
        }}
        fitView={nodes.length > 0}
        minZoom={0.2}
        maxZoom={1.8}
        defaultEdgeOptions={{
          type: 'joinEdge',
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#333842" />
        <Controls className="!bg-[var(--surface)] !border-[var(--border)] !rounded-lg overflow-hidden [&>button]:!bg-[var(--surface)] [&>button]:!border-b [&>button]:!border-[var(--border)] [&>button]:!text-white [&>button:hover]:!bg-[var(--hover)]" />
      </ReactFlow>

      {state.tables.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-4">
          <div className="bg-[#16181d]/90 border border-[var(--border)] rounded-xl p-6 shadow-2xl backdrop-blur-sm max-w-sm pointer-events-auto">
            <h3 className="text-white font-semibold text-sm mb-1">Canvas is Empty</h3>
            <p className="text-[var(--muted)] text-xs mb-3">
              Click or drag tables from the left sidebar to start designing your query visually.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
