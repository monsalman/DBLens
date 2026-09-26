import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type {
  MaterializeRequest,
  MaterializePreview,
  MaterializeResult,
  ScratchTable,
} from './materializeHelper'

export function useMaterialize(connId?: string, autoFetchScratch = true) {
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [scratchLoading, setScratchLoading] = useState(false)
  const [previewData, setPreviewData] = useState<MaterializePreview | null>(null)
  const [scratchTables, setScratchTables] = useState<ScratchTable[]>([])
  const [error, setError] = useState<string | null>(null)

  const fetchScratch = useCallback(async () => {
    if (!connId) return []
    setScratchLoading(true)
    setError(null)
    try {
      const items = await api.getScratchTables(connId)
      setScratchTables(items)
      return items
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      return []
    } finally {
      setScratchLoading(false)
    }
  }, [connId])

  useEffect(() => {
    if (autoFetchScratch && connId) {
      fetchScratch()
    }
  }, [autoFetchScratch, connId, fetchScratch])

  const preview = useCallback(
    async (req: MaterializeRequest): Promise<MaterializePreview | null> => {
      const targetConn = req.targetConnId || connId || ''
      if (!targetConn) return null
      setPreviewLoading(true)
      setError(null)
      try {
        const res = await api.materializePreview(targetConn, req)
        setPreviewData(res)
        return res
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        throw err
      } finally {
        setPreviewLoading(false)
      }
    },
    [connId]
  )

  const execute = useCallback(
    async (req: MaterializeRequest): Promise<MaterializeResult> => {
      const targetConn = req.targetConnId || connId || ''
      if (!targetConn) throw new Error('Target connection ID is required')
      setLoading(true)
      setError(null)
      try {
        const res = await api.materializeExecute(targetConn, req)
        if (req.mode === 'temp' || req.ttlMinutes) {
          await fetchScratch()
        }
        return res
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [connId, fetchScratch]
  )

  const deleteScratch = useCallback(
    async (schema: string, table: string): Promise<boolean> => {
      if (!connId) return false
      setLoading(true)
      try {
        await api.deleteScratchTable(connId, schema, table)
        setScratchTables((prev) =>
          prev.filter((t) => !(t.table === table && (schema === '' || !t.schema || t.schema === schema)))
        )
        return true
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [connId]
  )

  const promoteScratch = useCallback(
    async (schema: string, table: string): Promise<string> => {
      if (!connId) return ''
      setLoading(true)
      try {
        const res = await api.promoteScratchTable(connId, schema, table)
        setScratchTables((prev) =>
          prev.filter((t) => !(t.table === table && (schema === '' || !t.schema || t.schema === schema)))
        )
        return res.migrationSql
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [connId]
  )

  const expireScratch = useCallback(async (): Promise<number> => {
    if (!connId) return 0
    setLoading(true)
    try {
      const res = await api.expireScratchTables(connId)
      await fetchScratch()
      return res.dropped
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    } finally {
      setLoading(false)
    }
  }, [connId, fetchScratch])

  return {
    loading,
    previewLoading,
    scratchLoading,
    previewData,
    scratchTables,
    error,
    setError,
    setPreviewData,
    preview,
    execute,
    fetchScratch,
    deleteScratch,
    promoteScratch,
    expireScratch,
  }
}
