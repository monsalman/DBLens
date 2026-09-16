import React, { useState, useEffect, useMemo, useRef } from 'react'
import CodeMirror, { keymap, Prec } from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
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
} from 'lucide-react'
import { api } from '../../lib/api'
import type { QueryResult } from '../../lib/api'
import { useAppStore } from '../../stores/appStore'

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
    setActiveSqlTabId,
    addBookmark,
    deleteBookmark,
    openDryRunModal,
  } = useAppStore()

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

  const currentResult = currentTab ? tabResults[currentTab.id] ?? null : null
  const isExecuting = Boolean(currentTab && tabExecuting[currentTab.id])

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

  const executeRun = async (tabId: string, query: string) => {
    setTabExecuting((prev) => ({ ...prev, [tabId]: true }))
    const startTime = performance.now()

    try {
      const res = await api.executeQuery(connId, query)
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

  const handleRun = async (overrideSql?: string) => {
    if (!currentTab) return
    const tabId = currentTab.id
    const query = (overrideSql ?? currentTab.query).trim()
    if (!query || tabExecuting[tabId]) return

    const isDestructive = /\b(DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE|DELETE\s+FROM(?!\s+[\s\S]*?\bWHERE\b))\b/i.test(query)
    if (isDestructive) {
      openDryRunModal('Confirm Destructive Query', query, () => {
        executeRun(tabId, query)
      })
      return
    }

    await executeRun(tabId, query)
  }

  const runRef = useRef(handleRun)
  useEffect(() => {
    runRef.current = handleRun
  })

  const extensions = useMemo(() => {
    return [
      sql(),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              runRef.current()
              return true
            },
          },
        ])
      ),
    ]
  }, [])

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
            </div>

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

        {/* Results Pane */}
        {currentResult && (
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
    </div>
  )
}
