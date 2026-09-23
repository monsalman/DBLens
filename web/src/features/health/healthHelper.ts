import type { ConnectionHealth, HealthSample, HealthStatus } from '../../lib/api'

/**
 * Maps a latency sample series to SVG polyline points inside a w×h box.
 *
 * The scale is shared across the series (min→bottom, max→top) so the shape is
 * readable; a flat series is drawn as a centred flat line rather than a spike.
 * Failed probes (ms = 0) are clamped to the baseline so an outage reads as a
 * deep valley. X is always evenly spaced, so a full window looks "busy" and a
 * half-full window only occupies its own share of the width.
 */
export function sparklinePoints(
  samples: number[],
  width: number,
  height: number,
  pad = 2,
): string {
  const values = samples.filter(v => Number.isFinite(v))
  if (values.length === 0) return ''
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min
  const inner = Math.max(height - pad * 2, 1)
  const step = values.length > 1 ? width / (values.length - 1) : 0
  return values
    .map((v, i) => {
      const x = +(i * step).toFixed(2)
      const ratio = span === 0 ? 0.5 : (v - min) / span
      const y = +(pad + inner * (1 - ratio)).toFixed(2)
      return `${x},${y}`
    })
    .join(' ')
}

/** Latency series for a connection: successful probes keep their ms, failures plot 0. */
export function latencySeries(conn: ConnectionHealth): number[] {
  return (conn.samples ?? []).map((s: HealthSample) => (s.ok ? Math.max(s.ms, 0) : 0))
}

/** Percentage of successful probes, rounded to one decimal. */
export function uptimePct(conn: ConnectionHealth): number {
  if (!conn.total_checks) return 0
  return Math.round((conn.success_count / conn.total_checks) * 1000) / 10
}

/** Stroke colour for a status; unknown falls back to muted grey. */
export function statusStroke(status: HealthStatus): string {
  switch (status) {
    case 'green': return '#10b981'
    case 'yellow': return '#f59e0b'
    case 'red': return '#ef4444'
    default: return '#71717a'
  }
}

/** Human label for a status badge. */
export function statusLabel(status: HealthStatus): string {
  switch (status) {
    case 'green': return 'Healthy'
    case 'yellow': return 'Degraded'
    case 'red': return 'Down'
    default: return 'Unknown'
  }
}

/**
 * Mirrors the server's driver.MaskDSN so a browser-local connection profile can
 * be matched against the masked DSN the monitor reports as a label. Only the
 * password segment is replaced; query parameters survive untouched.
 */
export function maskDsn(dsn: string): string {
  if (!dsn.includes('@')) return dsn
  const qIdx = dsn.indexOf('?')
  const base = qIdx === -1 ? dsn : dsn.slice(0, qIdx)
  const query = qIdx === -1 ? '' : dsn.slice(qIdx)
  const lastAt = base.lastIndexOf('@')
  if (lastAt === -1) return dsn
  let start = 0
  const schemeIdx = base.indexOf('://')
  if (schemeIdx !== -1 && schemeIdx < lastAt) start = schemeIdx + 3
  const userInfo = base.slice(start, lastAt)
  const colonIdx = userInfo.indexOf(':')
  if (colonIdx === -1) return dsn
  const user = userInfo.slice(0, colonIdx)
  return dsn.slice(0, start) + user + ':***' + base.slice(lastAt) + query
}

/**
 * Resolves the health entry for a connection profile. Server-seeded global_*
 * connections match by id; browser-local profiles (local_*) carry ids the
 * server never sees, so they match on the masked DSN label instead.
 */
export function findHealth<T extends { connection_id: string; label?: string }>(
  conn: { id: string; dsn?: string },
  healthConns: T[],
): T | undefined {
  if (!conn) return undefined
  const byId = healthConns.find(h => h.connection_id === conn.id)
  if (byId) return byId
  if (conn.dsn) {
    const masked = maskDsn(conn.dsn)
    return healthConns.find(h => h.label === masked)
  }
  return undefined
}
