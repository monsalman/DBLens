import React, { useState, useEffect, useMemo, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  X,
  Zap,
  Play,
  RefreshCw,
  Search,
  Code2,
  Eye,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  Shield,
  Plus,
  ToggleLeft,
  ToggleRight,
  Database,
  Terminal,
  Activity,
  Save,
} from 'lucide-react'
import {
  api,
  type RoutineItem,
  type TriggerItem,
  type ViewItem,
  type InvokeRoutineResponse,
} from '../../lib/api'
import {
  filterRoutines,
  filterTriggers,
  filterViews,
  formatRoutineSignature,
  parseParamValues,
  groupTriggersByTable,
  generateRoutineTemplate,
  getTimingBadgeClass,
  getEventBadgeClass,
} from './routineHelper'
import { useAppStore } from '../../stores/appStore'

interface Props {
  isOpen?: boolean
  onClose?: () => void
}

export const RoutineStudioModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const storeIsOpen = useAppStore((s) => s.isRoutineStudioOpen)
  const setStoreIsOpen = useAppStore((s) => s.setIsRoutineStudioOpen)
  const initialTab = useAppStore((s) => s.routineStudioInitialTab)
  const activeConnId = useAppStore((s) => s.activeConnectionId)
  const connections = useAppStore((s) => s.connections)
  const selectedSchema = useAppStore((s) => s.selectedSchema) || 'public'
  const isSafeModeActive = useAppStore((s) => s.isSafeModeActive)
  const openDryRunModal = useAppStore((s) => s.openDryRunModal)

  const show = isOpen !== undefined ? isOpen : storeIsOpen
  const handleClose = () => {
    if (onClose) onClose()
    else setStoreIsOpen(false)
  }

  const activeConn = useMemo(
    () => connections.find((c) => c.id === activeConnId),
    [connections, activeConnId]
  )
  const dialect = activeConn?.dialect || 'postgres'
  const isReadOnly = Boolean(activeConn?.readOnly || (activeConnId && isSafeModeActive(activeConnId)))
  const isDark = typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true

  // Active Tab
  const [activeTab, setActiveTab] = useState<'routines' | 'triggers' | 'views'>('routines')
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab])

  // Shared state
  const [search, setSearch] = useState('')
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [copied, setCopied] = useState(false)

  // Routines state
  const [routines, setRoutines] = useState<RoutineItem[]>([])
  const [selectedRoutine, setSelectedRoutine] = useState<RoutineItem | null>(null)
  const [routineTypeFilter, setRoutineTypeFilter] = useState<'ALL' | 'PROCEDURE' | 'FUNCTION'>('ALL')
  const [editorDdl, setEditorDdl] = useState('')
  const [isEditingDdl, setIsEditingDdl] = useState(false)
  const [paramInputs, setParamInputs] = useState<Record<string, string>>({})
  const [invokeResult, setInvokeResult] = useState<InvokeRoutineResponse | null>(null)
  const [invoking, setInvoking] = useState(false)
  const [loadingRoutines, setLoadingRoutines] = useState(false)

  // Triggers state
  const [triggers, setTriggers] = useState<TriggerItem[]>([])
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerItem | null>(null)
  const [triggerTableFilter, setTriggerTableFilter] = useState('ALL')
  const [loadingTriggers, setLoadingTriggers] = useState(false)

  // Views state
  const [views, setViews] = useState<ViewItem[]>([])
  const [selectedView, setSelectedView] = useState<ViewItem | null>(null)
  const [matOnly, setMatOnly] = useState(false)
  const [loadingViews, setLoadingViews] = useState(false)
  const [refreshingView, setRefreshingView] = useState(false)
  const [concurrentRefresh, setConcurrentRefresh] = useState(false)

  const showStatus = (text: string, type: 'success' | 'error' = 'success') => {
    setStatusMessage({ text, type })
    setTimeout(() => setStatusMessage(null), 4000)
  }

  // Fetch Routines
  const fetchRoutines = useCallback(async () => {
    if (!activeConnId) return
    setLoadingRoutines(true)
    try {
      const data = await api.getRoutines(activeConnId, undefined, connections)
      setRoutines(data)
      if (data.length > 0 && !selectedRoutine) {
        setSelectedRoutine(data[0])
        setEditorDdl(data[0].definition || '')
      }
    } catch (err: any) {
      showStatus(err.message || 'Failed to load routines', 'error')
    } finally {
      setLoadingRoutines(false)
    }
  }, [activeConnId, connections, selectedRoutine])

  // Fetch Triggers
  const fetchTriggers = useCallback(async () => {
    if (!activeConnId) return
    setLoadingTriggers(true)
    try {
      const data = await api.getTriggers(activeConnId, undefined, undefined, connections)
      setTriggers(data)
      if (data.length > 0 && !selectedTrigger) {
        setSelectedTrigger(data[0])
      }
    } catch (err: any) {
      showStatus(err.message || 'Failed to load triggers', 'error')
    } finally {
      setLoadingTriggers(false)
    }
  }, [activeConnId, connections, selectedTrigger])

  // Fetch Views
  const fetchViews = useCallback(async () => {
    if (!activeConnId) return
    setLoadingViews(true)
    try {
      const data = await api.getViews(activeConnId, undefined, connections)
      setViews(data)
      if (data.length > 0 && !selectedView) {
        setSelectedView(data[0])
      }
    } catch (err: any) {
      showStatus(err.message || 'Failed to load views', 'error')
    } finally {
      setLoadingViews(false)
    }
  }, [activeConnId, connections, selectedView])

  // Initial tab loading
  useEffect(() => {
    if (!show || !activeConnId) return
    if (activeTab === 'routines') fetchRoutines()
    else if (activeTab === 'triggers') fetchTriggers()
    else if (activeTab === 'views') fetchViews()
  }, [show, activeConnId, activeTab, fetchRoutines, fetchTriggers, fetchViews])

  // When selected routine changes, load its definition and reset invocation
  const handleSelectRoutine = (r: RoutineItem) => {
    setSelectedRoutine(r)
    setEditorDdl(r.definition || '')
    setIsEditingDdl(false)
    setInvokeResult(null)
    const initialParams: Record<string, string> = {}
    ;(r.arguments || []).forEach((arg, idx) => {
      const key = arg.name || `param_${idx + 1}`
      initialParams[key] = arg.defaultValue || ''
    })
    setParamInputs(initialParams)
  }

  // Handle Routine Invocation
  const handleInvokeRoutine = async () => {
    if (!activeConnId || !selectedRoutine) return
    setInvoking(true)
    setInvokeResult(null)
    try {
      const parsedArgs = parseParamValues(paramInputs, selectedRoutine.arguments || [])
      const res = await api.invokeRoutine(
        activeConnId,
        {
          schema: selectedRoutine.schema,
          name: selectedRoutine.name,
          routineType: selectedRoutine.routineType,
          parameters: parsedArgs,
        },
        connections
      )
      setInvokeResult(res)
      showStatus(res.message || 'Routine executed successfully')
    } catch (err: any) {
      showStatus(err.message || 'Invocation failed', 'error')
    } finally {
      setInvoking(false)
    }
  }

  // Handle Save Routine
  const handleSaveRoutine = async () => {
    if (!activeConnId || !editorDdl.trim()) return
    if (isReadOnly) {
      showStatus('Connection is read-only. Mutation blocked by Safe Mode.', 'error')
      return
    }

    try {
      await api.saveRoutine(activeConnId, editorDdl, connections)
      showStatus('Routine saved successfully')
      setIsEditingDdl(false)
      await fetchRoutines()
    } catch (err: any) {
      showStatus(err.message || 'Failed to save routine', 'error')
    }
  }

  // Handle Drop Routine
  const handleDeleteRoutine = (r: RoutineItem) => {
    if (!activeConnId) return
    if (isReadOnly) {
      showStatus('Connection is read-only. Deletion blocked by Safe Mode.', 'error')
      return
    }

    openDryRunModal(
      `Drop ${r.routineType} ${r.schema}.${r.name}`,
      `DROP ${r.routineType} IF EXISTS "${r.schema}"."${r.name}";`,
      async () => {
        try {
          await api.deleteRoutine(activeConnId, r.schema, r.name, r.routineType, connections)
          showStatus(`${r.routineType} ${r.name} dropped successfully`)
          setSelectedRoutine(null)
          await fetchRoutines()
        } catch (err: any) {
          showStatus(err.message || 'Failed to drop routine', 'error')
        }
      },
      true
    )
  }

  // Handle Trigger Toggle
  const handleToggleTrigger = async (t: TriggerItem) => {
    if (!activeConnId) return
    if (isReadOnly) {
      showStatus('Connection is read-only. Trigger toggle blocked by Safe Mode.', 'error')
      return
    }

    const nextState = !t.enabled
    try {
      await api.toggleTrigger(
        activeConnId,
        {
          schema: t.schema,
          table: t.tableName,
          name: t.name,
          enabled: nextState,
        },
        connections
      )
      // Optimistic update
      setTriggers((prev) =>
        prev.map((item) => (item.name === t.name ? { ...item, enabled: nextState } : item))
      )
      if (selectedTrigger?.name === t.name) {
        setSelectedTrigger({ ...selectedTrigger, enabled: nextState })
      }
      showStatus(`Trigger ${t.name} ${nextState ? 'enabled' : 'disabled'}`)
    } catch (err: any) {
      showStatus(err.message || 'Failed to toggle trigger', 'error')
    }
  }

  // Handle Drop Trigger
  const handleDeleteTrigger = (t: TriggerItem) => {
    if (!activeConnId) return
    if (isReadOnly) {
      showStatus('Connection is read-only. Mutation blocked by Safe Mode.', 'error')
      return
    }

    openDryRunModal(
      `Drop Trigger ${t.name} on ${t.tableName}`,
      `DROP TRIGGER IF EXISTS "${t.name}" ON "${t.schema}"."${t.tableName}";`,
      async () => {
        try {
          await api.deleteTrigger(activeConnId, t.schema, t.name, t.tableName, connections)
          showStatus(`Trigger ${t.name} dropped successfully`)
          setSelectedTrigger(null)
          await fetchTriggers()
        } catch (err: any) {
          showStatus(err.message || 'Failed to drop trigger', 'error')
        }
      },
      true
    )
  }

  // Handle Refresh View
  const handleRefreshView = async (v: ViewItem) => {
    if (!activeConnId) return
    if (isReadOnly) {
      showStatus('Connection is read-only. Action blocked by Safe Mode.', 'error')
      return
    }

    setRefreshingView(true)
    try {
      await api.refreshView(
        activeConnId,
        {
          schema: v.schema,
          name: v.name,
          concurrently: concurrentRefresh,
        },
        connections
      )
      showStatus(`Materialized view ${v.name} refreshed successfully`)
    } catch (err: any) {
      showStatus(err.message || 'Failed to refresh view', 'error')
    } finally {
      setRefreshingView(false)
    }
  }

  // New routine template scaffold
  const handleNewRoutine = (type: 'PROCEDURE' | 'FUNCTION') => {
    const template = generateRoutineTemplate(dialect, type, `new_${type.toLowerCase()}`, selectedSchema)
    setEditorDdl(template)
    setIsEditingDdl(true)
    setSelectedRoutine(null)
  }

  // Copy helper
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Filtered lists
  const filteredRoutines = useMemo(
    () => filterRoutines(routines, search, routineTypeFilter),
    [routines, search, routineTypeFilter]
  )
  const filteredTriggers = useMemo(
    () => filterTriggers(triggers, search, triggerTableFilter),
    [triggers, search, triggerTableFilter]
  )
  const filteredViews = useMemo(
    () => filterViews(views, search, matOnly),
    [views, search, matOnly]
  )
  const triggerTables = useMemo(() => {
    const set = new Set<string>()
    triggers.forEach((t) => set.add(t.tableName))
    return Array.from(set).sort()
  }, [triggers])
  const groupedTriggers = useMemo(() => groupTriggersByTable(filteredTriggers), [filteredTriggers])

  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl w-full max-w-6xl shadow-2xl flex flex-col h-[90vh] overflow-hidden text-[var(--fg)] text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] bg-[var(--card)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-[var(--fg)]">
                  Routine, View & Trigger Studio
                </h2>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20 uppercase">
                  {dialect}
                </span>
                {isReadOnly && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                    <Shield className="w-3 h-3" />
                    Read-Only Mode
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--muted)] mt-0.5">
                Inspect, test, and manage stored procedures, user-defined functions, triggers, and views
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Main Tabs */}
            <div className="flex items-center bg-[var(--surface)] p-0.5 rounded-lg border border-[var(--border)]">
              <button
                onClick={() => {
                  setActiveTab('routines')
                  setSearch('')
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  activeTab === 'routines'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                Routines & Procedures ({routines.length})
              </button>
              <button
                onClick={() => {
                  setActiveTab('triggers')
                  setSearch('')
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  activeTab === 'triggers'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                Triggers ({triggers.length})
              </button>
              <button
                onClick={() => {
                  setActiveTab('views')
                  setSearch('')
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  activeTab === 'views'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Views & Materialized ({views.length})
              </button>
            </div>

            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status Toast Banner */}
        {statusMessage && (
          <div
            className={`px-4 py-2 border-b text-xs flex items-center gap-2 shrink-0 ${
              statusMessage.type === 'error'
                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            }`}
          >
            {statusMessage.type === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate">{statusMessage.text}</span>
          </div>
        )}

        {/* Body Content */}
        <div className="flex-1 overflow-hidden flex flex-row">
          {/* ════════════════════════════════════════════════════════════════════
              TAB 1: ROUTINES & PROCEDURES
          ════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'routines' && (
            <div className="flex-1 flex overflow-hidden">
              {/* Left Column: List & Filters */}
              <div className="w-80 border-r border-[var(--border)] flex flex-col bg-[var(--surface)]/20 shrink-0">
                <div className="p-3 border-b border-[var(--border)] space-y-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--muted)]" />
                    <input
                      type="text"
                      placeholder="Search routines..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md pl-8 pr-3 py-1.5 text-xs text-[var(--fg)] focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-1">
                    <div className="flex bg-[var(--bg)] p-0.5 rounded border border-[var(--border)] text-[10px]">
                      {(['ALL', 'PROCEDURE', 'FUNCTION'] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setRoutineTypeFilter(t)}
                          className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                            routineTypeFilter === t
                              ? 'bg-purple-600 text-white font-semibold'
                              : 'text-[var(--muted)] hover:text-[var(--fg)]'
                          }`}
                        >
                          {t === 'ALL' ? 'All' : t === 'PROCEDURE' ? 'Proc' : 'Func'}
                        </button>
                      ))}
                    </div>

                    {!isReadOnly && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleNewRoutine('FUNCTION')}
                          className="px-2 py-1 bg-purple-600/10 text-purple-400 border border-purple-500/20 hover:bg-purple-600/20 rounded flex items-center gap-1 text-[10px] cursor-pointer"
                          title="New Function"
                        >
                          <Plus className="w-3 h-3" /> Func
                        </button>
                        <button
                          onClick={() => handleNewRoutine('PROCEDURE')}
                          className="px-2 py-1 bg-blue-600/10 text-blue-400 border border-blue-500/20 hover:bg-blue-600/20 rounded flex items-center gap-1 text-[10px] cursor-pointer"
                          title="New Procedure"
                        >
                          <Plus className="w-3 h-3" /> Proc
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {loadingRoutines ? (
                    <div className="p-4 text-center text-[var(--muted)]">Loading routines...</div>
                  ) : filteredRoutines.length === 0 ? (
                    <div className="p-4 text-center text-[var(--muted)]">
                      {dialect === 'sqlite'
                        ? 'SQLite does not store user procedures in schema catalog'
                        : 'No routines found'}
                    </div>
                  ) : (
                    filteredRoutines.map((r) => {
                      const isSelected =
                        selectedRoutine?.name === r.name && selectedRoutine?.schema === r.schema
                      const isProc = r.routineType.toUpperCase() === 'PROCEDURE'
                      return (
                        <div
                          key={`${r.schema}.${r.name}`}
                          onClick={() => handleSelectRoutine(r)}
                          className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-purple-500/10 border-purple-500/40 text-[var(--fg)] shadow-xs'
                              : 'border-transparent hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="font-mono font-medium truncate text-xs text-[var(--fg)]">
                              {r.name}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase shrink-0 ${
                                isProc
                                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              }`}
                            >
                              {r.routineType}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-[var(--muted)] font-mono">
                            <span>{r.schema}</span>
                            {r.returnType ? (
                              <span className="truncate max-w-[100px]">&rarr; {r.returnType}</span>
                            ) : (
                              <span>{r.arguments?.length || 0} args</span>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Routine Inspector / Testbench */}
              <div className="flex-1 flex flex-col overflow-y-auto">
                {selectedRoutine || isEditingDdl ? (
                  <div className="p-5 space-y-5">
                    {/* Routine Header */}
                    <div className="flex items-start justify-between bg-[var(--card)] p-4 rounded-xl border border-[var(--border)]">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold font-mono text-[var(--fg)] truncate">
                            {selectedRoutine
                              ? formatRoutineSignature(selectedRoutine)
                              : 'Create New Routine'}
                          </h3>
                        </div>
                        {selectedRoutine?.comment && (
                          <p className="text-xs text-[var(--muted)] italic">
                            {selectedRoutine.comment}
                          </p>
                        )}
                        <div className="flex items-center gap-3 text-[11px] text-[var(--muted)] pt-1">
                          {selectedRoutine?.language && (
                            <span>Language: <strong className="text-[var(--fg)]">{selectedRoutine.language}</strong></span>
                          )}
                          {selectedRoutine?.returnType && (
                            <span>Returns: <strong className="text-[var(--fg)]">{selectedRoutine.returnType}</strong></span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {selectedRoutine?.definition && (
                          <button
                            onClick={() => handleCopy(selectedRoutine.definition || '')}
                            className="p-1.5 rounded border border-[var(--border)] hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
                            title="Copy DDL definition"
                          >
                            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {!isReadOnly && selectedRoutine && (
                          <button
                            onClick={() => handleDeleteRoutine(selectedRoutine)}
                            className="p-1.5 rounded border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                            title="Drop routine"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Section 1: Definition / DDL Editor */}
                    <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--surface)]/40 border-b border-[var(--border)]">
                        <div className="flex items-center gap-2">
                          <Code2 className="w-4 h-4 text-purple-400" />
                          <span className="font-semibold text-xs text-[var(--fg)]">Routine Definition (DDL)</span>
                        </div>
                        {!isReadOnly && (
                          <div className="flex items-center gap-2">
                            {isEditingDdl ? (
                              <>
                                <button
                                  onClick={() => {
                                    setIsEditingDdl(false)
                                    setEditorDdl(selectedRoutine?.definition || '')
                                  }}
                                  className="px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--fg)] cursor-pointer"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={handleSaveRoutine}
                                  className="px-3 py-1 bg-emerald-600 text-white rounded font-medium text-xs flex items-center gap-1.5 hover:bg-emerald-500 cursor-pointer"
                                >
                                  <Save className="w-3.5 h-3.5" /> Save Changes
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setIsEditingDdl(true)}
                                className="px-2.5 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--surface)] text-[var(--fg)] cursor-pointer"
                              >
                                Edit DDL
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="p-1 font-mono text-xs">
                        <CodeMirror
                          value={editorDdl}
                          height="220px"
                          theme={isDark ? oneDark : 'light'}
                          extensions={[sql()]}
                          readOnly={!isEditingDdl || isReadOnly}
                          onChange={(val) => setEditorDdl(val)}
                        />
                      </div>
                    </div>

                    {/* Section 2: Invoke Routine Testbench */}
                    {selectedRoutine && (
                      <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--surface)]/40 border-b border-[var(--border)]">
                          <div className="flex items-center gap-2">
                            <Terminal className="w-4 h-4 text-emerald-400" />
                            <span className="font-semibold text-xs text-[var(--fg)]">
                              Invoke Testbench ({selectedRoutine.routineType})
                            </span>
                          </div>
                          <button
                            onClick={handleInvokeRoutine}
                            disabled={invoking}
                            className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium text-xs flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                          >
                            <Play className={`w-3.5 h-3.5 ${invoking ? 'animate-spin' : ''}`} />
                            {invoking ? 'Executing...' : 'Run Invocation'}
                          </button>
                        </div>

                        {/* Dynamic Parameter Inputs */}
                        <div className="p-4 space-y-3">
                          {!selectedRoutine.arguments || selectedRoutine.arguments.length === 0 ? (
                            <div className="text-xs text-[var(--muted)] italic">
                              This routine accepts zero parameters. Click Run Invocation to execute.
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {selectedRoutine.arguments.map((arg, idx) => {
                                const key = arg.name || `param_${idx + 1}`
                                return (
                                  <div key={key} className="space-y-1">
                                    <div className="flex items-center justify-between text-[11px]">
                                      <label className="font-mono text-[var(--fg)] font-medium">
                                        {key}
                                      </label>
                                      <span className="font-mono text-[var(--muted)]">
                                        {arg.mode} {arg.type}
                                      </span>
                                    </div>
                                    <input
                                      type="text"
                                      placeholder={arg.defaultValue ? `Default: ${arg.defaultValue}` : `Value for ${key}`}
                                      value={paramInputs[key] ?? ''}
                                      onChange={(e) =>
                                        setParamInputs((prev) => ({
                                          ...prev,
                                          [key]: e.target.value,
                                        }))
                                      }
                                      className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-1.5 text-xs text-[var(--fg)] font-mono focus:outline-none focus:border-purple-500"
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>

                        {/* Invocation Results Table */}
                        {invokeResult && (
                          <div className="border-t border-[var(--border)] p-4 space-y-3 bg-[var(--bg)]/40">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-xs text-[var(--fg)]">Output Results</span>
                              <div className="flex items-center gap-3 text-[11px] text-[var(--muted)] font-mono">
                                <span>Duration: <strong className="text-[var(--fg)]">{invokeResult.durationMs}ms</strong></span>
                                <span>Affected: <strong className="text-[var(--fg)]">{invokeResult.affectedRows}</strong></span>
                              </div>
                            </div>

                            {invokeResult.columns && invokeResult.columns.length > 0 ? (
                              <div className="overflow-x-auto border border-[var(--border)] rounded-lg">
                                <table className="w-full text-left text-xs font-mono">
                                  <thead className="bg-[var(--surface)] border-b border-[var(--border)] text-[var(--muted)]">
                                    <tr>
                                      {invokeResult.columns.map((c) => (
                                        <th key={c} className="px-3 py-2 font-medium">
                                          {c}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[var(--border)]">
                                    {invokeResult.rows.map((row, rIdx) => (
                                      <tr key={rIdx} className="hover:bg-[var(--surface)]/50">
                                        {row.map((val, cIdx) => (
                                          <td key={cIdx} className="px-3 py-1.5 text-[var(--fg)]">
                                            {val === null ? (
                                              <span className="text-[var(--muted)] italic">NULL</span>
                                            ) : typeof val === 'object' ? (
                                              JSON.stringify(val)
                                            ) : (
                                              String(val)
                                            )}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="p-3 bg-[var(--surface)] rounded border border-[var(--border)] text-xs text-emerald-400 font-mono">
                                {invokeResult.message || 'Execution completed with no returned rows.'}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] gap-2 p-8 text-center">
                    <Code2 className="w-8 h-8 opacity-30" />
                    <p className="text-sm font-medium text-[var(--fg)]">No routine selected</p>
                    <p className="text-xs">Select a routine on the left or create a new procedure/function.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════════
              TAB 2: TRIGGERS
          ════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'triggers' && (
            <div className="flex-1 flex overflow-hidden">
              {/* Left Column: Filter & List */}
              <div className="w-80 border-r border-[var(--border)] flex flex-col bg-[var(--surface)]/20 shrink-0">
                <div className="p-3 border-b border-[var(--border)] space-y-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--muted)]" />
                    <input
                      type="text"
                      placeholder="Search triggers..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md pl-8 pr-3 py-1.5 text-xs text-[var(--fg)] focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  {triggerTables.length > 0 && (
                    <select
                      value={triggerTableFilter}
                      onChange={(e) => setTriggerTableFilter(e.target.value)}
                      className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2.5 py-1 text-xs text-[var(--fg)] focus:outline-none"
                    >
                      <option value="ALL">All Tables ({triggers.length})</option>
                      {triggerTables.map((tbl) => (
                        <option key={tbl} value={tbl}>
                          Table: {tbl}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-4">
                  {loadingTriggers ? (
                    <div className="p-4 text-center text-[var(--muted)]">Loading triggers...</div>
                  ) : filteredTriggers.length === 0 ? (
                    <div className="p-4 text-center text-[var(--muted)]">No triggers found</div>
                  ) : (
                    Object.entries(groupedTriggers).map(([tbl, trgs]) => (
                      <div key={tbl} className="space-y-1">
                        <div className="flex items-center gap-1.5 px-2 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                          <Database className="w-3 h-3" />
                          <span>{tbl}</span>
                          <span className="font-mono">({trgs.length})</span>
                        </div>
                        {trgs.map((t) => {
                          const isSelected = selectedTrigger?.name === t.name
                          return (
                            <div
                              key={t.name}
                              onClick={() => setSelectedTrigger(t)}
                              className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-purple-500/10 border-purple-500/40 text-[var(--fg)] shadow-xs'
                                  : 'border-transparent hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1 mb-1.5">
                                <span className="font-mono font-medium truncate text-xs text-[var(--fg)]">
                                  {t.name}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono border shrink-0 ${getTimingBadgeClass(
                                    t.timing
                                  )}`}
                                >
                                  {t.timing}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[10px]">
                                <span
                                  className={`px-1.5 py-0.5 rounded font-mono border ${getEventBadgeClass(
                                    t.event
                                  )}`}
                                >
                                  {t.event}
                                </span>
                                <span className={`font-mono text-[10px] ${t.enabled ? 'text-emerald-400' : 'text-zinc-500'}`}>
                                  {t.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Right Column: Trigger Details & Actions */}
              <div className="flex-1 flex flex-col overflow-y-auto">
                {selectedTrigger ? (
                  <div className="p-5 space-y-5">
                    {/* Trigger Header */}
                    <div className="flex items-start justify-between bg-[var(--card)] p-4 rounded-xl border border-[var(--border)]">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-semibold font-mono text-[var(--fg)]">
                            {selectedTrigger.name}
                          </h3>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-xs font-mono bg-[var(--surface)] border border-[var(--border)] text-[var(--fg)]">
                            Table: <strong>{selectedTrigger.tableName}</strong>
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs font-mono border ${getTimingBadgeClass(selectedTrigger.timing)}`}>
                            {selectedTrigger.timing}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs font-mono border ${getEventBadgeClass(selectedTrigger.event)}`}>
                            {selectedTrigger.event}
                          </span>
                          <span className="px-2 py-0.5 rounded text-xs font-mono bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                            {selectedTrigger.orientation}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Toggle Enable/Disable Button */}
                        {dialect === 'postgres' && (
                          <button
                            onClick={() => handleToggleTrigger(selectedTrigger)}
                            disabled={isReadOnly}
                            className={`px-3 py-1.5 rounded-lg border font-medium text-xs flex items-center gap-2 transition-all cursor-pointer ${
                              selectedTrigger.enabled
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                            } disabled:opacity-50`}
                            title={isReadOnly ? 'Safe Mode Active' : selectedTrigger.enabled ? 'Disable Trigger' : 'Enable Trigger'}
                          >
                            {selectedTrigger.enabled ? (
                              <>
                                <ToggleRight className="w-4 h-4" /> Disable Trigger
                              </>
                            ) : (
                              <>
                                <ToggleLeft className="w-4 h-4" /> Enable Trigger
                              </>
                            )}
                          </button>
                        )}

                        {!isReadOnly && (
                          <button
                            onClick={() => handleDeleteTrigger(selectedTrigger)}
                            className="p-1.5 rounded border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                            title="Drop trigger"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Trigger Definition */}
                    <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--surface)]/40 border-b border-[var(--border)]">
                        <div className="flex items-center gap-2">
                          <Code2 className="w-4 h-4 text-purple-400" />
                          <span className="font-semibold text-xs text-[var(--fg)]">
                            Trigger Action Statement
                          </span>
                        </div>
                        <button
                          onClick={() => handleCopy(selectedTrigger.statement)}
                          className="p-1.5 rounded border border-[var(--border)] hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
                          title="Copy statement"
                        >
                          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="p-1 font-mono text-xs">
                        <CodeMirror
                          value={selectedTrigger.statement}
                          height="320px"
                          theme={isDark ? oneDark : 'light'}
                          extensions={[sql()]}
                          readOnly={true}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] gap-2 p-8 text-center">
                    <Activity className="w-8 h-8 opacity-30" />
                    <p className="text-sm font-medium text-[var(--fg)]">No trigger selected</p>
                    <p className="text-xs">Select a trigger from the list to inspect its action statement and firing events.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════════
              TAB 3: VIEWS & MATERIALIZED VIEWS
          ════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'views' && (
            <div className="flex-1 flex overflow-hidden">
              {/* Left Column: Filter & List */}
              <div className="w-80 border-r border-[var(--border)] flex flex-col bg-[var(--surface)]/20 shrink-0">
                <div className="p-3 border-b border-[var(--border)] space-y-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--muted)]" />
                    <input
                      type="text"
                      placeholder="Search views..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md pl-8 pr-3 py-1.5 text-xs text-[var(--fg)] focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={matOnly}
                        onChange={(e) => setMatOnly(e.target.checked)}
                        className="rounded border-[var(--border)] text-purple-600 focus:ring-0"
                      />
                      <span>Materialized Only</span>
                    </label>

                    <span className="text-[10px] font-mono text-[var(--muted)]">
                      {filteredViews.length} views
                    </span>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {loadingViews ? (
                    <div className="p-4 text-center text-[var(--muted)]">Loading views...</div>
                  ) : filteredViews.length === 0 ? (
                    <div className="p-4 text-center text-[var(--muted)]">No views found</div>
                  ) : (
                    filteredViews.map((v) => {
                      const isSelected = selectedView?.name === v.name && selectedView?.schema === v.schema
                      return (
                        <div
                          key={`${v.schema}.${v.name}`}
                          onClick={() => setSelectedView(v)}
                          className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-purple-500/10 border-purple-500/40 text-[var(--fg)] shadow-xs'
                              : 'border-transparent hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="font-mono font-medium truncate text-xs text-[var(--fg)]">
                              {v.name}
                            </span>
                            {v.isMaterialized ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20 uppercase shrink-0">
                                MatView
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase shrink-0">
                                View
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-[var(--muted)] font-mono">
                            <span>{v.schema}</span>
                            {v.owner && <span>Owner: {v.owner}</span>}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Right Column: View Details & Refresh */}
              <div className="flex-1 flex flex-col overflow-y-auto">
                {selectedView ? (
                  <div className="p-5 space-y-5">
                    {/* View Header */}
                    <div className="flex items-start justify-between bg-[var(--card)] p-4 rounded-xl border border-[var(--border)]">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-semibold font-mono text-[var(--fg)]">
                            {selectedView.schema}.{selectedView.name}
                          </h3>
                          {selectedView.isMaterialized ? (
                            <span className="px-2 py-0.5 rounded text-xs font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20 font-semibold">
                              Materialized View
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-xs font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                              Standard View
                            </span>
                          )}
                        </div>
                        {selectedView.owner && (
                          <div className="text-xs text-[var(--muted)] font-mono">
                            Owner: <strong className="text-[var(--fg)]">{selectedView.owner}</strong>
                          </div>
                        )}
                      </div>

                      {/* 1-Click Refresh View Button (for Materialized Views) */}
                      {selectedView.isMaterialized && dialect === 'postgres' && (
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)] cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={concurrentRefresh}
                              onChange={(e) => setConcurrentRefresh(e.target.checked)}
                              className="rounded border-[var(--border)] text-purple-600 focus:ring-0"
                            />
                            <span>CONCURRENTLY</span>
                          </label>
                          <button
                            onClick={() => handleRefreshView(selectedView)}
                            disabled={refreshingView || isReadOnly}
                            className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium text-xs flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                            title={isReadOnly ? 'Safe Mode Active' : 'Refresh Materialized View'}
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${refreshingView ? 'animate-spin' : ''}`} />
                            {refreshingView ? 'Refreshing...' : '1-Click Refresh View'}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* View SQL Definition */}
                    <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--surface)]/40 border-b border-[var(--border)]">
                        <div className="flex items-center gap-2">
                          <Eye className="w-4 h-4 text-purple-400" />
                          <span className="font-semibold text-xs text-[var(--fg)]">
                            View Query Definition
                          </span>
                        </div>
                        <button
                          onClick={() => handleCopy(selectedView.definition)}
                          className="p-1.5 rounded border border-[var(--border)] hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
                          title="Copy view SQL"
                        >
                          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="p-1 font-mono text-xs">
                        <CodeMirror
                          value={selectedView.definition}
                          height="360px"
                          theme={isDark ? oneDark : 'light'}
                          extensions={[sql()]}
                          readOnly={true}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] gap-2 p-8 text-center">
                    <Eye className="w-8 h-8 opacity-30" />
                    <p className="text-sm font-medium text-[var(--fg)]">No view selected</p>
                    <p className="text-xs">Select a view to inspect its SQL definition or refresh cached materialized data.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
