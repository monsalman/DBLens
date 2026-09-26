import React, { useState } from 'react'
import {
  X,
  Copy,
  Check,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  Database,
  Code2,
  ListOrdered,
} from 'lucide-react'
import type { RemediationPlan } from './impactHelper'
import { getRiskBadgeClass } from './impactHelper'

interface ImpactPlanModalProps {
  isOpen: boolean
  onClose: () => void
  plan: RemediationPlan | null
  loading?: boolean
}

type TabMode = 'steps' | 'upsql' | 'downsql'

export const ImpactPlanModal: React.FC<ImpactPlanModalProps> = ({
  isOpen,
  onClose,
  plan,
  loading = false,
}) => {
  const [activeTab, setActiveTab] = useState<TabMode>('steps')
  const [copiedUp, setCopiedUp] = useState(false)
  const [copiedDown, setCopiedDown] = useState(false)
  const [confirmedRisk, setConfirmedRisk] = useState(false)

  if (!isOpen) return null

  const handleCopy = (text: string, type: 'up' | 'down') => {
    navigator.clipboard.writeText(text)
    if (type === 'up') {
      setCopiedUp(true)
      setTimeout(() => setCopiedUp(false), 2000)
    } else {
      setCopiedDown(true)
      setTimeout(() => setCopiedDown(false), 2000)
    }
  }

  const isHighRisk = plan?.estimated_risk === 'HIGH' || plan?.estimated_risk === 'CRITICAL'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="flex flex-col w-full max-w-3xl h-[85vh] max-h-[800px] bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-[var(--fg)]">
                  Safe-Drop Remediation Plan
                </h2>
                {plan && (
                  <span
                    className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded border uppercase ${getRiskBadgeClass(
                      plan.estimated_risk
                    )}`}
                  >
                    {plan.estimated_risk} RISK
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--muted)] font-mono mt-0.5">
                Target: {plan?.target?.schema ? `${plan.target.schema}.` : ''}
                <span className="text-[var(--fg)] font-semibold">{plan?.target?.name}</span>{' '}
                ({plan?.target?.kind})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between px-5 border-b border-[var(--border)] bg-[var(--surface)]/50">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('steps')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'steps'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <ListOrdered className="w-3.5 h-3.5" />
              <span>Remediation Steps ({plan?.steps?.length || 0})</span>
            </button>
            <button
              onClick={() => setActiveTab('upsql')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'upsql'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Forward Migration (UP)</span>
            </button>
            <button
              onClick={() => setActiveTab('downsql')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'downsql'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Rollback Script (DOWN)</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'upsql' && plan?.up_sql && (
              <button
                onClick={() => handleCopy(plan.up_sql, 'up')}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
              >
                {copiedUp ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedUp ? 'Copied' : 'Copy UP SQL'}</span>
              </button>
            )}
            {activeTab === 'downsql' && plan?.down_sql && (
              <button
                onClick={() => handleCopy(plan.down_sql, 'down')}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
              >
                {copiedDown ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedDown ? 'Copied' : 'Copy DOWN SQL'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-xs font-mono text-[var(--muted)]">
              Generating safe drop sequence...
            </div>
          ) : !plan ? (
            <div className="flex items-center justify-center h-48 text-xs font-mono text-[var(--muted)]">
              No remediation plan available.
            </div>
          ) : activeTab === 'steps' ? (
            <div className="space-y-3">
              {plan.requires_cascade && (
                <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">CASCADE Alert:</span> This operation impacts foreign keys or dependent views. Standard drops without sequential remediation would fail.
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {plan.steps.map((step) => (
                  <div
                    key={step.order}
                    className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-mono"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 flex items-center justify-center rounded-full bg-[var(--bg)] border border-[var(--border)] text-[10px] font-bold">
                          {step.order}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 uppercase">
                          {step.action}
                        </span>
                        <span className="text-[var(--fg)] font-semibold">{step.object_name}</span>
                        <span className="text-[10px] text-[var(--muted)]">({step.object_kind})</span>
                      </div>
                      {step.irreversible ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-500/15 text-red-400 border border-red-500/30 font-semibold">
                          <AlertTriangle className="w-3 h-3" />
                          Irreversible Data Loss
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          Reversible
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[var(--muted)] mb-2 font-sans">
                      {step.description}
                    </div>
                    <pre className="p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--fg)] overflow-x-auto whitespace-pre-wrap">
                      <code>{step.sql}</code>
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          ) : activeTab === 'upsql' ? (
            <div className="h-full flex flex-col">
              <pre className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs font-mono text-[var(--fg)] overflow-auto flex-1 leading-relaxed">
                <code>{plan.up_sql}</code>
              </pre>
            </div>
          ) : (
            <div className="h-full flex flex-col">
              <pre className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs font-mono text-[var(--fg)] overflow-auto flex-1 leading-relaxed">
                <code>{plan.down_sql}</code>
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--surface)] flex flex-wrap items-center justify-between gap-3">
          {isHighRisk ? (
            <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={confirmedRisk}
                onChange={(e) => setConfirmedRisk(e.target.checked)}
                className="rounded border-[var(--border)] text-red-500 focus:ring-0"
              />
              <span>I understand the risks of dropping this object and its dependents</span>
            </label>
          ) : (
            <div className="text-xs text-[var(--muted)]">
              {plan?.steps?.length || 0} sequential remediation steps generated.
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => {
                if (plan?.up_sql) handleCopy(plan.up_sql, 'up')
              }}
              disabled={isHighRisk && !confirmedRisk}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                isHighRisk && !confirmedRisk
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                  : 'bg-red-600 hover:bg-red-500 text-white font-semibold'
              }`}
            >
              <span>Copy UP SQL to Console</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
