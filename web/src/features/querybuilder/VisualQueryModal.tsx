import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  X,
  Play,
  Save,
  FolderOpen,
  RotateCcw,
  Table as TableIcon,
  Search,
  Plus,
  ArrowRight,
  Filter,
  ArrowUpDown,
  TableProperties,
  Sparkles,
  Loader2,
  Trash2,
  Check,
} from 'lucide-react'
import { VisualQueryCanvas } from './VisualQueryCanvas'
import { FilterRack } from './FilterRack'
import { AggregateRack } from './AggregateRack'
import { LiveSqlPreviewPane } from './LiveSqlPreviewPane'
import { useQueryBuilder } from './useQueryBuilder'
import { generateClientSQL, validateCanvas } from './queryBuilderHelper'
import {
  api,
  type TableMeta,
  type ERDTable,
  type SavedVisualQuery,
  type QueryResult,
} from '../../lib/api'

interface VisualQueryModalProps {
  isOpen: boolean
  onClose: () => void
  connId: string
  currentDialect?: string
  tables: (TableMeta | ERDTable)[]
  onSendToEditor: (sql: string) => void
}

type ActiveTab = 'canvas' | 'filters' | 'aggregates' | 'results'

export const VisualQueryModal: React.FC<VisualQueryModalProps> = ({
  isOpen,
  onClose,
  connId,
  currentDialect = 'postgres',
  tables,
  onSendToEditor,
}) => {
  const qb = useQueryBuilder()
  const [queryName, setQueryName] = useState('New Visual Query')
  const [queryId, setQueryId] = useState<string | undefined>()
  const [activeTab, setActiveTab] = useState<ActiveTab>('canvas')
  const [dialect, setDialect] = useState(currentDialect || 'postgres')
  const [tableSearch, setTableSearch] = useState('')

  // Saved queries drawer
  const [isSavedDrawerOpen, setIsSavedDrawerOpen] = useState(false)
  const [savedQueries, setSavedQueries] = useState<SavedVisualQuery[]>([])
  const [isLoadingSaved, setIsLoadingSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Execution & Server SQL
  const [isRunning, setIsRunning] = useState(false)
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [serverSql, setServerSql] = useState<string | null>(null)
  const [serverWarnings, setServerWarnings] = useState<string[]>([])
  const [execError, setExecError] = useState<string | null>(null)

  // Sync dialect when prop changes
  useEffect(() => {
    if (currentDialect) {
      setDialect(currentDialect)
    }
  }, [currentDialect])

  // Generate live client preview
  const liveSql = useMemo(() => {
    return generateClientSQL(qb.state, dialect)
  }, [qb.state, dialect])

  const validation = useMemo(() => {
    return validateCanvas(qb.state)
  }, [qb.state])

  // Fetch server-generated SQL on debounce
  useEffect(() => {
    if (qb.state.tables.length === 0) {
      setServerSql(null)
      setServerWarnings([])
      return
    }

    const timer = setTimeout(async () => {
      try {
        const res = await api.generateVisualQuery(connId, qb.state, dialect)
        if (res?.sql) {
          setServerSql(res.sql)
          setServerWarnings(res.warnings || [])
        }
      } catch {
        // fallback to liveSql if backend generation fails or conn unavailable
      }
    }, 400)

    return () => clearTimeout(timer)
  }, [qb.state, dialect, connId])

  // Load saved queries
  const loadSavedQueriesList = useCallback(async () => {
    setIsLoadingSaved(true)
    try {
      const list = await api.listSavedVisualQueries(connId)
      setSavedQueries(list)
    } catch {
      // ignore
    } finally {
      setIsLoadingSaved(false)
    }
  }, [connId])

  useEffect(() => {
    if (isOpen) {
      loadSavedQueriesList()
    }
  }, [isOpen, loadSavedQueriesList])

  // Save current query
  const handleSave = async () => {
    setIsSaving(true)
    try {
      const saved = await api.saveVisualQuery(
        {
          id: queryId,
          name: queryName,
          connectionId: connId,
          state: qb.state,
          sql: serverSql || liveSql,
        },
        connId
      )
      if (saved?.id) {
        setQueryId(saved.id)
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2000)
        loadSavedQueriesList()
      }
    } catch (err: any) {
      setExecError(err.message || 'Failed to save query')
    } finally {
      setIsSaving(false)
    }
  }

  // Load a saved query
  const handleSelectSaved = (saved: SavedVisualQuery) => {
    setQueryId(saved.id)
    setQueryName(saved.name)
    if (saved.state) {
      qb.loadState(saved.state)
    }
    setIsSavedDrawerOpen(false)
  }

  // Delete saved query
  const handleDeleteSaved = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await api.deleteSavedVisualQuery(id, connId)
      loadSavedQueriesList()
      if (queryId === id) {
        setQueryId(undefined)
      }
    } catch {
      // ignore
    }
  }

  // Run visual query
  const handleRunQuery = async () => {
    const finalSql = serverSql || liveSql
    if (!finalSql || finalSql.startsWith('--')) return

    setIsRunning(true)
    setExecError(null)
    setActiveTab('results')

    try {
      const res = await api.runVisualQuery(connId, {
        state: qb.state,
        sql: finalSql,
        dialect,
      })
      if (res?.result) {
        setQueryResult(res.result)
      }
    } catch (err: any) {
      setExecError(err.message || 'Query execution failed')
    } finally {
      setIsRunning(false)
    }
  }

  // Send to SQL Console
  const handleSendToEditor = () => {
    const finalSql = serverSql || liveSql
    onSendToEditor(finalSql)
    onClose()
  }

  // Filter available tables
  const filteredTables = useMemo(() => {
    return tables.filter((t) =>
      t.name.toLowerCase().includes(tableSearch.toLowerCase())
    )
  }, [tables, tableSearch])

  // Drag table onto canvas
  const handleTableDragStart = (e: React.DragEvent, tableName: string) => {
    e.dataTransfer.setData('application/dblens-table', tableName)
    e.dataTransfer.effectAllowed = 'move'
  }

  if (!isOpen) return null

  const displaySql = serverSql || liveSql

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-hidden animate-in fade-in duration-150">
      <div className="bg-[#12141a] text-[var(--fg)] border border-[var(--border)] rounded-xl shadow-2xl w-full h-[94vh] max-w-[96vw] flex flex-col overflow-hidden">
        {/* Top Studio Header */}
        <div className="bg-[#161820] border-b border-[var(--border)] px-4 py-2.5 flex items-center justify-between gap-4 shrink-0">
          {/* Query Name & Title */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              <input
                type="text"
                value={queryName}
                onChange={(e) => setQueryName(e.target.value)}
                placeholder="Query Name..."
                className="bg-transparent font-semibold text-white text-sm outline-none border-b border-transparent hover:border-white/20 focus:border-indigo-500 transition-colors px-1 py-0.5"
              />
            </div>

            <div className="h-4 w-px bg-white/10" />

            {/* Save Button */}
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-[var(--surface)] hover:bg-[var(--hover)] text-white border border-[var(--border)] transition-colors cursor-pointer"
            >
              {saveSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Saved</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{isSaving ? 'Saving...' : 'Save'}</span>
                </>
              )}
            </button>

            {/* Saved Queries Drawer Toggle */}
            <button
              type="button"
              onClick={() => setIsSavedDrawerOpen(!isSavedDrawerOpen)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-[var(--surface)] hover:bg-[var(--hover)] text-[var(--fg)] border border-[var(--border)] transition-colors cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
              <span>Saved ({savedQueries.length})</span>
            </button>

            {/* Reset Canvas */}
            <button
              type="button"
              onClick={() => {
                if (confirm('Clear canvas and reset all visual query tables?')) {
                  qb.reset()
                  setQueryId(undefined)
                  setQueryResult(null)
                  setExecError(null)
                }
              }}
              className="text-[var(--muted)] hover:text-white p-1 rounded transition-colors cursor-pointer"
              title="Reset Canvas"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSendToEditor}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--surface)] hover:bg-[var(--hover)] text-indigo-300 border border-indigo-500/30 font-medium transition-colors cursor-pointer"
              title="Send SQL to SQL Editor"
            >
              <span>Send to SQL Editor</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleRunQuery}
              disabled={isRunning || qb.state.tables.length === 0}
              className="btn-primary flex items-center gap-1.5 text-xs px-3.5 py-1.5 disabled:opacity-40"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Run Query</span>
                </>
              )}
            </button>

            <div className="h-4 w-px bg-white/10" />

            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-[var(--muted)] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Close Visual Query Builder"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Studio Body */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Left Sidebar: Schema Tables */}
          <div className="w-64 border-r border-[var(--border)] bg-[#14161d] flex flex-col shrink-0 select-none">
            <div className="p-2.5 border-b border-[var(--border)] flex items-center justify-between">
              <span className="font-semibold text-white text-xs">Tables ({tables.length})</span>
            </div>

            <div className="p-2 border-b border-[var(--border)]">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-[var(--muted)] absolute left-2 pointer-events-none" />
                <input
                  type="text"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Filter tables..."
                  className="w-full pl-7 pr-2 py-1 text-xs bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--fg)] outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-white/5 p-1">
              {filteredTables.map((t) => {
                const isAdded = qb.state.tables.some((st) => st.name === t.name)
                return (
                  <div
                    key={t.name}
                    draggable
                    onDragStart={(e) => handleTableDragStart(e, t.name)}
                    onClick={() => qb.addTable(t)}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-white/5 cursor-pointer transition-colors group"
                    title={`Click or drag to add ${t.name} to canvas`}
                  >
                    <div className="flex items-center gap-2 overflow-hidden flex-1">
                      <TableIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span className="truncate text-xs text-[var(--fg)] group-hover:text-white">
                        {t.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isAdded && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="On Canvas" />
                      )}
                      <span className="text-[10px] text-[var(--muted)] font-mono">
                        {t.columns?.length || 0}
                      </span>
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 text-indigo-300"
                        title="Add to canvas"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )
              })}

              {filteredTables.length === 0 && (
                <div className="p-4 text-center text-xs text-[var(--muted)]">
                  No tables match '{tableSearch}'
                </div>
              )}
            </div>
          </div>

          {/* Center Main Stage */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* View Tabs */}
            <div className="bg-[#15171e] border-b border-[var(--border)] px-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('canvas')}
                  className={`px-3 py-2 text-xs font-medium border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
                    activeTab === 'canvas'
                      ? 'border-indigo-500 text-white font-semibold'
                      : 'border-transparent text-[var(--muted)] hover:text-white'
                  }`}
                >
                  <TableProperties className="w-3.5 h-3.5" />
                  <span>Visual Canvas</span>
                  {qb.state.tables.length > 0 && (
                    <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300">
                      {qb.state.tables.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('filters')}
                  className={`px-3 py-2 text-xs font-medium border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
                    activeTab === 'filters'
                      ? 'border-indigo-500 text-white font-semibold'
                      : 'border-transparent text-[var(--muted)] hover:text-white'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>WHERE Filters</span>
                  {(qb.state.filters || []).length > 0 && (
                    <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300">
                      {qb.state.filters?.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('aggregates')}
                  className={`px-3 py-2 text-xs font-medium border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
                    activeTab === 'aggregates'
                      ? 'border-indigo-500 text-white font-semibold'
                      : 'border-transparent text-[var(--muted)] hover:text-white'
                  }`}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span>Modifiers & Sort</span>
                  {((qb.state.orderBy?.length || 0) > 0 || (qb.state.havings?.length || 0) > 0) && (
                    <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300">
                      {(qb.state.orderBy?.length || 0) + (qb.state.havings?.length || 0)}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('results')}
                  className={`px-3 py-2 text-xs font-medium border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
                    activeTab === 'results'
                      ? 'border-indigo-500 text-white font-semibold'
                      : 'border-transparent text-[var(--muted)] hover:text-white'
                  }`}
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Query Results</span>
                  {queryResult && (
                    <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300">
                      {queryResult.rows.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Status Indicator */}
              <div className="text-[11px] text-[var(--muted)] flex items-center gap-2">
                {validation.warnings.length > 0 && (
                  <span className="text-amber-400 text-[10px]">
                    ⚠️ {validation.warnings[0]}
                  </span>
                )}
              </div>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-hidden relative">
              {activeTab === 'canvas' && (
                <VisualQueryCanvas
                  state={qb.state}
                  onRemoveTable={qb.removeTable}
                  onToggleColumn={qb.toggleColumn}
                  onSelectAll={qb.selectAll}
                  onSetAggregate={qb.setAggregate}
                  onSetColAlias={qb.setColAlias}
                  onSetTblAlias={qb.setTblAlias}
                  onUpdatePosition={qb.updatePosition}
                  onConnectJoin={qb.connectJoin}
                  onChangeJoinType={qb.changeJoinType}
                  onDeleteJoin={qb.deleteJoin}
                  onAddTable={qb.addTable}
                  availableTables={tables}
                />
              )}

              {activeTab === 'filters' && (
                <div className="h-full overflow-y-auto bg-[#0f1117]">
                  <FilterRack
                    state={qb.state}
                    onAddFilter={qb.addFilter}
                    onUpdateFilter={qb.updateFilter}
                    onRemoveFilter={qb.removeFilter}
                  />
                </div>
              )}

              {activeTab === 'aggregates' && (
                <div className="h-full overflow-y-auto bg-[#0f1117]">
                  <AggregateRack
                    state={qb.state}
                    onAddHaving={qb.addHaving}
                    onUpdateHaving={qb.updateHaving}
                    onRemoveHaving={qb.removeHaving}
                    onAddOrderBy={qb.addOrderBy}
                    onUpdateOrderBy={qb.updateOrderBy}
                    onRemoveOrderBy={qb.removeOrderBy}
                    onSetDistinct={qb.setDistinct}
                    onSetLimit={qb.setLimit}
                    onSetOffset={qb.setOffset}
                  />
                </div>
              )}

              {activeTab === 'results' && (
                <div className="h-full overflow-auto bg-[#0f1117] p-4 flex flex-col">
                  {execError && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded mb-3 text-xs">
                      {execError}
                    </div>
                  )}

                  {isRunning ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-indigo-400">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span className="text-xs">Executing visual query...</span>
                    </div>
                  ) : queryResult ? (
                    <div className="flex flex-col flex-1">
                      <div className="text-[11px] text-[var(--muted)] mb-2 flex items-center justify-between">
                        <span>
                          {queryResult.rows.length} rows returned ({queryResult.durationMs}ms)
                        </span>
                      </div>
                      <div className="border border-[var(--border)] rounded-md overflow-auto max-h-[60vh]">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="bg-[#181a22] text-white sticky top-0 border-b border-[var(--border)]">
                            <tr>
                              {queryResult.columns.map((col) => (
                                <th key={col} className="p-2 font-mono font-semibold">
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                            {queryResult.rows.map((row, ri) => (
                              <tr key={ri} className="hover:bg-white/[0.02]">
                                {queryResult.columns.map((col) => (
                                  <td key={col} className="p-2 text-[var(--fg)] truncate max-w-[200px]">
                                    {row[col] !== undefined && row[col] !== null
                                      ? String(row[col])
                                      : 'NULL'}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--muted)]">
                      <Play className="w-8 h-8 opacity-30 text-indigo-400" />
                      <p className="text-xs">Run your query to preview executed database results.</p>
                      <button
                        type="button"
                        onClick={handleRunQuery}
                        disabled={qb.state.tables.length === 0}
                        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs mt-2 disabled:opacity-40 cursor-pointer"
                      >
                        Run Query Now
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Pane: Live SQL Preview */}
          <div className="w-96 shrink-0 flex flex-col">
            <LiveSqlPreviewPane
              sql={displaySql}
              dialect={dialect}
              onDialectChange={setDialect}
              onRunQuery={handleRunQuery}
              onSendToEditor={handleSendToEditor}
              isRunning={isRunning}
              warnings={serverWarnings}
              error={execError}
            />
          </div>

          {/* Saved Queries Drawer Overlay */}
          {isSavedDrawerOpen && (
            <div className="absolute inset-y-0 left-64 w-80 bg-[#161820] border-r border-[var(--border)] shadow-2xl z-40 flex flex-col font-sans text-xs">
              <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
                <span className="font-semibold text-white">Saved Visual Queries</span>
                <button
                  type="button"
                  onClick={() => setIsSavedDrawerOpen(false)}
                  className="text-[var(--muted)] hover:text-white p-1 rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-2 divide-y divide-white/5">
                {isLoadingSaved ? (
                  <div className="p-4 text-center text-[var(--muted)]">Loading...</div>
                ) : savedQueries.length === 0 ? (
                  <div className="p-6 text-center text-[var(--muted)]">
                    No saved queries yet. Click "Save" in the toolbar to save your visual design.
                  </div>
                ) : (
                  savedQueries.map((saved) => (
                    <div
                      key={saved.id}
                      onClick={() => handleSelectSaved(saved)}
                      className="p-2.5 rounded hover:bg-white/5 cursor-pointer transition-colors group flex items-start justify-between gap-2"
                    >
                      <div className="flex-1 overflow-hidden">
                        <div className="font-medium text-white truncate text-xs">
                          {saved.name}
                        </div>
                        {saved.description && (
                          <div className="text-[10px] text-[var(--muted)] truncate">
                            {saved.description}
                          </div>
                        )}
                        <div className="text-[9px] text-[var(--muted)] font-mono mt-1">
                          {saved.state?.tables?.length || 0} tables · {saved.state?.joins?.length || 0} joins
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => handleDeleteSaved(saved.id!, e)}
                        className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-rose-400 p-1 rounded transition-colors"
                        title="Delete saved query"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
