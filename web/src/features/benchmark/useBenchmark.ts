import { useState, useEffect, useRef, useCallback } from 'react'
import { api, type ConnectionConfig } from '../../lib/api'
import type {
  BenchmarkConfig,
  BenchmarkProgress,
  BenchmarkResult,
} from './benchmarkHelper'

interface UseBenchmarkOptions {
  connId: string
  profiles?: ConnectionConfig[]
}

const STORAGE_KEY_PREFIX = 'dblens_benchmark_history_'

export function useBenchmark({ connId, profiles }: UseBenchmarkOptions) {
  const [isRunning, setIsRunning] = useState<boolean>(false)
  const [activeProgress, setActiveProgress] = useState<BenchmarkProgress | null>(null)
  const [result, setResult] = useState<BenchmarkResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<BenchmarkResult[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}${connId}`)
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  const esRef = useRef<EventSource | null>(null)
  const activeIdRef = useRef<string | null>(null)

  // Persist history changes
  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${connId}`, JSON.stringify(history.slice(0, 30)))
    } catch {
      // Ignore quota errors
    }
  }, [history, connId])

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
    }
  }, [])

  const startBenchmark = useCallback(
    async (cfg: BenchmarkConfig) => {
      if (isRunning) return
      setError(null)
      setIsRunning(true)
      setActiveProgress(null)

      try {
        const resp = await api.runBenchmark(
          connId,
          {
            sql: cfg.sql,
            concurrency: cfg.concurrency,
            durationSec: cfg.durationSec,
            iterations: cfg.iterations,
            rollback: cfg.rollback,
            assertP99Lt: cfg.assertP99Lt,
            label: cfg.label,
          },
          profiles
        )

        const benchId = resp.id
        activeIdRef.current = benchId
        setActiveProgress(resp.progress)

        // Connect SSE stream
        if (esRef.current) {
          esRef.current.close()
          esRef.current = null
        }

        const streamUrl = api.getBenchmarkStreamUrl(connId, benchId, profiles)
        const es = new EventSource(streamUrl)
        esRef.current = es

        es.onmessage = (event) => {
          try {
            const prog: BenchmarkProgress = JSON.parse(event.data)
            setActiveProgress(prog)

            if (prog.result) {
              setResult(prog.result)
            }

            if (prog.status === 'completed' || prog.status === 'cancelled' || prog.status === 'failed') {
              setIsRunning(false)
              if (prog.result) {
                setHistory((prev) => [prog.result!, ...prev.filter((r) => r.id !== prog.result!.id)])
              }
              if (prog.status === 'failed') {
                setError(prog.error || 'Benchmark failed')
              }
              es.close()
              esRef.current = null
              activeIdRef.current = null
            }
          } catch {
            // Ignore parse errors
          }
        }

        es.onerror = () => {
          // Fallback: fetch directly once
          if (activeIdRef.current) {
            api
              .getBenchmark(connId, activeIdRef.current, profiles)
              .then((res) => {
                if (res && res.status !== 'running') {
                  setResult(res)
                  setHistory((prev) => [res, ...prev.filter((r) => r.id !== res.id)])
                  setIsRunning(false)
                }
              })
              .catch(() => {})
          }
        }
      } catch (err: any) {
        setIsRunning(false)
        setError(err.message || 'Failed to start benchmark')
      }
    },
    [connId, profiles, isRunning]
  )

  const cancelBenchmark = useCallback(async () => {
    const id = activeIdRef.current
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    if (id) {
      try {
        await api.cancelBenchmark(connId, id, profiles)
      } catch {
        // Ignore cancel errors
      }
    }
    setIsRunning(false)
    setActiveProgress((prev) => (prev ? { ...prev, status: 'cancelled' } : null))
  }, [connId, profiles])

  const clearResult = useCallback(() => {
    setResult(null)
    setActiveProgress(null)
    setError(null)
  }, [])

  const deleteFromHistory = useCallback((id: string) => {
    setHistory((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    try {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${connId}`)
    } catch {}
  }, [connId])

  return {
    isRunning,
    activeProgress,
    result,
    error,
    history,
    startBenchmark,
    cancelBenchmark,
    clearResult,
    deleteFromHistory,
    clearHistory,
    setResult,
  }
}
