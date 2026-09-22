import React from 'react'
import type { PlaybookEntry } from '../../lib/api'

interface Props {
  entries: PlaybookEntry[]
  selected: PlaybookEntry | null
  onSelect: (e: PlaybookEntry) => void
  onNew: () => void
  tag: string
  q: string
  onTagChange: (t: string) => void
  onQChange: (q: string) => void
}

export const PlaybookList: React.FC<Props> = ({
  entries, selected, onSelect, onNew, tag, q, onTagChange, onQChange,
}) => {
  const allTags = Array.from(new Set(entries.flatMap(e => e.tags ?? []))).sort()

  return (
    <div className="flex flex-col h-full border-r border-[var(--border)] w-64 shrink-0">
      {/* Search */}
      <div className="p-3 border-b border-[var(--border)] space-y-2">
        <input
          value={q}
          onChange={ev => onQChange(ev.target.value)}
          placeholder="Search…"
          className="w-full text-xs px-2.5 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] placeholder-[var(--muted)] outline-none"
        />
        <select
          value={tag}
          onChange={ev => onTagChange(ev.target.value)}
          className="w-full text-xs px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] outline-none"
        >
          <option value="">All tags</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-[var(--muted)] text-xs">
            No entries
          </div>
        )}
        {entries.map(e => (
          <button
            key={e.id}
            onClick={() => onSelect(e)}
            className={`w-full text-left px-3 py-2.5 border-b border-[var(--border)] transition-colors hover:bg-[var(--hover)] ${selected?.id === e.id ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500' : ''}`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-medium text-[var(--fg)] truncate">{e.title}</span>
              {e.dialect && (
                <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono border border-indigo-500/20">
                  {e.dialect}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {(e.tags ?? []).slice(0, 3).map(t => (
                <span key={t} className="text-[10px] px-1 py-0.5 rounded bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">{t}</span>
              ))}
            </div>
            <div className="flex items-center justify-between mt-1">
              {e.author && <span className="text-[10px] text-[var(--muted)]">{e.author.slice(0, 2).toUpperCase()}</span>}
              <span className="text-[10px] text-[var(--muted)]">{e.updated_at?.slice(0, 10)}</span>
            </div>
          </button>
        ))}
      </div>

      {/* New */}
      <div className="p-2 border-t border-[var(--border)] shrink-0">
        <button onClick={onNew} className="btn-primary w-full text-xs py-1.5">+ New Entry</button>
      </div>
    </div>
  )
}
