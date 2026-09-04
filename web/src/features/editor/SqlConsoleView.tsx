import React, { useState, useRef } from 'react'
import { Play, Loader2, Clock, Rows, AlertCircle } from 'lucide-react'
import { api } from '../../lib/api'
import type { QueryResult } from '../../lib/api'

interface Props { connId: string }

export const SqlConsoleView: React.FC<Props> = ({ connId }) => {
  const [sqlText, setSqlText] = useState('SELECT * FROM users LIMIT 10;')
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleRun = async () => {
    if (!sqlText.trim() || executing) return
    setExecuting(true)
    try {
      const res = await api.executeQuery(connId, sqlText)
      setResult(res)
    } catch (err: any) {
      setResult({ columns: [], rows: [], durationMs: 0, error: err.message })
    } finally {
      setExecuting(false)
    }
  }

  const formatForCmdEnter = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleRun()
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg)] overflow-hidden">
      {/* Editor */}
      <div className="flex-1 flex flex-col border-b border-[var(--border)]">
        <textarea ref={textareaRef} value={sqlText} onChange={e => setSqlText(e.target.value)} onKeyDown={formatForCmdEnter}
          className="flex-1 w-full bg-[var(--bg)] border-none text-xs font-mono text-[var(--fg)] px-4 pt-4 pb-3 resize-none focus:outline-none"
          placeholder="Write your SQL query..." spellCheck={false} />
        
        <div className="h-10 border-t border-[var(--border)] px-3 flex items-center justify-between shrink-0">
          <kbd className="text-[10px] text-[var(--muted)] font-mono"><span className="text-[var(--fg)]">Ctrl</span>+Enter Run</kbd>
          <button onClick={handleRun} disabled={executing || !sqlText.trim()} className="btn-primary flex items-center gap-1.5 disabled:opacity-40">
            {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            <span>{executing ? 'Running...' : 'Run Query'}</span>
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="flex-1 overflow-auto">
          {result.error ? (
            <div className="p-4 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <pre className="text-xs text-red-400 font-mono">{result.error}</pre>
            </div>
          ) : (
            <div>
              {/* Summary bar */}
              <div className="h-8 border-b border-[var(--border)] px-3 flex items-center gap-3 text-[11px] text-[var(--muted)] font-mono shrink-0">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{result.durationMs}ms</span>
                <span className="flex items-center gap-1"><Rows className="w-3 h-3" />{result.rows?.length ?? 0} rows</span>
              </div>
              
              {/* Data table */}
              {(result.rows?.length ?? 0) > 0 && (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[var(--bg)]">
                    <tr>
                      {(result.columns ?? []).map(c => (
                        <th key={c} className="px-3 py-1.5 text-[10px] text-[var(--muted)] font-mono border-r border-[var(--border)]">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(result.rows ?? []).slice(0, 100).map((row, i) => (
                      <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--hover)]">
                        {(result.columns ?? []).map(c => (
                          <td key={c} className="px-3 py-1.5 font-mono-data text-[var(--fg)] truncate max-w-[280px]">{row[c]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {(result.rows?.length ?? 0) === 0 && (
                <div className="p-8 text-center text-[11px] text-[var(--muted)] font-mono">No results</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
