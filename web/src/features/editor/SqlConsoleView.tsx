import React, { useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  Play,
  Clock,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Sparkles,
  History,
} from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { api, type QueryResult } from '../../lib/api'

export const SqlConsoleView: React.FC = () => {
  const {
    activeConnectionId,
    queryHistory,
    addQueryHistory,
    clearQueryHistory,
  } = useAppStore()

  const [query, setQuery] = useState<string>(
    'SELECT * FROM users ORDER BY created_at DESC LIMIT 20;'
  )
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [activeSubTab, setActiveSubTab] = useState<'result' | 'history'>('result')

  const handleRunQuery = async () => {
    if (!activeConnectionId || !query.trim()) return
    setIsRunning(true)

    try {
      const res = await api.executeQuery(activeConnectionId, query)
      setResult(res)
      setActiveSubTab('result')

      // Save to history
      addQueryHistory({
        id: `hist_${Date.now()}`,
        sql: query,
        timestamp: Date.now(),
        durationMs: res.durationMs,
        success: !res.error,
        rowCount: res.rows?.length || res.affectedRows || 0,
        error: res.error,
      })
    } catch (err: any) {
      setResult({
        columns: [],
        rows: [],
        durationMs: 0,
        error: err?.message || 'Failed to execute query',
      })
    } finally {
      setIsRunning(false)
    }
  }

  const handleFormatSql = () => {
    // Simple basic keyword uppercase formatting
    const keywords = [
      'SELECT',
      'FROM',
      'WHERE',
      'INSERT INTO',
      'UPDATE',
      'DELETE',
      'JOIN',
      'LEFT JOIN',
      'RIGHT JOIN',
      'GROUP BY',
      'ORDER BY',
      'LIMIT',
      'OFFSET',
      'HAVING',
      'AS',
      'ON',
      'AND',
      'OR',
    ]

    let formatted = query
    keywords.forEach((kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, 'gi')
      formatted = formatted.replace(regex, kw)
    })
    setQuery(formatted)
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden">
      {/* Editor & Action Bar */}
      <div className="flex flex-col border-b border-zinc-800 bg-zinc-900/30">
        {/* Editor Controls */}
        <div className="h-11 px-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleRunQuery}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium transition-all shadow-sm shadow-emerald-600/20 disabled:opacity-50"
            >
              <Play className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : 'fill-white'}`} />
              <span>{isRunning ? 'Running...' : 'Run (Ctrl+Enter)'}</span>
            </button>

            <button
              onClick={handleFormatSql}
              className="flex items-center gap-1 px-2.5 py-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded text-xs transition-colors"
              title="Format SQL Keywords"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Format</span>
            </button>

            <button
              onClick={() => setQuery('')}
              className="flex items-center gap-1 px-2 py-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded text-xs transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveSubTab('result')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                activeSubTab === 'result'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Results
            </button>
            <button
              onClick={() => setActiveSubTab('history')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                activeSubTab === 'history'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>History ({queryHistory.length})</span>
            </button>
          </div>
        </div>

        {/* CodeMirror Editor Area */}
        <div
          className="h-52 overflow-hidden text-sm"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              handleRunQuery()
            }
          }}
        >
          <CodeMirror
            value={query}
            height="208px"
            theme={oneDark}
            extensions={[sql()]}
            onChange={(val) => setQuery(val)}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightSpecialChars: true,
              history: true,
              foldGutter: true,
              drawSelection: true,
              dropCursor: true,
              allowMultipleSelections: true,
              indentOnInput: true,
              syntaxHighlighting: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: true,
              rectangularSelection: true,
              crosshairCursor: true,
              highlightActiveLine: true,
              highlightSelectionMatches: true,
              closeBracketsKeymap: true,
              defaultKeymap: true,
              searchKeymap: true,
              historyKeymap: true,
              foldKeymap: true,
              completionKeymap: true,
              lintKeymap: true,
            }}
          />
        </div>
      </div>

      {/* Bottom Area: Results or History */}
      <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
        {activeSubTab === 'result' ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Status Bar */}
            {result && (
              <div className="h-8 border-b border-zinc-800 px-4 flex items-center justify-between bg-zinc-900/60 text-xs shrink-0">
                <div className="flex items-center gap-3">
                  {result.error ? (
                    <div className="flex items-center gap-1.5 text-red-400 font-medium">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Execution Error</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        Success — {result.rows ? `${result.rows.length} rows returned` : `${result.affectedRows || 0} rows affected`}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 text-zinc-400 font-mono">
                  <Clock className="w-3 h-3" />
                  <span>{result.durationMs}ms</span>
                </div>
              </div>
            )}

            {/* Content Table or Error Banner */}
            <div className="flex-1 overflow-auto">
              {result?.error ? (
                <div className="p-4">
                  <div className="p-4 rounded-lg bg-red-950/30 border border-red-800/40 text-red-300 font-mono text-xs whitespace-pre-wrap">
                    {result.error}
                  </div>
                </div>
              ) : result?.rows && result.rows.length > 0 ? (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800 z-10">
                    <tr>
                      {result.columns.map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 text-xs font-mono font-medium text-zinc-400 border-r border-zinc-800 whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-zinc-800/50 hover:bg-zinc-900/40 transition-colors"
                      >
                        {result.columns.map((col) => (
                          <td
                            key={col}
                            className="px-3 py-1.5 text-xs font-mono text-zinc-300 border-r border-zinc-800/50 whitespace-nowrap truncate max-w-xs select-text"
                          >
                            {row[col] === null || row[col] === undefined ? (
                              <span className="text-zinc-600 italic">NULL</span>
                            ) : (
                              String(row[col])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flex-1 h-full flex flex-col items-center justify-center text-zinc-600 text-xs py-16">
                  <span>Write a query and press Run (Ctrl+Enter)</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* History Sub-tab */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="h-8 border-b border-zinc-800 px-4 flex items-center justify-between bg-zinc-900/60 text-xs shrink-0">
              <span className="text-zinc-400 font-medium">Recent SQL Queries</span>
              <button
                onClick={clearQueryHistory}
                className="text-zinc-500 hover:text-zinc-300 text-[11px]"
              >
                Clear History
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60 p-2 space-y-1">
              {queryHistory.map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 rounded-lg bg-zinc-900/40 hover:bg-zinc-900 border border-zinc-800/60 transition-all flex items-start justify-between gap-4"
                >
                  <div className="space-y-1 flex-1 overflow-hidden">
                    <pre className="font-mono text-xs text-zinc-200 truncate select-text">
                      {item.sql}
                    </pre>
                    <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                      <span className={item.success ? 'text-emerald-400' : 'text-red-400'}>
                        {item.success ? 'Success' : 'Failed'}
                      </span>
                      <span>{item.rowCount} rows</span>
                      <span>{item.durationMs}ms</span>
                      <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setQuery(item.sql)
                      setActiveSubTab('result')
                    }}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium shrink-0 transition-colors"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
