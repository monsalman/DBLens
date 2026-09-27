import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import type {
  SchemaSnapshot,
  SnapshotDiff,
  RollbackPlan,
  CaptureSnapshotRequest,
  DiffSnapshotsRequest,
  RollbackPlanRequest,
} from './snapshotHelper'

export function useSnapshots(connId: string | null) {
  const [snapshots, setSnapshots] = useState<SchemaSnapshot[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [isCapturing, setIsCapturing] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)

  const [baseId, setBaseId] = useState<string | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)

  const [diff, setDiff] = useState<SnapshotDiff | null>(null)
  const [isDiffing, setIsDiffing] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  const [rollbackPlan, setRollbackPlan] = useState<RollbackPlan | null>(null)
  const [isPlanLoading, setIsPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)

  const fetchSnapshots = useCallback(async () => {
    if (!connId) {
      setSnapshots([])
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const data = await api.listSnapshots(connId)
      setSnapshots(data || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load schema snapshots')
    } finally {
      setIsLoading(false)
    }
  }, [connId])

  useEffect(() => {
    fetchSnapshots()
    setDiff(null)
    setRollbackPlan(null)
    setBaseId(null)
    setTargetId(null)
  }, [fetchSnapshots])

  const captureSnapshot = useCallback(
    async (req: CaptureSnapshotRequest): Promise<SchemaSnapshot | null> => {
      if (!connId) return null
      setIsCapturing(true)
      setCaptureError(null)
      try {
        const snap = await api.captureSnapshot(connId, req)
        setSnapshots((prev) => [snap, ...prev])
        return snap
      } catch (err: any) {
        setCaptureError(err?.message || 'Failed to capture snapshot')
        return null
      } finally {
        setIsCapturing(false)
      }
    },
    [connId]
  )

  const deleteSnapshot = useCallback(
    async (id: string): Promise<boolean> => {
      if (!connId) return false
      try {
        await api.deleteSnapshot(connId, id)
        setSnapshots((prev) => prev.filter((s) => s.id !== id))
        if (baseId === id) setBaseId(null)
        if (targetId === id) setTargetId(null)
        return true
      } catch (err: any) {
        setError(err?.message || 'Failed to delete snapshot')
        return false
      }
    },
    [connId, baseId, targetId]
  )

  const compareSnapshots = useCallback(
    async (
      base: string,
      target?: string,
      live?: boolean,
      schema?: string
    ): Promise<SnapshotDiff | null> => {
      if (!connId || !base) return null
      setIsDiffing(true)
      setDiffError(null)
      try {
        const req: DiffSnapshotsRequest = {
          baseId: base,
          targetId: target,
          live: live ?? (!target || target === 'live'),
          schema,
        }
        const res = await api.diffSnapshots(connId, req)
        setDiff(res)
        return res
      } catch (err: any) {
        setDiffError(err?.message || 'Failed to compare snapshots')
        return null
      } finally {
        setIsDiffing(false)
      }
    },
    [connId]
  )

  const generateRollback = useCallback(
    async (
      base?: string,
      target?: string,
      diffObj?: SnapshotDiff
    ): Promise<RollbackPlan | null> => {
      if (!connId) return null
      setIsPlanLoading(true)
      setPlanError(null)
      try {
        const req: RollbackPlanRequest = {
          baseId: base,
          targetId: target,
          diff: diffObj,
        }
        const plan = await api.generateRollbackPlan(connId, req)
        setRollbackPlan(plan)
        return plan
      } catch (err: any) {
        setPlanError(err?.message || 'Failed to generate rollback plan')
        return null
      } finally {
        setIsPlanLoading(false)
      }
    },
    [connId]
  )

  const clearDiff = useCallback(() => {
    setDiff(null)
    setDiffError(null)
  }, [])

  return {
    snapshots,
    isLoading,
    error,
    isCapturing,
    captureError,
    baseId,
    targetId,
    setBaseId,
    setTargetId,
    diff,
    isDiffing,
    diffError,
    rollbackPlan,
    isPlanLoading,
    planError,
    fetchSnapshots,
    captureSnapshot,
    deleteSnapshot,
    compareSnapshots,
    generateRollback,
    clearDiff,
  }
}
