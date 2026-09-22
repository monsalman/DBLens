import React, { useState, useEffect } from 'react'
import { X, AlertTriangle, ShieldAlert } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

export const DryRunModal: React.FC = () => {
  const { dryRunModal, closeDryRunModal } = useAppStore()
  const { isOpen, title, sql, onConfirm, requireTypedConfirm } = dryRunModal
  const [typedInput, setTypedInput] = useState('')

  useEffect(() => {
    if (isOpen) {
      setTypedInput('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const isConfirmDisabled = requireTypedConfirm && typedInput.trim() !== 'CONFIRM'

  return (
    <div className="modal-overlay p-4 z-50">
      <div className="modal-content w-full max-w-lg p-5 flex flex-col gap-3.5 bg-[var(--surface)] border border-[var(--border)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-2.5">
          <div className="flex items-center gap-2">
            {requireTypedConfirm ? (
              <ShieldAlert className="w-4 h-4 text-red-500" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            )}
            <span className={`font-mono text-xs font-bold uppercase tracking-wide ${
              requireTypedConfirm ? 'text-red-500' : 'text-[var(--fg)]'
            }`}>
              {title || (requireTypedConfirm ? 'Destructive Action Confirmation' : 'Confirm Query')}
            </span>
          </div>
          <button
            onClick={closeDryRunModal}
            className="text-[var(--muted)] hover:text-[var(--fg)] p-0.5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Warning Banner if Typed Confirm Required */}
        {requireTypedConfirm && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400 font-mono space-y-1">
            <p className="font-bold flex items-center gap-1.5 text-red-500">
              <AlertTriangle className="w-3.5 h-3.5" /> High Risk / Destructive Query Guardrail
            </p>
            <p className="text-[11px] opacity-90 leading-relaxed">
              This statement contains destructive operations or is executing in a protected environment. Data loss may be irreversible.
            </p>
          </div>
        )}

        {/* SQL Preview */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase text-[var(--muted)] tracking-wider">
            Statement Preview
          </label>
          <div className="p-3 bg-[var(--bg)] border border-[var(--border)] rounded font-mono text-xs text-indigo-400 dark:text-indigo-300 whitespace-pre-wrap max-h-48 overflow-auto">
            {sql}
          </div>
        </div>

        {/* Two-step typed confirmation input */}
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

        {/* Footer */}
        <div className="pt-3 border-t border-[var(--border)] flex items-center justify-end gap-2">
          <button
            onClick={closeDryRunModal}
            className="btn-secondary px-3 py-1.5 text-xs font-mono"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (isConfirmDisabled) return
              onConfirm()
              closeDryRunModal()
            }}
            disabled={isConfirmDisabled}
            className={`px-3 py-1.5 text-xs font-mono font-medium rounded transition-all ${
              requireTypedConfirm
                ? isConfirmDisabled
                  ? 'bg-red-500/30 text-red-300/40 cursor-not-allowed border border-red-500/20'
                  : 'bg-red-600 hover:bg-red-700 text-white shadow-sm cursor-pointer'
                : 'btn-primary'
            }`}
          >
            {requireTypedConfirm ? 'Execute Destructive Query' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}
