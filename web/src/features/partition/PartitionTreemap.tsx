import React, { useState, useMemo, useRef, useEffect } from 'react'
import type { PartitionNode, TreemapRect } from './partitionHelper'
import {
  computeTreemapLayout,
  formatBytes,
  formatRows,
  formatShare,
  getStatusBadge,
} from './partitionHelper'

interface PartitionTreemapProps {
  partitions: PartitionNode[]
  metric: 'bytes' | 'rows'
  selectedNode?: PartitionNode | null
  onSelectNode: (node: PartitionNode) => void
}

export const PartitionTreemap: React.FC<PartitionTreemapProps> = ({
  partitions,
  metric,
  selectedNode,
  onSelectNode,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 800,
    height: 420,
  })
  const [hoveredRect, setHoveredRect] = useState<TreemapRect | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  useEffect(() => {
    if (!containerRef.current) return
    const updateSize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current
        if (clientWidth > 100) {
          setDimensions({
            width: clientWidth,
            height: Math.max(clientHeight, 380),
          })
        }
      }
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const rects = useMemo(() => {
    return computeTreemapLayout(partitions, dimensions.width, dimensions.height, metric)
  }, [partitions, dimensions.width, dimensions.height, metric])

  const handleMouseMove = (e: React.MouseEvent, r: TreemapRect) => {
    const target = containerRef.current
    if (target) {
      const bounds = target.getBoundingClientRect()
      setMousePos({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      })
    }
    setHoveredRect(r)
  }

  if (!partitions || partitions.length === 0) {
    return (
      <div className="flex h-64 w-full items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 text-xs text-zinc-500">
        No partition slices detected to visualize
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[420px] rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden select-none"
    >
      <svg
        width={dimensions.width}
        height={dimensions.height}
        className="w-full h-full block"
      >
        <defs>
          <pattern id="gridPattern" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255, 255, 255, 0.03)" strokeWidth="1" />
          </pattern>
        </defs>

        <rect width={dimensions.width} height={dimensions.height} fill="url(#gridPattern)" />

        {rects.map((r) => {
          const isSelected = selectedNode?.name === r.node.name
          const isHovered = hoveredRect?.id === r.id
          const status = getStatusBadge(r.node.status)
          const fill = status.bgFill

          // Opacity scaled with share percentage (min 0.35, max 0.85)
          const fillOpacity = Math.min(Math.max(r.percentage / 100 + 0.3, 0.35), 0.85)

          return (
            <g
              key={r.id}
              onClick={() => onSelectNode(r.node)}
              onMouseMove={(e) => handleMouseMove(e, r)}
              onMouseLeave={() => setHoveredRect(null)}
              className="cursor-pointer transition-all duration-150"
            >
              <rect
                x={r.x}
                y={r.y}
                width={Math.max(r.width - 2, 1)}
                height={Math.max(r.height - 2, 1)}
                rx={4}
                ry={4}
                fill={fill}
                fillOpacity={isHovered ? 0.9 : fillOpacity}
                stroke={isSelected ? '#ffffff' : isHovered ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)'}
                strokeWidth={isSelected ? 2.5 : 1}
                className="transition-colors"
              />

              {/* Text labels if box is big enough */}
              {r.width > 60 && r.height > 35 && (
                <text
                  x={r.x + 8}
                  y={r.y + 18}
                  fill="#ffffff"
                  fontSize={r.width > 120 ? 12 : 10}
                  fontWeight="600"
                  className="pointer-events-none drop-shadow-sm select-none"
                >
                  {r.node.name.length > Math.floor(r.width / 8)
                    ? r.node.name.slice(0, Math.floor(r.width / 8)) + '…'
                    : r.node.name}
                </text>
              )}

              {r.width > 70 && r.height > 55 && (
                <text
                  x={r.x + 8}
                  y={r.y + 34}
                  fill="rgba(255, 255, 255, 0.75)"
                  fontSize={10}
                  className="pointer-events-none select-none font-mono"
                >
                  {metric === 'bytes' ? formatBytes(r.node.bytes) : `${formatRows(r.node.rows)} rows`} (
                  {formatShare(r.percentage)})
                </text>
              )}

              {r.width > 90 && r.height > 75 && r.node.status === 'hot_skew' && (
                <text
                  x={r.x + 8}
                  y={r.y + 50}
                  fill="#fecaca"
                  fontSize={9}
                  fontWeight="700"
                  className="pointer-events-none select-none tracking-wider"
                >
                  🔥 HOT SKEW
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Floating Tooltip */}
      {hoveredRect && (
        <div
          className="pointer-events-none absolute z-20 rounded-md border border-zinc-700 bg-zinc-900/95 p-3 text-xs text-zinc-200 shadow-xl backdrop-blur-md space-y-1.5 min-w-[200px]"
          style={{
            left: Math.min(mousePos.x + 15, dimensions.width - 220),
            top: Math.min(mousePos.y + 15, dimensions.height - 140),
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-1.5">
            <span className="font-semibold text-white truncate max-w-[140px]">{hoveredRect.node.name}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${getStatusBadge(hoveredRect.node.status).badgeClass}`}>
              {getStatusBadge(hoveredRect.node.status).label}
            </span>
          </div>

          {hoveredRect.node.boundExpression && (
            <div className="text-[11px] text-zinc-400 font-mono truncate" title={hoveredRect.node.boundExpression}>
              {hoveredRect.node.boundExpression}
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] pt-1 border-t border-zinc-800/60 font-mono">
            <div>
              <span className="text-zinc-500">Storage:</span> {formatBytes(hoveredRect.node.bytes)}
            </div>
            <div>
              <span className="text-zinc-500">Share:</span> {formatShare(hoveredRect.node.byteSharePct)}
            </div>
            <div>
              <span className="text-zinc-500">Rows:</span> {formatRows(hoveredRect.node.rows)}
            </div>
            <div>
              <span className="text-zinc-500">Row%:</span> {formatShare(hoveredRect.node.rowSharePct)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
