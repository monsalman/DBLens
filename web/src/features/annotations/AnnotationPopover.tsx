import React, { useState } from 'react'
import { Pin, Trash2 } from 'lucide-react'
import { api, type Annotation } from '../../lib/api'

interface Props {
  connId: string
  schema?: string
  table?: string
  column?: string
  items: Annotation[]
  onClose: () => void
  /** Called with the annotations currently attached to this target. */
  onChanged: (next: Annotation[]) => void
}

/**
 * Inline popover for reading and editing the notes attached to one schema
 * target (a table or a single column).
 */
export const AnnotationPopover: React.FC<Props> = ({ connId, schema, table, column, items, onClose, onChanged }) => {
  const [note, setNote] = useState('')
  const [author, setAuthor] = useState('')
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const later = (id: string) => (items.length > 1 ? items.filter(a => a.id !== id) : [])

  const handleSave = async () => {
    if (!note.trim()) {
      setError('Note text is required')
      return
    }
    setBusy(true)
    setError('')
    try {
      const created = await api.createAnnotation({
        target_type: column ? 'column' : 'table',
        connection_id: connId,
        schema,
        table,
        column,
        note: note.trim(),
        author: author.trim(),
        pinned,
      })
      onChanged([...items, created])
      setNote('')
      setPinned(false)
    } catch (e: any) {
      setError(e?.message || 'Failed to save note')
    } finally {
      setBusy(false)
    }
  }

  const handleTogglePin = async (a: Annotation) => {
    try {
      const updated = await api.updateAnnotation(a.id, { note: a.note, author: a.author, pinned: !a.pinned })
      onChanged(items.map(i => (i.id === a.id ? updated : i)))
    } catch (e: any) {
      setError(e?.message || 'Failed to update note')
    }
  }

  const handleDelete = async (a: Annotation) => {
    try {
      await api.deleteAnnotation(a.id)
      onChanged(later(a.id))
    } catch (e: any) {
      setError(e?.message || 'Failed to delete note')
    }
  }

  return (
    <div className="absolute left-0 top-full mt-1 z-40 w-72 rounded-md border border-[var(--border)] bg-[var(--bg)] shadow-xl p-2.5 font-mono text-[11px] space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-semibold">
          {column ? `Note · ${column}` : `Notes · ${table ?? 'connection'}`}
        </span>
        <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--fg)] px-1">✕</button>
      </div>

      {items.length > 0 && (
        <ul className="max-h-40 overflow-y-auto space-y-1.5">
          {items.map(a => (
            <li key={a.id} className="rounded border border-[var(--border)] bg-[var(--surface)]/50 p-1.5">
              <div className="flex items-center gap-1 text-[9px] text-[var(--muted)]">
                <span className="truncate">{a.author || 'anonymous'}</span>
                <span>·</span>
                <span>{new Date(a.updated_at).toLocaleDateString()}</span>
                <span className="ml-auto flex items-center gap-0.5">
                  <button
                    title={a.pinned ? 'Unpin' : 'Pin'}
                    onClick={() => handleTogglePin(a)}
                    className={`p-0.5 rounded hover:bg-[var(--hover)] ${a.pinned ? 'text-amber-500' : ''}`}
                  >
                    <Pin className="w-2.5 h-2.5" />
                  </button>
                  <button
                    title="Delete note"
                    onClick={() => handleDelete(a)}
                    className="p-0.5 rounded hover:bg-[var(--hover)] hover:text-red-400"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-[var(--fg)] mt-0.5">{a.note}</p>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="text-red-400 text-[10px]">{error}</div>}

      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        rows={2}
        placeholder="Add a note for your team…"
        className="w-full resize-y bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] rounded px-1.5 py-1 outline-none text-[11px]"
      />
      <div className="flex items-center gap-1.5">
        <input
          value={author}
          onChange={e => setAuthor(e.target.value)}
          placeholder="author"
          className="flex-1 min-w-0 bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] rounded px-1.5 py-1 outline-none text-[10px]"
        />
        <label className="flex items-center gap-1 text-[10px] text-[var(--muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={pinned}
            onChange={e => setPinned(e.target.checked)}
            className="rounded border-[var(--border)] bg-[var(--surface)] text-amber-500 w-3 h-3"
          />
          Pin
        </label>
        <button
          onClick={handleSave}
          disabled={busy}
          className="px-2 py-1 rounded bg-[var(--accent)] text-white text-[10px] font-medium disabled:opacity-50"
        >
          {busy ? '…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
