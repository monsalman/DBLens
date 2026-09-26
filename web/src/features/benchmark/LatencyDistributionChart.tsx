import React, { useState } from 'react'
import type { HistogramBucket } from './benchmarkHelper'

interface LatencyDistributionChartProps {
  buckets: HistogramBucket[]
  p50?: number
  p95?: number
  p99?: number
  minLatencyMs?: number
  maxLatencyMs?: number
  totalQueries?: number
}

export const LatencyDistributionChart: React.FC<LatencyDistributionChartProps> = ({
  buckets,
  p50,
  p95,
  p99,
  minLatencyMs = 0,
  maxLatencyMs = 0,
  totalQueries = 0,
}) => {
  const [hoveredBucket, setHoveredBucket] = useState<{
    bucket: HistogramBucket
    x: number
    y: number
  } | null>(null)

  if (!buckets || buckets.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center border border-dashed border-zinc-800 rounded-lg text-zinc-500 text-sm">
        No latency distribution data available
      </div>
    )
  }

  const width = 640
  const height = 200
  const padLeft = 45
  const padRight = 30
  const padTop = 30
  const padBottom = 35

  const chartW = width - padLeft - padRight
  const chartH = height - padTop - padBottom

  const maxCount = Math.max(...buckets.map((b) => b.count), 1)
  const barGap = 3
  const totalGaps = (buckets.length - 1) * barGap
  const barWidth = Math.max((chartW - totalGaps) / buckets.length, 4)

  const overallMin = minLatencyMs || (buckets[0]?.fromMs ?? 0)
  const overallMax = maxLatencyMs || (buckets[buckets.length - 1]?.toMs ?? 1)
  const latencySpan = Math.max(overallMax - overallMin, 0.001)

  // Map latency to X coordinate
  const latencyToX = (lat: number): number => {
    const clamped = Math.max(overallMin, Math.min(overallMax, lat))
    const ratio = (clamped - overallMin) / latencySpan
    return padLeft + ratio * chartW
  }

  return (
    <div className="relative w-full bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-4 font-sans select-none">
      <div className="flex items-center justify-between mb-3 text-xs">
        <span className="font-semibold text-zinc-300 uppercase tracking-wider">
          Latency Distribution (ms)
        </span>
        <div className="flex items-center gap-3 text-[11px]">
          {p50 !== undefined && (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              P50: {p50.toFixed(2)}ms
            </span>
          )}
          {p95 !== undefined && (
            <span className="flex items-center gap-1.5 text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              P95: {p95.toFixed(2)}ms
            </span>
          )}
          {p99 !== undefined && (
            <span className="flex items-center gap-1.5 text-rose-400">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              P99: {p99.toFixed(2)}ms
            </span>
          )}
        </div>
      </div>

      <div className="w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible"
        >
          <defs>
            <linearGradient id="benchBarGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.4" />
            </linearGradient>
            <linearGradient id="benchBarHover" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity="1" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.8" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line
            x1={padLeft}
            y1={padTop}
            x2={padLeft + chartW}
            y2={padTop}
            stroke="#27272a"
            strokeDasharray="2 2"
          />
          <line
            x1={padLeft}
            y1={padTop + chartH / 2}
            x2={padLeft + chartW}
            y2={padTop + chartH / 2}
            stroke="#27272a"
            strokeDasharray="2 2"
          />
          <line
            x1={padLeft}
            y1={padTop + chartH}
            x2={padLeft + chartW}
            y2={padTop + chartH}
            stroke="#3f3f46"
          />

          {/* Y Axis scale text */}
          <text
            x={padLeft - 8}
            y={padTop + 4}
            textAnchor="end"
            fontSize="10"
            fill="#71717a"
          >
            {maxCount >= 1000 ? `${(maxCount / 1000).toFixed(1)}k` : maxCount}
          </text>
          <text
            x={padLeft - 8}
            y={padTop + chartH / 2 + 4}
            textAnchor="end"
            fontSize="10"
            fill="#71717a"
          >
            {maxCount / 2 >= 1000 ? `${(maxCount / 2000).toFixed(1)}k` : Math.round(maxCount / 2)}
          </text>
          <text
            x={padLeft - 8}
            y={padTop + chartH}
            textAnchor="end"
            fontSize="10"
            fill="#71717a"
          >
            0
          </text>

          {/* Histogram Bars */}
          {buckets.map((b, i) => {
            const x = padLeft + i * (barWidth + barGap)
            const barH = (b.count / maxCount) * chartH
            const y = padTop + chartH - barH
            const isHovered = hoveredBucket?.bucket === b

            return (
              <g key={i}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(barH, 1)}
                  rx="2"
                  fill={isHovered ? 'url(#benchBarHover)' : 'url(#benchBarGradient)'}
                  className="transition-colors cursor-pointer"
                  onMouseEnter={() => setHoveredBucket({ bucket: b, x: x + barWidth / 2, y })}
                  onMouseLeave={() => setHoveredBucket(null)}
                />
              </g>
            )
          })}

          {/* X Axis Range Labels */}
          <text
            x={padLeft}
            y={padTop + chartH + 18}
            textAnchor="start"
            fontSize="10"
            fill="#a1a1aa"
          >
            {overallMin.toFixed(2)} ms
          </text>
          <text
            x={padLeft + chartW / 2}
            y={padTop + chartH + 18}
            textAnchor="middle"
            fontSize="10"
            fill="#71717a"
          >
            {((overallMin + overallMax) / 2).toFixed(2)} ms
          </text>
          <text
            x={padLeft + chartW}
            y={padTop + chartH + 18}
            textAnchor="end"
            fontSize="10"
            fill="#a1a1aa"
          >
            {overallMax.toFixed(2)} ms
          </text>

          {/* P50 Marker */}
          {p50 !== undefined && (
            <g>
              <line
                x1={latencyToX(p50)}
                y1={padTop}
                x2={latencyToX(p50)}
                y2={padTop + chartH}
                stroke="#10b981"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
              <circle cx={latencyToX(p50)} cy={padTop} r="3" fill="#10b981" />
            </g>
          )}

          {/* P95 Marker */}
          {p95 !== undefined && (
            <g>
              <line
                x1={latencyToX(p95)}
                y1={padTop}
                x2={latencyToX(p95)}
                y2={padTop + chartH}
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
              <circle cx={latencyToX(p95)} cy={padTop} r="3" fill="#f59e0b" />
            </g>
          )}

          {/* P99 Marker */}
          {p99 !== undefined && (
            <g>
              <line
                x1={latencyToX(p99)}
                y1={padTop}
                x2={latencyToX(p99)}
                y2={padTop + chartH}
                stroke="#f43f5e"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
              <circle cx={latencyToX(p99)} cy={padTop} r="3" fill="#f43f5e" />
            </g>
          )}
        </svg>
      </div>

      {/* Floating Tooltip */}
      {hoveredBucket && (
        <div
          className="absolute z-20 pointer-events-none px-2.5 py-1.5 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl text-xs text-zinc-100 transform -translate-x-1/2 -translate-y-full mb-2"
          style={{
            left: `${(hoveredBucket.x / width) * 100}%`,
            top: `${(hoveredBucket.y / height) * 100}%`,
          }}
        >
          <div className="font-semibold text-sky-400">
            {hoveredBucket.bucket.fromMs.toFixed(2)} - {hoveredBucket.bucket.toMs.toFixed(2)} ms
          </div>
          <div className="text-zinc-300">
            {hoveredBucket.bucket.count.toLocaleString()} queries
            {totalQueries > 0 && (
              <span className="text-zinc-500 ml-1">
                ({((hoveredBucket.bucket.count / totalQueries) * 100).toFixed(1)}%)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
