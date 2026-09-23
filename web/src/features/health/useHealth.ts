import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ConnectionHealth, type HealthPayload, type HealthSummary } from '../../lib/api'

const EMPTY_SUMMARY: HealthSummary = {
  healthy: 0, degraded: 0, down: 0, unknown: 0,
  total: 0, total_checks: 0, success_count: 0, success_rate: 0,
}

/**
 * Loads the connection health snapshot once, then keeps it fresh from the
 * server's SSE stream. The stream carries the same payload shape, so a push
 * simply replaces local state; if the stream drops, EventSource retries on its
 * own and the periodic fallback poll covers the gap.
 */
export function useHealth(enabled = true) {
  const [connections, setConnections] = useState<ConnectionHealth[]>([])
  const [summary, setSummary] = useState<HealthSummary>(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const apply = useCallback((payload: HealthPayload | null | undefined) => {
    if (!payload) return
    setConnections(payload.connections ?? [])
    setSummary({ ...EMPTY_SUMMARY, ...(payload.summary ?? {}) })
  }, [])

  const load = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError('')
    try {
      apply(await api.getConnectionHealth())
    } catch (e: any) {
      setError(e?.message || 'Failed to load connection health')
    } finally {
      setLoading(false)
    }
  }, [enabled, apply])

  useEffect(() => {
    if (!enabled) return
    load()
  }, [enabled, load])

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return
    const es = new EventSource(api.healthStreamUrl())
    esRef.current = es
    es.onopen = () => setLive(true)
    es.onerror = () => setLive(false)
    es.onmessage = (ev) => {
      try {
        apply(JSON.parse(ev.data))
        setLive(true)
        setError('')
      } catch {
        /* ignore a malformed frame; the next tick re-sends the full snapshot */
      }
    }
    return () => {
      es.close()
      esRef.current = null
      setLive(false)
    }
  }, [enabled, apply])

  return { connections, summary, loading, error, live, reload: load }
}
