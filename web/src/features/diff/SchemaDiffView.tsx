import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  GitCompare,
  ArrowLeftRight,
  RefreshCw,
  Copy,
  Check,
  Play,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Table2,
  Code2,
  Search,
  X,
} from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  api,
  type ConnectionConfig,
  type SchemaDiffResult,
  type DiffStatus,
} from '../../lib/api'
import { useAppStore } from '../../stores/appStore'

interface SchemaDiffViewProps {
  connections: ConnectionConfig[]
  activeConnId: string | null
  defaultSchema?: string
  defaultTable?: string | null
}

type FilterType = 'ALL' | 'MODIFIED' | 'ADDED' | 'REMOVED' | 'IDENTICAL'

export const SchemaDiffView: React.FC<SchemaDiffViewProps> = ({
  connections,
  activeConnId,
  defaultSchema = 'public',
  defaultTable = null,
}) => {
  const diffPreload = useAppStore((s) => s.diffPreload)
  const setDiffPreload = useAppStore((s) => s.setDiffPreload)
  const openDataDiff = useAppStore((s) => s.openDataDiff)

  // Source selection
  const [sourceConnId, setSourceConnId] = useState<string>(() => {
    return diffPreload?.sourceConnId || activeConnId || (connections[0]?.id ?? '')
  })
  const [sourceSchema, setSourceSchema] = useState<string>(() => {
    return diffPreload?.sourceSchema || defaultSchema
  })
  const [sourceTable, setSourceTable] = useState<string>(() => {
    return diffPreload?.sourceTable || defaultTable || ''
  })

  // Target selection
  const [targetConnId, setTargetConnId] = useState<string>(() => {
    // Default to a different connection if available, otherwise same connection
    if (connections.length > 1) {
      const other = connections.find((c) => c.id !== (diffPreload?.sourceConnId || activeConnId))
      if (other) return other.id
    }
    return diffPreload?.sourceConnId || activeConnId || (connections[0]?.id ?? '')
  })
  const [targetSchema, setTargetSchema] = useState<string>(() => {
    return diffPreload?.sourceSchema || defaultSchema
  })
  const [targetTable, setTargetTable] = useState<string>(() => {
    return diffPreload?.sourceTable || defaultTable || ''
  })

  // Dropdown options
  const [sourceSchemas, setSourceSchemas] = useState<string[]>([])
  const [sourceTables, setSourceTables] = useState<string[]>([])
  const [targetSchemas, setTargetSchemas] = useState<string[]>([])
  const [targetTables, setTargetTables] = useState<string[]>([])

  // Diff Execution State
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffResult, setDiffResult] = useState<SchemaDiffResult | null>(null)

  // UI Filters & Expansion
  const [activeFilter, setActiveFilter] = useState<FilterType>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({})

  // Apply Sync State
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [copiedSql, setCopiedSql] = useState(false)

  // Detect Dark Mode
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : true
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => observer.disconnect()
  }, [])

  // Clear preload once consumed
  useEffect(() => {
    if (diffPreload) {
      if (diffPreload.sourceConnId) setSourceConnId(diffPreload.sourceConnId)
      if (diffPreload.sourceSchema) setSourceSchema(diffPreload.sourceSchema)
      if (diffPreload.sourceTable) setSourceTable(diffPreload.sourceTable)
      setDiffPreload(null)
    }
  }, [diffPreload, setDiffPreload])

  // Fetch Source Schemas
  useEffect(() => {
    if (!sourceConnId) return
    let isMounted = true
    api.getSchemas(sourceConnId, connections)
      .then((schemas) => {
        if (!isMounted) return
        const list = schemas.map((s) => (typeof s === 'string' ? s : (s as any).name || 'public'))
        setSourceSchemas(list)
        setSourceSchema((prev) => (list.length > 0 && !list.includes(prev) ? list[0] : prev))
      })
      .catch(() => {
        if (isMounted) setSourceSchemas(['public'])
      })
    return () => {
      isMounted = false
    }
  }, [sourceConnId, connections])

  // Fetch Source Tables
  useEffect(() => {
    if (!sourceConnId || !sourceSchema) return
    let isMounted = true
    api.getTables(sourceConnId, sourceSchema, connections)
      .then((tables) => {
        if (isMounted) setSourceTables(tables.map((t) => t.name))
      })
      .catch(() => {
        if (isMounted) setSourceTables([])
      })
    return () => {
      isMounted = false
    }
  }, [sourceConnId, sourceSchema, connections])

  // Fetch Target Schemas
  useEffect(() => {
    if (!targetConnId) return
    let isMounted = true
    api.getSchemas(targetConnId, connections)
      .then((schemas) => {
        if (!isMounted) return
        const list = schemas.map((s) => (typeof s === 'string' ? s : (s as any).name || 'public'))
        setTargetSchemas(list)
        setTargetSchema((prev) => (list.length > 0 && !list.includes(prev) ? list[0] : prev))
      })
      .catch(() => {
        if (isMounted) setTargetSchemas(['public'])
      })
    return () => {
      isMounted = false
    }
  }, [targetConnId, connections])

  // Fetch Target Tables
  useEffect(() => {
    if (!targetConnId || !targetSchema) return
    let isMounted = true
    api.getTables(targetConnId, targetSchema, connections)
      .then((tables) => {
        if (isMounted) setTargetTables(tables.map((t) => t.name))
      })
      .catch(() => {
        if (isMounted) setTargetTables([])
      })
    return () => {
      isMounted = false
    }
  }, [targetConnId, targetSchema, connections])

  // Detect Target Connection Read-Only Status
  const targetConnObj = useMemo(
    () => connections.find((c) => c.id === targetConnId),
    [connections, targetConnId]
  )
  const sourceConnObj = useMemo(
    () => connections.find((c) => c.id === sourceConnId),
    [connections, sourceConnId]
  )
  const isTargetReadOnly = !!targetConnObj?.readOnly

  // Run Schema Diff
  const handleCompare = useCallback(async () => {
    if (!sourceConnId) return
    setIsLoading(true)
    setError(null)
    setApplyResult(null)

    try {
      const res = await api.compareSchema(
        sourceConnId,
        {
          source: {
            connId: sourceConnId,
            schema: sourceSchema,
            table: sourceTable || undefined,
          },
          target: {
            connId: targetConnId,
            schema: targetSchema,
            table: targetTable || (sourceTable ? sourceTable : undefined),
          },
        },
        connections
      )
      setDiffResult(res)

      // Auto-expand modified, added, and removed tables
      const newExpanded: Record<string, boolean> = {}
      res.tables.forEach((t) => {
        if (t.status !== 'IDENTICAL') {
          newExpanded[t.name] = true
        }
      })
      setExpandedTables(newExpanded)
    } catch (err: any) {
      setError(err?.message || 'Failed to compare database schemas')
    } finally {
      setIsLoading(false)
    }
  }, [
    sourceConnId,
    sourceSchema,
    sourceTable,
    targetConnId,
    targetSchema,
    targetTable,
    connections,
  ])

  // Swap Source & Target
  const handleSwap = () => {
    const prevSrcConn = sourceConnId
    const prevSrcSchema = sourceSchema
    const prevSrcTable = sourceTable

    setSourceConnId(targetConnId)
    setSourceSchema(targetSchema)
    setSourceTable(targetTable)

    setTargetConnId(prevSrcConn)
    setTargetSchema(prevSrcSchema)
    setTargetTable(prevSrcTable)
  }

  // Copy Migration SQL
  const handleCopySql = () => {
    if (!diffResult?.sql) return
    navigator.clipboard.writeText(diffResult.sql)
    setCopiedSql(true)
    setTimeout(() => setCopiedSql(false), 2000)
  }

  // Apply Sync Migration
  const handleApplyMigration = async () => {
    if (!diffResult?.migrationSql || diffResult.migrationSql.length === 0 || isTargetReadOnly) return
    setIsApplying(true)
    setApplyResult(null)

    try {
      const tgtDsn = api._getDSN(targetConnId, connections)
      const res = await api.applySchemaDiff(
        targetConnId,
        {
          statements: diffResult.migrationSql,
          targetDsn: tgtDsn,
          readOnly: isTargetReadOnly,
        },
        connections,
        isTargetReadOnly
      )
      setApplyResult({
        success: true,
        message: res.message || `Successfully executed ${res.statementsExecuted} migration statements`,
      })
      setShowConfirmModal(false)
      // Re-run comparison to verify changes applied
      setTimeout(() => {
        handleCompare()
      }, 500)
    } catch (err: any) {
      setApplyResult({
        success: false,
        message: err?.message || 'Failed to apply migration statements',
      })
    } finally {
      setIsApplying(false)
    }
  }

  // Toggle Table Expansion
  const toggleExpand = (tableName: string) => {
    setExpandedTables((prev) => ({
      ...prev,
      [tableName]: !prev[tableName],
    }))
  }

  // Filtered Tables
  const filteredTables = useMemo(() => {
    if (!diffResult) return []
    return diffResult.tables.filter((table) => {
      if (activeFilter !== 'ALL' && table.status !== activeFilter) {
        return false
      }
      if (
        searchQuery &&
        !table.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
      ) {
        return false
      }
      return true
    })
  }, [diffResult, activeFilter, searchQuery])

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg)] text-[var(--fg)] overflow-hidden">
      {/* Top Configuration & Picker Toolbar */}
      <div className="p-3 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          {/* Source Selector Box */}
          <div className="flex items-center gap-1.5 p-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)]">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              SRC
            </span>
            {/* Connection */}
            <select
              value={sourceConnId}
              onChange={(e) => setSourceConnId(e.target.value)}
              className="bg-transparent border-none text-[var(--fg)] text-xs focus:outline-hidden cursor-pointer"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id} className="bg-[var(--bg)] text-[var(--fg)]">
                  {c.label || c.name || c.id}
                </option>
              ))}
            </select>
            <span className="text-[var(--muted)]">/</span>
            {/* Schema */}
            <select
              value={sourceSchema}
              onChange={(e) => setSourceSchema(e.target.value)}
              className="bg-transparent border-none text-[var(--fg)] text-xs focus:outline-hidden cursor-pointer"
            >
              {sourceSchemas.map((s) => (
                <option key={s} value={s} className="bg-[var(--bg)] text-[var(--fg)]">
                  {s}
                </option>
              ))}
            </select>
            <span className="text-[var(--muted)]">/</span>
            {/* Table */}
            <select
              value={sourceTable}
              onChange={(e) => setSourceTable(e.target.value)}
              className="bg-transparent border-none text-[var(--fg)] text-xs focus:outline-hidden cursor-pointer max-w-[130px] truncate"
            >
              <option value="" className="bg-[var(--bg)] text-[var(--fg)]">
                All Tables
              </option>
              {sourceTables.map((t) => (
                <option key={t} value={t} className="bg-[var(--bg)] text-[var(--fg)]">
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Swap Button */}
          <button
            onClick={handleSwap}
            title="Swap Source and Target"
            className="p-1.5 text-[var(--muted)] hover:text-[var(--fg)] rounded hover:bg-[var(--hover)] transition-colors cursor-pointer"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
          </button>

          {/* Target Selector Box */}
          <div className="flex items-center gap-1.5 p-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)]">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
              TGT
            </span>
            {/* Connection */}
            <select
              value={targetConnId}
              onChange={(e) => setTargetConnId(e.target.value)}
              className="bg-transparent border-none text-[var(--fg)] text-xs focus:outline-hidden cursor-pointer"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id} className="bg-[var(--bg)] text-[var(--fg)]">
                  {c.label || c.name || c.id}{c.readOnly ? ' (read-only)' : ''}
                </option>
              ))}
            </select>
            {isTargetReadOnly && (
              <span className="px-1 py-0.2 rounded text-[9px] font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/30">
                RO
              </span>
            )}
            <span className="text-[var(--muted)]">/</span>
            {/* Schema */}
            <select
              value={targetSchema}
              onChange={(e) => setTargetSchema(e.target.value)}
              className="bg-transparent border-none text-[var(--fg)] text-xs focus:outline-hidden cursor-pointer"
            >
              {targetSchemas.map((s) => (
                <option key={s} value={s} className="bg-[var(--bg)] text-[var(--fg)]">
                  {s}
                </option>
              ))}
            </select>
            <span className="text-[var(--muted)]">/</span>
            {/* Table */}
            <select
              value={targetTable}
              onChange={(e) => setTargetTable(e.target.value)}
              className="bg-transparent border-none text-[var(--fg)] text-xs focus:outline-hidden cursor-pointer max-w-[130px] truncate"
            >
              <option value="" className="bg-[var(--bg)] text-[var(--fg)]">
                All Tables
              </option>
              {targetTables.map((t) => (
                <option key={t} value={t} className="bg-[var(--bg)] text-[var(--fg)]">
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Compare Action Button & Data Diff Launch */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openDataDiff}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-xs font-mono font-medium transition-colors cursor-pointer"
            title="Launch Row-Level Data Diff & Bi-Directional Sync Studio (Alt+D)"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>Data Diff Studio</span>
          </button>

          <button
            onClick={handleCompare}
            disabled={isLoading || !sourceConnId}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 text-xs font-mono font-medium transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
          >
            <GitCompare className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Comparing...' : 'Compare Schemas'}</span>
          </button>
        </div>
      </div>

      {/* Status Bar / Error or Result Alert */}
      {error && (
        <div className="mx-4 mt-3 p-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-mono flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="hover:text-rose-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {applyResult && (
        <div
          className={`mx-4 mt-3 p-3 rounded-md border text-xs font-mono flex items-center justify-between ${
            applyResult.success
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
          }`}
        >
          <div className="flex items-center gap-2">
            {applyResult.success ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{applyResult.message}</span>
          </div>
          <button onClick={() => setApplyResult(null)} className="hover:opacity-75">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Diff Content Container */}
      {!diffResult && !isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] gap-3 p-6 text-center">
          <GitCompare className="w-12 h-12 opacity-25" />
          <div>
            <p className="text-sm font-medium text-[var(--fg)]">No Schema Diff Loaded</p>
            <p className="text-xs text-[var(--muted)] mt-1 max-w-sm">
              Select Source and Target database connections above and click{' '}
              <strong className="text-[var(--fg)] font-mono">Compare Schemas</strong> to inspect schema differences and generate sync migration SQL.
            </p>
          </div>
        </div>
      ) : isLoading && !diffResult ? (
        <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] gap-3 p-6 font-mono text-xs">
          <RefreshCw className="w-6 h-6 animate-spin text-[var(--accent)]" />
          <span>Analyzing tables, columns, indexes, and constraints...</span>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Left Column: Summary Cards, Filter Pills, and Visual Diff Cards */}
          <div className="flex-1 flex flex-col overflow-hidden border-r border-[var(--border)] min-w-0">
            {/* Summary KPI Cards */}
            <div className="p-3 border-b border-[var(--border)] grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0 bg-[var(--surface)]/30">
              <button
                onClick={() => setActiveFilter('ADDED')}
                className={`p-2 rounded-md border text-left transition-colors cursor-pointer ${
                  activeFilter === 'ADDED'
                    ? 'border-emerald-500 bg-emerald-500/15'
                    : 'border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover)]'
                }`}
              >
                <div className="text-[10px] font-mono text-[var(--muted)] uppercase">Added Tables</div>
                <div className="text-lg font-mono font-bold text-emerald-400 mt-0.5">
                  {`+${diffResult?.addedCount ?? 0}`}
                </div>
              </button>

              <button
                onClick={() => setActiveFilter('MODIFIED')}
                className={`p-2 rounded-md border text-left transition-colors cursor-pointer ${
                  activeFilter === 'MODIFIED'
                    ? 'border-amber-500 bg-amber-500/15'
                    : 'border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover)]'
                }`}
              >
                <div className="text-[10px] font-mono text-[var(--muted)] uppercase">Modified Tables</div>
                <div className="text-lg font-mono font-bold text-amber-400 mt-0.5">
                  {`~${diffResult?.modifiedCount ?? 0}`}
                </div>
              </button>

              <button
                onClick={() => setActiveFilter('REMOVED')}
                className={`p-2 rounded-md border text-left transition-colors cursor-pointer ${
                  activeFilter === 'REMOVED'
                    ? 'border-rose-500 bg-rose-500/15'
                    : 'border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover)]'
                }`}
              >
                <div className="text-[10px] font-mono text-[var(--muted)] uppercase">Removed Tables</div>
                <div className="text-lg font-mono font-bold text-rose-400 mt-0.5">
                  {`-${diffResult?.removedCount ?? 0}`}
                </div>
              </button>

              <button
                onClick={() => setActiveFilter('IDENTICAL')}
                className={`p-2 rounded-md border text-left transition-colors cursor-pointer ${
                  activeFilter === 'IDENTICAL'
                    ? 'border-slate-400 bg-slate-500/15'
                    : 'border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover)]'
                }`}
              >
                <div className="text-[10px] font-mono text-[var(--muted)] uppercase">Identical Tables</div>
                <div className="text-lg font-mono font-bold text-[var(--muted)] mt-0.5">
                  {`=${diffResult?.identicalCount ?? 0}`}
                </div>
              </button>
            </div>

            {/* Filter Pills and Search Bar */}
            <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between gap-2 shrink-0 bg-[var(--surface)]/20">
              <div className="flex items-center gap-1 font-mono text-xs overflow-x-auto">
                {(
                  [
                    { id: 'ALL', label: 'All', count: diffResult?.totalTables ?? 0 },
                    { id: 'MODIFIED', label: 'Modified', count: diffResult?.modifiedCount ?? 0 },
                    { id: 'ADDED', label: 'Added', count: diffResult?.addedCount ?? 0 },
                    { id: 'REMOVED', label: 'Removed', count: diffResult?.removedCount ?? 0 },
                    { id: 'IDENTICAL', label: 'Identical', count: diffResult?.identicalCount ?? 0 },
                  ] as const
                ).map((pill) => (
                  <button
                    key={pill.id}
                    onClick={() => setActiveFilter(pill.id)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                      activeFilter === pill.id
                        ? 'bg-[var(--active)] text-[var(--fg)]'
                        : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                    }`}
                  >
                    {pill.label} ({pill.count})
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="w-3 h-3 absolute left-2 top-2 text-[var(--muted)]" />
                <input
                  type="text"
                  placeholder="Filter tables..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-6 pr-2 py-0.5 text-[11px] font-mono bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--fg)] focus:outline-hidden w-36"
                />
              </div>
            </div>

            {/* Diff Cards List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {filteredTables.length === 0 ? (
                <div className="h-36 flex items-center justify-center text-[var(--muted)] font-mono text-xs">
                  No tables match the selected filter.
                </div>
              ) : (
                filteredTables.map((table) => {
                  const isExpanded = !!expandedTables[table.name]
                  return (
                    <div
                      key={table.name}
                      className="border border-[var(--border)] rounded-md overflow-hidden bg-[var(--surface)]/40 transition-colors"
                    >
                      {/* Card Header */}
                      <div
                        onClick={() => toggleExpand(table.name)}
                        className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-[var(--hover)] transition-colors select-none"
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="text-[var(--muted)] hover:text-[var(--fg)]"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <Table2 className="w-3.5 h-3.5 text-[var(--muted)]" />
                          <span className="font-mono text-xs font-semibold text-[var(--fg)]">
                            {table.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Status Badge */}
                          <DiffStatusBadge status={table.status} />
                        </div>
                      </div>

                      {/* Card Content Details */}
                      {isExpanded && (
                        <div className="p-3 border-t border-[var(--border)] bg-[var(--bg)] space-y-3 font-mono text-xs">
                          {/* Added Table explanation */}
                          {table.status === 'ADDED' && (
                            <div className="text-emerald-400/90 text-[11px] flex items-center gap-1.5">
                              <Plus className="w-3.5 h-3.5" />
                              <span>Table exists in Source schema, missing in Target. Will be created.</span>
                            </div>
                          )}

                          {/* Removed Table explanation */}
                          {table.status === 'REMOVED' && (
                            <div className="text-rose-400/90 text-[11px] flex items-center gap-1.5">
                              <Minus className="w-3.5 h-3.5" />
                              <span>Table exists in Target schema, missing in Source. Will be dropped.</span>
                            </div>
                          )}

                          {/* Columns Diff Table */}
                          {table.columns && table.columns.length > 0 && (
                            <div className="border border-[var(--border)] rounded overflow-x-auto">
                              <table className="w-full text-left text-[11px] min-w-[540px]">
                                <thead className="bg-[var(--surface)] border-b border-[var(--border)] text-[var(--muted)] font-semibold uppercase tracking-wider text-[10px]">
                                  <tr>
                                    <th className="py-1.5 px-2.5 w-6 shrink-0"></th>
                                    <th className="py-1.5 px-2.5 min-w-[100px]">Column</th>
                                    <th className="py-1.5 px-2.5 min-w-[120px]">Target (Current)</th>
                                    <th className="py-1.5 px-2.5 min-w-[120px]">Source (Desired)</th>
                                    <th className="py-1.5 px-2.5 min-w-[150px]">Changes / Details</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--border)]">
                                  {table.columns.map((col) => {
                                    const isAdded = col.status === 'ADDED'
                                    const isRemoved = col.status === 'REMOVED'
                                    const isModified = col.status === 'MODIFIED'

                                    return (
                                      <tr
                                        key={col.name}
                                        className={`${
                                          isAdded
                                            ? 'bg-emerald-500/10'
                                            : isRemoved
                                            ? 'bg-rose-500/10'
                                            : isModified
                                            ? 'bg-amber-500/10'
                                            : 'hover:bg-[var(--hover)]'
                                        }`}
                                      >
                                        <td className="py-1.5 px-2.5 font-bold w-6 shrink-0">
                                          {isAdded && <span className="text-emerald-400">+</span>}
                                          {isRemoved && <span className="text-rose-400">-</span>}
                                          {isModified && <span className="text-amber-400">~</span>}
                                          {!isAdded && !isRemoved && !isModified && (
                                            <span className="text-[var(--muted)]">=</span>
                                          )}
                                        </td>
                                        <td className="py-1.5 px-2.5 font-semibold text-[var(--fg)] min-w-[100px] break-words">
                                          {col.name}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-[var(--muted)] min-w-[120px] break-words">
                                          {col.targetType ? (
                                            <span>
                                              {col.targetType}
                                              {col.targetNullable === false ? ' NOT NULL' : ''}
                                              {col.targetDefault ? ` DEFAULT ${col.targetDefault}` : ''}
                                            </span>
                                          ) : (
                                            <span className="opacity-40">—</span>
                                          )}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-[var(--fg)] min-w-[120px] break-words">
                                          {col.sourceType ? (
                                            <span>
                                              {col.sourceType}
                                              {col.sourceNullable === false ? ' NOT NULL' : ''}
                                              {col.sourceDefault ? ` DEFAULT ${col.sourceDefault}` : ''}
                                            </span>
                                          ) : (
                                            <span className="opacity-40">—</span>
                                          )}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-[11px] min-w-[150px]">
                                          {col.changes && col.changes.length > 0 ? (
                                            <span className="text-amber-400 font-medium inline-block break-words">
                                              {col.changes.join(', ')}
                                            </span>
                                          ) : isAdded ? (
                                            <span className="text-emerald-400">New column</span>
                                          ) : isRemoved ? (
                                            <span className="text-rose-400">Drop column</span>
                                          ) : (
                                            <span className="text-[var(--muted)]">Identical</span>
                                          )}
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Indexes Diff Section */}
                          {table.indexes && table.indexes.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                                Indexes
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {table.indexes.map((idx) => {
                                  const isAdded = idx.status === 'ADDED'
                                  const isRemoved = idx.status === 'REMOVED'
                                  return (
                                    <span
                                      key={idx.name}
                                      className={`px-2 py-0.5 rounded border text-[10px] font-medium flex items-center gap-1 ${
                                        isAdded
                                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                          : isRemoved
                                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                                          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]'
                                      }`}
                                    >
                                      {isAdded ? '+' : isRemoved ? '-' : '='} {idx.name} (
                                      {idx.columns.join(', ')})
                                    </span>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          {/* Foreign Keys Diff Section */}
                          {table.foreignKeys && table.foreignKeys.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                                Foreign Keys
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {table.foreignKeys.map((fk) => {
                                  const isAdded = fk.status === 'ADDED'
                                  const isRemoved = fk.status === 'REMOVED'
                                  return (
                                    <span
                                      key={`${fk.column}->${fk.refTable}.${fk.refColumn}`}
                                      className={`px-2 py-0.5 rounded border text-[10px] font-medium flex items-center gap-1 ${
                                        isAdded
                                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                          : isRemoved
                                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                                          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]'
                                      }`}
                                    >
                                      {isAdded ? '+' : isRemoved ? '-' : '='} {fk.column} →{' '}
                                      {fk.refTable}({fk.refColumn})
                                    </span>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Right Column: Migration SQL Script Preview & Apply Sync Action Panel */}
          <div className="w-[420px] lg:w-[480px] shrink-0 flex flex-col h-full bg-[var(--surface)]/20">
            {/* Header */}
            <div className="p-3 border-b border-[var(--border)] flex items-center justify-between shrink-0 bg-[var(--surface)]">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-[var(--accent)]" />
                <span className="font-mono text-xs font-semibold text-[var(--fg)]">
                  Migration SQL Preview
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[var(--active)] text-[var(--fg)] font-medium">
                  {diffResult?.migrationSql?.length ?? 0} stmts
                </span>
                {isTargetReadOnly && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                    <AlertTriangle className="w-3 h-3" />
                    Target is Read-Only
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCopySql}
                  disabled={!diffResult?.sql}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border border-[var(--border)] transition-colors disabled:opacity-50 cursor-pointer"
                  title="Copy Migration SQL"
                >
                  {copiedSql ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400 text-[11px]">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span className="text-[11px]">Copy</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => !isTargetReadOnly && setShowConfirmModal(true)}
                  disabled={
                    isApplying ||
                    isTargetReadOnly ||
                    !diffResult?.migrationSql ||
                    diffResult.migrationSql.length === 0
                  }
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 text-xs font-mono font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                  title={isTargetReadOnly ? 'Target connection is read-only' : 'Apply migration statements to target database'}
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Apply Sync</span>
                </button>
              </div>
            </div>

            {/* Read-Only Warning Banner */}
            {isTargetReadOnly && diffResult?.migrationSql && diffResult.migrationSql.length > 0 && (
              <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-center gap-2 font-mono">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Target is read-only. Migration cannot be applied.</span>
              </div>
            )}

            {/* SQL Script CodeMirror Editor/Viewer */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {diffResult?.sql ? (
                <CodeMirror
                  value={diffResult.sql}
                  height="100%"
                  className="flex-1 font-mono text-xs overflow-auto"
                  theme={isDark ? oneDark : undefined}
                  extensions={[sql()]}
                  editable={false}
                  basicSetup={{
                    lineNumbers: true,
                    foldGutter: false,
                    highlightActiveLine: false,
                  }}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] font-mono text-xs p-6 text-center">
                  <Code2 className="w-8 h-8 opacity-25 mb-2" />
                  <span>No migration statements needed.</span>
                  <span className="text-[11px] opacity-75 mt-1">
                    Schemas are identical or no differences detected.
                  </span>
                </div>
              )}
            </div>

            {/* Target Sync Summary Footer */}
            <div className="p-2.5 border-t border-[var(--border)] bg-[var(--surface)] text-[11px] font-mono text-[var(--muted)] flex items-center justify-between shrink-0">
              <span className="truncate max-w-[280px]">
                <span>{sourceConnObj?.label || sourceConnId}</span> → <strong>{targetConnObj?.label || targetConnId}</strong>
              </span>
              <span className="text-[10px] uppercase font-semibold">
                Dialect: {diffResult?.targetDialect || targetConnObj?.dialect || 'auto'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal before Executing Sync Migration */}
      {showConfirmModal && !isTargetReadOnly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-xl w-full max-w-lg overflow-hidden flex flex-col font-mono text-xs">
            {/* Modal Header */}
            <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface)]">
              <div className="flex items-center gap-2 text-amber-400 font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Confirm Schema Sync Migration</span>
              </div>
              <button
                onClick={() => setShowConfirmModal(false)}
                className="text-[var(--muted)] hover:text-[var(--fg)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-3">
              <p className="text-[var(--fg)]">
                You are about to execute{' '}
                <strong className="text-amber-400">
                  {diffResult?.migrationSql?.length ?? 0} DDL migration statements
                </strong>{' '}
                on target database:
              </p>

              <div className="p-2.5 rounded bg-[var(--surface)] border border-[var(--border)] space-y-1">
                <div>
                  <span className="text-[var(--muted)]">Connection: </span>
                  <strong className="text-[var(--fg)]">
                    {targetConnObj?.label || targetConnId}
                  </strong>
                </div>
                <div>
                  <span className="text-[var(--muted)]">Target Schema: </span>
                  <strong className="text-[var(--fg)]">{targetSchema}</strong>
                </div>
              </div>

              <div className="border border-[var(--border)] rounded overflow-hidden max-h-48 overflow-y-auto p-2 bg-[var(--bg)] text-[11px] space-y-1 text-[var(--muted)]">
                {diffResult?.migrationSql?.map((stmt, idx) => (
                  <div key={idx} className="truncate">
                    <span className="text-amber-400">{idx + 1}.</span> {stmt}
                  </div>
                ))}
              </div>

              <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[11px]">
                Warning: DDL operations modify the database schema directly. Ensure you have backed up any critical data before proceeding.
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-end gap-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                disabled={isApplying}
                className="px-3 py-1.5 rounded text-xs font-mono text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyMigration}
                disabled={isApplying}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500 text-black font-semibold hover:bg-amber-400 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {isApplying ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Applying Migration...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Confirm & Apply</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DiffStatusBadge({ status }: { status: DiffStatus }) {
  switch (status) {
    case 'ADDED':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          + ADDED
        </span>
      )
    case 'REMOVED':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
          - REMOVED
        </span>
      )
    case 'MODIFIED':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
          ~ MODIFIED
        </span>
      )
    case 'IDENTICAL':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-500/15 text-slate-400 border border-slate-500/30">
          = IDENTICAL
        </span>
      )
    default:
      return null
  }
}
