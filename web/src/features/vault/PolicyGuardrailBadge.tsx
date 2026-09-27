import React from 'react'
import { ShieldCheck, ShieldAlert, FileText, Lock } from 'lucide-react'

export interface PolicyGuardrailBadgeProps {
  type: 'safe_mode' | 'audit' | 'prod_guardrail' | 'read_only' | 'custom'
  label?: string
  className?: string
}

export const PolicyGuardrailBadge: React.FC<PolicyGuardrailBadgeProps> = ({
  type,
  label,
  className = '',
}) => {
  switch (type) {
    case 'safe_mode':
      return (
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 ${className}`}
          title="Safe Mode is strictly enforced. DDL and non-WHERE mutations are blocked."
        >
          <ShieldAlert className="w-2.5 h-2.5" />
          <span>{label || 'Safe Mode'}</span>
        </span>
      )
    case 'audit':
      return (
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 ${className}`}
          title="Audit logging is mandatory for this connection."
        >
          <FileText className="w-2.5 h-2.5" />
          <span>{label || 'Audit Log'}</span>
        </span>
      )
    case 'prod_guardrail':
      return (
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400 ${className}`}
          title="Global team production guardrail active"
        >
          <Lock className="w-2.5 h-2.5" />
          <span>{label || 'Prod Guardrail'}</span>
        </span>
      )
    case 'read_only':
      return (
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 ${className}`}
          title="Connection opened in read-only mode"
        >
          <ShieldCheck className="w-2.5 h-2.5" />
          <span>{label || 'Read-Only'}</span>
        </span>
      )
    default:
      return (
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] ${className}`}
        >
          <ShieldCheck className="w-2.5 h-2.5" />
          <span>{label || 'Policy'}</span>
        </span>
      )
  }
}
