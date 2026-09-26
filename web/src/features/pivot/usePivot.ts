import { useState, useMemo, useCallback } from 'react'
import { api } from '../../lib/api'
import {
  buildPivot,
  exportPivotToCSV,
  exportPivotToMarkdown,
  inferPivotDefaults,
  type PivotConfig,
  type PivotMatrix,
  type PushdownRequest,
} from './pivotHelper'

export interface UsePivotOptions {
  columns: string[]
  rows: (Record<string, any> | any[])[]
  initialConfig?: Partial<PivotConfig>
  connId?: string
  query?: string
  dialect?: string
}

export function usePivot({
  columns,
  rows: rawRows,
  initialConfig,
  connId,
  query,
  dialect,
}: UsePivotOptions) {
  // Convert rows if they are 2D arrays (QueryResult.rows format)
  const rows = useMemo(() => {
    if (!rawRows || rawRows.length === 0) return []
    if (Array.isArray(rawRows[0])) {
      return (rawRows as any[][]).map((rowArr) => {
        const obj: Record<string, any> = {}
        columns.forEach((col, idx) => {
          obj[col] = rowArr[idx]
        })
        return obj
      })
    }
    return rawRows as Record<string, any>[]
  }, [rawRows, columns])

  // Pivot configuration state
  const [config, setConfig] = useState<PivotConfig>(() => {
    const defaults = inferPivotDefaults(columns, rows)
    return {
      ...defaults,
      ...initialConfig,
    }
  })

  // Heat shading toggle
  const [heatShading, setHeatShading] = useState<boolean>(false)

  // Pushdown SQL states
  const [pushdownSQL, setPushdownSQL] = useState<string | null>(null)
  const [isGeneratingPushdown, setIsGeneratingPushdown] = useState<boolean>(false)
  const [pushdownError, setPushdownError] = useState<string | null>(null)
  const [pushdownResult, setPushdownResult] = useState<any | null>(null)
  const [isRunningPushdown, setIsRunningPushdown] = useState<boolean>(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Computed pivot matrix
  const matrix = useMemo<PivotMatrix>(() => {
    return buildPivot(rows, config)
  }, [rows, config])

  // Min and max calculation across numeric cells for heat shading
  const { minVal, maxVal } = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const row of matrix.cells) {
      for (const cell of row) {
        if (typeof cell === 'number' && !isNaN(cell)) {
          if (cell < min) min = cell
          if (cell > max) max = cell
        }
      }
    }
    return {
      minVal: min === Infinity ? 0 : min,
      maxVal: max === -Infinity ? 0 : max,
    }
  }, [matrix])

  const updateConfig = useCallback((partial: Partial<PivotConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }))
  }, [])

  const toggleHeatShading = useCallback(() => {
    setHeatShading((prev) => !prev)
  }, [])

  // Pushdown SQL generation
  const generatePushdown = useCallback(
    async (overrideConnId?: string, overrideQuery?: string, overrideDialect?: string) => {
      const targetConnId = overrideConnId || connId
      const targetQuery = overrideQuery || query
      const targetDialect = overrideDialect || dialect || 'postgres'

      if (!targetQuery) {
        setPushdownError('No SQL query available to push down')
        return null
      }
      if (!config.colField) {
        setPushdownError('Column field is required for pivot pushdown')
        return null
      }

      setIsGeneratingPushdown(true)
      setPushdownError(null)

      try {
        const payload: PushdownRequest = {
          query: targetQuery,
          dialect: targetDialect,
          rowFields: config.rowFields,
          colField: config.colField,
          valueField: config.valueField,
          aggregator: config.aggregator,
          subtotals: config.subtotals,
          colValues: matrix.colHeaders,
        }

        const res = await api.pivotPushdown(targetConnId, payload)
        const resultSQL = res.sql
        setPushdownSQL(resultSQL)
        return resultSQL
      } catch (err: any) {
        const msg = err.message || 'Failed to generate pushdown SQL'
        setPushdownError(msg)
        return null
      } finally {
        setIsGeneratingPushdown(false)
      }
    },
    [connId, query, dialect, config, matrix.colHeaders]
  )

  // Pushdown query execution
  const runPushdown = useCallback(
    async (overrideConnId?: string, overrideQuery?: string, overrideDialect?: string) => {
      const targetConnId = overrideConnId || connId
      const targetQuery = overrideQuery || query
      const targetDialect = overrideDialect || dialect || 'postgres'

      if (!targetConnId) {
        setServerError('Connection ID is required to run pushdown query on server')
        return null
      }
      if (!targetQuery) {
        setServerError('No query provided')
        return null
      }

      setIsRunningPushdown(true)
      setServerError(null)

      try {
        const payload: PushdownRequest = {
          query: targetQuery,
          dialect: targetDialect,
          rowFields: config.rowFields,
          colField: config.colField,
          valueField: config.valueField,
          aggregator: config.aggregator,
          subtotals: config.subtotals,
          colValues: matrix.colHeaders,
        }

        const runData = await api.pivotRun(targetConnId, payload)
        setPushdownResult(runData)
        if (runData.sql) {
          setPushdownSQL(runData.sql)
        }
        return runData
      } catch (err: any) {
        const msg = err.message || 'Failed to run pushdown query'
        setServerError(msg)
        return null
      } finally {
        setIsRunningPushdown(false)
      }
    },
    [connId, query, dialect, config, matrix.colHeaders]
  )

  // File downloads
  const exportCSV = useCallback(
    (filename = 'pivot.csv') => {
      const csvStr = exportPivotToCSV(matrix, config.rowFields)
      const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    },
    [matrix, config.rowFields]
  )

  const exportMarkdown = useCallback(
    (filename = 'pivot.md') => {
      const mdStr = exportPivotToMarkdown(matrix, config.rowFields)
      const blob = new Blob([mdStr], { type: 'text/markdown;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    },
    [matrix, config.rowFields]
  )

  const copyMarkdown = useCallback(async () => {
    const mdStr = exportPivotToMarkdown(matrix, config.rowFields)
    if (navigator?.clipboard) {
      await navigator.clipboard.writeText(mdStr)
      return true
    }
    return false
  }, [matrix, config.rowFields])

  return {
    config,
    updateConfig,
    matrix,
    rows,
    heatShading,
    toggleHeatShading,
    minVal,
    maxVal,
    pushdownSQL,
    isGeneratingPushdown,
    pushdownError,
    pushdownResult,
    isRunningPushdown,
    serverError,
    generatePushdown,
    runPushdown,
    exportCSV,
    exportMarkdown,
    copyMarkdown,
  }
}
