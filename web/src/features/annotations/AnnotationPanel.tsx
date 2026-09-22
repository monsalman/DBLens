import React, { useState } from 'react'
import { Download, Pin, RefreshCw, StickyNote, Trash2 } from 'lucide-react'
import { api as apiClient } from '../../lib/api'
import { useAnnotations } from './useAnnotations'
import { groupByTable, sortPinnedFirst } from './annotationHelper'

interface Props {
  /** Filter the panel to the active connection; empty string means "all". */
  connId?: string
  schema?: string
  table?: string
}

/**
 * "Schema Notes" sidebar panel: lists every annotation, groups them by table,
 * supports keyword search and exports the whole set as Markdown.
 */
export const AnnotationPanel: React.FC<Props> = ({ connId = '', schema, table }) => {
  const [q, setQ] = useState('')
  const { annotations, loading, error, reload, update, remove } = useAnnotations(
    { conn: connId || undefined, q: q || undefined },
    true,
  )

  const grouped = groupByTable(sortPinnedFirst(annotations)).map(g => [g.label, g.items] as const)

  const pinnedCount = annotations.filter(a => a.pinned).length
  const scopeLabel = table ? `for ${table}` : schema ? `for schema ${schema}` : 'for this connection'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border)] space-y-1.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <StickyNote className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
            {annotations.length}
          </span>
          {pinnedCount > 0 && (
            <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
              📌 {pinnedCount}
            </span>
          )}
          <button
            onClick={() => reload()}
            title="Reload annotations"
            className="ml-auto p-0.5 rounded hover:bg-[var(--hover)] text-[var(--muted)]"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={`Search notes ${scopeLabel}…`}
            className="flex-1 min-w-0 bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] rounded px-2 py-1 outline-none font-mono text-[11px]"
          />
          <a
            href={apiClient.annotationExportUrl()}
            title="Export all annotations as Markdown"
            className="p-1 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] shrink-0"
          >
            <Download className="w-3 h-3" />
          </a>
        </div>
      </div>

      {error && <div className="px-3 py-1.5 text-[11px] text-red-400 bg-red-500/10 border-b border-red-500/20 shrink-0">{error}</div>}

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {!loading && annotations.length === 0 && (
          <div className="text-[11px] text-[var(--muted)] ml-1">
            No notes yet. Use the <StickyNote className="w-3 h-3 inline" /> icon in the table header to annotate a table or column.
          </div>
        )}
        {grouped.map(([label, items]) => (
          <div key={label} className="space-y-1">
            <div className="text-[10px] uppercase text-[var(--muted)] font-semibold tracking-wider px-1 truncate" title={label}>
              {label}
            </div>
            {items.map(a => (
              <div
                key={a.id}
                className={`rounded border p-1.5 font-mono text-[11px] ${
                  a.pinned ? 'border-amber-500/40 bg-amber-500/5' : 'border-[var(--border)] bg-[var(--surface)]/40'
                }`}
              >
                <div className="flex items-center gap-1 text-[9px] text-[var(--muted)]">
                  {a.column && (
                    <span className="px-1 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--fg)] truncate">
                      {a.column}
                    </span>
                  )}
                  <span className="truncate">{a.author || 'anonymous'}</span>
                  <span>·</span>
                  <span className="shrink-0">{new Date(a.updated_at).toLocaleDateString()}</span>
                  <span className="ml-auto flex items-center gap-0.5 shrink-0">
                    <button
                      title={a.pinned ? 'Unpin note' : 'Pin note'}
                      onClick={() => update(a.id, { note: a.note, author: a.author, pinned: !a.pinned })}
                      className={`p-0.5 rounded hover:bg-[var(--hover)] ${a.pinned ? 'text-amber-500' : ''}`}
                    >
                      <Pin className="w-2.5 h-2.5" />
                    </button>
                    <button
                      title="Delete note"
                      onClick={() => remove(a.id)}
                      className="p-0.5 rounded hover:bg-[var(--hover)] hover:text-red-400"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[var(--fg)] mt-1">{a.note}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
