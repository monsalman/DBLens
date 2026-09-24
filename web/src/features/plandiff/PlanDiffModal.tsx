import React, { useEffect, useState } from 'react'
import {
  X,
  GitCompare,
  Sparkles,
  Download,
  AlertTriangle,
  Play,
  Loader2,
  Coins,
  Clock,
  Layers,
  CheckCircle,
  HelpCircle,
} from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import type { ConnectionConfig, ExplainResult } from '../../lib/api'
import { usePlanDiff } from './usePlanDiff'
import { PlanDiffTree } from './PlanDiffTree'
import { IndexAdvisorCard } from './IndexAdvisorCard'
import { getDeltaBadgeClass } from './planDiffHelper'

export interface PlanDiffModalProps {
  isOpen: boolean
  onClose: () => void
  connId: string
  initialBaselineSql?: string
  initialBaselinePlan?: ExplainResult | null
  initialCandidateSql?: string
  initialCandidatePlan?: ExplainResult | null
  schema?: string
  profiles?: ConnectionConfig[]
}

export const PlanDiffModal: React.FC<PlanDiffModalProps> = ({
  isOpen,
  onClose,
  connId,
  initialBaselineSql = '',
  initialBaselinePlan = null,
  initialCandidateSql = '',
  initialCandidatePlan = null,
  schema = '',
  profiles = [],
}) => {
  const {
    baselineSql,
    setBaselineSql,
    candidateSql,
    setCandidateSql,
    diffResult,
    isDiffing,
    error,
    runDiff,
    appliedIndexes,
    applyingIndex,
    applyError,
    applyIndex,
    exportMarkdown,
  } = usePlanDiff({
    connId,
    initialBaselineSql,
    initialBaselinePlan,
    initialCandidateSql,
    initialCandidatePlan,
    schema,
    profiles,
  })

  const [activeTab, setActiveTab] = useState<'tree' | 'advisor'>('tree')

  // Auto-run diff if both plans or baseline is already provided on open
  useEffect(() => {
    if (isOpen && !diffResult) {
      if (initialBaselinePlan || initialCandidatePlan || (initialBaselineSql && initialCandidateSql)) {
        runDiff()
      }
    }
  }, [isOpen, initialBaselinePlan, initialCandidatePlan, initialBaselineSql, initialCandidateSql])

  // Hotkey listener: Cmd+Shift+E / Ctrl+Shift+E
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        runDiff()
      } else if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, runDiff, onClose])

  if (!isOpen) return null

  const isDark = document.documentElement.classList.contains('dark')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-6xl h-[92vh] max-h-[950px] bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden font-sans">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <GitCompare className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-[var(--fg)]">
                  Execution Plan Diff Studio & Smart Index Advisor
                </h2>
                {diffResult?.dialect && (
                  <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/25 uppercase">
                    {diffResult.dialect}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--muted)]">
                A/B Query Plan Compare, Cost & Time Deltas, and Heuristic Index Recommendations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {diffResult && (
              <button
                onClick={exportMarkdown}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--border)] hover:bg-[var(--hover)] text-[var(--fg)] transition-colors cursor-pointer"
                title="Export Comparison Report as Markdown"
              >
                <Download className="w-3.5 h-3.5 text-indigo-400" />
                Export Markdown
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
              title="Close (Esc)"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scratchpad: Baseline (A) vs Candidate (B) Queries */}
        <div className="p-3 border-b border-[var(--border)] bg-[var(--surface)]/50 shrink-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-2.5">
            {/* Baseline SQL */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[var(--fg)] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  Baseline SQL (Plan A)
                </span>
                <span className="text-[10px] text-[var(--muted)]">Original / Production query</span>
              </div>
              <div className="rounded-md border border-[var(--border)] overflow-hidden font-mono text-xs">
                <CodeMirror
                  value={baselineSql}
                  onChange={(val) => setBaselineSql(val)}
                  theme={isDark ? oneDark : undefined}
                  extensions={[sql()]}
                  height="72px"
                  placeholder="SELECT * FROM table WHERE ... (Baseline query)"
                />
              </div>
            </div>

            {/* Candidate SQL */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[var(--fg)] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Candidate SQL (Plan B)
                </span>
                <span className="text-[10px] text-[var(--muted)]">Optimized or altered query</span>
              </div>
              <div className="rounded-md border border-[var(--border)] overflow-hidden font-mono text-xs">
                <CodeMirror
                  value={candidateSql}
                  onChange={(val) => setCandidateSql(val)}
                  theme={isDark ? oneDark : undefined}
                  extensions={[sql()]}
                  height="72px"
                  placeholder="SELECT * FROM table WHERE ... (Candidate query to compare)"
                />
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-[var(--muted)] flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 opacity-60" />
              Tip: Press <kbd className="px-1 py-0.5 text-[10px] font-mono rounded bg-[var(--surface)] border border-[var(--border)]">Cmd+Shift+E</kbd> to run diff
            </span>

            <button
              onClick={() => runDiff()}
              disabled={isDiffing}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md font-medium text-xs bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isDiffing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Analyzing Plans...
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Diff Plans
                </>
              )}
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="m-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2 shrink-0">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* KPI Summary Cards */}
        {diffResult && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 border-b border-[var(--border)] bg-[var(--bg)] shrink-0">
            {/* Total Cost Delta */}
            <div className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                <span className="flex items-center gap-1">
                  <Coins className="w-3.5 h-3.5 text-amber-400" />
                  Total Cost Delta
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${getDeltaBadgeClass(
                    diffResult.summary.costDeltaPct
                  )}`}
                >
                  {diffResult.summary.costDeltaPct > 0 ? '+' : ''}
                  {diffResult.summary.costDeltaPct.toFixed(1)}%
                </span>
              </div>
              <div className="text-xs font-mono font-medium text-[var(--fg)]">
                {diffResult.summary.baselineTotalCost.toFixed(1)} →{' '}
                <span className="font-semibold">{diffResult.summary.candidateTotalCost.toFixed(1)}</span>
              </div>
            </div>

            {/* Execution Time Delta */}
            <div className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  Execution Time Delta
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${getDeltaBadgeClass(
                    diffResult.summary.timeDeltaPct
                  )}`}
                >
                  {diffResult.summary.timeDeltaPct > 0 ? '+' : ''}
                  {diffResult.summary.timeDeltaPct.toFixed(1)}%
                </span>
              </div>
              <div className="text-xs font-mono font-medium text-[var(--fg)]">
                {diffResult.summary.baselineTimeMs.toFixed(2)}ms →{' '}
                <span className="font-semibold">{diffResult.summary.candidateTimeMs.toFixed(2)}ms</span>
              </div>
            </div>

            {/* Bottlenecks Detected */}
            <div className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                <span className="flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  Bottlenecks
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    diffResult.summary.bottleneckCount > 0
                      ? 'text-rose-400 bg-rose-950/40 border border-rose-800/40'
                      : 'text-emerald-400 bg-emerald-950/40 border border-emerald-800/40'
                  }`}
                >
                  {diffResult.summary.bottleneckCount} detected
                </span>
              </div>
              <div className="text-xs text-[var(--muted)]">
                {diffResult.summary.bottleneckCount === 0
                  ? 'No severe plan regressions'
                  : 'High-cost nodes require attention'}
              </div>
            </div>

            {/* Smart Index Recommendations */}
            <div className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  Index Advice
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-indigo-400 bg-indigo-950/40 border border-indigo-800/40">
                  {diffResult.recommendations.length} available
                </span>
              </div>
              <div className="text-xs text-[var(--muted)]">
                {diffResult.recommendations.length > 0
                  ? 'Estimated ~60-90% savings'
                  : 'Indexes adequately cover queries'}
              </div>
            </div>
          </div>
        )}

        {/* Tab switcher for mobile / narrow displays */}
        {diffResult && (
          <div className="flex md:hidden border-b border-[var(--border)] bg-[var(--surface)] px-3 text-xs">
            <button
              onClick={() => setActiveTab('tree')}
              className={`py-2 px-3 border-b-2 font-medium ${
                activeTab === 'tree'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-[var(--muted)]'
              }`}
            >
              Plan Diff Tree
            </button>
            <button
              onClick={() => setActiveTab('advisor')}
              className={`py-2 px-3 border-b-2 font-medium flex items-center gap-1.5 ${
                activeTab === 'advisor'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-[var(--muted)]'
              }`}
            >
              <Sparkles className="w-3 h-3 text-indigo-400" />
              Index Advisor ({diffResult.recommendations.length})
            </button>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden p-3 min-h-0">
          {!diffResult && !isDiffing && (
            <div className="flex-1 h-full flex flex-col items-center justify-center text-center p-8 text-[var(--muted)]">
              <Layers className="w-12 h-12 mb-3 opacity-30 text-indigo-400" />
              <h3 className="text-sm font-semibold text-[var(--fg)] mb-1">
                Ready to Compare Execution Plans
              </h3>
              <p className="text-xs max-w-md mb-4 text-[var(--muted)]">
                Provide queries in Baseline and Candidate scratchpads above, then click <strong>Diff Plans</strong> to view node-by-node cost and execution time deltas.
              </p>
            </div>
          )}

          {isDiffing && !diffResult && (
            <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-[var(--muted)]">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
              <p className="text-xs font-mono">Running explain queries and aligning execution trees...</p>
            </div>
          )}

          {diffResult && (
            <div className="h-full grid grid-cols-1 md:grid-cols-12 gap-3 min-h-0">
              {/* Left 8 cols: Plan Diff Tree */}
              <div
                className={`h-full min-h-0 md:col-span-7 lg:col-span-8 flex flex-col ${
                  activeTab === 'advisor' ? 'hidden md:flex' : 'flex'
                }`}
              >
                <PlanDiffTree rootNode={diffResult.alignedTree} />
              </div>

              {/* Right 4 cols: Smart Index Advisor */}
              <div
                className={`h-full min-h-0 md:col-span-5 lg:col-span-4 flex flex-col bg-[var(--surface)]/40 border border-[var(--border)] rounded-lg overflow-hidden ${
                  activeTab === 'tree' ? 'hidden md:flex' : 'flex'
                }`}
              >
                <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between text-xs shrink-0">
                  <span className="font-semibold text-[var(--fg)] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    Smart Index Advisor
                  </span>
                  <span className="text-[11px] text-[var(--muted)]">
                    {diffResult.recommendations.length}{' '}
                    {diffResult.recommendations.length === 1 ? 'suggestion' : 'suggestions'}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {diffResult.recommendations.length > 0 ? (
                    diffResult.recommendations.map((rec) => (
                      <IndexAdvisorCard
                        key={rec.ddl}
                        recommendation={rec}
                        onApply={applyIndex}
                        isApplying={applyingIndex === rec.ddl}
                        isApplied={appliedIndexes.has(rec.ddl)}
                        applyError={applyingIndex === rec.ddl ? applyError : null}
                      />
                    ))
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center p-6 text-center text-[var(--muted)]">
                      <CheckCircle className="w-8 h-8 text-emerald-400 mb-2 opacity-60" />
                      <p className="text-xs font-semibold text-[var(--fg)] mb-1">
                        Optimal Indexing
                      </p>
                      <p className="text-[11px]">
                        No missing multi-column indexes or severe table scan bottlenecks detected.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
