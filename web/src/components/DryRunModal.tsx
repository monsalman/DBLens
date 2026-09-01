import React from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

export const DryRunModal: React.FC = () => {
  const { dryRunModal, closeDryRunModal } = useAppStore()
  const { isOpen, title, sql, onConfirm } = dryRunModal

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">{title || 'Confirm Action'}</h2>
              <p className="text-xs text-zinc-400">Review the generated SQL mutation before applying</p>
            </div>
          </div>
          <button
            onClick={closeDryRunModal}
            className="text-zinc-400 hover:text-zinc-200 p-1 rounded hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body / SQL preview */}
        <div className="p-5 space-y-3">
          <label className="text-[11px] font-medium text-zinc-400">Generated Query:</label>
          <div className="p-3 bg-zinc-950 border border-zinc-800/90 rounded-lg overflow-x-auto max-h-48">
            <code className="text-xs font-mono text-indigo-300 whitespace-pre-wrap">{sql}</code>
          </div>
          <p className="text-[11px] text-zinc-400">
            This will execute immediately against the active database transaction.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-zinc-950/60 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            onClick={closeDryRunModal}
            className="px-3.5 py-1.5 rounded-lg border border-zinc-800 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm()
              closeDryRunModal()
            }}
            className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition-colors shadow-lg shadow-amber-600/20"
          >
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  )
}
