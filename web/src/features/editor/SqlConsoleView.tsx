import React, { useState, useEffect, useMemo, useRef } from 'react'
import CodeMirror, { keymap, Prec } from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Play,
  Loader2,
  Clock,
  Rows,
  AlertCircle,
  X,
  Trash2,
  Copy,
  Check,
  FileCode,
  Plus,
  Edit2,
  Bookmark,
  Tag,
  Search,
  Download,
  FolderPlus,
  ListTree,
  Sparkles,
  RefreshCw,
  BarChart3,
  Braces,
  Code,
  ChevronDown,
} from 'lucide-react'
import { api } from '../../lib/api'
import type { QueryResult, ExplainResult } from '../../lib/api'
import { useAppStore } from '../../stores/appStore'
import { ExplainPlanView } from './ExplainPlanView'
import { SqlChartStudio } from './SqlChartStudio'
import { createSqlExtension } from '../../lib/sqlAutocomplete'
import { extractQueryVariables, DBA_MAINTENANCE_SNIPPETS, type SqlSnippet } from './sqlVariableParser'
import { sqlVariableHighlight } from './sqlVariableHighlight'
import { ParameterPromptModal } from './ParameterPromptModal'

interface Props {
  connId: string
}

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

export const SqlConsoleView: React.FC<Props> = ({ connId }) => {
  const {
    connections,
    queryHistory,
    addQueryHistory,
    clearQueryHistory,
    sqlTabs,
    activeSqlTabId,
    queryBookmarks,
    addSqlTab,
    closeSqlTab,
    renameSqlTab,
    updateSqlTabQuery,
    updateSqlTabParams,
    setActiveSqlTabId,
    addBookmark,
    deleteBookmark,
    openDryRunModal,
    selectedSchema,
  } = useAppStore()

  const qc = useQueryClient()
  const effectiveConnections = useMemo(
    () => (connections && connections.length > 0 ? connections : api.getProfiles()),
    [connections]
  )
  const currentConn = useMemo(
    () => effectiveConnections.find((c) => c.id === connId),
    [effectiveConnections, connId]
  )
  const currentDialect = currentConn?.dialect || currentConn?.driver

  const {
    data: erdTables,
    isLoading: isSchemaLoading,
    isFetching: isSchemaFetching,
  } = useQuery({
    queryKey: ['schema-autocomplete', connId],
    queryFn: () => api.getERDData(connId, effectiveConnections),
    staleTime: 60000,
  })

  // Tabs management
  const tabs = useMemo(() => sqlTabs[connId] || [], [sqlTabs, connId])
  const activeId = activeSqlTabId[connId]

  const currentTab = useMemo(() => {
    if (tabs.length === 0) return null
    return tabs.find((t) => t.id === activeId) || tabs[0]
  }, [tabs, activeId])

  useEffect(() => {
    if (tabs.length === 0) {
      addSqlTab(connId, 'Query 1', 'SELECT * FROM users LIMIT 10;')
    } else if (!activeId || !tabs.some((t) => t.id === activeId)) {
      setActiveSqlTabId(connId, tabs[0].id)
    }
  }, [connId, tabs, activeId, addSqlTab, setActiveSqlTabId])

  // Per-tab execution & results
  const [tabResults, setTabResults] = useState<Record<string, QueryResult>>({})
  const [tabExecuting, setTabExecuting] = useState<Record<string, boolean>>({})
  const [tabExplainResults, setTabExplainResults] = useState<Record<string, ExplainResult>>({})
  const [tabExplaining, setTabExplaining] = useState<Record<string, boolean>>({})
  const [tabActivePane, setTabActivePane] = useState<Record<string, 'results' | 'explain' | 'chart'>>({})

  const currentResult = currentTab ? tabResults[currentTab.id] ?? null : null
  const isExecuting = Boolean(currentTab && tabExecuting[currentTab.id])
  const currentExplain = currentTab ? tabExplainResults[currentTab.id] ?? null : null
  const isExplaining = Boolean(currentTab && tabExplaining[currentTab.id])
  const activePane = currentTab ? tabActivePane[currentTab.id] ?? 'results' : 'results'

  // Tab rename state
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingTabId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [editingTabId])

  const startRenameTab = (tabId: string, currentName: string) => {
    setEditingTabId(tabId)
    setEditingName(currentName)
  }

  const submitRenameTab = () => {
    if (editingTabId && editingName.trim()) {
      renameSqlTab(connId, editingTabId, editingName.trim())
    }
    setEditingTabId(null)
  }

  const cancelRenameTab = () => {
    setEditingTabId(null)
  }

  // Drawers & Modals
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiedBmId, setCopiedBmId] = useState<string | null>(null)

  // Bookmarks filter & save state
  const [bookmarkSearch, setBookmarkSearch] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [isSaveBookmarkFormOpen, setIsSaveBookmarkFormOpen] = useState(false)
  const [newBookmarkName, setNewBookmarkName] = useState('')
  const [newBookmarkTags, setNewBookmarkTags] = useState('')

  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    for (const b of queryBookmarks || []) {
      for (const t of b.tags || []) {
        if (t.trim()) tagSet.add(t.trim())
      }
    }
    return Array.from(tagSet).sort()
  }, [queryBookmarks])

  const filteredBookmarks = useMemo(() => {
    const list = queryBookmarks || []
    return list.filter((b) => {
      const matchesSearch =
        !bookmarkSearch ||
        b.name.toLowerCase().includes(bookmarkSearch.toLowerCase()) ||
        b.sql.toLowerCase().includes(bookmarkSearch.toLowerCase())
      const matchesTag = !selectedTag || (b.tags && b.tags.includes(selectedTag))
      return matchesSearch && matchesTag
    })
  }, [queryBookmarks, bookmarkSearch, selectedTag])

  const handleSaveBookmark = (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentTab || !currentTab.query.trim()) return
    const name = newBookmarkName.trim() || currentTab.name || 'Saved Query'
    const tags = Array.from(
      new Set(
        newBookmarkTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      )
    )
    addBookmark({
      name,
      sql: currentTab.query,
      tags: tags.length > 0 ? tags : ['general'],
    })
    setNewBookmarkName('')
    setNewBookmarkTags('')
    setIsSaveBookmarkFormOpen(false)
  }

  // Theme detection
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

  // Query variables & snippets state
  const [isParamModalOpen, setIsParamModalOpen] = useState(false)
  const [isSnippetsOpen, setIsSnippetsOpen] = useState(false)
  const [snippetCategory, setSnippetCategory] = useState<string>('All')
  const snippetsMenuRef = useRef<HTMLDivElement>(null)

  const detectedVariables = useMemo(
    () => extractQueryVariables(currentTab?.query || ''),
    [currentTab?.query]
  )

  const normalizedDialect = useMemo(() => {
    const d = (currentDialect || '').toLowerCase()
    if (d.includes('postgres') || d.includes('pg')) return 'postgres'
    if (d.includes('mysql') || d.includes('maria')) return 'mysql'
    if (d.includes('sqlite')) return 'sqlite'
    return 'all'
  }, [currentDialect])

  const filteredSnippets = useMemo(() => {
    return DBA_MAINTENANCE_SNIPPETS.filter((s) => {
      const dialectMatch = s.dialect === 'all' || s.dialect === normalizedDialect
      const categoryMatch = snippetCategory === 'All' || s.category === snippetCategory
      return dialectMatch && categoryMatch
    })
  }, [normalizedDialect, snippetCategory])

  useEffect(() => {
    if (!isSnippetsOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (snippetsMenuRef.current && !snippetsMenuRef.current.contains(e.target as Node)) {
        setIsSnippetsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isSnippetsOpen])

  const executeRun = async (tabId: string, query: string, params?: Record<string, any>) => {
    setTabExecuting((prev) => ({ ...prev, [tabId]: true }))
    const startTime = performance.now()

    try {
      setTabActivePane((prev) => ({ ...prev, [tabId]: 'results' }))
      const activeParams = params ?? currentTab?.params
      const res = await api.executeQuery(connId, query, effectiveConnections, activeParams)
      const durationMs = Math.round(res.durationMs || (performance.now() - startTime))
      const rowCount = res.rows?.length ?? res.affectedRows ?? 0
      const isSuccess = !res.error

      setTabResults((prev) => ({ ...prev, [tabId]: res }))
      addQueryHistory({
        id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        sql: query,
        timestamp: Date.now(),
        durationMs,
        success: isSuccess,
        rowCount,
        error: res.error,
      })
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime)
      const errorMsg = err?.message || 'Query execution failed'
      const errRes: QueryResult = { columns: [], rows: [], durationMs, error: errorMsg }
      setTabResults((prev) => ({ ...prev, [tabId]: errRes }))
      addQueryHistory({
        id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        sql: query,
        timestamp: Date.now(),
        durationMs,
        success: false,
        rowCount: 0,
        error: errorMsg,
      })
    } finally {
      setTabExecuting((prev) => ({ ...prev, [tabId]: false }))
    }
  }

  const handleRun = async (overrideSql?: string, overrideParams?: Record<string, any>) => {
    if (!currentTab) return
    const tabId = currentTab.id
    const query = (overrideSql ?? currentTab.query).trim()
    if (!query || tabExecuting[tabId]) return

    // Prompt for variables if any variable in the query has not been filled
    const vars = extractQueryVariables(query)
    if (vars.length > 0 && !overrideParams) {
      const tabParams = currentTab.params || {}
      const hasUnset = vars.some((v) => {
        const val = tabParams[v.name]
        return val === undefined || val === null || val === ''
      })
      if (hasUnset) {
        setIsParamModalOpen(true)
        return
      }
    }

    const isDestructive = /\b(DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE|DELETE\s+FROM(?!\s+[\s\S]*?\bWHERE\b))\b/i.test(query)
    if (isDestructive) {
      openDryRunModal('Confirm Destructive Query', query, () => {
        executeRun(tabId, query, overrideParams)
      })
      return
    }

    await executeRun(tabId, query, overrideParams)
  }

  const handleRunParameters = (newParams: Record<string, any>) => {
    if (!currentTab) return
    updateSqlTabParams(connId, currentTab.id, newParams)
    handleRun(currentTab.query, newParams)
  }

  const handleSaveParameters = (newParams: Record<string, any>) => {
    if (!currentTab) return
    updateSqlTabParams(connId, currentTab.id, newParams)
  }

  const handleSelectSnippet = (snippet: SqlSnippet) => {
    if (!currentTab) return
    updateSqlTabQuery(connId, currentTab.id, snippet.sql)
    if (snippet.defaultParams) {
      updateSqlTabParams(connId, currentTab.id, {
        ...(currentTab.params || {}),
        ...snippet.defaultParams,
      })
    }
    setIsSnippetsOpen(false)
  }

  const handleExplain = async (overrideSql?: string) => {
    if (!currentTab) return
    const tabId = currentTab.id
    const query = (overrideSql ?? currentTab.query).trim()
    if (!query || tabExplaining[tabId]) return

    setTabExplaining((prev) => ({ ...prev, [tabId]: true }))
    setTabActivePane((prev) => ({ ...prev, [tabId]: 'explain' }))

    try {
      const res = await api.explainQuery(connId, query, { schema: selectedSchema })
      setTabExplainResults((prev) => ({ ...prev, [tabId]: res }))
    } catch (err: any) {
      setTabExplainResults((prev) => ({
        ...prev,
        [tabId]: {
          dialect: 'sqlite',
          root: { nodeType: 'Error' },
          summary: {},
          raw: err?.message || 'Explain failed',
          format: 'text',
          error: err?.message || 'Explain failed',
        },
      }))
    } finally {
      setTabExplaining((prev) => ({ ...prev, [tabId]: false }))
    }
  }

  const runRef = useRef(handleRun)
  useEffect(() => {
    runRef.current = handleRun
  })

  const explainRef = useRef(handleExplain)
  useEffect(() => {
    explainRef.current = handleExplain
  })

  const extensions = useMemo(() => {
    const baseExtensions = createSqlExtension(currentDialect, erdTables, selectedSchema)
    return [
      ...baseExtensions,
      sqlVariableHighlight,
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              runRef.current()
              return true
            },
          },
          {
            key: 'Mod-Alt-Enter',
            run: () => {
              explainRef.current()
              return true
            },
          },
          {
            key: 'Shift-Mod-Enter',
            run: () => {
              explainRef.current()
              return true
            },
          },
        ])
      ),
    ]
  }, [currentDialect, erdTables, selectedSchema])

  // Export handlers
  const handleExportCsv = () => {
    if (!currentResult?.rows || currentResult.rows.length === 0) return
    const cols = currentResult.columns || []
    const header = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')
    const rows = currentResult.rows.map((row) =>
      cols
        .map((c) => {
          const val = row[c]
          if (val === null || val === undefined) return ''
          const s = typeof val === 'object' ? JSON.stringify(val) : String(val)
          return `"${s.replace(/"/g, '""')}"`
        })
        .join(',')
    )
    const csvContent = [header, ...rows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const safeName = (currentTab?.name || 'query').replace(/[/\\?%*:|"<>]/g, '_')
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}_${Date.now()}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleExportJson = () => {
    if (!currentResult?.rows || currentResult.rows.length === 0) return
    const jsonContent = JSON.stringify(currentResult.rows, null, 2)
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const safeName = (currentTab?.name || 'query').replace(/[/\\?%*:|"<>]/g, '_')
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}_${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg)] overflow-hidden relative">
      {/* Tab Strip */}
      <div className="flex items-center bg-[var(--surface)]/70 border-b border-[var(--border)] px-2 pt-1 gap-1 overflow-x-auto select-none shrink-0">
        {tabs.map((tab) => {
          const isActive = tab.id === (currentTab?.id ?? activeId)
          const isEditing = editingTabId === tab.id

          return (
            <div
              key={tab.id}
              onClick={() => {
                if (!isActive) setActiveSqlTabId(connId, tab.id)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                startRenameTab(tab.id, tab.name)
              }}
              className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t border-t border-x cursor-pointer transition-colors max-w-[180px] shrink-0 ${
                isActive
                  ? 'bg-[var(--bg)] border-[var(--border)] text-[var(--fg)] font-medium'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface)]'
              }`}
            >
              {isEditing ? (
                <input
                  ref={renameInputRef}
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={submitRenameTab}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRenameTab()
                    if (e.key === 'Escape') cancelRenameTab()
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-[var(--surface)] text-[var(--fg)] border border-indigo-500 rounded px-1 py-0.2 text-xs outline-none w-24"
                />
              ) : (
                <span className="truncate" title={tab.name}>
                  {tab.name}
                </span>
              )}

              {isActive && !isEditing && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    startRenameTab(tab.id, tab.name)
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--muted)] hover:text-[var(--fg)] rounded transition-opacity"
                  title="Rename tab"
                >
                  <Edit2 className="w-2.5 h-2.5" />
                </button>
              )}

              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    closeSqlTab(connId, tab.id)
                  }}
                  className="p-0.5 rounded text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors ml-0.5"
                  title="Close tab"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )
        })}

        <button
          onClick={() => addSqlTab(connId)}
          className="flex items-center justify-center p-1.5 text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface)] rounded mb-1 transition-colors"
          title="Add new SQL tab"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main Console Body */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* Editor Pane */}
        <div className="flex-1 flex flex-col min-h-0 border-b border-[var(--border)] overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto">
            {currentTab && (
              <CodeMirror
                key={currentTab.id}
                value={currentTab.query}
                height="100%"
                theme={isDark ? oneDark : 'light'}
                extensions={extensions}
                onChange={(val) => updateSqlTabQuery(connId, currentTab.id, val)}
                basicSetup={{
                  lineNumbers: true,
                  bracketMatching: true,
                  autocompletion: true,
                  indentOnInput: true,
                  foldGutter: false,
                  highlightActiveLine: true,
                }}
                className="h-full text-xs font-mono"
              />
            )}
          </div>

          <div className="h-10 border-t border-[var(--border)] px-3 flex items-center justify-between shrink-0 bg-[var(--bg)]">
            <div className="flex items-center gap-2">
              <kbd className="text-[10px] text-[var(--muted)] font-mono mr-1">
                <span className="text-[var(--fg)]">Ctrl</span>+Enter Run
              </kbd>

              {/* History Button */}
              <button
                onClick={() => {
                  setIsHistoryOpen((prev) => !prev)
                  setIsBookmarksOpen(false)
                }}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] border transition-colors ${
                  isHistoryOpen
                    ? 'bg-[var(--surface)] border-[var(--border)] text-[var(--fg)]'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                }`}
                title="Toggle Query History"
              >
                <Clock className="w-3 h-3 text-indigo-400" />
                <span>History</span>
                {queryHistory.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-indigo-500/15 text-indigo-400 font-mono font-medium">
                    {queryHistory.length}
                  </span>
                )}
              </button>

              {/* Bookmarks Button */}
              <button
                onClick={() => {
                  setIsBookmarksOpen((prev) => !prev)
                  setIsHistoryOpen(false)
                }}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] border transition-colors ${
                  isBookmarksOpen
                    ? 'bg-[var(--surface)] border-[var(--border)] text-[var(--fg)]'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                }`}
                title="Toggle Query Bookmarks"
              >
                <Bookmark className="w-3 h-3 text-amber-400" />
                <span>Bookmarks</span>
                {queryBookmarks && queryBookmarks.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-amber-500/15 text-amber-400 font-mono font-medium">
                    {queryBookmarks.length}
                  </span>
                )}
              </button>

              {/* Variables Button */}
              <button
                onClick={() => setIsParamModalOpen(true)}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] border transition-colors ${
                  detectedVariables.length > 0
                    ? 'bg-sky-500/10 border-sky-500/30 text-sky-300 hover:bg-sky-500/20'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                }`}
                title="Manage Query Variables / Parameters"
              >
                <Braces className="w-3 h-3 text-sky-400" />
                <span>Variables</span>
                {detectedVariables.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-sky-500/20 text-sky-300 font-mono font-medium">
                    {detectedVariables.length}
                  </span>
                )}
              </button>

              {/* Snippets Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setIsSnippetsOpen((prev) => !prev)}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] border transition-colors ${
                    isSnippetsOpen
                      ? 'bg-[var(--surface)] border-[var(--border)] text-[var(--fg)]'
                      : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                  }`}
                  title="DBA Maintenance Snippet Catalog"
                >
                  <Code className="w-3 h-3 text-cyan-400" />
                  <span>Snippets</span>
                  <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                </button>

                {isSnippetsOpen && (
                  <div
                    ref={snippetsMenuRef}
                    className="absolute bottom-full mb-2 left-0 z-40 w-96 max-h-[380px] bg-slate-900 border border-slate-750 shadow-2xl rounded-xl flex flex-col overflow-hidden text-slate-200"
                  >
                    <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
                      <div className="flex items-center gap-1.5">
                        <Code className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="text-xs font-semibold text-white">DBA Maintenance Snippets</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 uppercase font-mono">
                          {normalizedDialect}
                        </span>
                      </div>
                      <button
                        onClick={() => setIsSnippetsOpen(false)}
                        className="text-slate-400 hover:text-white p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Category Filter Pills */}
                    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-slate-800/80 bg-slate-950/40 overflow-x-auto text-[10px]">
                      {['All', 'Performance', 'Maintenance', 'Diagnostics', 'Templates'].map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setSnippetCategory(cat)}
                          className={`px-2 py-0.5 rounded-full transition-colors ${
                            snippetCategory === cat
                              ? 'bg-cyan-600 text-white font-medium shadow-xs'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>

                    {/* Snippet List */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1.5 divide-y divide-slate-800/40">
                      {filteredSnippets.length === 0 ? (
                        <div className="py-6 text-center text-xs text-slate-500">
                          No snippets found for this category and dialect
                        </div>
                      ) : (
                        filteredSnippets.map((snippet) => (
                          <button
                            key={snippet.id}
                            onClick={() => handleSelectSnippet(snippet)}
                            className="w-full text-left p-2 rounded-lg hover:bg-slate-800/80 group transition-all pt-2 first:pt-2"
                          >
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-xs font-medium text-slate-200 group-hover:text-cyan-300 transition-colors">
                                {snippet.title}
                              </span>
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700/60 font-mono">
                                {snippet.category}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 line-clamp-1 mb-1">
                              {snippet.description}
                            </p>
                            <pre className="text-[10px] font-mono text-slate-500 line-clamp-1 bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-850">
                              {snippet.sql.replace(/--[^\n]*\n/g, '').trim()}
                            </pre>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Schema Refresh Button */}
              <button
                id="dblens-refresh-schema-btn"
                onClick={() => qc.invalidateQueries({ queryKey: ['schema-autocomplete', connId] })}
                disabled={isSchemaFetching}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] border border-transparent text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors disabled:opacity-50"
                title="Refresh Schema IntelliSense (Ctrl+Space to complete)"
                aria-label="Refresh Schema IntelliSense"
              >
                <RefreshCw
                  className={`w-3 h-3 text-emerald-400 ${
                    isSchemaFetching ? 'animate-spin' : ''
                  }`}
                />
                <span>Refresh Schema</span>
              </button>

              {/* IntelliSense Indicator */}
              <div
                className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] select-none"
                title={`IntelliSense schema autocomplete active: ${
                  erdTables?.length || 0
                } tables cached. Manual trigger: Ctrl+Space.`}
              >
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span className="font-mono text-[10px]">
                  {isSchemaLoading
                    ? 'IntelliSense loading...'
                    : `IntelliSense: ${erdTables?.length || 0} tables`}
                </span>
              </div>
            </div>

            <button
              id="dblens-explain-btn"
              onClick={() => handleExplain()}
              disabled={isExplaining || isExecuting || !currentTab?.query.trim()}
              className="flex items-center gap-1.5 text-xs px-3 py-1 rounded bg-[var(--surface)] hover:bg-[var(--hover)] text-[var(--fg)] border border-[var(--border)] disabled:opacity-40 transition-colors"
              title="Explain Query Execution Plan (Mod-Alt-Enter)"
              aria-label="Explain Query Execution Plan (Mod-Alt-Enter)"
            >
              {isExplaining ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              ) : (
                <ListTree className="w-3.5 h-3.5 text-indigo-400" />
              )}
              <span>{isExplaining ? 'Explaining...' : 'Explain Plan'}</span>
            </button>

            <button
              id="dblens-run-query-btn"
              onClick={() => handleRun()}
              disabled={isExecuting || !currentTab?.query.trim()}
              className="btn-primary flex items-center gap-1.5 disabled:opacity-40 text-xs px-3 py-1"
            >
              {isExecuting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>{isExecuting ? 'Running...' : 'Run Query'}</span>
            </button>
          </div>
        </div>

        {/* Results / Explain Tab Switcher Bar */}
        {(currentResult || currentExplain || isExplaining) && (
          <div className="h-8 border-b border-[var(--border)] px-3 flex items-center justify-between bg-[var(--surface)]/70 shrink-0 text-xs select-none">
            <div className="flex items-center gap-1" role="tablist" aria-label="Query Output Views">
              <button
                role="tab"
                aria-selected={activePane === 'results'}
                onClick={() =>
                  setTabActivePane((prev) => ({
                    ...prev,
                    [currentTab?.id || '']: 'results',
                  }))
                }
                className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs transition-colors ${
                  activePane === 'results'
                    ? 'bg-[var(--bg)] text-[var(--fg)] font-semibold shadow-xs border border-[var(--border)]'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <Rows className="w-3 h-3 text-blue-400" />
                <span>Results</span>
                {currentResult && !currentResult.error && (
                  <span className="text-[10px] text-[var(--muted)] font-mono">
                    ({currentResult.rows?.length ?? currentResult.affectedRows ?? 0})
                  </span>
                )}
              </button>

              <button
                role="tab"
                aria-selected={activePane === 'explain'}
                onClick={() =>
                  setTabActivePane((prev) => ({
                    ...prev,
                    [currentTab?.id || '']: 'explain',
                  }))
                }
                className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs transition-colors ${
                  activePane === 'explain'
                    ? 'bg-[var(--bg)] text-[var(--fg)] font-semibold shadow-xs border border-[var(--border)]'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <ListTree className="w-3 h-3 text-indigo-400" />
                <span>Execution Plan</span>
                {currentExplain?.summary?.totalCost !== undefined && currentExplain.summary.totalCost > 0 && (
                  <span className="text-[10px] text-amber-400 font-mono">
                    (cost: {Math.round(currentExplain.summary.totalCost)})
                  </span>
                )}
              </button>

              <button
                role="tab"
                aria-selected={activePane === 'chart'}
                onClick={() =>
                  setTabActivePane((prev) => ({
                    ...prev,
                    [currentTab?.id || '']: 'chart',
                  }))
                }
                className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs transition-colors ${
                  activePane === 'chart'
                    ? 'bg-[var(--bg)] text-[var(--fg)] font-semibold shadow-xs border border-[var(--border)]'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <BarChart3 className="w-3 h-3 text-emerald-400" />
                <span>Charts</span>
                {currentResult && !currentResult.error && (currentResult.rows?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-[var(--muted)] font-mono">
                    ({currentResult.rows?.length})
                  </span>
                )}
              </button>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)] font-mono">
              {(activePane === 'results' || activePane === 'chart') && currentResult && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {currentResult.durationMs}ms
                </span>
              )}
              {activePane === 'explain' && currentExplain?.summary?.executionTime !== undefined && (
                <span className="flex items-center gap-1 text-emerald-400">
                  <Clock className="w-3 h-3" />
                  {currentExplain.summary.executionTime.toFixed(2)}ms
                </span>
              )}
            </div>
          </div>
        )}

        {/* Explain Plan Pane */}
        {activePane === 'explain' && (currentExplain || isExplaining) && (
          <ExplainPlanView
            plan={currentExplain}
            isExplaining={isExplaining}
            onClose={() =>
              setTabActivePane((prev) => ({
                ...prev,
                [currentTab?.id || '']: 'results',
              }))
            }
          />
        )}

        {/* Results Pane */}
        {activePane === 'results' && currentResult && (
          <div className="flex-1 flex flex-col min-h-0 overflow-auto">
            {currentResult.error ? (
              <div className="p-4 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <pre className="text-xs text-red-400 font-mono whitespace-pre-wrap">
                  {currentResult.error}
                </pre>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Summary bar */}
                <div className="h-8 border-b border-[var(--border)] px-3 flex items-center justify-between text-[11px] text-[var(--muted)] font-mono shrink-0 bg-[var(--surface)]/50">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {currentResult.durationMs}ms
                    </span>
                    <span className="flex items-center gap-1">
                      <Rows className="w-3 h-3" />
                      {currentResult.rows?.length ?? 0} rows
                    </span>
                  </div>

                  {(currentResult.rows?.length ?? 0) > 0 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleExportCsv}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface)] border border-[var(--border)] transition-colors"
                        title="Export results as CSV"
                      >
                        <Download className="w-3 h-3" />
                        <span>CSV</span>
                      </button>
                      <button
                        onClick={handleExportJson}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface)] border border-[var(--border)] transition-colors"
                        title="Export results as JSON"
                      >
                        <Download className="w-3 h-3" />
                        <span>JSON</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Data table */}
                {(currentResult.rows?.length ?? 0) > 0 && (
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-[var(--bg)] z-10">
                        <tr>
                          {(currentResult.columns ?? []).map((c) => (
                            <th
                              key={c}
                              className="px-3 py-1.5 text-[10px] text-[var(--muted)] font-mono border-r border-[var(--border)] whitespace-nowrap"
                            >
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(currentResult.rows ?? []).slice(0, 100).map((row, i) => (
                          <tr
                            key={i}
                            className="border-b border-[var(--border)] hover:bg-[var(--hover)]"
                          >
                            {(currentResult.columns ?? []).map((c) => (
                              <td
                                key={c}
                                className="px-3 py-1.5 font-mono-data text-[var(--fg)] truncate max-w-[280px]"
                              >
                                {row[c] === null || row[c] === undefined ? (
                                  <span className="italic text-[var(--muted)] opacity-60 font-mono text-xs">
                                    null
                                  </span>
                                ) : typeof row[c] === 'object' ? (
                                  JSON.stringify(row[c])
                                ) : (
                                  String(row[c])
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {(currentResult.rows?.length ?? 0) === 0 && (
                  <div className="p-8 text-center text-[11px] text-[var(--muted)] font-mono">
                    No results
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chart Studio Pane */}
        {activePane === 'chart' && (
          <SqlChartStudio result={currentResult} />
        )}
      </div>

      {/* Query Bookmarks Drawer */}
      {isBookmarksOpen && (
        <div className="absolute inset-y-0 right-0 w-84 md:w-96 max-w-full bg-[var(--surface)] border-l border-[var(--border)] z-30 flex flex-col shadow-2xl">
          {/* Drawer Header */}
          <div className="h-10 px-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg)] shrink-0">
            <div className="flex items-center gap-1.5 font-mono text-xs text-[var(--fg)]">
              <Bookmark className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold">Query Bookmarks</span>
              <span className="text-[10px] text-[var(--muted)]">
                ({queryBookmarks?.length ?? 0})
              </span>
            </div>
            <button
              onClick={() => setIsBookmarksOpen(false)}
              className="text-[var(--muted)] hover:text-[var(--fg)] p-1 rounded hover:bg-[var(--hover)] transition-colors"
              title="Close bookmarks"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search & Action Bar */}
          <div className="p-2.5 border-b border-[var(--border)] space-y-2 bg-[var(--bg)]/40">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                type="text"
                value={bookmarkSearch}
                onChange={(e) => setBookmarkSearch(e.target.value)}
                placeholder="Search bookmarks or SQL..."
                className="w-full pl-8 pr-2.5 py-1 text-xs bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--fg)] placeholder:text-[var(--muted)] focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            {/* Tag Pills Filter */}
            {allTags.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`px-2 py-0.5 text-[10px] rounded-full font-mono shrink-0 transition-colors ${
                    selectedTag === null
                      ? 'bg-indigo-600 text-white font-medium'
                      : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)] border border-[var(--border)]'
                  }`}
                >
                  All
                </button>
                {allTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => setSelectedTag(selectedTag === t ? null : t)}
                    className={`px-2 py-0.5 text-[10px] rounded-full font-mono shrink-0 transition-colors ${
                      selectedTag === t
                        ? 'bg-indigo-600 text-white font-medium'
                        : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)] border border-[var(--border)]'
                    }`}
                  >
                    #{t}
                  </button>
                ))}
              </div>
            )}

            {/* Save Current Query Button / Form */}
            {!isSaveBookmarkFormOpen ? (
              <button
                onClick={() => {
                  setNewBookmarkName(currentTab?.name || '')
                  setNewBookmarkTags('')
                  setIsSaveBookmarkFormOpen(true)
                }}
                disabled={!currentTab?.query.trim()}
                className="w-full flex items-center justify-center gap-1.5 py-1 text-xs rounded border border-dashed border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-40 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Save Current Query as Bookmark</span>
              </button>
            ) : (
              <form
                onSubmit={handleSaveBookmark}
                className="p-2 bg-[var(--bg)] border border-[var(--border)] rounded space-y-2 text-xs"
              >
                <div className="font-semibold text-[11px] text-[var(--fg)] flex items-center justify-between">
                  <span>Save Bookmark</span>
                  <button
                    type="button"
                    onClick={() => setIsSaveBookmarkFormOpen(false)}
                    className="text-[var(--muted)] hover:text-[var(--fg)]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--muted)] mb-1">
                    Bookmark Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newBookmarkName}
                    onChange={(e) => setNewBookmarkName(e.target.value)}
                    placeholder="e.g. Active Users Summary"
                    className="w-full px-2 py-1 text-xs bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--fg)] focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--muted)] mb-1">
                    Tags (comma separated)
                  </label>
                  <input
                    type="text"
                    value={newBookmarkTags}
                    onChange={(e) => setNewBookmarkTags(e.target.value)}
                    placeholder="e.g. analytics, general"
                    className="w-full px-2 py-1 text-xs bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--fg)] focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="flex items-center justify-end gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsSaveBookmarkFormOpen(false)}
                    className="btn-secondary px-2 py-0.5 text-[11px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary px-2.5 py-0.5 text-[11px]"
                  >
                    Save
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Bookmarks List */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {filteredBookmarks.length === 0 ? (
              <div className="text-center py-10 text-xs text-[var(--muted)] font-mono">
                No bookmarks found.
              </div>
            ) : (
              filteredBookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded p-2.5 space-y-1.5 text-xs font-mono group hover:border-amber-500/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="font-semibold text-[11px] text-[var(--fg)] truncate">
                      {bm.name}
                    </span>
                    <button
                      onClick={() => deleteBookmark(bm.id)}
                      className="text-[var(--muted)] hover:text-red-400 p-0.5 rounded transition-colors"
                      title="Delete bookmark"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  {bm.tags && bm.tags.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {bm.tags.map((t) => (
                        <span
                          key={t}
                          className="flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono"
                        >
                          <Tag className="w-2 h-2" />
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  <pre className="text-[11px] text-[var(--fg)] font-mono line-clamp-3 overflow-hidden text-ellipsis whitespace-pre-wrap bg-[var(--surface)]/60 p-1.5 rounded border border-[var(--border)]/40 select-text">
                    {bm.sql}
                  </pre>

                  <div className="flex items-center justify-end gap-1 pt-1 border-t border-[var(--border)]/40">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(bm.sql)
                        setCopiedBmId(bm.id)
                        setTimeout(() => setCopiedBmId(null), 1500)
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
                      title="Copy SQL"
                    >
                      {copiedBmId === bm.id ? (
                        <Check className="w-2.5 h-2.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-2.5 h-2.5" />
                      )}
                      <span>{copiedBmId === bm.id ? 'Copied' : 'Copy'}</span>
                    </button>

                    <button
                      onClick={() => {
                        if (currentTab) {
                          updateSqlTabQuery(connId, currentTab.id, bm.sql)
                        }
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
                      title="Load into active tab"
                    >
                      <FileCode className="w-2.5 h-2.5" />
                      <span>Load</span>
                    </button>

                    <button
                      onClick={() => {
                        addSqlTab(connId, bm.name, bm.sql)
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
                      title="Open in new tab"
                    >
                      <FolderPlus className="w-2.5 h-2.5" />
                      <span>New Tab</span>
                    </button>

                    <button
                      onClick={() => {
                        if (currentTab) {
                          updateSqlTabQuery(connId, currentTab.id, bm.sql)
                          handleRun(bm.sql)
                        }
                      }}
                      disabled={isExecuting}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 disabled:opacity-40 transition-colors"
                      title="Run immediately"
                    >
                      <Play className="w-2.5 h-2.5" />
                      <span>Run</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Query History Drawer */}
      {isHistoryOpen && (
        <div className="absolute inset-y-0 right-0 w-80 md:w-96 max-w-full bg-[var(--surface)] border-l border-[var(--border)] z-30 flex flex-col shadow-2xl">
          {/* Drawer Header */}
          <div className="h-10 px-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg)] shrink-0">
            <div className="flex items-center gap-1.5 font-mono text-xs text-[var(--fg)]">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span className="font-semibold">Query History</span>
              <span className="text-[10px] text-[var(--muted)]">
                ({queryHistory.length})
              </span>
            </div>
            <div className="flex items-center gap-1">
              {queryHistory.length > 0 && (
                <button
                  onClick={clearQueryHistory}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-[var(--muted)] hover:text-red-400 hover:bg-red-950/20 transition-colors"
                  title="Clear all history"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              )}
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="text-[var(--muted)] hover:text-[var(--fg)] p-1 rounded hover:bg-[var(--hover)] transition-colors"
                title="Close history"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* History List */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {queryHistory.length === 0 ? (
              <div className="text-center py-10 text-xs text-[var(--muted)] font-mono">
                No queries executed yet.
              </div>
            ) : (
              queryHistory.map((item) => (
                <div
                  key={item.id}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded p-2.5 space-y-1.5 text-xs font-mono group hover:border-indigo-500/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--muted)]">
                    <div className="flex items-center gap-1.5 truncate">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          item.success ? 'bg-emerald-400' : 'bg-red-400'
                        }`}
                      />
                      <span className="truncate">
                        {formatRelativeTime(item.timestamp)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span>{item.durationMs}ms</span>
                      <span>{item.rowCount} rows</span>
                    </div>
                  </div>

                  <pre className="text-[11px] text-[var(--fg)] font-mono line-clamp-3 overflow-hidden text-ellipsis whitespace-pre-wrap bg-[var(--surface)]/60 p-1.5 rounded border border-[var(--border)]/40 select-text">
                    {item.sql}
                  </pre>

                  {item.error && (
                    <p className="text-[10px] text-red-400 truncate font-mono">
                      {item.error}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-1 pt-1 border-t border-[var(--border)]/40">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(item.sql)
                        setCopiedId(item.id)
                        setTimeout(() => setCopiedId(null), 1500)
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
                      title="Copy SQL"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-2.5 h-2.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-2.5 h-2.5" />
                      )}
                      <span>{copiedId === item.id ? 'Copied' : 'Copy'}</span>
                    </button>

                    <button
                      onClick={() => {
                        if (currentTab) {
                          updateSqlTabQuery(connId, currentTab.id, item.sql)
                        }
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
                      title="Load into editor"
                    >
                      <FileCode className="w-2.5 h-2.5" />
                      <span>Load</span>
                    </button>

                    <button
                      onClick={() => {
                        addSqlTab(connId, undefined, item.sql)
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
                      title="Open in new tab"
                    >
                      <FolderPlus className="w-2.5 h-2.5" />
                      <span>New Tab</span>
                    </button>

                    <button
                      onClick={() => {
                        if (currentTab) {
                          updateSqlTabQuery(connId, currentTab.id, item.sql)
                          handleRun(item.sql)
                        }
                      }}
                      disabled={isExecuting}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 disabled:opacity-40 transition-colors"
                      title="Run query immediately"
                    >
                      <Play className="w-2.5 h-2.5" />
                      <span>Run</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Parameter Prompt Modal */}
      {isParamModalOpen && (
        <ParameterPromptModal
          isOpen={isParamModalOpen}
          onClose={() => setIsParamModalOpen(false)}
          variables={detectedVariables}
          initialValues={currentTab?.params || {}}
          onRun={handleRunParameters}
          onSave={handleSaveParameters}
        />
      )}
    </div>
  )
}
