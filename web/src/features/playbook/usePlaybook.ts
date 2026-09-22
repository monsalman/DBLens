import { useState, useCallback } from 'react'
import { api, type PlaybookEntry } from '../../lib/api'

export function usePlaybook() {
  const [entries, setEntries] = useState<PlaybookEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (tag?: string, q?: string) => {
    setLoading(true)
    setError('')
    try {
      const list = await api.listPlaybookEntries(tag, q)
      setEntries(list ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const create = useCallback(async (entry: Partial<PlaybookEntry>) => {
    const created = await api.createPlaybookEntry(entry)
    setEntries(prev => [created, ...prev])
    return created
  }, [])

  const update = useCallback(async (id: string, entry: Partial<PlaybookEntry>) => {
    const updated = await api.updatePlaybookEntry(id, entry)
    setEntries(prev => prev.map(e => e.id === id ? updated : e))
    return updated
  }, [])

  const remove = useCallback(async (id: string) => {
    await api.deletePlaybookEntry(id)
    setEntries(prev => prev.filter(e => e.id !== id))
  }, [])

  const share = useCallback(async (id: string) => {
    return api.getPlaybookShareUri(id)
  }, [])

  return { entries, loading, error, load, create, update, remove, share }
}
