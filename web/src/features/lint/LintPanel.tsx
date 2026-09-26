import React, { useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  Settings2,
  RefreshCw,
  X,
  Wand2,
  ArrowRight,
  Terminal,
  Check,
} from 'lucide-react'
import {
  buildLintCliCommand,
  copyCliCommand,
} from '../cli/cliHelper'
import {
  getSeverityStyle,
  type LintDiagnostic,
  type AnalysisSummary,
  type QuickFix,
  type LintSeverity,
} from './lintRules'

interface LintPanelProps {
  diagnostics: LintDiagnostic[]
  summary: AnalysisSummary
  isAnalyzing: boolean
  onSelectDiagnostic: (d: LintDiagnostic) => void
  onApplyFix: (fix: QuickFix) => void
  onOpenSettings: () => void
  onRevalidate: () => void
  onClose: () => void
}

export const LintPanel: React.FC<LintPanelProps> = ({
  diagnostics,
  summary,
  isAnalyzing,
  onSelectDiagnostic,
  onApplyFix,
  onOpenSettings,
  onRevalidate,
  onClose,
}) => {
  const [filterSeverity, setFilterSeverity] = useState<LintSeverity | 'all'>('all')
  const [copiedCLI, setCopiedCLI] = useState(false)

  const handleCopyCLI = async () => {
    const cmd = buildLintCliCommand({
      dialect: 'postgres',
      failOn: 'error',
      format: 'text',
    })
    await copyCliCommand(cmd)
    setCopiedCLI(true)
    setTimeout(() => setCopiedCLI(false), 2000)
  }

  const filteredDiagnostics = diagnostics.filter((d) => {
    if (filterSeverity === 'all') return true
    return d.severity === filterSeverity
  })

  return (
    <div className="h-64 border-t border-[var(--border)] bg-[var(--bg)] flex flex-col select-none text-xs">
      {/* Header bar */}
      <div className="h-9 px-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface)]/80 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-medium text-[var(--fg)]">
            <span>SQL Quality & Analyzer</span>
          </div>

          <div className="h-3.5 w-px bg-[var(--border)] mx-1" />

          {/* Severity tabs */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilterSeverity('all')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                filterSeverity === 'all'
                  ? 'bg-[var(--hover)] text-[var(--fg)]'
                  : 'text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              All ({summary.total})
            </button>

            {summary.errors > 0 && (
              <button
                onClick={() => setFilterSeverity('error')}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  filterSeverity === 'error'
                    ? 'bg-red-500/20 text-red-300 font-semibold'
                    : 'text-red-400/80 hover:text-red-300 hover:bg-red-500/10'
                }`}
              >
                <AlertCircle className="w-3 h-3 text-red-400" />
                <span>{summary.errors} Errors</span>
              </button>
            )}

            {summary.warnings > 0 && (
              <button
                onClick={() => setFilterSeverity('warning')}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  filterSeverity === 'warning'
                    ? 'bg-amber-500/20 text-amber-300 font-semibold'
                    : 'text-amber-400/80 hover:text-amber-300 hover:bg-amber-500/10'
                }`}
              >
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <span>{summary.warnings} Warnings</span>
              </button>
            )}

            {summary.info > 0 && (
              <button
                onClick={() => setFilterSeverity('info')}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  filterSeverity === 'info'
                    ? 'bg-sky-500/20 text-sky-300 font-semibold'
                    : 'text-sky-400/80 hover:text-sky-300 hover:bg-sky-500/10'
                }`}
              >
                <Info className="w-3 h-3 text-sky-400" />
                <span>{summary.info} Info</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onRevalidate}
            disabled={isAnalyzing}
            className="p-1 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
            title="Re-run Analysis"
            aria-label="Re-run Analysis"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
            title="Configure Lint Rules"
          >
            <Settings2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>Rules</span>
          </button>

          <button
            onClick={handleCopyCLI}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border border-[var(--border)] transition-colors cursor-pointer"
            title="Copy equivalent DBLens CLI command"
          >
            {copiedCLI ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
            )}
            <span>{copiedCLI ? 'CLI Copied!' : '>_ CLI'}</span>
          </button>

          <div className="h-3.5 w-px bg-[var(--border)] mx-0.5" />

          <button
            onClick={onClose}
            className="p-1 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
            title="Close Panel"
            aria-label="Close Panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Diagnostics List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
        {filteredDiagnostics.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[var(--muted)]">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mb-2 opacity-80" />
            <p className="text-sm font-medium text-[var(--fg)]">No SQL Quality Issues Found</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Query adheres to best practices and schema constraints.
            </p>
          </div>
        ) : (
          filteredDiagnostics.map((d, index) => {
            const style = getSeverityStyle(d.severity)
            return (
              <div
                key={`${d.rule_id}-${d.line}-${d.col}-${index}`}
                onClick={() => onSelectDiagnostic(d)}
                className="p-2.5 px-3.5 hover:bg-[var(--hover)]/60 cursor-pointer flex items-start gap-2.5 transition-colors group"
              >
                {d.severity === 'error' && <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />}
                {d.severity === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />}
                {d.severity === 'info' && <Info className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-semibold border ${style.badge}`}
                    >
                      {d.severity}
                    </span>

                    <span className="font-mono text-[11px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.2 rounded">
                      {d.rule_id}
                    </span>

                    <span className="text-[10px] text-[var(--muted)] font-mono">
                      Ln {d.line}, Col {d.col}
                    </span>
                  </div>

                  <p className="text-xs text-[var(--fg)] leading-relaxed select-text font-sans">
                    {d.message}
                  </p>

                  {d.quick_fix && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (d.quick_fix) {
                            onApplyFix(d.quick_fix)
                          }
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-medium text-[11px] transition-colors shadow-xs"
                      >
                        <Wand2 className="w-3 h-3 text-indigo-400" />
                        <span>Fix: {d.quick_fix.title}</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[11px] self-center">
                  <span>Jump to code</span>
                  <ArrowRight className="w-3 h-3" />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
