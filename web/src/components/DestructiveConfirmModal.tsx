import React, { useState } from 'react'
import { X, AlertTriangle, ShieldAlert } from 'lucide-react'

export interface DestructiveConfirmModalProps {
  isOpen: boolean
  title?: string
  sql: string
  reason?: string
  requireTypedConfirm?: boolean
  onConfirm: () => void
  onClose: () => void
}

export const DestructiveConfirmModal: React.FC<DestructiveConfirmModalProps> = ({
  isOpen,
  title = 'Destructive Query Confirmation',
  sql,
  reason,
  requireTypedConfirm = true,
  onConfirm,
  onClose,
}) => {
  const [typedInput, setTypedInput] = useState('')

  if (!isOpen) return null

  const isConfirmDisabled = requireTypedConfirm && typedInput.trim() !== 'CONFIRM'

  return (
    <div className="modal-overlay p-4 z-50">
      <div className="modal-content w-full max-w-lg p-5 flex flex-col gap-3.5 bg-[var(--surface)] border border-[var(--border)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-2.5">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-500" />
            <span className="font-mono text-xs font-bold uppercase tracking-wide text-red-500">
              {title}
            </span>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--fg)] p-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400 font-mono space-y-1">
          <p className="font-bold flex items-center gap-1.5 text-red-500">
            <AlertTriangle className="w-3.5 h-3.5" /> High Risk / Destructive Query Guardrail
          </p>
          <p className="text-[11px] opacity-90 leading-relaxed">
            {reason || 'This statement modifies or deletes database objects/records. Data loss may be irreversible.'}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase text-[var(--muted)] tracking-wider">
            Statement Preview
          </label>
          <div className="p-3 bg-[var(--bg)] border border-[var(--border)] rounded font-mono text-xs text-indigo-400 dark:text-indigo-300 whitespace-pre-wrap max-h-48 overflow-auto">
            {sql}
          </div>
        </div>

        {requireTypedConfirm && (
          <div className="space-y-1.5 pt-1">
            <label className="block text-xs font-mono text-[var(--fg)]">
              Type <strong className="text-red-500 font-bold">CONFIRM</strong> to authorize execution:
            </label>
            <input
              type="text"
              value={typedInput}
              onChange={(e) => setTypedInput(e.target.value)}
              placeholder="CONFIRM"
              autoFocus
              className="w-full px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs font-mono text-[var(--fg)] focus:outline-none focus:border-red-500 transition-colors"
            />
          </div>
        )}

        <div className="pt-3 border-t border-[var(--border)] flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-secondary px-3 py-1.5 text-xs font-mono">
            Cancel
          </button>
          <button
            onClick={() => {
              if (isConfirmDisabled) return
              onConfirm()
              onClose()
            }}
            disabled={isConfirmDisabled}
            className={`px-3 py-1.5 text-xs font-mono font-medium rounded transition-all ${
              isConfirmDisabled
                ? 'bg-red-500/30 text-red-300/40 cursor-not-allowed border border-red-500/20'
                : 'bg-red-600 hover:bg-red-700 text-white shadow-sm cursor-pointer'
            }`}
          >
            Execute Destructive Query
          </button>
        </div>
      </div>
    </div>
  )
}
