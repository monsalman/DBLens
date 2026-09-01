import React, { useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { Play, Clock } from 'lucide-react'
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

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0c0e] overflow-hidden select-none">
      {/* Top Toolbar */}
      <div className="h-9 border-b border-white/[0.06] px-2.5 flex items-center justify-between bg-[#0b0c0e] shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRunQuery}
            disabled={isRunning}
            className="btn-primary flex items-center gap-1 px-2.5 py-0.5 text-xs disabled:opacity-40"
          >
            <Play className={`w-3 h-3 ${isRunning ? 'animate-spin' : 'fill-white'}`} />
            <span>{isRunning ? 'Running...' : 'Run'}</span>
          </button>
          <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline-block">Ctrl+Enter</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveSubTab('result')}
            className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
              activeSubTab === 'result'
                ? 'bg-white/[0.08] text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Results
          </button>
          <button
            onClick={() => setActiveSubTab('history')}
            className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
              activeSubTab === 'history'
                ? 'bg-white/[0.08] text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            History ({queryHistory.length})
          </button>
        </div>
      </div>

      {/* Editor Area */}
      <div
        className="h-44 border-b border-white/[0.06] overflow-hidden"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            handleRunQuery()
          }
        }}
      >
        <CodeMirror
          value={query}
          height="176px"
          theme={oneDark}
          extensions={[sql()]}
          onChange={(val) => setQuery(val)}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: false,
            foldGutter: false,
          }}
        />
      </div>

      {/* Results / History Container */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#0b0c0e]">
        {activeSubTab === 'result' ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Status Bar */}
            {result && (
              <div className="h-7 border-b border-white/[0.06] px-3 flex items-center justify-between bg-white/[0.01] text-[11px] font-mono shrink-0">
                {result.error ? (
                  <span className="text-red-400">Error executing SQL</span>
                ) : (
                  <span className="text-emerald-400">
                    {result.rows ? `${result.rows.length} rows` : `${result.affectedRows || 0} affected`}
                  </span>
                )}
                <span className="text-zinc-500 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {result.durationMs}ms
                </span>
              </div>
            )}

            {/* Table or Message */}
            <div className="flex-1 overflow-auto">
              {result?.error ? (
                <div className="p-3 text-red-400 font-mono text-xs whitespace-pre-wrap">
                  {result.error}
                </div>
              ) : result?.rows && result.rows.length > 0 ? (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#0e1013] border-b border-white/[0.06] z-10">
                    <tr>
                      {result.columns.map((col) => (
                        <th
                          key={col}
                          className="px-2 py-1 text-[11px] font-mono font-medium text-zinc-400 border-r border-white/[0.06] whitespace-nowrap bg-[#0e1013]"
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
                        className="border-b border-white/[0.04] hover:bg-white/[0.02]"
                      >
                        {result.columns.map((col) => (
                          <td
                            key={col}
                            className="px-2 py-1 text-xs font-mono text-zinc-300 border-r border-white/[0.04] whitespace-nowrap truncate max-w-xs select-text"
                          >
                            {row[col] === null || row[col] === undefined ? (
                              <span className="text-zinc-600 italic">null</span>
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
                <div className="flex-1 h-full flex items-center justify-center text-zinc-600 text-xs font-mono py-12">
                  Execute a query to see results
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="h-7 border-b border-white/[0.06] px-3 flex items-center justify-between bg-white/[0.01] text-[11px] font-mono shrink-0">
              <span className="text-zinc-400">History</span>
              <button
                onClick={clearQueryHistory}
                className="text-zinc-500 hover:text-zinc-300 text-[10px]"
              >
                Clear
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04] p-1">
              {queryHistory.map((item) => (
                <div
                  key={item.id}
                  className="p-2 hover:bg-white/[0.02] flex items-center justify-between gap-3 text-xs font-mono"
                >
                  <div className="flex-1 truncate">
                    <div className="text-zinc-200 truncate select-text">{item.sql}</div>
                    <div className="text-[10px] text-zinc-500 flex gap-2 mt-0.5">
                      <span className={item.success ? 'text-emerald-400' : 'text-red-400'}>
                        {item.success ? `${item.rowCount} rows` : 'failed'}
                      </span>
                      <span>{item.durationMs}ms</span>
                      <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setQuery(item.sql)
                      setActiveSubTab('result')
                    }}
                    className="btn-secondary px-2 py-0.5 text-[11px] shrink-0"
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
