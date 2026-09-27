import React, { useState } from 'react'
import {
  Sparkles,
  Copy,
  Check,
  Zap,
  ArrowRight,
  RotateCcw,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import type { IndexRecommendation } from './planDiffHelper'

interface Props {
  recommendation: IndexRecommendation
  onApply: (rec: IndexRecommendation) => Promise<boolean>
  isApplying?: boolean
  isApplied?: boolean
  applyError?: string | null
}

export const IndexAdvisorCard: React.FC<Props> = ({
  recommendation,
  onApply,
  isApplying = false,
  isApplied = false,
  applyError = null,
}) => {
  const [copiedDDL, setCopiedDDL] = useState(false)
  const [copiedRollback, setCopiedRollback] = useState(false)
  const [showRollback, setShowRollback] = useState(false)

  const handleCopy = (text: string, isRollback = false) => {
    navigator.clipboard.writeText(text)
    if (isRollback) {
      setCopiedRollback(true)
      setTimeout(() => setCopiedRollback(false), 2000)
    } else {
      setCopiedDDL(true)
      setTimeout(() => setCopiedDDL(false), 2000)
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-3 shadow-xs transition-all hover:border-[var(--border-strong)]">
      {/* Top Header: Table & Savings */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">
              <Sparkles className="w-3 h-3 text-indigo-400" />
              {recommendation.table}
            </span>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)]">
              {recommendation.indexType}
            </span>
            {recommendation.columns.map((col) => (
              <span
                key={col}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--fg)]"
              >
                {col}
              </span>
            ))}
          </div>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            {recommendation.reason}
          </p>
        </div>

        {/* Savings Badge */}
        <div className="shrink-0 text-right">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-800/40">
            <Zap className="w-3 h-3" />
            ~{recommendation.estimatedCostSavingsPct.toFixed(0)}% Savings
          </span>
        </div>
      </div>

      {/* DDL Code Snippet */}
      <div className="relative group rounded-md bg-[var(--bg)] border border-[var(--border)] p-2.5 font-mono text-xs overflow-x-auto">
        <pre className="text-emerald-300/90 whitespace-pre-wrap select-all">
          {recommendation.ddl}
        </pre>
        <button
          onClick={() => handleCopy(recommendation.ddl, false)}
          className="absolute top-2 right-2 p-1 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] opacity-70 group-hover:opacity-100 transition-opacity"
          title="Copy DDL"
          aria-label="Copy DDL"
        >
          {copiedDDL ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>

      {/* Optional Rollback DDL Preview */}
      {showRollback && (
        <div className="relative group rounded-md bg-[var(--bg)] border border-[var(--border)] p-2.5 font-mono text-xs overflow-x-auto">
          <div className="text-[10px] text-[var(--muted)] mb-1 font-sans">Rollback Script:</div>
          <pre className="text-rose-300/90 whitespace-pre-wrap select-all">
            {recommendation.rollbackDdl}
          </pre>
          <button
            onClick={() => handleCopy(recommendation.rollbackDdl, true)}
            className="absolute top-2 right-2 p-1 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] opacity-70 group-hover:opacity-100 transition-opacity"
            title="Copy Rollback DDL"
            aria-label="Copy Rollback DDL"
          >
            {copiedRollback ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-1 text-xs">
        <button
          onClick={() => setShowRollback(!showRollback)}
          className="flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          {showRollback ? 'Hide Rollback' : 'View Rollback'}
        </button>

        <div className="flex items-center gap-2">
          {isApplied ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-medium text-xs">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Index Applied
            </span>
          ) : (
            <button
              onClick={() => onApply(recommendation)}
              disabled={isApplying}
              className="flex items-center gap-1.5 px-3 py-1 rounded font-medium text-xs bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 shadow-xs cursor-pointer"
            >
              {isApplying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <ArrowRight className="w-3.5 h-3.5" />
                  Apply Index
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {applyError && (
        <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1.5 rounded">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{applyError}</span>
        </div>
      )}
    </div>
  )
}
