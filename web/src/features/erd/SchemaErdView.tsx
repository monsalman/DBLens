import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useQuery } from '@tanstack/react-query'
import {
  Table,
  Key,
  Search,
  X,
  Network,
  Download,
  Copy,
  Layout,
  Eye,
} from 'lucide-react'
import { api, type ERDTable, type ColumnMeta, type ERDForeignKey } from '../../lib/api'
import { useAppStore } from '../../stores/appStore'

interface Props {
  connId: string
  schema?: string
}

type TableNodeData = {
  table: ERDTable
  onFocus: (name: string) => void
  onViewData: (name: string) => void
  isFocused: boolean
}

type TableNodeType = Node<TableNodeData, 'tableNode'>

// ── TableNode ──────────────────────────────────────────────────────────────
const TableNode: React.FC<NodeProps<TableNodeType>> = ({ data }) => {
  const { table, onFocus, onViewData } = data
  const hasManyColumns = table.columns.length > 10

  return (
    <div className="bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] rounded-md shadow-lg overflow-hidden min-w-[230px] select-none">
      <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-indigo-500 !border-0" />
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-indigo-500 !border-0" />

      {/* Header */}
      <div className="bg-[#16181d] px-3 py-1.5 border-b border-[var(--border)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <Table className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
          <span className="truncate text-white font-bold text-xs">{table.name}</span>
          <span className="text-[10px] text-[var(--muted)] ml-1 shrink-0">({table.columns.length})</span>
        </div>
        {table.schema && (
          <span className="text-[9px] text-[var(--muted)] font-mono px-1 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] shrink-0">
            {table.schema}
          </span>
        )}
      </div>

      {/* Columns */}
      <div className={`px-3 py-2 flex flex-col gap-0.5 text-[11px] ${hasManyColumns ? 'max-h-[260px] overflow-y-auto' : ''}`}>
        {table.columns.map((col: ColumnMeta) => {
          const isPk = col.isPrimaryKey || col.isPrimary
          const isFk = col.isForeignKey
          const dataTypeStr = col.dataType || col.type || ''
          const isNullable = col.isNullable

          return (
            <div key={col.name} className="flex items-center justify-between gap-2 py-0.5">
              <div className="flex items-center gap-1 overflow-hidden">
                {isPk
                  ? <Key className="w-3 h-3 text-amber-400 shrink-0" />
                  : <span className="w-3 h-3 shrink-0" />}
                <span className="truncate font-mono text-xs">{col.name}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {isFk && (
                  <span className="text-[8px] px-1 bg-indigo-500/20 text-indigo-400 rounded font-bold">FK</span>
                )}
                {isNullable && (
                  <span className="text-[8px] px-1 bg-yellow-500/10 text-yellow-500 rounded">?</span>
                )}
                <span className="font-mono text-[9px] text-[var(--muted)]">{dataTypeStr}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Action buttons */}
      <div className="border-t border-[var(--border)] flex">
        <button
          onClick={() => onFocus(table.name)}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] text-[var(--muted)] hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
        >
          <Network className="w-3 h-3" /> Focus
        </button>
        <div className="w-px bg-[var(--border)]" />
        <button
          onClick={() => onViewData(table.name)}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] text-[var(--muted)] hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
        >
          <Eye className="w-3 h-3" /> View Data
        </button>
      </div>
    </div>
  )
}

// ── CardinalityEdge ────────────────────────────────────────────────────────
const CardinalityEdge: React.FC<EdgeProps> = ({
  id,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  label,
  style,
  selected,
}) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          strokeWidth: selected ? 2.5 : 1.5,
          opacity: selected ? 1 : 0.75,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#1e2028] border border-indigo-500/40 text-indigo-300 font-mono shadow">
              {String(label)}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const nodeTypes = { tableNode: TableNode }
const edgeTypes = { cardinalityEdge: CardinalityEdge }

// ── Topological DAG layout ─────────────────────────────────────────────────
function dagLayout(tables: ERDTable[]): Map<string, { x: number; y: number }> {
  const nameSet = new Set(tables.map((t) => t.name))
  // Build in-degree and adjacency
  const inDeg = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const t of tables) {
    if (!inDeg.has(t.name)) inDeg.set(t.name, 0)
    if (!children.has(t.name)) children.set(t.name, [])

    const refSet = new Set<string>()
    for (const fk of t.fks || []) {
      if (!fk.refTable || fk.refTable === t.name) continue
      if (!nameSet.has(fk.refTable)) continue
      refSet.add(fk.refTable)
    }

    for (const refTable of refSet) {
      inDeg.set(refTable, (inDeg.get(refTable) || 0) + 1)
      children.get(t.name)!.push(refTable)
    }
  }

  // Kahn's BFS
  const ranks = new Map<string, number>()
  const queue: string[] = []
  for (const t of tables) {
    if ((inDeg.get(t.name) || 0) === 0) {
      ranks.set(t.name, 0)
      queue.push(t.name)
    }
  }
  while (queue.length) {
    const node = queue.shift()!
    const rank = ranks.get(node) || 0
    for (const child of children.get(node) || []) {
      const next = Math.max(ranks.get(child) || 0, rank + 1)
      ranks.set(child, next)
      const current = (inDeg.get(child) || 1) - 1
      inDeg.set(child, current)
      if (current === 0) {
        queue.push(child)
      }
    }
  }
  // Assign remaining (cycles)
  let maxRank = 0
  for (const v of ranks.values()) maxRank = Math.max(maxRank, v)
  for (const t of tables) {
    if (!ranks.has(t.name)) ranks.set(t.name, maxRank + 1)
  }

  // Group by rank
  const byRank = new Map<number, string[]>()
  for (const [name, rank] of ranks.entries()) {
    if (!byRank.has(rank)) byRank.set(rank, [])
    byRank.get(rank)!.push(name)
  }

  const COL_W = 300, ROW_H = 280
  const pos = new Map<string, { x: number; y: number }>()
  for (const [rank, group] of byRank.entries()) {
    group.forEach((name, i) => {
      pos.set(name, { x: rank * COL_W + 40, y: i * ROW_H + 40 })
    })
  }
  return pos
}

// ── Mermaid export ─────────────────────────────────────────────────────────
function buildMermaid(tables: ERDTable[]): string {
  const lines: string[] = ['erDiagram']
  const nameSet = new Set(tables.map((t) => t.name))
  for (const tbl of tables) {
    const cleanTblName = tbl.name.replace(/[^a-zA-Z0-9_]/g, '_')
    lines.push(`  ${cleanTblName} {`)
    for (const col of tbl.columns) {
      const pk = col.isPrimary || col.isPrimaryKey ? ' PK' : ''
      const fk = col.isForeignKey ? ' FK' : ''
      const rawType = col.dataType || col.type || 'TEXT'
      const cleanType = rawType.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '_') || 'TEXT'
      const cleanColName = col.name.replace(/[^a-zA-Z0-9_]/g, '_')
      lines.push(`    ${cleanType} ${cleanColName}${pk}${fk}`)
    }
    lines.push(`  }`)
  }
  for (const tbl of tables) {
    const cleanTblName = tbl.name.replace(/[^a-zA-Z0-9_]/g, '_')
    for (const fk of tbl.fks || []) {
      if (!nameSet.has(fk.refTable)) continue
      const cleanRefTable = fk.refTable.replace(/[^a-zA-Z0-9_]/g, '_')
      const rel = fk.cardinality === '1:1' ? '||--||' : '||--o{'
      const label = (fk.column || '').replace(/"/g, "'")
      lines.push(`  ${cleanRefTable} ${rel} ${cleanTblName} : "${label}"`)
    }
  }
  return lines.join('\n')
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ── Main component ─────────────────────────────────────────────────────────
export const SchemaErdView: React.FC<Props> = ({ connId, schema }) => {
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const setSelectedTable = useAppStore((s) => s.setSelectedTable)

  const { data: erdTables } = useQuery({
    queryKey: ['erd', connId],
    queryFn: () => api.getERDData(connId),
  })

  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeType>([])
  const [edges, setEdges, onEdgesState] = useEdgesState<Edge>([])
  const [search, setSearch] = useState('')
  const [focusTable, setFocusTable] = useState<string | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const nodesRef = useRef<TableNodeType[]>([])
  nodesRef.current = nodes

  const allTables = useMemo(() => {
    if (!erdTables) return []
    const targetSchema = schema || 'public'
    const filtered = erdTables.filter((t) => !t.schema || t.schema === targetSchema || t.schema === 'main')
    if (filtered.length === 0) return erdTables
    return filtered
  }, [erdTables, schema])

  const filteredTables = useMemo(() => {
    const q = search.toLowerCase().trim()
    let tables = allTables
    if (focusTable) {
      const nameSet = new Set<string>()
      nameSet.add(focusTable)
      for (const t of allTables) {
        for (const fk of t.fks || []) {
          if (t.name === focusTable) nameSet.add(fk.refTable)
          if (fk.refTable === focusTable) nameSet.add(t.name)
        }
      }
      tables = tables.filter((t) => nameSet.has(t.name))
    }
    if (!q) return tables
    return tables.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q)),
    )
  }, [allTables, search, focusTable])

  const totalRelationships = useMemo(
    () => allTables.reduce((s, t) => s + (t.fks?.length || 0), 0),
    [allTables],
  )

  const buildGraph = useCallback(
    (tables: ERDTable[], positions?: Map<string, { x: number; y: number }>) => {
      const nameSet = new Set(tables.map((t) => t.name))
      const existingPos = new Map<string, { x: number; y: number }>()
      for (const n of nodesRef.current) {
        existingPos.set(n.id, n.position)
      }

      const newNodes: TableNodeType[] = tables.map((t, i) => ({
        id: t.name,
        type: 'tableNode',
        position: positions?.get(t.name) || existingPos.get(t.name) || {
          x: (i % 3) * 320 + 40,
          y: Math.floor(i / 3) * 280 + 40,
        },
        data: {
          table: t,
          isFocused: focusTable === t.name,
          onFocus: (name: string) => setFocusTable((prev) => (prev === name ? null : name)),
          onViewData: (name: string) => {
            setSelectedTable(name)
            setActiveTab('table')
          },
        },
      }))

      const newEdges: Edge[] = tables.flatMap((table: ERDTable) =>
        (table.fks || [])
          .filter((fk: ERDForeignKey) => nameSet.has(fk.refTable))
          .map((fk: ERDForeignKey) => ({
            id: `e-${table.name}.${fk.column}-${fk.refTable}.${fk.refColumn}`,
            source: table.name,
            target: fk.refTable,
            label: fk.cardinality || '1:N',
            type: 'cardinalityEdge',
            animated: true,
            style: { stroke: '#6366f1' },
          })),
      )

      setNodes(newNodes)
      setEdges(newEdges)
    },
    [focusTable, setNodes, setEdges, setActiveTab, setSelectedTable],
  )

  useEffect(() => {
    buildGraph(filteredTables)
  }, [filteredTables, buildGraph])

  const handleDagLayout = useCallback(() => {
    const pos = dagLayout(filteredTables)
    buildGraph(filteredTables, pos)
  }, [filteredTables, buildGraph])

  // Export SVG
  const handleExportSVG = useCallback(() => {
    if (nodes.length === 0) return

    const TABLE_W = 280
    const HEADER_H = 34
    const ROW_H = 22
    const PAD = 50

    const nodeBounds = new Map<string, { x: number; y: number; w: number; h: number }>()
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const node of nodes) {
      const colCount = node.data.table.columns.length
      const h = HEADER_H + colCount * ROW_H + 10
      const x = node.position.x
      const y = node.position.y
      nodeBounds.set(node.id, { x, y, w: TABLE_W, h })

      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x + TABLE_W > maxX) maxX = x + TABLE_W
      if (y + h > maxY) maxY = y + h
    }

    if (!isFinite(minX)) {
      minX = 0
      minY = 0
      maxX = 800
      maxY = 600
    }

    const viewBoxX = minX - PAD
    const viewBoxY = minY - PAD
    const viewBoxW = maxX - minX + PAD * 2
    const viewBoxH = maxY - minY + PAD * 2

    const svgParts: string[] = []

    svgParts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}" width="${viewBoxW}" height="${viewBoxH}" style="background-color: #0c0d12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">`,
      `  <rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxW}" height="${viewBoxH}" fill="#0c0d12" />`,
    )

    const edgeParts: string[] = []
    const badgeParts: string[] = []

    for (const edge of edges) {
      const src = nodeBounds.get(edge.source)
      const tgt = nodeBounds.get(edge.target)
      if (!src || !tgt) continue

      const sx = src.x + src.w
      const sy = src.y + HEADER_H / 2
      const tx = tgt.x
      const ty = tgt.y + HEADER_H / 2

      const dx = Math.max(50, Math.abs(tx - sx) * 0.4)
      const c1x = sx + (tx >= sx ? dx : 60)
      const c1y = sy
      const c2x = tx - (tx >= sx ? dx : 60)
      const c2y = ty

      const path = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`
      edgeParts.push(
        `    <path d="${path}" fill="none" stroke="#6366f1" stroke-width="1.5" opacity="0.8" />`,
      )

      const t = 0.5
      const midX = (1 - t) ** 3 * sx + 3 * (1 - t) ** 2 * t * c1x + 3 * (1 - t) * t ** 2 * c2x + t ** 3 * tx
      const midY = (1 - t) ** 3 * sy + 3 * (1 - t) ** 2 * t * c1y + 3 * (1 - t) * t ** 2 * c2y + t ** 3 * ty
      const badge = edge.label ? String(edge.label) : '1:N'

      badgeParts.push(
        `    <g transform="translate(${midX}, ${midY})">` +
          `<rect x="-16" y="-10" width="32" height="20" rx="4" fill="#1e2028" stroke="#6366f1" stroke-width="1" />` +
          `<text x="0" y="3.5" fill="#a5b4fc" font-size="9" font-family="monospace" font-weight="bold" text-anchor="middle">${escapeXml(badge)}</text>` +
          `</g>`,
      )
    }

    if (edgeParts.length > 0) {
      svgParts.push('  <g id="edges">', ...edgeParts, ...badgeParts, '  </g>')
    }

    svgParts.push('  <g id="tables">')
    for (const node of nodes) {
      const b = nodeBounds.get(node.id)!
      const t = node.data.table

      svgParts.push(`    <g transform="translate(${b.x}, ${b.y})">`)
      svgParts.push(
        `      <rect width="${b.w}" height="${b.h}" rx="6" fill="#16181d" stroke="#2e3340" stroke-width="1" />`,
        `      <path d="M 0 6 A 6 6 0 0 1 6 0 L ${b.w - 6} 0 A 6 6 0 0 1 ${b.w} 6 L ${b.w} ${HEADER_H} L 0 ${HEADER_H} Z" fill="#1f222b" />`,
        `      <line x1="0" y1="${HEADER_H}" x2="${b.w}" y2="${HEADER_H}" stroke="#2e3340" stroke-width="1" />`,
        `      <circle cx="14" cy="${HEADER_H / 2}" r="3.5" fill="#818cf8" />`,
        `      <text x="24" y="${HEADER_H / 2 + 4}" fill="#ffffff" font-size="12" font-weight="bold">${escapeXml(t.name)}</text>`,
      )

      if (t.schema) {
        svgParts.push(
          `      <text x="${b.w - 12}" y="${HEADER_H / 2 + 3.5}" fill="#818cf8" font-size="9" font-family="monospace" text-anchor="end">[${escapeXml(t.schema)}]</text>`,
        )
      }

      t.columns.forEach((col, colIdx) => {
        const colY = HEADER_H + 6 + colIdx * ROW_H
        const isPk = col.isPrimaryKey || col.isPrimary
        const isFk = col.isForeignKey
        const isNullable = col.isNullable

        const badge = isPk && isFk ? 'PK/FK' : isPk ? 'PK' : isFk ? 'FK' : ''
        if (badge) {
          const badgeColor = isPk ? '#fbbf24' : '#818cf8'
          svgParts.push(
            `      <text x="12" y="${colY + 13}" fill="${badgeColor}" font-size="9" font-weight="bold" font-family="monospace">${badge}</text>`,
          )
        }

        const nameX = badge ? (badge.length > 2 ? 52 : 36) : 16
        const nameColor = isPk ? '#fef08a' : '#e5e7eb'
        svgParts.push(
          `      <text x="${nameX}" y="${colY + 13}" fill="${nameColor}" font-size="11" font-family="monospace">${escapeXml(col.name)}</text>`,
        )

        const typeStr = (col.dataType || col.type || '') + (isNullable ? ' ?' : '')
        svgParts.push(
          `      <text x="${b.w - 12}" y="${colY + 13}" fill="#9ca3af" font-size="9" font-family="monospace" text-anchor="end">${escapeXml(typeStr)}</text>`,
        )
      })

      svgParts.push('    </g>')
    }
    svgParts.push('  </g>')
    svgParts.push('</svg>')

    const svgString = svgParts.join('\n')
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${schema || 'database'}-erd.svg`
    a.click()
    URL.revokeObjectURL(url)
    setExportMenuOpen(false)
  }, [nodes, edges, schema])

  // Export Mermaid
  const handleCopyMermaid = useCallback(() => {
    navigator.clipboard.writeText(buildMermaid(filteredTables)).catch(() => {})
    setExportMenuOpen(false)
  }, [filteredTables])

  const handleDownloadMermaid = useCallback(() => {
    const blob = new Blob([buildMermaid(filteredTables)], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'erd.mmd'
    a.click()
    URL.revokeObjectURL(url)
    setExportMenuOpen(false)
  }, [filteredTables])

  return (
    <div className="w-full h-full flex flex-col bg-[var(--bg)]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)] flex-wrap shrink-0">
        {/* Search */}
        <div className="relative flex items-center">
          <Search className="absolute left-2 w-3.5 h-3.5 text-[var(--muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter tables / columns…"
            className="pl-7 pr-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] placeholder:text-[var(--muted)] focus:outline-none focus:border-indigo-500 w-44"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-1.5">
              <X className="w-3 h-3 text-[var(--muted)] hover:text-[var(--fg)]" />
            </button>
          )}
        </div>

        {/* Focus table */}
        {focusTable ? (
          <button
            onClick={() => setFocusTable(null)}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-indigo-500 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 transition-colors"
          >
            <Network className="w-3 h-3" />
            {focusTable}
            <X className="w-3 h-3" />
          </button>
        ) : (
          <span className="text-[11px] text-[var(--muted)]">Click "Focus" on a node for 1-hop view</span>
        )}

        <div className="flex-1" />

        {/* Stats */}
        <span className="text-[11px] text-[var(--muted)] px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)]">
          {filteredTables.length} tables · {totalRelationships} relations
        </span>

        {/* DAG layout */}
        <button
          onClick={handleDagLayout}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] hover:border-indigo-500 hover:text-indigo-300 transition-colors"
        >
          <Layout className="w-3 h-3" /> Auto-Layout
        </button>

        {/* Export */}
        <div className="relative">
          <button
            onClick={() => setExportMenuOpen((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] hover:border-indigo-500 hover:text-indigo-300 transition-colors"
          >
            <Download className="w-3 h-3" /> Export
          </button>
          {exportMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--surface)] border border-[var(--border)] rounded shadow-lg min-w-[160px] overflow-hidden text-xs">
              <button
                onClick={handleCopyMermaid}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg)] text-[var(--fg)]"
              >
                <Copy className="w-3 h-3" /> Copy Mermaid
              </button>
              <button
                onClick={handleDownloadMermaid}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg)] text-[var(--fg)]"
              >
                <Download className="w-3 h-3" /> Download .mmd
              </button>
              <button
                onClick={handleExportSVG}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg)] text-[var(--fg)]"
              >
                <Download className="w-3 h-3" /> Export SVG
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesState}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          onClick={() => setExportMenuOpen(false)}
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
    </div>
  )
}
