import { useState, useCallback, useEffect } from 'react'
import { api, type ConnectionConfig } from '../../lib/api'
import type {
  ProfileReport,
  ColumnProfile,
  CompareResult,
} from './profileHelper'

export interface UseProfileOptions {
  connId: string
  dsn: string
  table: string
  schema?: string
  profiles?: ConnectionConfig[]
  autoLoad?: boolean
}

export function useProfile({
  connId,
  dsn,
  table,
  schema,
  profiles,
  autoLoad = true,
}: UseProfileOptions) {
  const [report, setReport] = useState<ProfileReport | null>(null)
  const [selectedColumn, setSelectedColumn] = useState<ColumnProfile | null>(null)
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [compareLoading, setCompareLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sampleRows, setSampleRows] = useState<number>(10000)

  const fetchProfile = useCallback(
    async (samples?: number) => {
      if (!table) return
      setLoading(true)
      setError(null)
      try {
        const effSamples = samples !== undefined ? samples : sampleRows
        const rep = await api.profileTable(
          connId,
          dsn,
          {
            table,
            schema,
            sampleRows: effSamples > 0 ? effSamples : undefined,
          },
          profiles
        )
        setReport(rep)
        if (rep.columns.length > 0) {
          setSelectedColumn(prev => {
            if (prev) {
              const match = rep.columns.find(c => c.columnName === prev.columnName)
              if (match) return match
            }
            return rep.columns[0]
          })
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to profile dataset')
      } finally {
        setLoading(false)
      }
    },
    [connId, dsn, table, schema, profiles, sampleRows]
  )

  const runCompare = useCallback(
    async (targetTable: string, targetSchema?: string) => {
      if (!table || !targetTable) return
      setCompareLoading(true)
      try {
        const diff = await api.profileCompare(
          connId,
          dsn,
          {
            baseTable: table,
            baseSchema: schema,
            targetTable,
            targetSchema,
            baseReport: report || undefined,
          },
          profiles
        )
        setCompareResult(diff)
      } catch (err: any) {
        setError(err?.message || 'Failed to compare profiles')
      } finally {
        setCompareLoading(false)
      }
    },
    [connId, dsn, table, schema, report, profiles]
  )

  const exportMarkdown = useCallback(async () => {
    if (!table) return ''
    try {
      return await api.exportProfileMarkdown(
        connId,
        dsn,
        table,
        schema,
        report || undefined,
        profiles
      )
    } catch (err: any) {
      setError(err?.message || 'Failed to export markdown')
      return ''
    }
  }, [connId, dsn, table, schema, report, profiles])

  useEffect(() => {
    if (autoLoad && table) {
      fetchProfile()
    }
  }, [autoLoad, table, fetchProfile])

  return {
    report,
    selectedColumn,
    setSelectedColumn,
    compareResult,
    setCompareResult,
    loading,
    compareLoading,
    error,
    sampleRows,
    setSampleRows,
    fetchProfile,
    runCompare,
    exportMarkdown,
  }
}
