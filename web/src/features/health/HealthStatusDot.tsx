import React from 'react'
import type { HealthStatus } from '../../lib/api'

interface Props {
  status: HealthStatus
  size?: number
  label?: string
  className?: string
}

const COLORS: Record<HealthStatus, { dot: string; text: string }> = {
  green: { dot: 'bg-emerald-500', text: 'text-emerald-500' },
  yellow: { dot: 'bg-amber-500', text: 'text-amber-500' },
  red: { dot: 'bg-red-500', text: 'text-red-500' },
  unknown: { dot: 'bg-zinc-500', text: 'text-zinc-400' },
}

const DESCRIPTIONS: Record<HealthStatus, string> = {
  green: 'Healthy — last checks passed with low latency',
  yellow: 'Degraded — a recent check failed or latency is high',
  red: 'Down — three or more consecutive probe failures',
  unknown: 'Not probed yet',
}

/** Small coloured liveness dot with a hover tooltip describing the status. */
export const HealthStatusDot: React.FC<Props> = ({ status, size = 8, label, className = '' }) => {
  const c = COLORS[status] ?? COLORS.unknown
  const title = `${label ? label + ': ' : ''}${DESCRIPTIONS[status] ?? DESCRIPTIONS.unknown}`
  return (
    <span className={`inline-flex items-center gap-1 shrink-0 ${className}`} title={title} aria-label={title} role="img">
      <span
        className={`rounded-full ${c.dot}`}
        style={{ width: size, height: size, boxShadow: '0 0 4px currentColor' }}
      />
    </span>
  )
}
