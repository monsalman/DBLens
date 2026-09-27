import React, { useState } from 'react'
import {
  Copy,
  Check,
  Play,
  ArrowRight,
  AlertTriangle,
  Code,
  Loader2,
} from 'lucide-react'

interface LiveSqlPreviewPaneProps {
  sql: string
  dialect: string
  onDialectChange: (dialect: string) => void
  onRunQuery: () => void
  onSendToEditor: () => void
  isRunning?: boolean
  warnings?: string[]
  error?: string | null
}

export const LiveSqlPreviewPane: React.FC<LiveSqlPreviewPaneProps> = ({
  sql,
  dialect,
  onDialectChange,
  onRunQuery,
  onSendToEditor,
  isRunning = false,
  warnings = [],
  error = null,
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sql)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#111318] border-l border-[var(--border)] font-sans text-xs">
      {/* Pane Header */}
      <div className="px-3 py-2 bg-[#16181d] border-b border-[var(--border)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Code className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-semibold text-white">Live SQL Preview</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Dialect selector */}
          <select
            value={dialect}
            onChange={(e) => onDialectChange(e.target.value)}
            className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-0.5 text-[11px] text-[var(--fg)] outline-none cursor-pointer font-mono"
          >
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
            <option value="sqlite">SQLite</option>
          </select>

          {/* Copy Button */}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-[var(--surface)] hover:bg-[var(--hover)] text-[var(--fg)] border border-[var(--border)] transition-colors cursor-pointer"
            title="Copy generated SQL"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Warnings Banner */}
      {warnings && warnings.length > 0 && (
        <div className="px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-[11px] flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <div className="flex-1 truncate">{warnings[0]}</div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="px-3 py-1.5 bg-rose-500/10 border-b border-rose-500/20 text-rose-300 text-[11px] flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <div className="flex-1">{error}</div>
        </div>
      )}

      {/* SQL Code Body */}
      <div className="flex-1 p-3 overflow-auto bg-[#0d0e12] select-text">
        <pre className="font-mono text-[11.5px] leading-relaxed text-indigo-100 whitespace-pre-wrap">
          {sql}
        </pre>
      </div>

      {/* Pane Footer Actions */}
      <div className="p-2.5 bg-[#16181d] border-t border-[var(--border)] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSendToEditor}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--surface)] hover:bg-[var(--hover)] text-indigo-300 border border-indigo-500/30 text-xs font-medium transition-colors cursor-pointer"
          title="Paste this SQL query into the active tab of SQL Console"
        >
          <span>Send to SQL Editor</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onRunQuery}
          disabled={isRunning || !sql || sql.startsWith('--')}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer"
          title="Execute query immediately and display results"
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
      </div>
    </div>
  )
}
