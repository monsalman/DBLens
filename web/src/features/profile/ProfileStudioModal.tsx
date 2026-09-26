import React, { useState } from 'react'
import {
  X,
  Download,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  Columns3,
  ArrowRightLeft,
  Shield,
  Lightbulb,
  Terminal,
} from 'lucide-react'
import { buildProfileCliCommand, copyCliCommand } from '../cli/cliHelper'
import type { ConnectionConfig } from '../../lib/api'
import { useProfile } from './useProfile'
import { ValueDistributionBars } from './ValueDistributionBars'
import { Histogram } from './Histogram'
import { ColumnProfileCard } from './ColumnProfileCard'
import {
  formatNumber,
  formatPercentage,
  formatMetricVal,
  qualityBadgeColor,
  generateMarkdownReport,
  type ColumnProfile,
} from './profileHelper'

interface ProfileStudioModalProps {
  isOpen: boolean
  onClose: () => void
  connId: string
  dsn: string
  table: string
  schema?: string
  profiles?: ConnectionConfig[]
  availableTables?: string[]
}

type ActiveTab = 'columns' | 'suggestions' | 'compare'

export const ProfileStudioModal: React.FC<ProfileStudioModalProps> = ({
  isOpen,
  onClose,
  connId,
  dsn,
  table,
  schema,
  profiles,
  availableTables = [],
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('columns')
  const [copiedReport, setCopiedReport] = useState(false)
  const [copiedCLI, setCopiedCLI] = useState(false)
  const [copiedRemediationIdx, setCopiedRemediationIdx] = useState<number | null>(null)
  const [targetTable, setTargetTable] = useState<string>('')
  const [columnSearch, setColumnSearch] = useState<string>('')

  const handleCopyCLI = async () => {
    const cmd = buildProfileCliCommand({
      conn: dsn || connId || 'conn',
      table,
      schema,
      format: 'text',
    })
    await copyCliCommand(cmd)
    setCopiedCLI(true)
    setTimeout(() => setCopiedCLI(false), 2000)
  }

  const {
    report,
    selectedColumn,
    setSelectedColumn,
    compareResult,
    loading,
    compareLoading,
    error,
    sampleRows,
    setSampleRows,
    fetchProfile,
    runCompare,
  } = useProfile({
    connId,
    dsn,
    table,
    schema,
    profiles,
    autoLoad: isOpen,
  })

  if (!isOpen) return null

  const handleCopyReport = async () => {
    if (!report) return
    const md = generateMarkdownReport(report)
    await navigator.clipboard.writeText(md)
    setCopiedReport(true)
    setTimeout(() => setCopiedReport(false), 2000)
  }

  const handleExportMarkdown = () => {
    if (!report) return
    const md = generateMarkdownReport(report)
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `profile-${table}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleCopySQL = async (sql: string, idx: number) => {
    await navigator.clipboard.writeText(sql)
    setCopiedRemediationIdx(idx)
    setTimeout(() => setCopiedRemediationIdx(null), 2000)
  }

  const filteredColumns = (report?.columns || []).filter(c =>
    c.columnName.toLowerCase().includes(columnSearch.toLowerCase())
  )

  const qualityBadge = qualityBadgeColor(report?.qualityScore ?? 100)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-6xl h-[88vh] bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[var(--fg)] font-sans animate-in fade-in zoom-in-95 duration-150">
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-sm tracking-tight text-[var(--fg)] font-mono">
                  {schema ? `${schema}.${table}` : table}
                </h2>
                <span className="text-[10px] font-mono text-[var(--muted)] px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)]">
                  Dataset Profiling Studio
                </span>
                {report && (
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-mono font-medium px-2 py-0.5 rounded-full border ${qualityBadge.bg} ${qualityBadge.text} ${qualityBadge.border}`}
                  >
                    <TrendingUp className="w-3 h-3" />
                    <span>Quality: {report.qualityScore.toFixed(1)}%</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Column distributions, null percentages, uniqueness heuristics & PII safety audits
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {/* Sampling Selector */}
            <div className="flex items-center gap-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-xs font-mono">
              <span className="text-[var(--muted)] text-[11px]">Sample:</span>
              <select
                value={sampleRows}
                onChange={e => {
                  const val = Number(e.target.value)
                  setSampleRows(val)
                  fetchProfile(val)
                }}
                disabled={loading}
                className="bg-transparent text-[var(--fg)] focus:outline-hidden cursor-pointer text-xs"
              >
                <option value={1000} className="bg-[var(--bg)]">1,000</option>
                <option value={5000} className="bg-[var(--bg)]">5,000</option>
                <option value={10000} className="bg-[var(--bg)]">10,000</option>
                <option value={0} className="bg-[var(--bg)]">All Rows</option>
              </select>
            </div>

            <button
              onClick={() => fetchProfile()}
              disabled={loading}
              title="Re-run profiling"
              className="p-1.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={handleCopyCLI}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--border)] text-xs font-mono text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
              title="Copy equivalent DBLens CLI command"
            >
              {copiedCLI ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">CLI Copied!</span>
                </>
              ) : (
                <>
                  <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                  <span>&gt;_ CLI</span>
                </>
              )}
            </button>

            <button
              onClick={handleCopyReport}
              disabled={!report || loading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--border)] text-xs font-mono text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors disabled:opacity-50"
            >
              {copiedReport ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Report</span>
                </>
              )}
            </button>

            <button
              onClick={handleExportMarkdown}
              disabled={!report || loading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-medium transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export MD</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-4 px-5 border-b border-[var(--border)] bg-[var(--surface)]/50 shrink-0 text-xs font-mono">
          <button
            onClick={() => setActiveTab('columns')}
            className={`py-2.5 border-b-2 flex items-center gap-1.5 font-medium transition-colors ${
              activeTab === 'columns'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            <Columns3 className="w-3.5 h-3.5" />
            <span>Columns ({report?.columns.length || 0})</span>
          </button>

          <button
            onClick={() => setActiveTab('suggestions')}
            className={`py-2.5 border-b-2 flex items-center gap-1.5 font-medium transition-colors ${
              activeTab === 'suggestions'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            <Lightbulb className="w-3.5 h-3.5" />
            <span>Suggestions</span>
            {report?.suggestions && report.suggestions.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-300 font-bold">
                {report.suggestions.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('compare')}
            className={`py-2.5 border-b-2 flex items-center gap-1.5 font-medium transition-colors ${
              activeTab === 'compare'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>Drift Comparison</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-hidden relative">
          {error && (
            <div className="m-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-mono flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading && !report ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-xs font-mono text-[var(--muted)]">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
              <span>Running deep column profiling queries...</span>
            </div>
          ) : activeTab === 'columns' ? (
            <div className="flex h-full overflow-hidden">
              {/* Left Rail: Column list */}
              <div className="w-80 border-r border-[var(--border)] flex flex-col h-full bg-[var(--surface)]/30 shrink-0">
                <div className="p-3 border-b border-[var(--border)]">
                  <input
                    type="text"
                    placeholder="Filter columns..."
                    value={columnSearch}
                    onChange={e => setColumnSearch(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-xs font-mono placeholder:text-[var(--muted)] focus:outline-hidden focus:border-indigo-500"
                  />
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                  {filteredColumns.map(col => (
                    <ColumnProfileCard
                      key={col.columnName}
                      column={col}
                      isSelected={selectedColumn?.columnName === col.columnName}
                      onSelect={() => setSelectedColumn(col)}
                    />
                  ))}
                  {filteredColumns.length === 0 && (
                    <div className="text-center py-8 text-xs text-[var(--muted)] font-mono">
                      No matching columns
                    </div>
                  )}
                </div>
              </div>

              {/* Right Detail Pane */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {selectedColumn ? (
                  <ColumnDetailView column={selectedColumn} totalRows={report?.totalRows || 0} />
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-[var(--muted)] font-mono">
                    Select a column from the left rail to view metrics and distribution
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'suggestions' ? (
            <div className="h-full overflow-y-auto p-6 space-y-4 max-w-4xl mx-auto">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div>
                  <h3 className="text-sm font-semibold font-mono text-[var(--fg)]">
                    Actionable Data Quality Suggestions
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    Rule-based recommendations for constraints, indexes, cleanups, and privacy
                  </p>
                </div>
                <span className="text-xs font-mono text-[var(--muted)]">
                  {report?.suggestions.length || 0} suggestions generated
                </span>
              </div>

              {report?.suggestions && report.suggestions.length > 0 ? (
                report.suggestions.map((s, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                            s.severity === 'high'
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                              : s.severity === 'medium'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                          }`}
                        >
                          {s.severity}
                        </span>
                        <h4 className="text-xs font-mono font-semibold text-[var(--fg)]">
                          {s.title}
                        </h4>
                      </div>
                      {s.columnName && (
                        <span className="text-[11px] font-mono text-[var(--muted)] px-2 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)]">
                          {s.columnName}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      {s.description}
                    </p>

                    {s.remediation && (
                      <div className="relative mt-2 rounded bg-[var(--bg)] border border-[var(--border)] p-2.5 font-mono text-xs text-sky-300">
                        <div className="flex items-center justify-between text-[10px] text-[var(--muted)] mb-1">
                          <span>Remediation SQL:</span>
                          <button
                            onClick={() => handleCopySQL(s.remediation!, idx)}
                            className="flex items-center gap-1 hover:text-[var(--fg)] transition-colors"
                          >
                            {copiedRemediationIdx === idx ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            <span>{copiedRemediationIdx === idx ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                        <code>{s.remediation}</code>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-[var(--muted)] font-mono text-xs">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                  <span>No data quality issues or constraint warnings found!</span>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-6 space-y-6 max-w-5xl mx-auto">
              <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
                <h3 className="text-xs font-mono font-semibold text-[var(--fg)]">
                  Compare Profile with Another Table (Drift Analysis)
                </h3>
                <div className="flex items-center gap-3">
                  <select
                    value={targetTable}
                    onChange={e => setTargetTable(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-xs font-mono text-[var(--fg)] focus:outline-hidden"
                  >
                    <option value="">Select target table to compare...</option>
                    {availableTables
                      .filter(t => t !== table)
                      .map(t => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => runCompare(targetTable)}
                    disabled={!targetTable || compareLoading}
                    className="px-4 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-medium disabled:opacity-50 transition-colors"
                  >
                    {compareLoading ? 'Comparing...' : 'Run Comparison'}
                  </button>
                </div>
              </div>

              {compareResult && (
                <div className="space-y-4">
                  <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-xs font-mono text-indigo-300">
                    {compareResult.summary}
                  </div>

                  <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-[var(--surface)] text-[var(--muted)] border-b border-[var(--border)]">
                        <tr>
                          <th className="p-3">Column</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Base Null %</th>
                          <th className="p-3">Target Null %</th>
                          <th className="p-3">Null % Delta</th>
                          <th className="p-3">Distinct Delta</th>
                          <th className="p-3">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {compareResult.columnDiffs.map(cd => (
                          <tr key={cd.columnName} className="hover:bg-[var(--hover)]">
                            <td className="p-3 font-semibold text-[var(--fg)]">
                              {cd.columnName}
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  cd.status === 'added'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : cd.status === 'removed'
                                    ? 'bg-rose-500/20 text-rose-400'
                                    : cd.status === 'changed'
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'bg-zinc-500/20 text-zinc-400'
                                }`}
                              >
                                {cd.status}
                              </span>
                            </td>
                            <td className="p-3 text-[var(--muted)]">
                              {formatPercentage(cd.baseNullPct)}
                            </td>
                            <td className="p-3 text-[var(--muted)]">
                              {formatPercentage(cd.targetNullPct)}
                            </td>
                            <td className="p-3">
                              <span
                                className={
                                  cd.nullPctDiff > 0
                                    ? 'text-rose-400'
                                    : cd.nullPctDiff < 0
                                    ? 'text-emerald-400'
                                    : 'text-[var(--muted)]'
                                }
                              >
                                {cd.nullPctDiff > 0 ? `+${cd.nullPctDiff}%` : `${cd.nullPctDiff}%`}
                              </span>
                            </td>
                            <td className="p-3 text-[var(--fg)]">
                              {cd.distinctDiff > 0 ? `+${cd.distinctDiff}` : cd.distinctDiff}
                            </td>
                            <td className="p-3 text-[var(--muted)] text-[11px]">
                              {cd.notes.join(', ') || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ColumnDetailView({
  column,
  totalRows,
}: {
  column: ColumnProfile
  totalRows: number
}) {
  const isNumeric = column.minVal !== undefined && column.maxVal !== undefined

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex items-start justify-between border-b border-[var(--border)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold font-mono text-[var(--fg)]">
              {column.columnName}
            </h3>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)]">
              {column.dataType}
            </span>
            {column.piiType && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium bg-purple-500/15 text-purple-400 border border-purple-500/30">
                <Shield className="w-3.5 h-3.5" />
                PII: {column.piiType.toUpperCase()}
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--muted)] font-mono mt-1">
            Profiling over {formatNumber(column.totalRows || totalRows)} rows
          </p>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono">
        <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <span className="text-[11px] text-[var(--muted)] block">Nulls</span>
          <span className="text-sm font-semibold text-[var(--fg)] mt-1 block">
            {formatNumber(column.nullCount)}
          </span>
          <span className="text-[10px] text-[var(--muted)]">
            {formatPercentage(column.nullPercentage)} of rows
          </span>
        </div>

        <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <span className="text-[11px] text-[var(--muted)] block">Distinct Values</span>
          <span className="text-sm font-semibold text-[var(--fg)] mt-1 block">
            {formatNumber(column.distinctCount)}
          </span>
          <span className="text-[10px] text-[var(--muted)]">
            {formatPercentage(column.uniquenessRatio * 100)} uniqueness
          </span>
        </div>

        {isNumeric ? (
          <>
            <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
              <span className="text-[11px] text-[var(--muted)] block">Numeric Range</span>
              <span className="text-xs font-medium text-[var(--fg)] mt-1 block">
                [{formatMetricVal(column.minVal)} ... {formatMetricVal(column.maxVal)}]
              </span>
              <span className="text-[10px] text-[var(--muted)]">
                avg: {formatMetricVal(column.avgVal)}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
              <span className="text-[11px] text-[var(--muted)] block">Std Deviation</span>
              <span className="text-sm font-semibold text-[var(--fg)] mt-1 block">
                {formatMetricVal(column.stdDev)}
              </span>
              <span className="text-[10px] text-[var(--muted)]">population dispersion</span>
            </div>
          </>
        ) : (
          <>
            <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
              <span className="text-[11px] text-[var(--muted)] block">Empty Strings</span>
              <span className="text-sm font-semibold text-[var(--fg)] mt-1 block">
                {formatNumber(column.emptyCount)}
              </span>
              <span className="text-[10px] text-[var(--muted)]">zero-length text</span>
            </div>

            <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
              <span className="text-[11px] text-[var(--muted)] block">Non-Empty Rows</span>
              <span className="text-sm font-semibold text-[var(--fg)] mt-1 block">
                {formatNumber(column.totalRows - column.nullCount - column.emptyCount)}
              </span>
              <span className="text-[10px] text-[var(--muted)]">valid populated values</span>
            </div>
          </>
        )}
      </div>

      {/* Numeric Histogram */}
      {isNumeric && column.histogram && column.histogram.length > 0 && (
        <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-mono font-semibold text-[var(--fg)]">
              Value Histogram (Numeric Distribution)
            </h4>
            <span className="text-[10px] font-mono text-[var(--muted)]">5 Buckets</span>
          </div>
          <Histogram buckets={column.histogram} height={190} />
        </div>
      )}

      {/* Top 10 Frequent Values */}
      <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-mono font-semibold text-[var(--fg)]">
            Top Frequent Values
          </h4>
          <span className="text-[10px] font-mono text-[var(--muted)]">
            Frequency & Percentage
          </span>
        </div>
        <ValueDistributionBars values={column.topValues} totalRows={column.totalRows} />
      </div>
    </div>
  )
}
