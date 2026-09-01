import React from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

export const DryRunModal: React.FC = () => {
  const { dryRunModal, closeDryRunModal } = useAppStore()
  const { isOpen, title, sql, onConfirm } = dryRunModal

  if (!isOpen) return null

  return (
    <div className="modal-overlay p-4">
      <div className="modal-content w-full max-w-md bg-[#16181d] border border-white/[0.08] rounded-md p-4 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
          <span className="font-mono text-xs font-semibold text-zinc-100 uppercase tracking-wide">
            {title || 'Confirm Mutation'}
          </span>
          <button
            onClick={closeDryRunModal}
            className="text-zinc-500 hover:text-zinc-300 p-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* SQL Preview */}
        <div className="space-y-1.5">
          <div className="p-2.5 bg-[#0b0c0e] border border-white/[0.06] rounded font-mono text-xs text-indigo-300 whitespace-pre-wrap max-h-40 overflow-auto">
            {sql}
          </div>
          <span className="text-[11px] text-zinc-500 font-mono">
            Execute query against active database?
          </span>
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-white/[0.06] flex items-center justify-end gap-1.5">
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
