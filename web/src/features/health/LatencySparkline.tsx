import React from 'react'
import type { HealthStatus } from '../../lib/api'
import { sparklinePoints, statusStroke } from './healthHelper'

interface Props {
  samples: number[]
  status?: HealthStatus
  width?: number
  height?: number
}

/**
 * Pure-SVG latency sparkline (no chart library). Renders a polyline plus a dot
 * on the most recent sample; the stroke colour follows the connection status.
 */
export const LatencySparkline: React.FC<Props> = ({
  samples = [],
  status = 'unknown',
  width = 120,
  height = 28,
}) => {
  const values = samples.slice(-60)
  const stroke = statusStroke(status)

  if (values.length === 0) {
    return (
      <span className="text-[10px] text-[var(--muted)] italic" style={{ width }}>
        no samples
      </span>
    )
  }

  const points = sparklinePoints(values, width, height)
  const lastXY = points.split(' ').pop()?.split(',') ?? []
  const lastX = Number(lastXY[0] ?? 0)
  const lastY = Number(lastXY[1] ?? height / 2)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Latency sparkline, ${values.length} samples, status ${status}`}
      className="overflow-visible"
    >
      <line
        x1={0} y1={height - 1} x2={width} y2={height - 1}
        stroke="var(--border)" strokeWidth={1} strokeDasharray="2 2"
      />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={2.2} fill={stroke} />
    </svg>
  )
}
