import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  X,
  ArrowLeftRight,
  GitCompare,
  Terminal,
  Check,
  RotateCcw,
  Sparkles,
  Database,
  Table2,
  Key,
  XCircle,
} from 'lucide-react'
import {
  api,
  type DataDiffResult,
  type SyncConflictStrategy,
} from '../../lib/api'
import { useAppStore } from '../../stores/appStore'
import { DiffSummaryBar } from './DiffSummaryBar'
import { DataDiffGrid } from './DataDiffGrid'
import { SyncScriptPreviewModal } from './SyncScriptPreviewModal'
import {
  filterDiffRows,
  generateCLICommand,
  getRowKey,
} from './dataDiffHelper'

export interface DataDiffModalProps {
  isOpen?: boolean
  onClose?: () => void
  initialSourceConnId?: string
  initialSourceSchema?: string
  initialSourceTable?: string
  initialTargetConnId?: string
  initialTargetSchema?: string
  initialTargetTable?: string
}

export const DataDiffModal: React.FC<DataDiffModalProps> = ({
  isOpen: propIsOpen,
  onClose: propOnClose,
  initialSourceConnId,
  initialSourceSchema = 'public',
  initialSourceTable = '',
  initialTargetConnId,
  initialTargetSchema = 'public',
  initialTargetTable = '',
}) => {
  const isStoreOpen = useAppStore((s) => s.isDataDiffOpen)
  const closeStore = useAppStore((s) => s.closeDataDiff)
  const connections = useAppStore((s) => s.connections)
  const activeConnId = useAppStore((s) => s.activeConnectionId)

  const isOpen = propIsOpen !== undefined ? propIsOpen : isStoreOpen
  const handleClose = propOnClose || closeStore

  // Source selection state
  const [sourceConnId, setSourceConnId] = useState<string>(
    initialSourceConnId || activeConnId || (connections[0]?.id ?? '')
  )
  const [sourceSchema, setSourceSchema] = useState<string>(initialSourceSchema)
  const [sourceTable, setSourceTable] = useState<string>(initialSourceTable)
  const [sourceSchemas, setSourceSchemas] = useState<string[]>([])
  const [sourceTables, setSourceTables] = useState<string[]>([])

  // Target selection state
  const [targetConnId, setTargetConnId] = useState<string>(
    initialTargetConnId || (connections.length > 1 ? connections[1].id : sourceConnId)
  )
  const [targetSchema, setTargetSchema] = useState<string>(initialTargetSchema)
  const [targetTable, setTargetTable] = useState<string>(initialTargetTable)
  const [targetSchemas, setTargetSchemas] = useState<string[]>([])
  const [targetTables, setTargetTables] = useState<string[]>([])

  // Config: Columns, PKs, Filter & Where Clause
  const [availableColumns, setAvailableColumns] = useState<string[]>([])
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [selectedPKs, setSelectedPKs] = useState<string[]>([])
  const [whereClause, setWhereClause] = useState<string>('')
  const [pageSize, setPageSize] = useState<number>(500)

  // Execution state
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffResult, setDiffResult] = useState<DataDiffResult | null>(null)

  // Grid filter & selection state
  const [filterStatus, setFilterStatus] = useState<
    'all' | 'added' | 'deleted' | 'modified' | 'identical'
  >('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set())

  // Modal controls
  const [strategy, setStrategy] = useState<SyncConflictStrategy>('source_wins')
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [copiedCLI, setCopiedCLI] = useState(false)

  // Sync activeConnId to initial connections if not set
  useEffect(() => {
    if (!sourceConnId && connections.length > 0) {
      setSourceConnId(activeConnId || connections[0].id)
    }
    if (!targetConnId && connections.length > 1) {
      setTargetConnId(connections[1].id)
    }
  }, [connections, activeConnId, sourceConnId, targetConnId])

  // Load Source schemas & tables
  useEffect(() => {
    if (!sourceConnId) return
    let mounted = true
    api.getSchemas(sourceConnId, connections).then((schemas) => {
      if (!mounted) return
      setSourceSchemas(schemas || [])
      if (schemas.length > 0 && !schemas.includes(sourceSchema)) {
        setSourceSchema(schemas.includes('public') ? 'public' : schemas[0])
      }
    })
    return () => {
      mounted = false
    }
  }, [sourceConnId, connections])

  useEffect(() => {
    if (!sourceConnId) return
    let mounted = true
    api.getTables(sourceConnId, sourceSchema, connections).then((tables) => {
      if (!mounted) return
      const names = (tables || []).map((t: any) => (typeof t === 'string' ? t : t.name))
      setSourceTables(names)
      if (names.length > 0 && (!sourceTable || !names.includes(sourceTable))) {
        setSourceTable(names[0])
      }
    })
    return () => {
      mounted = false
    }
  }, [sourceConnId, sourceSchema, connections])

  // Load Target schemas & tables
  useEffect(() => {
    if (!targetConnId) return
    let mounted = true
    api.getSchemas(targetConnId, connections).then((schemas) => {
      if (!mounted) return
      setTargetSchemas(schemas || [])
      if (schemas.length > 0 && !schemas.includes(targetSchema)) {
        setTargetSchema(schemas.includes('public') ? 'public' : schemas[0])
      }
    })
    return () => {
      mounted = false
    }
  }, [targetConnId, connections])

  useEffect(() => {
    if (!targetConnId) return
    let mounted = true
    api.getTables(targetConnId, targetSchema, connections).then((tables) => {
      if (!mounted) return
      const names = (tables || []).map((t: any) => (typeof t === 'string' ? t : t.name))
      setTargetTables(names)
      if (names.length > 0 && (!targetTable || !names.includes(targetTable))) {
        // Default target table to same name as source table if exists
        if (sourceTable && names.includes(sourceTable)) {
          setTargetTable(sourceTable)
        } else {
          setTargetTable(names[0])
        }
      }
    })
    return () => {
      mounted = false
    }
  }, [targetConnId, targetSchema, sourceTable, connections])

  // Detect Columns & Primary Keys when source/target tables change
  useEffect(() => {
    if (!sourceConnId || !sourceTable) return
    let mounted = true

    api
      .getTableDetails(sourceConnId, sourceTable, sourceSchema, connections)
      .then((detail) => {
        if (!mounted || !detail?.columns) return
        const cols = detail.columns.map((c) => c.name)
        const pks = detail.columns.filter((c) => c.isPrimary).map((c) => c.name)

        setAvailableColumns(cols)
        setSelectedColumns(cols)
        if (pks.length > 0) {
          setSelectedPKs(pks)
        } else if (targetConnId && targetTable) {
          api
            .getTableDetails(targetConnId, targetTable, targetSchema, connections)
            .then((tgtDetail) => {
              if (!mounted || !tgtDetail?.columns) return
              const tgtPks = tgtDetail.columns.filter((c) => c.isPrimary).map((c) => c.name)
              setSelectedPKs(tgtPks.length > 0 ? tgtPks : cols.slice(0, 1))
            })
            .catch(() => {
              setSelectedPKs(cols.slice(0, 1))
            })
        } else {
          setSelectedPKs(cols.slice(0, 1))
        }
      })
      .catch(() => {})

    return () => {
      mounted = false
    }
  }, [sourceConnId, sourceSchema, sourceTable, targetConnId, targetSchema, targetTable, connections])

  // Swap Source & Target
  const handleSwap = () => {
    const tmpConn = sourceConnId
    const tmpSchema = sourceSchema
    const tmpTable = sourceTable

    setSourceConnId(targetConnId)
    setSourceSchema(targetSchema)
    setSourceTable(targetTable)

    setTargetConnId(tmpConn)
    setTargetSchema(tmpSchema)
    setTargetTable(tmpTable)
  }

  // Execute Comparison
  const handleCompare = async () => {
    if (!sourceConnId || !sourceTable) {
      setError('Source connection and table are required')
      return
    }
    if (!targetConnId || !targetTable) {
      setError('Target connection and table are required')
      return
    }
    if (selectedPKs.length === 0) {
      setError('At least one primary key column must be selected')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const res = await api.compareDataDiff(
        {
          sourceConnId,
          sourceSchema,
          sourceTable,
          targetConnId,
          targetSchema,
          targetTable,
          columns: selectedColumns,
          primaryKeys: selectedPKs,
          whereClause,
          pageSize,
          filterStatus: 'all',
        },
        connections
      )

      setDiffResult(res)

      // By default, select all non-identical rows for sync
      const pks = res.primaryKeys || selectedPKs
      const keysToSelect = new Set<string>()
      for (const row of res.rows) {
        if (row.status !== 'identical') {
          keysToSelect.add(getRowKey(row, pks))
        }
      }
      setSelectedRowKeys(keysToSelect)
    } catch (err: any) {
      setError(err.message || 'Comparison failed')
    } finally {
      setIsLoading(false)
    }
  }

  // Row filtering
  const filteredRows = useMemo(() => {
    if (!diffResult?.rows) return []
    return filterDiffRows(diffResult.rows, filterStatus, searchTerm)
  }, [diffResult?.rows, filterStatus, searchTerm])

  // Selection helpers
  const handleToggleRow = useCallback((rKey: string) => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev)
      if (next.has(rKey)) next.delete(rKey)
      else next.add(rKey)
      return next
    })
  }, [])

  const pks = diffResult?.primaryKeys || selectedPKs
  const isAllSelected = useMemo(() => {
    if (filteredRows.length === 0) return false
    return filteredRows.every((r) => selectedRowKeys.has(getRowKey(r, pks)))
  }, [filteredRows, selectedRowKeys, pks])

  const handleToggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedRowKeys((prev) => {
        const next = new Set(prev)
        for (const r of filteredRows) {
          next.delete(getRowKey(r, pks))
        }
        return next
      })
    } else {
      setSelectedRowKeys((prev) => {
        const next = new Set(prev)
        for (const r of filteredRows) {
          next.add(getRowKey(r, pks))
        }
        return next
      })
    }
  }, [isAllSelected, filteredRows, pks])

  // Rows selected for syncing
  const rowsToSync = useMemo(() => {
    if (!diffResult?.rows) return []
    return diffResult.rows.filter((r) => selectedRowKeys.has(getRowKey(r, pks)))
  }, [diffResult?.rows, selectedRowKeys, pks])

  // CLI Command copy
  const handleCopyCLI = () => {
    const cmd = generateCLICommand({
      sourceConnId,
      sourceSchema,
      sourceTable,
      targetConnId,
      targetSchema,
      targetTable,
      primaryKeys: selectedPKs,
      columns: selectedColumns,
      whereClause,
    })
    navigator.clipboard.writeText(cmd)
    setCopiedCLI(true)
    setTimeout(() => setCopiedCLI(false), 2000)
  }

  const sourceProfile = connections.find((c) => c.id === sourceConnId)
  const isSourceReadOnly = sourceProfile?.readOnly || false
  const targetProfile = connections.find((c) => c.id === targetConnId)
  const isTargetReadOnly = targetProfile?.readOnly || false

  const effectiveTargetConnId = strategy === 'target_wins' ? sourceConnId : targetConnId
  const effectiveIsTargetReadOnly = strategy === 'target_wins' ? isSourceReadOnly : isTargetReadOnly

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-6xl max-h-[95vh] bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col overflow-hidden font-mono text-xs">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--hover)]/30">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[var(--accent)] text-white shadow-xs">
              <ArrowLeftRight className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--fg)] flex items-center gap-2">
                <span>Row-Level Data Diff & Sync Studio</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  Feature-42
                </span>
              </h2>
              <p className="text-[11px] text-[var(--muted)]">
                Compare rows across databases, detect modified cell values, and sync bi-directionally
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyCLI}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover)] text-[var(--fg)] text-[11px] transition-colors cursor-pointer"
              title="Copy equivalent DBLens CLI command"
            >
              {copiedCLI ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Terminal className="w-3.5 h-3.5" />
              )}
              <span>{copiedCLI ? 'CLI Copied!' : '>_ CLI'}</span>
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded-md hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Studio Connection & Table Config Header */}
        <div className="p-4 border-b border-[var(--border)] bg-[var(--hover)]/10 flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center relative">
            {/* SOURCE SELECTOR */}
            <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-indigo-400">
                <span className="flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5" />
                  <span>SOURCE (Origin)</span>
                </span>
                <span className="text-[var(--muted)] font-normal">
                  {connections.find((c) => c.id === sourceConnId)?.driver || 'SQL'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={sourceConnId}
                  onChange={(e) => setSourceConnId(e.target.value)}
                  className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] focus:outline-hidden"
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.id}
                    </option>
                  ))}
                </select>

                <select
                  value={sourceSchema}
                  onChange={(e) => setSourceSchema(e.target.value)}
                  className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] focus:outline-hidden"
                >
                  {sourceSchemas.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <select
                  value={sourceTable}
                  onChange={(e) => setSourceTable(e.target.value)}
                  className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] font-semibold focus:outline-hidden"
                >
                  {sourceTables.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Swap Button (Desktop Centered) */}
            <button
              type="button"
              onClick={handleSwap}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hidden md:flex items-center justify-center w-8 h-8 rounded-full border border-[var(--border)] bg-[var(--bg)] shadow-md hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] transition-all cursor-pointer"
              title="Swap Source and Target"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* TARGET SELECTOR */}
            <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-cyan-400">
                <span className="flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5" />
                  <span>TARGET (Destination)</span>
                </span>
                <span className="text-[var(--muted)] font-normal">
                  {connections.find((c) => c.id === targetConnId)?.driver || 'SQL'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={targetConnId}
                  onChange={(e) => setTargetConnId(e.target.value)}
                  className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] focus:outline-hidden"
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.id}
                    </option>
                  ))}
                </select>

                <select
                  value={targetSchema}
                  onChange={(e) => setTargetSchema(e.target.value)}
                  className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] focus:outline-hidden"
                >
                  {targetSchemas.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <select
                  value={targetTable}
                  onChange={(e) => setTargetTable(e.target.value)}
                  className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] font-semibold focus:outline-hidden"
                >
                  {targetTables.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Primary Keys & Where Clause Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--border)]/40">
            {/* Primary Key selector pills */}
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[var(--muted)] font-medium">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>Primary Key(s):</span>
              </span>
              <div className="flex flex-wrap gap-1">
                {availableColumns.map((col) => {
                  const isPK = selectedPKs.includes(col)
                  return (
                    <button
                      key={col}
                      type="button"
                      onClick={() => {
                        if (isPK) {
                          if (selectedPKs.length > 1) {
                            setSelectedPKs(selectedPKs.filter((p) => p !== col))
                          }
                        } else {
                          setSelectedPKs([...selectedPKs, col])
                        }
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] border cursor-pointer transition-colors ${
                        isPK
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold'
                          : 'bg-[var(--bg)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'
                      }`}
                    >
                      {col}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Filter, Page Size & Run Button */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={whereClause}
                onChange={(e) => setWhereClause(e.target.value)}
                placeholder="Optional WHERE (e.g. status = 'active')"
                className="px-2.5 py-1 rounded-md border border-[var(--border)] bg-[var(--bg)] text-[11px] text-[var(--fg)] w-56 focus:outline-hidden"
              />

              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-[11px] text-[var(--fg)] focus:outline-hidden cursor-pointer"
                title="Page limit"
              >
                <option value={100}>100 rows</option>
                <option value={500}>500 rows</option>
                <option value={1000}>1000 rows</option>
                <option value={2000}>2000 rows</option>
              </select>

              <button
                type="button"
                onClick={handleCompare}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white font-medium transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
              >
                <GitCompare className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>{isLoading ? 'Comparing...' : 'Compare Rows'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mx-4 mt-3 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-rose-400 hover:text-rose-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Main Content: Diff Summary Bar & Diff Grid */}
        <div className="flex-1 overflow-hidden p-4 flex flex-col gap-3 min-h-0">
          {diffResult ? (
            <>
              <DiffSummaryBar
                summary={diffResult.summary}
                selectedFilter={filterStatus}
                onSelectFilter={setFilterStatus}
                selectedRowsCount={rowsToSync.length}
                totalRowsCount={diffResult.rows.length}
                onToggleSelectAll={handleToggleSelectAll}
                isAllSelected={isAllSelected}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
              />

              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <DataDiffGrid
                  columns={diffResult.comparedColumns}
                  primaryKeys={diffResult.primaryKeys}
                  rows={filteredRows}
                  selectedRowKeys={selectedRowKeys}
                  onToggleRow={handleToggleRow}
                  sourceLabel={sourceConnId}
                  targetLabel={targetConnId}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 text-[var(--muted)] gap-2">
              <Table2 className="w-12 h-12 opacity-30" />
              <p className="font-semibold text-sm text-[var(--fg)]">Ready to compare</p>
              <p className="text-[11px] max-w-sm">
                Select your Source and Target databases, configure Primary Keys, and click{' '}
                <strong className="text-[var(--accent)] font-mono">Compare Rows</strong> to analyze differences.
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        {diffResult && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)] bg-[var(--hover)]/30">
            <div className="text-[11px] text-[var(--muted)]">
              <span>{rowsToSync.length} row(s) selected for sync</span>
            </div>

            <button
              type="button"
              onClick={() => setIsSyncModalOpen(true)}
              disabled={rowsToSync.length === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generate Sync Script ({rowsToSync.length})</span>
            </button>
          </div>
        )}

        {/* Sync Script Preview & Execution Modal */}
        {isSyncModalOpen && (
          <SyncScriptPreviewModal
            isOpen={isSyncModalOpen}
            onClose={() => setIsSyncModalOpen(false)}
            sourceConnId={sourceConnId}
            sourceSchema={sourceSchema}
            sourceTable={sourceTable}
            targetConnId={effectiveTargetConnId}
            targetSchema={targetSchema}
            targetTable={targetTable}
            primaryKeys={diffResult?.primaryKeys || selectedPKs}
            columns={diffResult?.comparedColumns || selectedColumns}
            selectedRows={rowsToSync}
            sourceDialect={diffResult?.sourceDialect || 'postgres'}
            targetDialect={diffResult?.targetDialect || 'postgres'}
            isTargetReadOnly={effectiveIsTargetReadOnly}
            strategy={strategy}
            onStrategyChange={setStrategy}
            onSyncApplied={() => {
              // Re-run compare after sync applied
              handleCompare()
            }}
          />
        )}
      </div>
    </div>
  )
}
