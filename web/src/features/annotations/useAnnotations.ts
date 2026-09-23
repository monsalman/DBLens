import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Annotation } from '../../lib/api'

export interface AnnotationFilters {
  conn?: string
  schema?: string
  table?: string
  q?: string
}

export interface AnnotationDraft {
  note: string
  author?: string
  pinned?: boolean
}

/**
 * Loads annotations for an optional connection/schema/table/keyword filter and
 * exposes CRUD helpers that keep local state in sync with the server.
 */
export function useAnnotations(filters: AnnotationFilters = {}, enabled = true) {
  const { conn, schema, table, q } = filters
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError('')
    try {
      const list = await api.listAnnotations({ conn, schema, table, q })
      setAnnotations(list ?? [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load annotations')
    } finally {
      setLoading(false)
    }
  }, [enabled, conn, schema, table, q])

  useEffect(() => {
    load()
  }, [load])

  const create = useCallback(async (draft: AnnotationDraft & Partial<Annotation>) => {
    const created = await api.createAnnotation({
      target_type: draft.column ? 'column' : 'table',
      connection_id: draft.connection_id ?? conn ?? '',
      schema: draft.schema ?? schema,
      table: draft.table ?? table,
      column: draft.column,
      note: draft.note,
      author: draft.author,
      pinned: draft.pinned ?? false,
    })
    setAnnotations(prev => [created, ...prev])
    return created
  }, [conn, schema, table])

  const update = useCallback(async (id: string, patch: Partial<Annotation>) => {
    const updated = await api.updateAnnotation(id, patch)
    setAnnotations(prev => prev.map(a => (a.id === id ? updated : a)))
    return updated
  }, [])

  const remove = useCallback(async (id: string) => {
    await api.deleteAnnotation(id)
    setAnnotations(prev => prev.filter(a => a.id !== id))
  }, [])

  const byColumn = useMemo(() => {
    const map = new Map<string, Annotation[]>()
    for (const a of annotations) {
      if (a.target_type !== 'column' || !a.column) continue
      const key = a.column
      const list = map.get(key) ?? []
      list.push(a)
      map.set(key, list)
    }
    return map
  }, [annotations])

  const tableAnnotations = useMemo(
    () => annotations.filter(a => a.target_type === 'table' && (!table || a.table === table)),
    [annotations, table],
  )

  const pinned = useMemo(() => annotations.filter(a => a.pinned), [annotations])

  return { annotations, byColumn, tableAnnotations, pinned, loading, error, reload: load, create, update, remove }
}
