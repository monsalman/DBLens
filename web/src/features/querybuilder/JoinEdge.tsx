import React, { useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import { X, ChevronDown } from 'lucide-react'
import { SUPPORTED_JOIN_TYPES } from './queryBuilderHelper'

export interface JoinEdgeData {
  joinId: string
  joinType: string
  sourceTable: string
  sourceColumn: string
  targetTable: string
  targetColumn: string
  onChangeJoinType: (joinId: string, newType: string) => void
  onDeleteJoin: (joinId: string) => void
}

export const JoinEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}) => {
  const edgeData = data as unknown as JoinEdgeData | undefined
  const [menuOpen, setMenuOpen] = useState(false)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const joinType = edgeData?.joinType || 'INNER'

  const getJoinColor = (type: string) => {
    switch (type.toUpperCase()) {
      case 'LEFT':
        return 'text-sky-400 border-sky-500/40 bg-sky-950/80'
      case 'RIGHT':
        return 'text-emerald-400 border-emerald-500/40 bg-emerald-950/80'
      case 'FULL':
        return 'text-purple-400 border-purple-500/40 bg-purple-950/80'
      case 'CROSS':
        return 'text-rose-400 border-rose-500/40 bg-rose-950/80'
      default:
        return 'text-indigo-400 border-indigo-500/40 bg-indigo-950/80'
    }
  }

  const getEdgeStroke = (type: string) => {
    switch (type.toUpperCase()) {
      case 'LEFT':
        return '#38bdf8'
      case 'RIGHT':
        return '#34d399'
      case 'FULL':
        return '#c084fc'
      case 'CROSS':
        return '#f43f5e'
      default:
        return '#818cf8'
    }
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: getEdgeStroke(joinType),
          strokeWidth: 2,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan z-20"
        >
          <div className="relative">
            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-mono shadow-lg backdrop-blur-sm cursor-pointer hover:scale-105 transition-all ${getJoinColor(
                joinType
              )}`}
              onClick={() => setMenuOpen(!menuOpen)}
              title={`Join: ${edgeData?.sourceColumn} = ${edgeData?.targetColumn} (Click to change)`}
            >
              <span className="font-semibold">{joinType}</span>
              <ChevronDown className="w-2.5 h-2.5 opacity-70" />
              {edgeData && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    edgeData.onDeleteJoin(edgeData.joinId)
                  }}
                  className="hover:text-rose-400 ml-0.5 p-0.5 rounded transition-colors"
                  title="Remove join"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>

            {/* Join type selector dropdown */}
            {menuOpen && edgeData && (
              <div
                className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-2xl py-1 z-50 min-w-[100px] flex flex-col font-sans text-xs"
                onMouseLeave={() => setMenuOpen(false)}
              >
                {SUPPORTED_JOIN_TYPES.map((jt) => (
                  <button
                    key={jt}
                    type="button"
                    onClick={() => {
                      edgeData.onChangeJoinType(edgeData.joinId, jt)
                      setMenuOpen(false)
                    }}
                    className={`px-3 py-1 text-left text-[11px] font-mono hover:bg-white/10 transition-colors flex items-center justify-between ${
                      joinType === jt ? 'text-indigo-400 font-bold bg-white/5' : 'text-[var(--fg)]'
                    }`}
                  >
                    <span>{jt}</span>
                    {joinType === jt && <span className="text-[10px]">✓</span>}
                  </button>
                ))}
                <div className="border-t border-[var(--border)] my-1" />
                <button
                  type="button"
                  onClick={() => {
                    edgeData.onDeleteJoin(edgeData.joinId)
                    setMenuOpen(false)
                  }}
                  className="px-3 py-1 text-left text-[11px] text-rose-400 hover:bg-rose-500/10 transition-colors flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  <span>Delete Join</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
