import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ConnectionConfig } from '../../lib/api'
import type { LockTreeResponse, TerminateLockRequest } from './lockHelper'

interface UseLockManagerOptions {
  connId: string | null
  profiles?: ConnectionConfig[]
  enabled?: boolean
  initialAutoRefresh?: boolean
}

export function useLockManager({
  connId,
  profiles,
  enabled = true,
  initialAutoRefresh = true,
}: UseLockManagerOptions) {
  const [data, setData] = useState<LockTreeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(initialAutoRefresh)
  const [selectedPID, setSelectedPID] = useState<number | null>(null)
  const [isTerminating, setIsTerminating] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const fetchLocks = useCallback(async () => {
    if (!connId || !enabled) return
    setLoading(true)
    setError(null)
    try {
      const resp = await api.getLocks(connId, profiles)
      setData(resp)
      // Auto-select the first root blocker or deadlocked node if none selected
      setSelectedPID(prev => {
        if (prev !== null) {
          const stillExists = resp.all_nodes?.some(n => n.pid === prev)
          if (stillExists) return prev
        }
        if (resp.deadlocks && resp.deadlocks.length > 0 && resp.deadlocks[0].pids.length > 0) {
          return resp.deadlocks[0].pids[0]
        }
        if (resp.root_blockers && resp.root_blockers.length > 0) {
          return resp.root_blockers[0].pid
        }
        if (resp.all_nodes && resp.all_nodes.length > 0) {
          return resp.all_nodes[0].pid
        }
        return null
      })
    } catch (err: any) {
      setError(err?.message || 'Failed to inspect database locks')
    } finally {
      setLoading(false)
    }
  }, [connId, profiles, enabled])

  // Initial fetch when enabled or connId changes
  useEffect(() => {
    if (enabled && connId) {
      fetchLocks()
    } else {
      setData(null)
      setSelectedPID(null)
    }
  }, [enabled, connId, fetchLocks])

  // SSE Stream subscription when autoRefresh is enabled
  useEffect(() => {
    if (!enabled || !connId || !autoRefresh || typeof EventSource === 'undefined') {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
        setLive(false)
      }
      return
    }

    // Resolve DSN for query param if browser EventSource cannot send custom headers
    const dsn = (api as any)._getDSN ? (api as any)._getDSN(connId, profiles) : ''
    const sp = new URLSearchParams()
    if (dsn) sp.set('dsn', dsn)
    const streamUrl = `/api/connections/${encodeURIComponent(connId)}/locks/stream${sp.toString() ? `?${sp.toString()}` : ''}`

    const es = new EventSource(streamUrl)
    esRef.current = es

    es.onopen = () => {
      setLive(true)
      setError(null)
    }

    es.onerror = () => {
      setLive(false)
      // Fallback: don't permanently break, regular polling or reconnect will handle
    }

    es.onmessage = (event) => {
      try {
        const payload: LockTreeResponse = JSON.parse(event.data)
        setData(payload)
        setLive(true)
        setError(null)
      } catch {
        // Ignore unparseable frames
      }
    }

    return () => {
      es.close()
      esRef.current = null
      setLive(false)
    }
  }, [enabled, connId, autoRefresh, profiles])

  const terminateSession = useCallback(
    async (pid: number, force = false): Promise<boolean> => {
      if (!connId) return false
      setIsTerminating(true)
      setError(null)
      try {
        const payload: TerminateLockRequest = { pid, force }
        await api.terminateLock(connId, payload, profiles)
        await fetchLocks()
        return true
      } catch (err: any) {
        setError(err?.message || `Failed to terminate session ${pid}`)
        return false
      } finally {
        setIsTerminating(false)
      }
    },
    [connId, profiles, fetchLocks]
  )

  const exportJSON = useCallback(() => {
    if (!connId) return
    const url = api.getLocksExportUrl(connId, profiles)
    const a = document.createElement('a')
    a.href = url
    a.download = `locks-${connId}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [connId, profiles])

  return {
    data,
    loading,
    error,
    live,
    autoRefresh,
    setAutoRefresh,
    selectedPID,
    setSelectedPID,
    selectedNode: data?.all_nodes?.find(n => n.pid === selectedPID) || null,
    isTerminating,
    refresh: fetchLocks,
    terminateSession,
    exportJSON,
  }
}
