import React, { useState, useEffect } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { Share2, Download, History, Play, Edit, Check, X } from 'lucide-react'
import type { PlaybookEntry } from '../../lib/api'
import { useAppStore } from '../../stores/appStore'

interface Props {
  entry: PlaybookEntry | null
  onSave: (entry: Partial<PlaybookEntry>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onShare: (id: string) => Promise<string>
  isNew: boolean
  onCancelNew: () => void
}

export const PlaybookEditor: React.FC<Props> = ({ entry, onSave, onDelete, onShare, isNew, onCancelNew }) => {
  const [editing, setEditing] = useState(isNew)
  const [tab, setTab] = useState<'editor' | 'history'>('editor')
  const [draft, setDraft] = useState<Partial<PlaybookEntry>>({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const isDark = document.documentElement.classList.contains('dark')

  useEffect(() => {
    if (entry) {
      setDraft({ ...entry })
      setEditing(false)
      setTab('editor')
    } else if (isNew) {
      setDraft({ title: '', query: '', tags: [], dialect: 'sql', description: '' })
      setEditing(true)
      setTab('editor')
    }
  }, [entry, isNew])

  if (!entry && !isNew) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--muted)] text-sm">
        Select an entry or create a new one
      </div>
    )
  }

  const handleSave = async () => {
    if (!draft.title?.trim()) { setErr('Title is required'); return }
    setSaving(true)
    setErr('')
    try {
      await onSave(draft)
      setEditing(false)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleShare = async () => {
    if (!entry) return
    const uri = await onShare(entry.id)
    await navigator.clipboard.writeText(uri).catch(() => {})
    alert(`Copied: ${uri}`)
  }

  const handleRunInStudio = () => {
    if (!entry) return
    const activeConnId = useAppStore.getState().activeConnectionId || ''
    const tabId = useAppStore.getState().addSqlTab(activeConnId, entry.title, entry.query)
    useAppStore.getState().setActiveSqlTabId(activeConnId, tabId)
    useAppStore.getState().setActiveTab('sql')
  }

  const handleExportMD = () => {
    window.open('/api/playbook/export.md', '_blank')
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {editing ? (
            <input
              value={draft.title ?? ''}
              onChange={ev => setDraft(p => ({ ...p, title: ev.target.value }))}
              placeholder="Entry title…"
              className="text-sm font-semibold bg-transparent border-b border-indigo-500 outline-none text-[var(--fg)] min-w-0"
            />
          ) : (
            <span className="text-sm font-semibold text-[var(--fg)] truncate">{entry?.title}</span>
          )}
          {entry?.dialect && !editing && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">{entry.dialect}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!editing && entry && (
            <>
              <button onClick={handleRunInStudio} title="Run in SQL Studio" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:bg-[var(--hover)] text-emerald-400 border border-emerald-500/20 transition-colors">
                <Play className="w-3 h-3" /> Run
              </button>
              <button onClick={() => setTab(t => t === 'history' ? 'editor' : 'history')} title="Version History" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:bg-[var(--hover)] text-[var(--muted)] border border-[var(--border)] transition-colors">
                <History className="w-3 h-3" /> History
              </button>
              <button onClick={handleShare} title="Copy share link" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:bg-[var(--hover)] text-[var(--muted)] border border-[var(--border)] transition-colors">
                <Share2 className="w-3 h-3" /> Share
              </button>
              <button onClick={handleExportMD} title="Export Runbook" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:bg-[var(--hover)] text-[var(--muted)] border border-[var(--border)] transition-colors">
                <Download className="w-3 h-3" /> Export
              </button>
              <button onClick={() => setEditing(true)} title="Edit" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:bg-[var(--hover)] text-[var(--muted)] border border-[var(--border)] transition-colors">
                <Edit className="w-3 h-3" /> Edit
              </button>
              <button onClick={() => { if (confirm('Delete entry?')) onDelete(entry.id) }} className="text-[11px] px-2 py-1 rounded hover:bg-red-500/10 text-red-400 border border-red-500/20 transition-colors">✕</button>
            </>
          )}
          {editing && (
            <>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-indigo-500 hover:bg-indigo-600 text-white transition-colors">
                <Check className="w-3 h-3" /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setEditing(false); if (isNew) onCancelNew(); }} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:bg-[var(--hover)] text-[var(--muted)] border border-[var(--border)] transition-colors">
                <X className="w-3 h-3" /> Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {err && <div className="px-4 py-2 text-xs text-red-400 bg-red-500/10 border-b border-red-500/20">{err}</div>}

      {/* Metadata strip (edit mode) */}
      {editing && (
        <div className="px-4 py-2 border-b border-[var(--border)] flex flex-wrap gap-3 shrink-0">
          <input
            value={draft.description ?? ''}
            onChange={ev => setDraft(p => ({ ...p, description: ev.target.value }))}
            placeholder="Description (optional)"
            className="flex-1 min-w-[160px] text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] outline-none"
          />
          <input
            value={draft.dialect ?? ''}
            onChange={ev => setDraft(p => ({ ...p, dialect: ev.target.value }))}
            placeholder="Dialect (sql/postgres/mysql)"
            className="w-36 text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] outline-none"
          />
          <input
            value={(draft.tags ?? []).join(', ')}
            onChange={ev => setDraft(p => ({ ...p, tags: ev.target.value.split(',').map(t => t.trim()).filter(Boolean) }))}
            placeholder="Tags (comma separated)"
            className="w-48 text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] outline-none"
          />
          <input
            value={draft.author ?? ''}
            onChange={ev => setDraft(p => ({ ...p, author: ev.target.value }))}
            placeholder="Author"
            className="w-32 text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] outline-none"
          />
        </div>
      )}

      {/* Body */}
      {tab === 'editor' ? (
        <div className="flex-1 overflow-auto">
          <CodeMirror
            value={editing ? (draft.query ?? '') : (entry?.query ?? '')}
            height="100%"
            extensions={[sql()]}
            theme={isDark ? 'dark' : 'light'}
            readOnly={!editing}
            onChange={val => setDraft(p => ({ ...p, query: val }))}
            className="h-full text-xs"
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-xs font-semibold text-[var(--muted)] mb-3">Version History</h3>
          {(entry?.version_history ?? []).length === 0 && (
            <p className="text-xs text-[var(--muted)]">No versions yet</p>
          )}
          {[...(entry?.version_history ?? [])].reverse().map(v => (
            <div key={v.version} className="mb-4 rounded border border-[var(--border)] overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--surface)] text-[10px] text-[var(--muted)]">
                <span>v{v.version}</span>
                <span>{v.updated_at?.slice(0, 16)}</span>
              </div>
              <pre className="text-[11px] p-3 text-[var(--fg)] font-mono whitespace-pre-wrap overflow-x-auto">{v.query_snapshot}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
