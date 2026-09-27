import React, { useState } from 'react'
import { Lock, Eye, EyeOff, KeyRound, Loader2, AlertCircle } from 'lucide-react'

interface Props {
  isOpen: boolean
  onClose: () => void
  onUnlock: (passphrase: string) => Promise<void>
  title?: string
  description?: string
}

export const VaultUnlockPrompt: React.FC<Props> = ({
  isOpen,
  onClose,
  onUnlock,
  title = 'Unlock Team Vault',
  description = 'Enter your team vault passphrase to decrypt connections and secrets.',
}) => {
  const [passphrase, setPassphrase] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passphrase.trim()) {
      setError('Please enter your vault passphrase')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await onUnlock(passphrase)
      setPassphrase('')
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to unlock vault: invalid passphrase or corrupted data')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-[var(--border)] flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--fg)]">{title}</h3>
            <p className="text-xs text-[var(--muted)]">{description}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 text-xs bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--fg)] mb-1">
              Passphrase
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                type={showPass ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter vault passphrase..."
                autoFocus
                className="w-full bg-[var(--bg)] text-[var(--fg)] text-xs pl-9 pr-10 py-2 rounded-lg border border-[var(--border)] focus:outline-none focus:border-indigo-500 transition-colors font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--fg)]"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !passphrase.trim()}
              className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Unlock Vault</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
