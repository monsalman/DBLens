import React from 'react'
import type { ValueFreq } from './profileHelper'
import { formatNumber, formatPercentage } from './profileHelper'

interface ValueDistributionBarsProps {
  values: ValueFreq[]
  totalRows?: number
  height?: number
}

export const ValueDistributionBars: React.FC<ValueDistributionBarsProps> = ({
  values,
  height = 240,
}) => {
  if (!values || values.length === 0) {
    return (
      <div className="flex items-center justify-center h-28 text-xs text-[var(--muted)] border border-dashed border-[var(--border)] rounded-md">
        No frequent values recorded
      </div>
    )
  }

  const maxPct = Math.max(...values.map(v => v.percentage), 1)
  const barHeight = 22
  const gap = 8
  const labelWidth = 140
  const countWidth = 100
  const svgWidth = 560
  const barAreaWidth = svgWidth - labelWidth - countWidth - 20
  const svgHeight = Math.max(values.length * (barHeight + gap) + 10, height)

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full h-auto text-xs font-mono select-none"
        style={{ minWidth: 420, maxHeight: 360 }}
      >
        <defs>
          <linearGradient id="barGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0.95" />
          </linearGradient>
        </defs>

        {values.map((v, i) => {
          const y = i * (barHeight + gap) + 10
          const barW = Math.max(2, (v.percentage / maxPct) * barAreaWidth)
          const displayVal = v.value.length > 20 ? v.value.slice(0, 18) + '…' : v.value

          return (
            <g key={i} className="hover:opacity-90 transition-opacity">
              {/* Row hover guide */}
              <rect
                x={0}
                y={y - 2}
                width={svgWidth}
                height={barHeight + 4}
                fill="transparent"
                className="hover:fill-[var(--hover)]"
                rx={4}
              />

              {/* Label */}
              <text
                x={0}
                y={y + barHeight / 2 + 4}
                fill="var(--fg)"
                className="font-medium text-[11px]"
              >
                <title>{v.value}</title>
                {displayVal}
              </text>

              {/* Bar background track */}
              <rect
                x={labelWidth}
                y={y + 3}
                width={barAreaWidth}
                height={barHeight - 6}
                rx={3}
                fill="currentColor"
                className="text-[var(--border)] opacity-30"
              />

              {/* Filled bar */}
              <rect
                x={labelWidth}
                y={y + 3}
                width={barW}
                height={barHeight - 6}
                rx={3}
                fill="url(#barGradient)"
              />

              {/* Count and Percentage label */}
              <text
                x={labelWidth + barAreaWidth + 12}
                y={y + barHeight / 2 + 4}
                fill="var(--muted)"
                className="text-[11px]"
              >
                {formatNumber(v.count)} ({formatPercentage(v.percentage)})
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
