import React from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

export const DryRunModal: React.FC = () => {
  const { dryRunModal, closeDryRunModal } = useAppStore()
  const { isOpen, title, sql, onConfirm } = dryRunModal

  if (!isOpen) return null

  return (
    <div className="modal-overlay p-4">
      <div className="modal-content w-full max-w-md p-4 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
          <span className="font-mono text-xs font-semibold text-[var(--fg)] uppercase tracking-wide">
            {title || 'Confirm Mutation'}
          </span>
          <button
            onClick={closeDryRunModal}
            className="text-[var(--muted)] hover:text-[var(--fg)] p-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* SQL Preview */}
        <div className="space-y-1.5">
          <div className="p-2.5 bg-[var(--bg)] border border-[var(--border)] rounded font-mono text-xs text-indigo-400 dark:text-indigo-300 whitespace-pre-wrap max-h-40 overflow-auto">
            {sql}
          </div>
          <span className="text-[11px] text-[var(--muted)] font-mono">
            Execute query against active database?
          </span>
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-[var(--border)] flex items-center justify-end gap-1.5">
          <button
            onClick={closeDryRunModal}
            className="btn-secondary px-3 py-1 text-xs"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm()
              closeDryRunModal()
            }}
            className="btn-primary px-3 py-1 text-xs"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
