import React, { useState, useMemo } from 'react'
import type { ImpactGraph as ImpactGraphType, ImpactNode } from './impactHelper'

interface ImpactGraphProps {
  graph: ImpactGraphType | null
  onSelectNode?: (node: ImpactNode) => void
  selectedNodeId?: string | null
}

const KIND_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  view: { bg: '#0284c720', border: '#38bdf8', text: '#38bdf8', dot: '#38bdf8' },
  trigger: { bg: '#d9770620', border: '#fbbf24', text: '#fbbf24', dot: '#fbbf24' },
  foreign_key: { bg: '#7c3aed20', border: '#a855f7', text: '#c084fc', dot: '#a855f7' },
  table: { bg: '#05966920', border: '#34d399', text: '#34d399', dot: '#34d399' },
  routine: { bg: '#e11d4820', border: '#fb7185', text: '#fb7185', dot: '#fb7185' },
  index: { bg: '#64748b20', border: '#94a3b8', text: '#94a3b8', dot: '#94a3b8' },
  column: { bg: '#4f46e520', border: '#818cf8', text: '#818cf8', dot: '#818cf8' },
}

export const ImpactGraph: React.FC<ImpactGraphProps> = ({
  graph,
  onSelectNode,
  selectedNodeId,
}) => {
  const [hoveredNode, setHoveredNode] = useState<ImpactNode | null>(null)

  // Layout calculation
  const { nodePositions, width, height, centerX, centerY } = useMemo(() => {
    const w = 700
    const h = 480
    const cx = w / 2
    const cy = h / 2

    if (!graph || !graph.nodes || graph.nodes.length === 0) {
      return { nodePositions: new Map<string, { x: number; y: number }>(), width: w, height: h, centerX: cx, centerY: cy }
    }

    const positions = new Map<string, { x: number; y: number }>()
    // Root position at center
    positions.set(graph.root.id, { x: cx, y: cy })

    const total = graph.nodes.length
    // If small number of nodes, single circle ring. If large, two concentric rings
    if (total <= 8) {
      const radius = 170
      graph.nodes.forEach((node, idx) => {
        const angle = (idx / total) * 2 * Math.PI - Math.PI / 2
        positions.set(node.id, {
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle),
        })
      })
    } else {
      const innerCount = Math.ceil(total / 2)
      const outerCount = total - innerCount

      const r1 = 130
      const r2 = 210

      graph.nodes.slice(0, innerCount).forEach((node, idx) => {
        const angle = (idx / innerCount) * 2 * Math.PI - Math.PI / 2
        positions.set(node.id, {
          x: cx + r1 * Math.cos(angle),
          y: cy + r1 * Math.sin(angle),
        })
      })

      graph.nodes.slice(innerCount).forEach((node, idx) => {
        const angle = (idx / outerCount) * 2 * Math.PI - Math.PI / 2 + Math.PI / outerCount
        positions.set(node.id, {
          x: cx + r2 * Math.cos(angle),
          y: cy + r2 * Math.sin(angle),
        })
      })
    }

    return { nodePositions: positions, width: w, height: h, centerX: cx, centerY: cy }
  }, [graph])

  if (!graph) {
    return (
      <div className="flex items-center justify-center h-64 text-xs font-mono text-[var(--muted)]">
        No graph data available.
      </div>
    )
  }

  const rootPos = { x: centerX, y: centerY }

  return (
    <div className="relative w-full border border-[var(--border)] rounded-lg bg-[var(--surface)] overflow-hidden">
      {/* Legend & Controls */}
      <div className="absolute top-2 left-3 z-10 flex flex-wrap items-center gap-3 text-[10px] font-mono bg-[var(--bg)]/90 backdrop-blur px-2.5 py-1.5 rounded border border-[var(--border)] shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          <span className="text-[var(--fg)] font-semibold">Target</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#38bdf8]" />
          <span>View</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#fbbf24]" />
          <span>Trigger</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#a855f7]" />
          <span>FK</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#34d399]" />
          <span>Table</span>
        </div>
        <div className="border-l border-[var(--border)] pl-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[var(--muted)]">
            <span className="w-3 h-0.5 bg-[var(--border)] inline-block" /> Hard catalog
          </span>
          <span className="inline-flex items-center gap-1 text-[var(--muted)]">
            <span className="w-3 h-0.5 border-t border-dashed border-amber-400/80 inline-block" /> Textual ref
          </span>
        </div>
      </div>

      {/* SVG Canvas */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-[420px] select-none"
        style={{ background: 'radial-gradient(circle at center, rgba(99, 102, 241, 0.03) 0%, transparent 70%)' }}
      >
        <defs>
          <marker
            id="arrow-hard"
            viewBox="0 0 10 10"
            refX="22"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#6366f1" opacity="0.6" />
          </marker>
          <marker
            id="arrow-text"
            viewBox="0 0 10 10"
            refX="22"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" opacity="0.8" />
          </marker>
        </defs>

        {/* Orbit guides */}
        <circle cx={centerX} cy={centerY} r={170} fill="none" stroke="currentColor" className="text-[var(--border)]" strokeDasharray="3 3" opacity="0.4" />
        {graph.nodes.length > 8 && (
          <circle cx={centerX} cy={centerY} r={210} fill="none" stroke="currentColor" className="text-[var(--border)]" strokeDasharray="3 3" opacity="0.3" />
        )}

        {/* Edges */}
        {graph.nodes.map((node) => {
          const pos = nodePositions.get(node.id)
          if (!pos) return null

          const isTextual = node.ref_kind === 'textual_reference'
          const isHovered = hoveredNode?.id === node.id
          const isSelected = selectedNodeId === node.id

          return (
            <line
              key={`edge-${node.id}`}
              x1={pos.x}
              y1={pos.y}
              x2={rootPos.x}
              y2={rootPos.y}
              stroke={isTextual ? '#f59e0b' : isHovered || isSelected ? '#818cf8' : 'currentColor'}
              strokeOpacity={isHovered || isSelected ? 0.9 : isTextual ? 0.7 : 0.25}
              strokeWidth={isHovered || isSelected ? 2 : 1.2}
              strokeDasharray={isTextual ? '4 3' : 'none'}
              markerEnd={isTextual ? 'url(#arrow-text)' : 'url(#arrow-hard)'}
              className="transition-all duration-150"
            />
          )
        })}

        {/* Root Node */}
        <g
          transform={`translate(${rootPos.x}, ${rootPos.y})`}
          className="cursor-pointer"
          onClick={() => onSelectNode?.(graph.root)}
        >
          <circle
            r={36}
            fill="#6366f1"
            fillOpacity="0.2"
            stroke="#6366f1"
            strokeWidth={2.5}
            className="transition-all hover:scale-105"
          />
          <text
            textAnchor="middle"
            dy="-6"
            className="fill-indigo-300 font-mono text-[10px] uppercase font-bold tracking-wider"
          >
            {graph.root.kind}
          </text>
          <text
            textAnchor="middle"
            dy="12"
            className="fill-[var(--fg)] font-mono text-xs font-semibold"
          >
            {graph.root.name.length > 14 ? graph.root.name.slice(0, 12) + '…' : graph.root.name}
          </text>
        </g>

        {/* Dependent Nodes */}
        {graph.nodes.map((node) => {
          const pos = nodePositions.get(node.id)
          if (!pos) return null

          const colors = KIND_COLORS[node.kind] || {
            bg: '#3f3f4620',
            border: '#71717a',
            text: '#a1a1aa',
            dot: '#71717a',
          }
          const isHovered = hoveredNode?.id === node.id
          const isSelected = selectedNodeId === node.id

          return (
            <g
              key={`node-${node.id}`}
              transform={`translate(${pos.x}, ${pos.y})`}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredNode(node)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => onSelectNode?.(node)}
            >
              <circle
                r={isHovered || isSelected ? 24 : 20}
                fill={colors.bg}
                stroke={isSelected ? '#ffffff' : colors.border}
                strokeWidth={isSelected ? 2 : isHovered ? 2 : 1.2}
                className="transition-all duration-150"
              />
              <circle
                r={3}
                cy={-8}
                fill={colors.dot}
              />
              <text
                textAnchor="middle"
                dy="6"
                className="font-mono text-[10px] font-medium"
                fill={colors.text}
              >
                {node.name.length > 10 ? node.name.slice(0, 8) + '…' : node.name}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Hover Info Tooltip */}
      {hoveredNode && (
        <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:max-w-md bg-[var(--bg)]/95 backdrop-blur border border-[var(--border)] rounded-md shadow-lg p-3 text-xs font-mono z-20">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-1.5 mb-1.5">
            <span className="font-semibold text-[var(--fg)] flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ backgroundColor: KIND_COLORS[hoveredNode.kind]?.border || '#71717a' }}
              />
              {hoveredNode.name}
            </span>
            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">
              {hoveredNode.kind}
            </span>
          </div>
          <div className="text-[11px] text-[var(--muted)] space-y-0.5">
            <div><span className="text-[var(--fg)]">Ref Type:</span> {hoveredNode.ref_kind}</div>
            {hoveredNode.drop_behavior && (
              <div><span className="text-[var(--fg)]">Drop Behavior:</span> {hoveredNode.drop_behavior}</div>
            )}
            {hoveredNode.detail && (
              <div className="truncate text-[10px] mt-1 text-[var(--muted)]"><span className="text-[var(--fg)]">Detail:</span> {hoveredNode.detail}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
