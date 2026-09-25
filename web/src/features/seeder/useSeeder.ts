import { useState, useCallback, useEffect } from 'react'
import { api } from '../../lib/api'
import { useAppStore } from '../../stores/appStore'
import type {
  SeedPlan,
  SeederOptions,
  SeedProgress,
  SeedResult,
  GeneratorConfig,
} from './seederHelper'

export function useSeeder(initialTable?: string) {
  const { activeConnectionId, connections } = useAppStore()
  const activeConn = connections.find((c) => c.id === activeConnectionId)

  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [defaultRowCount, setDefaultRowCount] = useState<number>(20)
  const [customRowCounts, setCustomRowCounts] = useState<Record<string, number>>({})
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 900000) + 100000)
  const [cascade, setCascade] = useState<boolean>(true)
  const [customGenerators, setCustomGenerators] = useState<Record<string, Record<string, GeneratorConfig>>>({})

  const [plan, setPlan] = useState<SeedPlan | null>(null)
  const [loadingPlan, setLoadingPlan] = useState<boolean>(false)
  const [running, setRunning] = useState<boolean>(false)
  const [exporting, setExporting] = useState<boolean>(false)
  const [progress, setProgress] = useState<SeedProgress | null>(null)
  const [result, setResult] = useState<SeedResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'dag' | 'columns' | 'run'>('dag')

  // Initialize selected tables
  useEffect(() => {
    if (initialTable) {
      setSelectedTables([initialTable])
    }
  }, [initialTable])

  const fetchPlan = useCallback(async () => {
    if (!activeConnectionId) return
    setLoadingPlan(true)
    setError(null)
    try {
      const opts: SeederOptions = {
        schema: 'main',
        tables: selectedTables.length > 0 ? selectedTables : undefined,
        rowCount: customRowCounts,
        defaultRowCount,
        seed,
        customGenerators,
        cascade,
      }
      const p = await api.getSeederPlan(activeConnectionId, opts, activeConn?.dsn, connections)
      setPlan(p)
      if (selectedTables.length === 0 && p.tables.length > 0) {
        setSelectedTables(p.tables.map((t) => t.table))
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate seeder DAG plan')
    } finally {
      setLoadingPlan(false)
    }
  }, [activeConnectionId, activeConn?.dsn, connections, selectedTables, customRowCounts, defaultRowCount, seed, customGenerators, cascade])

  const runSeeder = useCallback(async () => {
    if (!activeConnectionId || !plan) return
    setRunning(true)
    setError(null)
    setProgress({
      table: plan.dagOrder[0] || '',
      rowsInserted: 0,
      totalRows: plan.totalRows,
      percentage: 0,
      rowsPerSec: 0,
      status: 'seeding',
    })
    try {
      const res = await api.runSeeder(
        activeConnectionId,
        { plan },
        activeConn?.dsn,
        connections
      )
      setResult(res)
      setProgress({
        table: '',
        rowsInserted: Number(res.totalInserted),
        totalRows: plan.totalRows,
        percentage: 100,
        rowsPerSec: res.durationMs > 0 ? (Number(res.totalInserted) / (res.durationMs / 1000)) : 0,
        status: 'completed',
      })
    } catch (err: any) {
      setError(err.message || 'Data seeding execution failed')
      setProgress((prev) => prev ? { ...prev, status: 'failed', error: err.message } : null)
    } finally {
      setRunning(false)
    }
  }, [activeConnectionId, activeConn?.dsn, connections, plan])

  const exportFixture = useCallback(async (format: 'sql' | 'json') => {
    if (!activeConnectionId || !plan) return
    setExporting(true)
    setError(null)
    try {
      const text = await api.exportSeederFixture(
        activeConnectionId,
        { format, plan },
        activeConn?.dsn,
        connections
      )
      // Trigger download
      const mime = format === 'json' ? 'application/json' : 'application/sql'
      const blob = new Blob([text], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `seed_fixture_${plan.seed}.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err.message || `Failed to export ${format.toUpperCase()} fixture`)
    } finally {
      setExporting(false)
    }
  }, [activeConnectionId, activeConn?.dsn, connections, plan])

  const updateColumnGenerator = useCallback((table: string, column: string, cfg: GeneratorConfig) => {
    setCustomGenerators((prev) => {
      const t = prev[table] || {}
      return {
        ...prev,
        [table]: {
          ...t,
          [column]: cfg,
        },
      }
    })
    // Also update current plan preview in-place
    setPlan((prev) => {
      if (!prev) return prev
      const newTables = prev.tables.map((tbl) => {
        if (tbl.table !== table) return tbl
        const newCols = tbl.columns.map((c) => {
          if (c.name !== column) return c
          return {
            ...c,
            generator: cfg.type,
            config: cfg,
          }
        })
        return {
          ...tbl,
          columns: newCols,
        }
      })
      return {
        ...prev,
        tables: newTables,
      }
    })
  }, [])

  return {
    selectedTables,
    setSelectedTables,
    defaultRowCount,
    setDefaultRowCount,
    customRowCounts,
    setCustomRowCounts,
    seed,
    setSeed,
    cascade,
    setCascade,
    customGenerators,
    updateColumnGenerator,
    plan,
    loadingPlan,
    running,
    exporting,
    progress,
    result,
    error,
    activeTab,
    setActiveTab,
    fetchPlan,
    runSeeder,
    exportFixture,
  }
}
