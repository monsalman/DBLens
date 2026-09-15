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
  const [sqlText, setSqlText] = useState('SELECT * FROM users LIMIT 10;')
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const { queryHistory, addQueryHistory, clearQueryHistory } = useAppStore()

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

  const handleRun = async (overrideSql?: string) => {
    const query = (overrideSql ?? sqlText).trim()
    if (!query || executing) return
    setExecuting(true)
    const startTime = performance.now()

    try {
      const res = await api.executeQuery(connId, query)
      const durationMs = Math.round(res.durationMs || (performance.now() - startTime))
      const rowCount = res.rows?.length ?? res.affectedRows ?? 0
      const isSuccess = !res.error

      setResult(res)
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
      setResult({ columns: [], rows: [], durationMs, error: errorMsg })
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
      setExecuting(false)
    }
  }

  const runRef = useRef(handleRun)
  runRef.current = handleRun

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

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg)] overflow-hidden relative">
      {/* Main Console Body */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* Editor Pane */}
        <div className="flex-1 flex flex-col min-h-0 border-b border-[var(--border)] overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto">
            <CodeMirror
              value={sqlText}
              height="100%"
              theme={isDark ? oneDark : 'light'}
              extensions={extensions}
              onChange={(val) => setSqlText(val)}
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
          </div>

          <div className="h-10 border-t border-[var(--border)] px-3 flex items-center justify-between shrink-0 bg-[var(--bg)]">
            <div className="flex items-center gap-3">
              <kbd className="text-[10px] text-[var(--muted)] font-mono">
                <span className="text-[var(--fg)]">Ctrl</span>+Enter Run
              </kbd>
              <button
                onClick={() => setIsHistoryOpen((prev) => !prev)}
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
            </div>

            <button
              id="dblens-run-query-btn"
              onClick={() => handleRun()}
              disabled={executing || !sqlText.trim()}
              className="btn-primary flex items-center gap-1.5 disabled:opacity-40 text-xs px-3 py-1"
            >
              {executing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>{executing ? 'Running...' : 'Run Query'}</span>
            </button>
          </div>
        </div>

        {/* Results Pane */}
        {result && (
          <div className="flex-1 flex flex-col min-h-0 overflow-auto">
            {result.error ? (
              <div className="p-4 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <pre className="text-xs text-red-400 font-mono whitespace-pre-wrap">
                  {result.error}
                </pre>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Summary bar */}
                <div className="h-8 border-b border-[var(--border)] px-3 flex items-center gap-3 text-[11px] text-[var(--muted)] font-mono shrink-0 bg-[var(--surface)]/50">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {result.durationMs}ms
                  </span>
                  <span className="flex items-center gap-1">
                    <Rows className="w-3 h-3" />
                    {result.rows?.length ?? 0} rows
                  </span>
                </div>

                {/* Data table */}
                {(result.rows?.length ?? 0) > 0 && (
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-[var(--bg)] z-10">
                        <tr>
                          {(result.columns ?? []).map((c) => (
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
                        {(result.rows ?? []).slice(0, 100).map((row, i) => (
                          <tr
                            key={i}
                            className="border-b border-[var(--border)] hover:bg-[var(--hover)]"
                          >
                            {(result.columns ?? []).map((c) => (
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
                {(result.rows?.length ?? 0) === 0 && (
                  <div className="p-8 text-center text-[11px] text-[var(--muted)] font-mono">
                    No results
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

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
                      onClick={() => setSqlText(item.sql)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
                      title="Load into editor"
                    >
                      <FileCode className="w-2.5 h-2.5" />
                      <span>Load</span>
                    </button>

                    <button
                      onClick={() => {
                        setSqlText(item.sql)
                        handleRun(item.sql)
                      }}
                      disabled={executing}
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
