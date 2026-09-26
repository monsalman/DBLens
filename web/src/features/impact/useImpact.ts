import { useState, useCallback, useEffect } from 'react'
import { api, type ConnectionConfig } from '../../lib/api'
import type {
  ImpactGraph,
  RemediationPlan,
  RenamePlan,
} from './impactHelper'

export interface UseImpactOptions {
  connId: string
  schema?: string
  object: string
  objectType?: string
  column?: string
  depth?: number
  profiles?: ConnectionConfig[]
  autoLoad?: boolean
}

export function useImpact({
  connId,
  schema,
  object,
  objectType = 'table',
  column,
  depth = 5,
  profiles,
  autoLoad = true,
}: UseImpactOptions) {
  const [graph, setGraph] = useState<ImpactGraph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [plan, setPlan] = useState<RemediationPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)

  const [renamePlan, setRenamePlan] = useState<RenamePlan | null>(null)
  const [renameLoading, setRenameLoading] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  const fetchImpact = useCallback(async () => {
    if (!object || !connId) return null
    setLoading(true)
    setError(null)
    try {
      const data = await api.getImpact(
        connId,
        { schema, object, object_type: objectType, column, depth },
        profiles
      )
      setGraph(data)
      return data
    } catch (err: any) {
      const msg = err.message || 'Failed to inspect impact'
      setError(msg)
      return null
    } finally {
      setLoading(false)
    }
  }, [connId, schema, object, objectType, column, depth, profiles])

  const generatePlan = useCallback(
    async (cascade: boolean = false) => {
      if (!object || !connId) return null
      setPlanLoading(true)
      setPlanError(null)
      try {
        const res = await api.createImpactPlan(
          connId,
          {
            schema,
            object,
            object_type: objectType,
            column,
            depth,
            cascade,
            graph: graph || undefined,
          },
          profiles
        )
        setPlan(res)
        return res
      } catch (err: any) {
        const msg = err.message || 'Failed to generate safe drop plan'
        setPlanError(msg)
        return null
      } finally {
        setPlanLoading(false)
      }
    },
    [connId, schema, object, objectType, column, depth, graph, profiles]
  )

  const generateRenamePlan = useCallback(
    async (newName: string) => {
      if (!object || !connId || !newName) return null
      setRenameLoading(true)
      setRenameError(null)
      try {
        const res = await api.createImpactRename(
          connId,
          {
            schema,
            object,
            object_type: objectType,
            column,
            new_name: newName,
          },
          profiles
        )
        setRenamePlan(res)
        return res
      } catch (err: any) {
        const msg = err.message || 'Failed to generate rename plan'
        setRenameError(msg)
        return null
      } finally {
        setRenameLoading(false)
      }
    },
    [connId, schema, object, objectType, column, profiles]
  )

  const downloadMarkdownReport = useCallback(
    async (cascade: boolean = false) => {
      if (!object || !connId) return
      try {
        const mdText = await api.exportImpactMD(
          connId,
          {
            schema,
            object,
            object_type: objectType,
            column,
            cascade,
            depth,
            graph: graph || undefined,
          },
          profiles
        )
        const blob = new Blob([mdText], { type: 'text/markdown;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `impact-${object}${column ? `-${column}` : ''}.md`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } catch (err: any) {
        throw new Error(err.message || 'Failed to export markdown report')
      }
    },
    [connId, schema, object, objectType, column, depth, graph, profiles]
  )

  useEffect(() => {
    if (autoLoad && object && connId) {
      fetchImpact()
    }
  }, [autoLoad, object, connId, fetchImpact])

  return {
    graph,
    loading,
    error,
    fetchImpact,
    plan,
    planLoading,
    planError,
    generatePlan,
    renamePlan,
    renameLoading,
    renameError,
    generateRenamePlan,
    downloadMarkdownReport,
  }
}
