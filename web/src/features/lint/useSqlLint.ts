import { useState, useEffect, useRef, useCallback } from 'react'
import { api, type ConnectionConfig } from '../../lib/api'
import {
  fastClientCheck,
  type LintDiagnostic,
  type AnalysisSummary,
  type RuleSetting,
} from './lintRules'

interface UseSqlLintProps {
  sql: string
  connId?: string
  dialect?: string
  schema?: string
  knownTables?: string[]
  knownCols?: Record<string, string[]>
  ruleConfig?: Record<string, RuleSetting>
  profiles?: ConnectionConfig[]
  enabled?: boolean
  debounceMs?: number
}

interface UseSqlLintReturn {
  diagnostics: LintDiagnostic[]
  summary: AnalysisSummary
  isAnalyzing: boolean
  error: string | null
  revalidate: () => void
}

const emptySummary: AnalysisSummary = {
  errors: 0,
  warnings: 0,
  info: 0,
  total: 0,
}

export function useSqlLint({
  sql,
  connId = 'none',
  dialect = 'sqlite',
  schema,
  knownTables,
  knownCols,
  ruleConfig,
  profiles,
  enabled = true,
  debounceMs = 400,
}: UseSqlLintProps): UseSqlLintReturn {
  const [diagnostics, setDiagnostics] = useState<LintDiagnostic[]>([])
  const [summary, setSummary] = useState<AnalysisSummary>(emptySummary)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const computeSummary = useCallback((diags: LintDiagnostic[]): AnalysisSummary => {
    let errors = 0
    let warnings = 0
    let info = 0
    for (const d of diags) {
      if (d.severity === 'error') errors++
      else if (d.severity === 'warning') warnings++
      else if (d.severity === 'info') info++
    }
    return { errors, warnings, info, total: diags.length }
  }, [])

  const executeAnalysis = useCallback(async () => {
    const trimmed = sql.trim()
    if (!trimmed || !enabled) {
      setDiagnostics([])
      setSummary(emptySummary)
      setIsAnalyzing(false)
      setError(null)
      return
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsAnalyzing(true)
    setError(null)

    try {
      const res = await api.analyzeSql(
        connId,
        {
          sql,
          dialect,
          schema,
          known_tables: knownTables,
          known_cols: knownCols,
          rule_config: ruleConfig,
        },
        profiles
      )

      if (!controller.signal.aborted) {
        setDiagnostics(res.diagnostics ?? [])
        setSummary(res.summary ?? computeSummary(res.diagnostics ?? []))
        setIsAnalyzing(false)
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        // Fallback to client-side fast checks when server is offline or errored
        const localDiags = fastClientCheck(sql)
        setDiagnostics(localDiags)
        setSummary(computeSummary(localDiags))
        setError(err instanceof Error ? err.message : String(err))
        setIsAnalyzing(false)
      }
    }
  }, [
    sql,
    connId,
    dialect,
    schema,
    knownTables,
    knownCols,
    ruleConfig,
    profiles,
    enabled,
    computeSummary,
  ])

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    if (!sql.trim() || !enabled) {
      setDiagnostics([])
      setSummary(emptySummary)
      setIsAnalyzing(false)
      return
    }

    timeoutRef.current = setTimeout(() => {
      executeAnalysis()
    }, debounceMs)

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [sql, enabled, debounceMs, executeAnalysis])

  const revalidate = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    executeAnalysis()
  }, [executeAnalysis])

  return {
    diagnostics,
    summary,
    isAnalyzing,
    error,
    revalidate,
  }
}
