import React, { useEffect, useState } from 'react'
import { StickyNote } from 'lucide-react'
import { api, type Annotation } from '../../lib/api'
import { AnnotationPopover } from './AnnotationPopover'
import { targetKey } from './annotationHelper'

interface Props {
  connId: string
  schema?: string
  table?: string
  column?: string
  /** Pre-loaded annotations for the table; when omitted the badge fetches its own. */
  annotations?: Annotation[]
}

/**
 * Small note icon rendered next to a column (or table) name. Shows how many
 * annotations exist for the target and opens an inline popover on click.
 */
export const AnnotationBadge: React.FC<Props> = ({ connId, schema, table, column, annotations }) => {
  const [own, setOwn] = useState<Annotation[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (annotations || !connId) return
    let alive = true
    api
      .listAnnotations({ conn: connId, table })
      .then(list => {
        if (alive) setOwn(list ?? [])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [annotations, connId, table, schema])

  const source = annotations ?? own
  const key = targetKey(schema, table, column)
  const items = source.filter(a => targetKey(a.schema, a.table, a.column) === key)
  const pinned = items.some(a => a.pinned)

  // Without a parent-owned list, patch the locally fetched copy.
  const applyLocal = (next: Annotation[]) => {
    if (annotations) return
    setOwn(prev => [...prev.filter(a => targetKey(a.schema, a.table, a.column) !== key), ...next])
  }

  const isColumn = !!column

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        title={items.length ? `${items.length} note(s) on this ${isColumn ? 'column' : 'table'}` : `Add a note to this ${isColumn ? 'column' : 'table'}`}
        onClick={e => {
          e.stopPropagation()
          setOpen(o => !o)
        }}
        className={`inline-flex items-center gap-0.5 px-1 rounded border text-[9px] font-mono transition-colors ${
          items.length
            ? pinned
              ? 'bg-amber-500/15 text-amber-500 border-amber-500/40'
              : 'bg-sky-500/15 text-sky-400 border-sky-500/30'
            : 'bg-transparent text-[var(--muted)] border-transparent hover:text-[var(--fg)] hover:border-[var(--border)]'
        }`}
      >
        <StickyNote className="w-2.5 h-2.5" />
        {items.length > 0 && <span>{items.length}</span>}
        {pinned && <span>📌</span>}
      </button>
      {open && (
        <AnnotationPopover
          connId={connId}
          schema={schema}
          table={table}
          column={column}
          items={items}
          onClose={() => setOpen(false)}
          onChanged={applyLocal}
        />
      )}
    </span>
  )
}
