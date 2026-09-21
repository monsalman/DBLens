import React, { useState, useEffect, useCallback } from 'react'
import {
  X,
  Network,
  Play,
  ArrowRightLeft,
  Scale,
  Download,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Database,
  Layers,
  Code2,
  Copy,
  Check,
} from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  api,
  type FederatedQueryResponse,
  type DataPipeResponse,
  type ReconcileResponse,
  type TableMeta,
} from '../../lib/api'
import { useAppStore } from '../../stores/appStore'
import {
  generateFederatedJoinSnippet,
  formatReconcileStatus,
  validateDataPipeForm,
  exportFederatedQueryResultToCSV,
} from './federationHelper'

interface Props {
  isOpen?: boolean
  onClose?: () => void
  initialTab?: 'query' | 'pipe' | 'reconcile'
}

export const FederationModal: React.FC<Props> = ({
  isOpen,
  onClose,
  initialTab = 'query',
}) => {
  const storeIsOpen = useAppStore((s) => s.isFederationModalOpen)
  const setStoreIsOpen = useAppStore((s) => s.setIsFederationModalOpen)
  const storeInitialTab = useAppStore((s) => s.federationInitialTab)
  const connections = useAppStore((s) => s.connections)
  const activeConnId = useAppStore((s) => s.activeConnectionId)

  const show = isOpen !== undefined ? isOpen : storeIsOpen
  const handleClose = useCallback(() => {
    if (onClose) {
      onClose()
    } else {
      setStoreIsOpen(false)
    }
  }, [onClose, setStoreIsOpen])

  const [activeTab, setActiveTab] = useState<'query' | 'pipe' | 'reconcile'>(
    storeInitialTab || initialTab
  )

  useEffect(() => {
    if (show && storeInitialTab) {
      setActiveTab(storeInitialTab)
    }
  }, [show, storeInitialTab])

  // ─────────────────────────────────────────────────────────────
  // TAB 1: Federated Query Studio State
  // ─────────────────────────────────────────────────────────────
  const [querySQL, setQuerySQL] = useState<string>('')
  const [queryLimit, setQueryLimit] = useState<number>(10000)
  const [queryLoading, setQueryLoading] = useState<boolean>(false)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [queryResponse, setQueryResponse] = useState<FederatedQueryResponse | null>(null)
  const [showRewritten, setShowRewritten] = useState<boolean>(false)
  const [copiedRewritten, setCopiedRewritten] = useState<boolean>(false)

  // Initialize sample query when modal opens and query is empty
  useEffect(() => {
    if (show && !querySQL) {
      const c1 = connections[0]?.id || 'conn1'
      const c2 = connections[1]?.id || connections[0]?.id || 'conn2'
      setQuerySQL(generateFederatedJoinSnippet(c1, 'users', c2, 'orders'))
    }
  }, [show, querySQL, connections])

  const handleRunFederatedQuery = async () => {
    if (!querySQL.trim()) return
    setQueryLoading(true)
    setQueryError(null)
    try {
      const res = await api.executeFederatedQuery(
        {
          query: querySQL,
          limit: queryLimit,
        },
        connections
      )
      setQueryResponse(res)
    } catch (err: any) {
      setQueryError(err.message || 'Federated query execution failed')
      setQueryResponse(null)
    } finally {
      setQueryLoading(false)
    }
  }

  const handleInsertConnTag = (connId: string) => {
    setQuerySQL((prev) => `${prev} [${connId}].`)
  }

  const handleExportCSV = () => {
    if (!queryResponse?.result) return
    const csv = exportFederatedQueryResultToCSV(queryResponse.result)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `federated_query_${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopyRewritten = () => {
    if (!queryResponse?.rewrittenSql) return
    navigator.clipboard.writeText(queryResponse.rewrittenSql)
    setCopiedRewritten(true)
    setTimeout(() => setCopiedRewritten(false), 2000)
  }

  // ─────────────────────────────────────────────────────────────
  // TAB 2: Data Pipe & Stream Migration State
  // ─────────────────────────────────────────────────────────────
  const [pipeSourceConn, setPipeSourceConn] = useState<string>(activeConnId || connections[0]?.id || '')
  const [pipeSourceSchema, setPipeSourceSchema] = useState<string>('')
  const [pipeSourceTable, setPipeSourceTable] = useState<string>('')
  const [pipeTargetConn, setPipeTargetConn] = useState<string>(connections[1]?.id || connections[0]?.id || '')
  const [pipeTargetSchema, setPipeTargetSchema] = useState<string>('')
  const [pipeTargetTable, setPipeTargetTable] = useState<string>('')
  const [pipeCreateTable, setPipeCreateTable] = useState<boolean>(true)
  const [pipeTruncateTable, setPipeTruncateTable] = useState<boolean>(false)
  const [pipeBatchSize, setPipeBatchSize] = useState<number>(500)
  const [pipeLoading, setPipeLoading] = useState<boolean>(false)
  const [pipeError, setPipeError] = useState<string | null>(null)
  const [pipeResponse, setPipeResponse] = useState<DataPipeResponse | null>(null)

  // Tables list for source dropdown
  const [sourceTables, setSourceTables] = useState<TableMeta[]>([])

  const loadSourceTables = useCallback(async (connId: string) => {
    if (!connId) return
    try {
      const tbls = await api.getTables(connId, undefined, connections)
      setSourceTables(tbls || [])
    } catch {
      setSourceTables([])
    }
  }, [connections])

  useEffect(() => {
    if (show && activeTab === 'pipe' && pipeSourceConn) {
      loadSourceTables(pipeSourceConn)
    }
  }, [show, activeTab, pipeSourceConn, loadSourceTables])

  const handleStartPipe = async () => {
    const validation = validateDataPipeForm({
      sourceConnId: pipeSourceConn,
      sourceTable: pipeSourceTable,
      targetConnId: pipeTargetConn,
      targetTable: pipeTargetTable || pipeSourceTable,
      batchSize: pipeBatchSize,
    })
    if (!validation.valid) {
      setPipeError(validation.error || 'Invalid form')
      return
    }

    setPipeLoading(true)
    setPipeError(null)
    setPipeResponse(null)
    try {
      const res = await api.executeDataPipe(
        {
          sourceConnId: pipeSourceConn,
          sourceSchema: pipeSourceSchema,
          sourceTable: pipeSourceTable,
          targetConnId: pipeTargetConn,
          targetSchema: pipeTargetSchema,
          targetTable: pipeTargetTable || pipeSourceTable,
          createTable: pipeCreateTable,
          truncateTable: pipeTruncateTable,
          batchSize: pipeBatchSize,
        },
        connections
      )
      setPipeResponse(res)
    } catch (err: any) {
      setPipeError(err.message || 'Data migration failed')
    } finally {
      setPipeLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // TAB 3: Data Reconciliation State
  // ─────────────────────────────────────────────────────────────
  const [recSourceConn, setRecSourceConn] = useState<string>(activeConnId || connections[0]?.id || '')
  const [recSourceSchema, setRecSourceSchema] = useState<string>('')
  const [recSourceTable, setRecSourceTable] = useState<string>('')
  const [recTargetConn, setRecTargetConn] = useState<string>(connections[1]?.id || connections[0]?.id || '')
  const [recTargetSchema, setRecTargetSchema] = useState<string>('')
  const [recTargetTable, setRecTargetTable] = useState<string>('')
  const [recSampleLimit, setRecSampleLimit] = useState<number>(50)
  const [recLoading, setRecLoading] = useState<boolean>(false)
  const [recError, setRecError] = useState<string | null>(null)
  const [recResponse, setRecResponse] = useState<ReconcileResponse | null>(null)

  const handleStartReconcile = async () => {
    if (!recSourceConn || !recSourceTable || !recTargetConn) {
      setRecError('Please select both connections and table names.')
      return
    }

    setRecLoading(true)
    setRecError(null)
    setRecResponse(null)
    try {
      const res = await api.reconcileTables(
        {
          sourceConnId: recSourceConn,
          sourceSchema: recSourceSchema,
          sourceTable: recSourceTable,
          targetConnId: recTargetConn,
          targetSchema: recTargetSchema,
          targetTable: recTargetTable || recSourceTable,
          sampleLimit: recSampleLimit,
        },
        connections
      )
      setRecResponse(res)
    } catch (err: any) {
      setRecError(err.message || 'Reconciliation failed')
    } finally {
      setRecLoading(false)
    }
  }

  // Keyboard shortcut listener: Cmd/Ctrl+Enter runs query, Esc closes
  useEffect(() => {
    if (!show) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (activeTab === 'query' && !queryLoading) {
          e.preventDefault()
          handleRunFederatedQuery()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [show, activeTab, queryLoading, querySQL, handleClose])

  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 md:p-6 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl flex flex-col w-full max-w-5xl h-[90vh] overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/20 text-indigo-400">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight text-white">
                  Multi-Connection Federation & Cross-DB Runner
                </h2>
                <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Virtual SQLite Hub
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Join, stream, and reconcile tables across PostgreSQL, MySQL, and SQLite connections
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 px-5 py-2 border-b border-zinc-800 bg-zinc-900/80 text-xs font-medium">
          <button
            onClick={() => setActiveTab('query')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
              activeTab === 'query'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Federated Query Studio
          </button>

          <button
            onClick={() => setActiveTab('pipe')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
              activeTab === 'pipe'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            Data Pipe & Migration
          </button>

          <button
            onClick={() => setActiveTab('reconcile')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
              activeTab === 'reconcile'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            Data Reconciliation
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* ─────────────────────────────────────────────────────────────
              TAB 1: Federated Query Studio
          ───────────────────────────────────────────────────────────── */}
          {activeTab === 'query' && (
            <div className="space-y-4 h-full flex flex-col">
              {/* Quick Connection Tag Helper */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-zinc-400 flex items-center gap-1">
                    <Database className="w-3.5 h-3.5 text-zinc-500" />
                    Insert Connection:
                  </span>
                  {connections.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleInsertConnTag(c.id)}
                      className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 transition-colors font-mono text-[11px]"
                      title={`Insert [${c.id}].`}
                    >
                      [{c.label || c.name || c.id}]
                    </button>
                  ))}
                  {connections.length === 0 && (
                    <span className="text-zinc-500 italic">No saved connections</span>
                  )}
                </div>

                <div className="text-[11px] text-zinc-500 font-mono">
                  Syntax: <span className="text-zinc-400">[conn_id].table</span> or{' '}
                  <span className="text-zinc-400">[conn_id].schema.table</span>
                </div>
              </div>

              {/* Code Editor */}
              <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950 shadow-inner">
                <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/90 border-b border-zinc-800 text-xs text-zinc-400">
                  <span className="font-mono text-[11px]">SQL Query (joined across connections)</span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-[11px]">
                      <span>Max Rows/Table:</span>
                      <input
                        type="number"
                        min={100}
                        max={20000}
                        step={500}
                        value={queryLimit}
                        onChange={(e) => setQueryLimit(Number(e.target.value))}
                        className="w-20 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-right text-zinc-200 focus:outline-hidden focus:border-indigo-500"
                      />
                    </label>
                  </div>
                </div>

                <div className="h-44 text-sm overflow-auto">
                  <CodeMirror
                    value={querySQL}
                    height="100%"
                    extensions={[sql()]}
                    theme={oneDark}
                    onChange={(val) => setQuerySQL(val)}
                    placeholder="SELECT * FROM [conn1].users u JOIN [conn2].orders o ON u.id = o.user_id"
                  />
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRunFederatedQuery}
                    disabled={queryLoading || !querySQL.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs shadow-sm transition-colors cursor-pointer"
                  >
                    {queryLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 fill-white" />
                    )}
                    Run Federated Query
                    <span className="text-[10px] opacity-75 ml-1">⌘Enter</span>
                  </button>
                </div>

                {queryResponse && (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-zinc-400">
                      Execution: <strong className="text-zinc-200">{queryResponse.elapsedMs} ms</strong>
                    </span>
                    <span className="text-zinc-400">
                      Returned: <strong className="text-zinc-200">{queryResponse.result.rows?.length || 0} rows</strong>
                    </span>
                    <button
                      onClick={handleExportCSV}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export CSV
                    </button>
                  </div>
                )}
              </div>

              {/* Error Message */}
              {queryError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-semibold">Query Execution Error:</strong> {queryError}
                  </div>
                </div>
              )}

              {/* Subquery Breakdown Stats */}
              {queryResponse?.tableStats && queryResponse.tableStats.length > 0 && (
                <div className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800/80 space-y-2">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span className="font-medium text-zinc-300 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-indigo-400" />
                      Federated Subquery Pull Breakdown:
                    </span>
                    <button
                      onClick={() => setShowRewritten(!showRewritten)}
                      className="text-[11px] text-indigo-400 hover:underline cursor-pointer"
                    >
                      {showRewritten ? 'Hide Rewritten SQL' : 'View Rewritten SQL'}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {queryResponse.tableStats.map((stat, idx) => (
                      <div
                        key={idx}
                        className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-[11px] flex items-center gap-1.5 text-zinc-300"
                      >
                        <span className="font-mono text-indigo-400">
                          [{stat.connId}].{stat.table}
                        </span>
                        <span className="text-zinc-500">•</span>
                        <span>{stat.rowCount} rows</span>
                        <span className="text-zinc-500">({stat.elapsedMs}ms)</span>
                      </div>
                    ))}
                  </div>

                  {showRewritten && queryResponse.rewrittenSql && (
                    <div className="mt-2 p-2.5 rounded bg-zinc-900 font-mono text-[11px] text-zinc-300 border border-zinc-800 relative">
                      <div className="flex items-center justify-between mb-1 text-zinc-500">
                        <span>SQLite Rewritten Executable:</span>
                        <button
                          onClick={handleCopyRewritten}
                          className="hover:text-zinc-300 flex items-center gap-1"
                        >
                          {copiedRewritten ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          {copiedRewritten ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <pre className="overflow-x-auto whitespace-pre-wrap">{queryResponse.rewrittenSql}</pre>
                    </div>
                  )}
                </div>
              )}

              {/* Tabular Results View */}
              {queryResponse?.result && (
                <div className="flex-1 min-h-[160px] border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950 flex flex-col">
                  <div className="overflow-auto flex-1">
                    <table className="w-full text-left text-xs border-collapse font-mono">
                      <thead className="bg-zinc-900 text-zinc-300 sticky top-0 border-b border-zinc-800">
                        <tr>
                          {queryResponse.result.columns?.map((col, idx) => (
                            <th key={idx} className="px-3 py-2 font-medium border-r border-zinc-800 last:border-r-0">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                        {queryResponse.result.rows?.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-zinc-900/50">
                            {row.map((val: any, cIdx: number) => (
                              <td
                                key={cIdx}
                                className="px-3 py-1.5 whitespace-nowrap border-r border-zinc-800/40 last:border-r-0 max-w-xs truncate"
                              >
                                {val === null ? (
                                  <span className="text-zinc-600 italic">NULL</span>
                                ) : typeof val === 'boolean' ? (
                                  <span className={val ? 'text-emerald-400' : 'text-rose-400'}>{String(val)}</span>
                                ) : (
                                  String(val)
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {(!queryResponse.result.rows || queryResponse.result.rows.length === 0) && (
                          <tr>
                            <td
                              colSpan={queryResponse.result.columns?.length || 1}
                              className="px-4 py-8 text-center text-zinc-500 italic"
                            >
                              0 rows returned
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
              TAB 2: Data Pipe & Migration
          ───────────────────────────────────────────────────────────── */}
          {activeTab === 'pipe' && (
            <div className="space-y-6 max-w-3xl mx-auto py-2">
              <div className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <ArrowRightLeft className="w-4 h-4 text-indigo-400" />
                  Cross-Connection Streaming Data Pipe
                </div>
                <p className="text-xs text-zinc-400">
                  Stream data in batches between heterogeneous databases. Automatic dialect type mapping is applied between PostgreSQL, MySQL, and SQLite.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  {/* Source Configuration */}
                  <div className="space-y-3 p-3.5 rounded-lg bg-zinc-900/70 border border-zinc-800">
                    <div className="text-xs font-medium text-indigo-300 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                      Source Database
                    </div>

                    <label className="block text-xs text-zinc-400">
                      Connection
                      <select
                        value={pipeSourceConn}
                        onChange={(e) => {
                          setPipeSourceConn(e.target.value)
                          loadSourceTables(e.target.value)
                        }}
                        className="mt-1 w-full px-2.5 py-1.5 rounded-md bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs focus:outline-hidden focus:border-indigo-500"
                      >
                        {connections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label || c.name || c.id} ({c.dialect || 'db'})
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs text-zinc-400">
                        Schema (optional)
                        <input
                          type="text"
                          value={pipeSourceSchema}
                          onChange={(e) => setPipeSourceSchema(e.target.value)}
                          placeholder="public"
                          className="mt-1 w-full px-2.5 py-1.5 rounded-md bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs focus:outline-hidden focus:border-indigo-500"
                        />
                      </label>

                      <label className="block text-xs text-zinc-400">
                        Source Table
                        {sourceTables.length > 0 ? (
                          <select
                            value={pipeSourceTable}
                            onChange={(e) => {
                              setPipeSourceTable(e.target.value)
                              if (!pipeTargetTable) setPipeTargetTable(e.target.value)
                            }}
                            className="mt-1 w-full px-2.5 py-1.5 rounded-md bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs focus:outline-hidden focus:border-indigo-500"
                          >
                            <option value="">Select table...</option>
                            {sourceTables.map((t) => (
                              <option key={t.name} value={t.name}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={pipeSourceTable}
                            onChange={(e) => {
                              setPipeSourceTable(e.target.value)
                              if (!pipeTargetTable) setPipeTargetTable(e.target.value)
                            }}
                            placeholder="users"
                            className="mt-1 w-full px-2.5 py-1.5 rounded-md bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs focus:outline-hidden focus:border-indigo-500"
                          />
                        )}
                      </label>
                    </div>
                  </div>

                  {/* Target Configuration */}
                  <div className="space-y-3 p-3.5 rounded-lg bg-zinc-900/70 border border-zinc-800">
                    <div className="text-xs font-medium text-emerald-300 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      Target Database
                    </div>

                    <label className="block text-xs text-zinc-400">
                      Connection
                      <select
                        value={pipeTargetConn}
                        onChange={(e) => setPipeTargetConn(e.target.value)}
                        className="mt-1 w-full px-2.5 py-1.5 rounded-md bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs focus:outline-hidden focus:border-indigo-500"
                      >
                        {connections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label || c.name || c.id} ({c.dialect || 'db'})
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs text-zinc-400">
                        Schema (optional)
                        <input
                          type="text"
                          value={pipeTargetSchema}
                          onChange={(e) => setPipeTargetSchema(e.target.value)}
                          placeholder="public"
                          className="mt-1 w-full px-2.5 py-1.5 rounded-md bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs focus:outline-hidden focus:border-indigo-500"
                        />
                      </label>

                      <label className="block text-xs text-zinc-400">
                        Target Table
                        <input
                          type="text"
                          value={pipeTargetTable}
                          onChange={(e) => setPipeTargetTable(e.target.value)}
                          placeholder={pipeSourceTable || 'users_migrated'}
                          className="mt-1 w-full px-2.5 py-1.5 rounded-md bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs focus:outline-hidden focus:border-indigo-500"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* Options */}
                <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800 space-y-3">
                  <div className="text-xs font-medium text-zinc-300">Streaming & Schema Options</div>

                  <div className="flex flex-wrap items-center gap-6 text-xs text-zinc-300">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pipeCreateTable}
                        onChange={(e) => setPipeCreateTable(e.target.checked)}
                        className="rounded bg-zinc-800 border-zinc-700 text-indigo-600 focus:ring-0"
                      />
                      Create table if not exists
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pipeTruncateTable}
                        onChange={(e) => setPipeTruncateTable(e.target.checked)}
                        className="rounded bg-zinc-800 border-zinc-700 text-indigo-600 focus:ring-0"
                      />
                      Truncate target table before inserting
                    </label>

                    <label className="flex items-center gap-2">
                      <span className="text-zinc-400">Batch Chunk Size:</span>
                      <input
                        type="number"
                        min={50}
                        max={5000}
                        step={50}
                        value={pipeBatchSize}
                        onChange={(e) => setPipeBatchSize(Number(e.target.value))}
                        className="w-20 px-2 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 text-right text-xs"
                      />
                    </label>
                  </div>
                </div>

                {/* Error Banner */}
                {pipeError && (
                  <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>{pipeError}</div>
                  </div>
                )}

                {/* Success Summary */}
                {pipeResponse && (
                  <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-semibold text-sm">Migration Complete!</div>
                      <div>
                        Streamed <strong>{pipeResponse.rowsMigrated} rows</strong> from table{' '}
                        <code className="font-mono text-emerald-200">{pipeResponse.sourceTable}</code> to{' '}
                        <code className="font-mono text-emerald-200">{pipeResponse.targetTable}</code> in{' '}
                        <strong>{pipeResponse.elapsedMs} ms</strong>.
                      </div>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleStartPipe}
                  disabled={pipeLoading || !pipeSourceConn || !pipeSourceTable}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs shadow-md transition-colors cursor-pointer"
                >
                  {pipeLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Streaming rows across connections...
                    </>
                  ) : (
                    <>
                      <ArrowRightLeft className="w-4 h-4" />
                      Start Data Pipe Migration
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
              TAB 3: Data Reconciliation
          ───────────────────────────────────────────────────────────── */}
          {activeTab === 'reconcile' && (
            <div className="space-y-4">
              {/* Table selectors */}
              <div className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Scale className="w-4 h-4 text-indigo-400" />
                  Cross-Connection Data & Schema Reconciliation
                </div>
                <p className="text-xs text-zinc-400">
                  Compare column definitions, nullability, row counts, and data sample checksums between tables across connections.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Source */}
                  <div className="space-y-2 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 text-xs">
                    <div className="font-medium text-indigo-300">Source Table</div>
                    <select
                      value={recSourceConn}
                      onChange={(e) => setRecSourceConn(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200"
                    >
                      {connections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label || c.name || c.id}
                        </option>
                      ))}
                    </select>

                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={recSourceSchema}
                        onChange={(e) => setRecSourceSchema(e.target.value)}
                        placeholder="Schema (public)"
                        className="px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200"
                      />
                      <input
                        type="text"
                        value={recSourceTable}
                        onChange={(e) => {
                          setRecSourceTable(e.target.value)
                          if (!recTargetTable) setRecTargetTable(e.target.value)
                        }}
                        placeholder="Table name"
                        className="px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200"
                      />
                    </div>
                  </div>

                  {/* Target */}
                  <div className="space-y-2 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 text-xs">
                    <div className="font-medium text-emerald-300">Target Table</div>
                    <select
                      value={recTargetConn}
                      onChange={(e) => setRecTargetConn(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200"
                    >
                      {connections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label || c.name || c.id}
                        </option>
                      ))}
                    </select>

                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={recTargetSchema}
                        onChange={(e) => setRecTargetSchema(e.target.value)}
                        placeholder="Schema (public)"
                        className="px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200"
                      />
                      <input
                        type="text"
                        value={recTargetTable}
                        onChange={(e) => setRecTargetTable(e.target.value)}
                        placeholder={recSourceTable || 'Table name'}
                        className="px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-zinc-400">
                    <span>Sample Rows to Hash/Diff:</span>
                    <input
                      type="number"
                      min={10}
                      max={500}
                      value={recSampleLimit}
                      onChange={(e) => setRecSampleLimit(Number(e.target.value))}
                      className="w-20 px-2 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 text-right text-xs"
                    />
                  </label>

                  <button
                    onClick={handleStartReconcile}
                    disabled={recLoading || !recSourceConn || !recSourceTable}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs shadow-sm transition-colors cursor-pointer"
                  >
                    {recLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}
                    Reconcile Tables
                  </button>
                </div>

                {recError && (
                  <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>{recError}</div>
                  </div>
                )}
              </div>

              {/* Reconciliation Results */}
              {recResponse && (
                <div className="space-y-4">
                  {/* Status Banner */}
                  {(() => {
                    const statusInfo = formatReconcileStatus(recResponse.status)
                    return (
                      <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${statusInfo.badgeClass}`}>
                        <div>
                          <div className="text-sm font-bold tracking-tight">{statusInfo.label}</div>
                          <div className="text-xs opacity-90 mt-0.5">{statusInfo.description}</div>
                        </div>

                        <div className="text-right text-xs opacity-80 shrink-0">
                          Elapsed: {recResponse.elapsedMs} ms
                        </div>
                      </div>
                    )
                  })()}

                  {/* Summary Metrics */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-lg bg-zinc-950/70 border border-zinc-800 space-y-1">
                      <div className="text-[11px] text-zinc-400 uppercase font-medium">Source Row Count</div>
                      <div className="text-xl font-bold text-white font-mono">{recResponse.sourceRowCount}</div>
                      <div className="text-[11px] text-zinc-500 truncate">{recResponse.sourceTable}</div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-zinc-950/70 border border-zinc-800 space-y-1">
                      <div className="text-[11px] text-zinc-400 uppercase font-medium">Target Row Count</div>
                      <div className="text-xl font-bold text-white font-mono">{recResponse.targetRowCount}</div>
                      <div className="text-[11px] text-zinc-500 truncate">{recResponse.targetTable}</div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-zinc-950/70 border border-zinc-800 space-y-1">
                      <div className="text-[11px] text-zinc-400 uppercase font-medium">Row Count Difference</div>
                      <div
                        className={`text-xl font-bold font-mono ${
                          recResponse.rowCountDiff === 0 ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {recResponse.rowCountDiff > 0 ? `+${recResponse.rowCountDiff}` : recResponse.rowCountDiff}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {recResponse.rowCountDiff === 0 ? 'Exact row parity' : 'Count mismatch'}
                      </div>
                    </div>
                  </div>

                  {/* Column Schema Comparison Table */}
                  <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950">
                    <div className="px-3.5 py-2 bg-zinc-900 border-b border-zinc-800 text-xs font-medium text-zinc-300 flex items-center justify-between">
                      <span>Column Schema Parity</span>
                      <span className="text-zinc-500 text-[11px]">
                        {recResponse.columnComparison?.length || 0} columns evaluated
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-zinc-900/50 text-zinc-400 border-b border-zinc-800">
                          <tr>
                            <th className="px-3 py-2">Column</th>
                            <th className="px-3 py-2">Source Type</th>
                            <th className="px-3 py-2">Target Type</th>
                            <th className="px-3 py-2">Source Nullable</th>
                            <th className="px-3 py-2">Target Nullable</th>
                            <th className="px-3 py-2 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/60">
                          {recResponse.columnComparison?.map((col, idx) => (
                            <tr key={idx} className="hover:bg-zinc-900/40">
                              <td className="px-3 py-2 font-semibold text-zinc-200">{col.name}</td>
                              <td className="px-3 py-2 text-zinc-400">{col.sourceType || '—'}</td>
                              <td className="px-3 py-2 text-zinc-400">{col.targetType || '—'}</td>
                              <td className="px-3 py-2 text-zinc-400">{col.sourceNullable ? 'YES' : 'NO'}</td>
                              <td className="px-3 py-2 text-zinc-400">{col.targetNullable ? 'YES' : 'NO'}</td>
                              <td className="px-3 py-2 text-right">
                                {col.match ? (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                    MATCH
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/15 text-rose-400 border border-rose-500/30">
                                    {col.status}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Sample Mismatch Diffs if any */}
                  {recResponse.sampleDiffs && recResponse.sampleDiffs.length > 0 && (
                    <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950 p-3.5 space-y-2">
                      <div className="text-xs font-medium text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" />
                        Sample Row Content Differences ({recResponse.sampleMismatched} rows mismatched)
                      </div>

                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {recResponse.sampleDiffs.map((diff, dIdx) => (
                          <div key={dIdx} className="p-2.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] font-mono space-y-1">
                            <div className="text-zinc-400 font-semibold">
                              Sample Row #{diff.rowIndex + 1} • Differing Columns: {diff.diffCols.join(', ')}
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-zinc-300">
                              <div className="p-1.5 rounded bg-zinc-950 text-indigo-300">
                                <strong>Source:</strong> {JSON.stringify(diff.source)}
                              </div>
                              <div className="p-1.5 rounded bg-zinc-950 text-emerald-300">
                                <strong>Target:</strong> {JSON.stringify(diff.target)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
