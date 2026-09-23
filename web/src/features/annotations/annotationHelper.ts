import type { Annotation } from '../../lib/api'

/** Composite key identifying the exact schema target a note hangs off. */
export function targetKey(schema?: string, table?: string, column?: string): string {
  return [schema ?? '', table ?? '', column ?? ''].join('\u0000')
}

/** Human-readable label for a target, e.g. "public.orders.total". */
export function annotationLabel(a: Annotation): string {
  const parts: string[] = []
  if (a.schema) parts.push(a.schema)
  if (a.table) parts.push(a.table)
  const base = parts.length ? parts.join('.') : '(connection level)'
  return a.column ? `${base}.${a.column}` : base
}

/** Case-insensitive keyword match across note, author and target names. */
export function matchesKeyword(a: Annotation, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return true
  return [a.note, a.author, a.schema, a.table, a.column, a.connection_id]
    .filter(Boolean)
    .some(v => String(v).toLowerCase().includes(kw))
}

/**
 * Groups annotations by table label, pinned notes first inside each group,
 * groups sorted alphabetically. Notes on a column stay under their table.
 */
export function groupByTable(annotations: Annotation[]): Array<{ label: string; items: Annotation[] }> {
  const groups = new Map<string, Annotation[]>()
  for (const a of annotations) {
    const parts: string[] = []
    if (a.schema) parts.push(a.schema)
    if (a.table) parts.push(a.table)
    const label = parts.length ? parts.join('.') : '(connection level)'
    const list = groups.get(label) ?? []
    list.push(a)
    groups.set(label, list)
  }
  return [...groups.entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([label, items]) => ({
      label,
      items: [...items].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      }),
    }))
}

/** Annotations attached to one specific target (column or table). */
export function filterByTarget(
  annotations: Annotation[],
  schema?: string,
  table?: string,
  column?: string,
): Annotation[] {
  const key = targetKey(schema, table, column)
  return annotations.filter(a => targetKey(a.schema, a.table, a.column) === key)
}

/** Pinned notes first across the whole set. */
export function sortPinnedFirst(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })
}
