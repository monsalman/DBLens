import React from 'react'
import type { Bucket } from './profileHelper'
import { formatNumber } from './profileHelper'

interface HistogramProps {
  buckets?: Bucket[]
  height?: number
}

export const Histogram: React.FC<HistogramProps> = ({ buckets, height = 180 }) => {
  if (!buckets || buckets.length === 0) {
    return (
      <div className="flex items-center justify-center h-28 text-xs text-[var(--muted)] border border-dashed border-[var(--border)] rounded-md">
        No numeric histogram data available
      </div>
    )
  }

  const maxCount = Math.max(...buckets.map(b => b.count), 1)
  const svgWidth = 520
  const padLeft = 36
  const padRight = 20
  const padTop = 24
  const padBottom = 34
  const chartW = svgWidth - padLeft - padRight
  const chartH = height - padTop - padBottom

  const barCount = buckets.length
  const barGap = 6
  const barWidth = Math.max(12, (chartW - (barCount - 1) * barGap) / barCount)

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${svgWidth} ${height}`}
        className="w-full h-auto text-xs font-mono select-none"
        style={{ minWidth: 380, maxHeight: 220 }}
      >
        <defs>
          <linearGradient id="histGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.75" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines */}
        <line
          x1={padLeft}
          y1={padTop + chartH}
          x2={svgWidth - padRight}
          y2={padTop + chartH}
          stroke="var(--border)"
          strokeWidth={1}
        />
        <line
          x1={padLeft}
          y1={padTop + chartH / 2}
          x2={svgWidth - padRight}
          y2={padTop + chartH / 2}
          stroke="var(--border)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.4}
        />

        {/* Y Axis labels */}
        <text
          x={padLeft - 6}
          y={padTop + 4}
          fill="var(--muted)"
          textAnchor="end"
          className="text-[9px]"
        >
          {formatNumber(maxCount)}
        </text>
        <text
          x={padLeft - 6}
          y={padTop + chartH / 2 + 3}
          fill="var(--muted)"
          textAnchor="end"
          className="text-[9px]"
        >
          {formatNumber(Math.round(maxCount / 2))}
        </text>
        <text
          x={padLeft - 6}
          y={padTop + chartH + 3}
          fill="var(--muted)"
          textAnchor="end"
          className="text-[9px]"
        >
          0
        </text>

        {/* Bars and X labels */}
        {buckets.map((b, i) => {
          const x = padLeft + i * (barWidth + barGap)
          const barH = (b.count / maxCount) * chartH
          const y = padTop + chartH - barH

          return (
            <g key={i} className="group cursor-pointer">
              {/* Tooltip background trigger */}
              <title>{`[${b.min} - ${b.max}]: ${formatNumber(b.count)} rows`}</title>

              {/* Bar */}
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(2, barH)}
                rx={3}
                fill="url(#histGradient)"
                className="transition-all duration-150 group-hover:brightness-110"
              />

              {/* Value on top of bar if count > 0 */}
              {b.count > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={Math.max(padTop - 4, y - 4)}
                  fill="var(--fg)"
                  textAnchor="middle"
                  className="text-[10px] font-medium"
                >
                  {formatNumber(b.count)}
                </text>
              )}

              {/* Range label under bar */}
              <text
                x={x + barWidth / 2}
                y={padTop + chartH + 14}
                fill="var(--muted)"
                textAnchor="middle"
                className="text-[9px]"
              >
                {b.min}
              </text>
            </g>
          )
        })}

        {/* Final edge label */}
        {buckets.length > 0 && (
          <text
            x={padLeft + buckets.length * (barWidth + barGap) - barGap}
            y={padTop + chartH + 14}
            fill="var(--muted)"
            textAnchor="middle"
            className="text-[9px]"
          >
            {buckets[buckets.length - 1].max}
          </text>
        )}
      </svg>
    </div>
  )
}
