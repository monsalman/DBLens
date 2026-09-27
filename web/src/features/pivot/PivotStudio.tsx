import React, { useState } from 'react'
import {
  Table,
  Download,
  Copy,
  Check,
  Code2,
  Play,
  Sparkles,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  Database,
} from 'lucide-react'
import type { QueryResult } from '../../lib/api'
import { usePivot } from './usePivot'
import { PivotFieldRack } from './PivotFieldRack'
import { PivotGrid } from './PivotGrid'
import { inferPivotDefaults } from './pivotHelper'

interface PivotStudioProps {
  result: QueryResult | null | undefined
  connId?: string
  query?: string
  dialect?: string
}

export const PivotStudio: React.FC<PivotStudioProps> = ({
  result,
  connId,
  query,
  dialect = 'postgres',
}) => {
  const columns = result?.columns || []
  const rows = result?.rows || []

  const {
    config,
    updateConfig,
    matrix,
    heatShading,
    toggleHeatShading,
    minVal,
    maxVal,
    pushdownSQL,
    isGeneratingPushdown,
    pushdownError,
    pushdownResult,
    isRunningPushdown,
    serverError,
    generatePushdown,
    runPushdown,
    exportCSV,
    exportMarkdown,
    copyMarkdown,
  } = usePivot({
    columns,
    rows,
    connId,
    query,
    dialect,
  })

  const [isPushdownOpen, setIsPushdownOpen] = useState(false)
  const [selectedDialect, setSelectedDialect] = useState(dialect)
  const [isCopiedMD, setIsCopiedMD] = useState(false)
  const [isCopiedSQL, setIsCopiedSQL] = useState(false)

  const handleCopyMD = async () => {
    const success = await copyMarkdown()
    if (success) {
      setIsCopiedMD(true)
      setTimeout(() => setIsCopiedMD(false), 2000)
    }
  }

  const handleCopySQL = async () => {
    if (!pushdownSQL) return
    if (navigator?.clipboard) {
      await navigator.clipboard.writeText(pushdownSQL)
      setIsCopiedSQL(true)
      setTimeout(() => setIsCopiedSQL(false), 2000)
    }
  }

  const handleOpenPushdown = async () => {
    setIsPushdownOpen((prev) => !prev)
    if (!pushdownSQL && query && connId) {
      await generatePushdown(connId, query, selectedDialect)
    }
  }

  const handleGeneratePushdown = async (d?: string) => {
    if (!connId || !query) return
    await generatePushdown(connId, query, d || selectedDialect)
  }

  const handleRunPushdown = async () => {
    if (!connId || !query) return
    await runPushdown(connId, query, selectedDialect)
  }

  const handleResetDefaults = () => {
    const defaults = inferPivotDefaults(columns, rows)
    updateConfig(defaults)
  }

  if (!result || !result.rows || result.rows.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-[var(--muted)] text-center bg-[var(--bg)]">
        <Table className="w-10 h-10 text-[var(--border)] mb-3" />
        <h3 className="text-sm font-medium text-[var(--fg)]">No Query Results to Pivot</h3>
        <p className="text-xs mt-1 max-w-sm">
          Run a SQL query with data rows first, then switch to the Pivot tab to explore cross-tabulated views.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg)] overflow-hidden select-none font-sans">
      {/* 1. Header Toolbar */}
      <div className="h-9 border-b border-[var(--border)] px-3 flex items-center justify-between bg-[var(--surface)]/90 shrink-0 text-xs">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-[var(--fg)]">
            <Table className="w-3.5 h-3.5 text-indigo-400" />
            <span>Pivot Studio</span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono">
            {matrix.rowHeaders.length} rows × {matrix.colHeaders.length} cols
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          {/* SQL Pushdown Toggle Button */}
          {query && (
            <button
              type="button"
              onClick={handleOpenPushdown}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors border ${
                isPushdownOpen
                  ? 'bg-indigo-600 text-white border-indigo-600 font-medium'
                  : 'bg-[var(--surface)] hover:bg-[var(--hover)] text-[var(--fg)] border-[var(--border)]'
              }`}
              title="Generate server-side SQL pushdown for pivoting"
            >
              <Code2 className="w-3.5 h-3.5 text-indigo-300" />
              <span>SQL Pushdown</span>
              {isPushdownOpen ? (
                <ChevronUp className="w-3 h-3 ml-0.5" />
              ) : (
                <ChevronDown className="w-3 h-3 ml-0.5" />
              )}
            </button>
          )}

          {/* Export CSV Button */}
          <button
            type="button"
            onClick={() => exportCSV(`pivot-${Date.now()}.csv`)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface)] hover:bg-[var(--hover)] text-[var(--fg)] border border-[var(--border)] text-xs transition-colors"
            title="Export Pivot Matrix to CSV"
          >
            <Download className="w-3.5 h-3.5 text-blue-400" />
            <span>CSV</span>
          </button>

          {/* Export Markdown Button */}
          <button
            type="button"
            onClick={() => exportMarkdown(`pivot-${Date.now()}.md`)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface)] hover:bg-[var(--hover)] text-[var(--fg)] border border-[var(--border)] text-xs transition-colors"
            title="Export Pivot Matrix to Markdown table"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Markdown</span>
          </button>

          {/* Copy Markdown Button */}
          <button
            type="button"
            onClick={handleCopyMD}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface)] hover:bg-[var(--hover)] text-[var(--fg)] border border-[var(--border)] text-xs transition-colors"
            title="Copy Markdown table to clipboard"
          >
            {isCopiedMD ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-purple-400" />
                <span>Copy MD</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. Field Rack Controls */}
      <PivotFieldRack
        columns={columns}
        config={config}
        onChange={updateConfig}
        heatShading={heatShading}
        onToggleHeatShading={toggleHeatShading}
        onResetDefaults={handleResetDefaults}
      />

      {/* 3. SQL Pushdown Collapsible Drawer */}
      {isPushdownOpen && (
        <div className="border-b border-[var(--border)] bg-[var(--surface)] p-3 text-xs flex flex-col gap-2 shrink-0 animate-in slide-in-from-top-1 duration-150">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[var(--fg)] flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-indigo-400" />
                SQL Pushdown Generator
              </span>
              <span className="text-[10px] text-[var(--muted)]">
                Translates current pivot config into conditional aggregations and GROUP BY
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Dialect selector */}
              <div className="flex items-center gap-1 text-[11px] font-mono text-[var(--muted)]">
                <span>Dialect:</span>
                <select
                  value={selectedDialect}
                  onChange={(e) => {
                    setSelectedDialect(e.target.value)
                    handleGeneratePushdown(e.target.value)
                  }}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs text-[var(--fg)] focus:outline-none"
                >
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="sqlite">SQLite</option>
                </select>
              </div>

              {/* Generate button */}
              <button
                type="button"
                onClick={() => handleGeneratePushdown()}
                disabled={isGeneratingPushdown}
                className="px-2.5 py-0.5 rounded bg-[var(--bg)] hover:bg-[var(--hover)] border border-[var(--border)] text-[var(--fg)] text-xs flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>{isGeneratingPushdown ? 'Generating...' : 'Refresh SQL'}</span>
              </button>

              {/* Copy SQL */}
              {pushdownSQL && (
                <button
                  type="button"
                  onClick={handleCopySQL}
                  className="px-2 py-0.5 rounded bg-[var(--bg)] hover:bg-[var(--hover)] border border-[var(--border)] text-[var(--fg)] text-xs flex items-center gap-1 transition-colors"
                >
                  {isCopiedSQL ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 text-indigo-400" />
                      <span>Copy SQL</span>
                    </>
                  )}
                </button>
              )}

              {/* Run Pushdown on Database */}
              {connId && (
                <button
                  type="button"
                  onClick={handleRunPushdown}
                  disabled={isRunningPushdown || !pushdownSQL}
                  className="px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1 transition-colors disabled:opacity-50"
                  title="Execute pushdown query directly on the database connection"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>{isRunningPushdown ? 'Running...' : 'Run on DB'}</span>
                </button>
              )}
            </div>
          </div>

          {pushdownError && (
            <div className="p-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{pushdownError}</span>
            </div>
          )}

          {serverError && (
            <div className="p-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          {pushdownSQL ? (
            <pre className="p-2.5 bg-[var(--bg)] border border-[var(--border)] rounded font-mono text-[11px] text-emerald-400 overflow-x-auto max-h-48 whitespace-pre leading-relaxed select-text">
              {pushdownSQL}
            </pre>
          ) : (
            <div className="py-4 text-center text-[var(--muted)] text-xs italic">
              Click &quot;Refresh SQL&quot; to compile database-native pivot query.
            </div>
          )}

          {pushdownResult?.result && (
            <div className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] rounded flex items-center justify-between">
              <span>
                Server executed query in <strong>{pushdownResult.result.elapsed ?? 0}ms</strong> ({pushdownResult.result.rows?.length ?? 0} rows returned).
              </span>
            </div>
          )}
        </div>
      )}

      {/* 4. Pivot Grid View */}
      <PivotGrid
        matrix={matrix}
        config={config}
        heatShading={heatShading}
        minVal={minVal}
        maxVal={maxVal}
      />
    </div>
  )
}
