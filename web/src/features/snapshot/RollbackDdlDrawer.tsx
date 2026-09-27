import React, { useState } from 'react'
import {
  X,
  Copy,
  Check,
  AlertTriangle,
  FileCode2,
  ShieldAlert,
} from 'lucide-react'
import type { RollbackPlan } from './snapshotHelper'

interface Props {
  plan: RollbackPlan | null
  isOpen: boolean
  onClose: () => void
}

export const RollbackDdlDrawer: React.FC<Props> = ({ plan, isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'down' | 'up'>('down')
  const [copied, setCopied] = useState(false)

  if (!isOpen || !plan) return null

  const sqlToDisplay = activeTab === 'down' ? plan.downSql : plan.upSql

  const handleCopy = () => {
    navigator.clipboard.writeText(sqlToDisplay)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-[var(--bg)] border-l border-[var(--border)] h-full shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <FileCode2 className="w-5 h-5 text-emerald-500" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--fg)]">
                Rollback & Migration DDL Patch
              </h3>
              <p className="text-[11px] text-[var(--muted)]">
                Dialect: <span className="font-mono uppercase">{plan.dialect}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Destructive Warning Banner */}
        {plan.destructive && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 p-3 flex items-start gap-2.5 text-xs text-amber-600 dark:text-amber-400">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Destructive Changes Detected</span>
              <p className="mt-0.5 opacity-90 text-[11px]">
                This script contains operations (such as DROP TABLE or DROP COLUMN) that may lead to permanent data loss. Always backup your database before executing.
              </p>
            </div>
          </div>
        )}

        {/* Specific Warnings */}
        {plan.warnings && plan.warnings.length > 0 && (
          <div className="p-3 bg-[var(--card)] border-b border-[var(--border)] space-y-1">
            <div className="text-[11px] font-semibold text-[var(--fg)] flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span>Warnings ({plan.warnings.length})</span>
            </div>
            <ul className="list-disc list-inside text-[11px] text-[var(--muted)] space-y-0.5 pl-1">
              {plan.warnings.map((warn, i) => (
                <li key={i}>{warn}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Tabs & Controls */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--card)]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('down')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'down'
                  ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 font-semibold'
                  : 'text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              DOWN (Reverse Rollback)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('up')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'up'
                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold'
                  : 'text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              UP (Forward Forward Migration)
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover)] text-[var(--fg)] transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-[var(--muted)]" />
                <span>Copy SQL</span>
              </>
            )}
          </button>
        </div>

        {/* SQL Code View */}
        <div className="flex-1 overflow-auto p-4 bg-[var(--bg)] font-mono text-xs">
          <pre className="whitespace-pre-wrap break-all text-[var(--fg)] leading-relaxed select-all">
            {sqlToDisplay || '-- No SQL statements needed (schemas are identical)'}
          </pre>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[var(--border)] flex items-center justify-between text-[11px] text-[var(--muted)] bg-[var(--card)]">
          <span>Click Copy SQL to run in query editor or migration runner</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)] text-[var(--fg)] cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
