import { useState, useCallback, useEffect } from 'react'
import { api, type ConnectionConfig, type ExplainResult } from '../../lib/api'
import {
  type PlanDiffResult,
  type IndexRecommendation,
  formatPlanDiffMarkdown,
} from './planDiffHelper'

export interface UsePlanDiffOptions {
  connId: string
  initialBaselineSql?: string
  initialBaselinePlan?: ExplainResult | null
  initialCandidateSql?: string
  initialCandidatePlan?: ExplainResult | null
  schema?: string
  profiles?: ConnectionConfig[]
}

export function usePlanDiff({
  connId,
  initialBaselineSql = '',
  initialBaselinePlan = null,
  initialCandidateSql = '',
  initialCandidatePlan = null,
  schema = '',
  profiles = [],
}: UsePlanDiffOptions) {
  const [baselineSql, setBaselineSql] = useState<string>(initialBaselineSql)
  const [candidateSql, setCandidateSql] = useState<string>(initialCandidateSql)
  const [baselinePlan, setBaselinePlan] = useState<ExplainResult | null>(initialBaselinePlan)
  const [candidatePlan, setCandidatePlan] = useState<ExplainResult | null>(initialCandidatePlan)

  const [diffResult, setDiffResult] = useState<PlanDiffResult | null>(null)
  const [isDiffing, setIsDiffing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const [appliedIndexes, setAppliedIndexes] = useState<Set<string>>(new Set())
  const [applyingIndex, setApplyingIndex] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)

  // Sync if initial props change
  useEffect(() => {
    if (initialBaselineSql && !baselineSql) setBaselineSql(initialBaselineSql)
    if (initialBaselinePlan && !baselinePlan) setBaselinePlan(initialBaselinePlan)
    if (initialCandidateSql && !candidateSql) setCandidateSql(initialCandidateSql)
    if (initialCandidatePlan && !candidatePlan) setCandidatePlan(initialCandidatePlan)
  }, [initialBaselineSql, initialBaselinePlan, initialCandidateSql, initialCandidatePlan])

  const runDiff = useCallback(
    async (
      overrideBaselineSql?: string,
      overrideCandidateSql?: string
    ): Promise<PlanDiffResult | null> => {
      const bSql = overrideBaselineSql !== undefined ? overrideBaselineSql : baselineSql
      const cSql = overrideCandidateSql !== undefined ? overrideCandidateSql : candidateSql

      if (!bSql.trim() && !baselinePlan && !cSql.trim() && !candidatePlan) {
        setError('Please provide at least baseline or candidate SQL/plan to diff.')
        return null
      }

      setIsDiffing(true)
      setError(null)

      try {
        const res = await api.comparePlanDiff(
          connId,
          {
            baselineSql: bSql.trim() || undefined,
            candidateSql: cSql.trim() || undefined,
            baselinePlan: baselinePlan || undefined,
            candidatePlan: candidatePlan || undefined,
            schema: schema || undefined,
          },
          profiles
        )

        setDiffResult(res)
        if (res.baselinePlan) setBaselinePlan(res.baselinePlan)
        if (res.candidatePlan) setCandidatePlan(res.candidatePlan)
        return res
      } catch (err: any) {
        const msg = err?.message || 'Failed to compare execution plans'
        setError(msg)
        return null
      } finally {
        setIsDiffing(false)
      }
    },
    [connId, baselineSql, candidateSql, baselinePlan, candidatePlan, schema, profiles]
  )

  const applyIndex = useCallback(
    async (rec: IndexRecommendation): Promise<boolean> => {
      setApplyingIndex(rec.ddl)
      setApplyError(null)

      try {
        await api.applyPlanIndex(connId, rec.ddl, profiles)
        setAppliedIndexes((prev) => new Set([...prev, rec.ddl]))
        return true
      } catch (err: any) {
        const msg = err?.message || 'Failed to apply index'
        setApplyError(msg)
        return false
      } finally {
        setApplyingIndex(null)
      }
    },
    [connId, profiles]
  )

  const exportMarkdown = useCallback(async () => {
    if (!diffResult) return

    try {
      let md: string
      try {
        md = await api.exportPlanDiffMd(connId, diffResult, profiles)
      } catch {
        // Fallback to client-side markdown generator
        md = formatPlanDiffMarkdown(diffResult)
      }

      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', 'plan-diff-report.md')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      console.error('Failed to export markdown:', err)
    }
  }, [connId, diffResult, profiles])

  return {
    baselineSql,
    setBaselineSql,
    candidateSql,
    setCandidateSql,
    baselinePlan,
    candidatePlan,
    diffResult,
    isDiffing,
    error,
    runDiff,
    appliedIndexes,
    applyingIndex,
    applyError,
    applyIndex,
    exportMarkdown,
  }
}
