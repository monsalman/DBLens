import React, { useEffect, useState } from 'react'
import { BookOpen, RefreshCw } from 'lucide-react'
import { PlaybookList } from './PlaybookList'
import { PlaybookEditor } from './PlaybookEditor'
import { usePlaybook } from './usePlaybook'
import type { PlaybookEntry } from '../../lib/api'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export const PlaybookPanel: React.FC<Props> = ({ isOpen, onClose }) => {
  const { entries, loading, error, load, create, update, remove, share } = usePlaybook()
  const [selected, setSelected] = useState<PlaybookEntry | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [tag, setTag] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    if (isOpen) load(tag || undefined, q || undefined)
  }, [isOpen, tag, q, load])

  const handleSave = async (draft: Partial<PlaybookEntry>) => {
    if (isNew) {
      const created = await create(draft)
      setSelected(created)
      setIsNew(false)
    } else if (selected) {
      const updated = await update(selected.id, draft)
      setSelected(updated)
    }
  }

  const handleDelete = async (id: string) => {
    await remove(id)
    setSelected(null)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-400" />
            <h1 className="font-semibold text-[var(--fg)]">Query Playbook</h1>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400">
              {entries.length} entr{entries.length !== 1 ? 'ies' : 'y'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => load(tag || undefined, q || undefined)}
              disabled={loading}
              className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] ml-2">✕</button>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-red-400 bg-red-500/10 border-b border-red-500/20 shrink-0">{error}</div>
        )}

        {/* Body: list + editor */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          <PlaybookList
            entries={entries}
            selected={selected}
            onSelect={e => { setSelected(e); setIsNew(false) }}
            onNew={() => { setSelected(null); setIsNew(true) }}
            tag={tag}
            q={q}
            onTagChange={setTag}
            onQChange={setQ}
          />
          <PlaybookEditor
            entry={selected}
            onSave={handleSave}
            onDelete={handleDelete}
            onShare={share}
            isNew={isNew}
            onCancelNew={() => setIsNew(false)}
          />
        </div>
      </div>
    </div>
  )
}
