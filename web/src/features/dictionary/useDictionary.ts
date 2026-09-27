import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  api,
  type ConnectionConfig,
  type DataDictionary,
  type CommentUpdateRequest,
} from '../../lib/api'
import {
  filterDictionary,
  downloadFile,
  type DictionarySchema,
} from './dictionaryHelper'

export interface UseDictionaryResult {
  dictionary: DataDictionary | null
  loading: boolean
  error: string | null
  selectedSchema: string
  setSelectedSchema: (schema: string) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  piiOnly: boolean
  setPiiOnly: (val: boolean) => void
  updatingComment: boolean
  filteredSchemas: DictionarySchema[]
  fetchDictionary: (schema?: string) => Promise<void>
  updateComment: (req: CommentUpdateRequest) => Promise<boolean>
  exportDictionary: (format: 'html' | 'md' | 'openapi', filename?: string) => Promise<void>
}

export function useDictionary(
  connId: string | null,
  profiles?: ConnectionConfig[]
): UseDictionaryResult {
  const [dictionary, setDictionary] = useState<DataDictionary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedSchema, setSelectedSchema] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [piiOnly, setPiiOnly] = useState(false)
  const [updatingComment, setUpdatingComment] = useState(false)

  const fetchDictionary = useCallback(
    async (schema?: string) => {
      if (!connId) {
        setDictionary(null)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const dict = await api.getDictionary(connId, schema, profiles)
        setDictionary(dict)
      } catch (err: any) {
        setError(err.message || 'Failed to load data dictionary')
      } finally {
        setLoading(false)
      }
    },
    [connId, profiles]
  )

  useEffect(() => {
    fetchDictionary()
  }, [fetchDictionary])

  const updateComment = useCallback(
    async (req: CommentUpdateRequest): Promise<boolean> => {
      if (!connId) return false
      setUpdatingComment(true)
      try {
        await api.updateDictionaryComments(connId, req, profiles)

        // Optimistically update local dictionary state
        setDictionary((prev) => {
          if (!prev) return prev
          let documentedDelta = 0

          const updatedSchemas = prev.schemas.map((s) => {
            if (req.schema && s.name.toLowerCase() !== req.schema.toLowerCase()) return s

            const updatedTables = s.tables.map((t) => {
              if (t.name.toLowerCase() !== req.table.toLowerCase()) return t

              if (!req.column) {
                // Table comment update
                return { ...t, comment: req.comment }
              }

              // Column comment update
              const updatedCols = t.columns.map((c) => {
                if (c.name.toLowerCase() !== req.column!.toLowerCase()) return c

                const hadComment = Boolean(c.comment && c.comment.trim())
                const hasComment = Boolean(req.comment && req.comment.trim())
                if (!hadComment && hasComment) documentedDelta++
                if (hadComment && !hasComment) documentedDelta--

                return { ...c, comment: req.comment }
              })

              return { ...t, columns: updatedCols }
            })

            return { ...s, tables: updatedTables }
          })

          const newDocCount = Math.max(0, prev.summary.documentedColumns + documentedDelta)
          const newCoverage = prev.summary.totalColumns > 0
            ? Math.round((newDocCount / prev.summary.totalColumns) * 1000) / 10
            : 0

          return {
            ...prev,
            schemas: updatedSchemas,
            summary: {
              ...prev.summary,
              documentedColumns: newDocCount,
              documentationCoverage: newCoverage,
            },
          }
        })

        return true
      } catch (err: any) {
        setError(err.message || 'Failed to update documentation comment')
        return false
      } finally {
        setUpdatingComment(false)
      }
    },
    [connId, profiles]
  )

  const exportDictionary = useCallback(
    async (format: 'html' | 'md' | 'openapi', customFilename?: string) => {
      if (!connId) return
      try {
        const text = await api.fetchDictionaryExportText(connId, format, selectedSchema, profiles)
        const ext = format === 'openapi' ? 'json' : format
        const mime =
          format === 'html'
            ? 'text/html;charset=utf-8'
            : format === 'md'
            ? 'text/markdown;charset=utf-8'
            : 'application/json;charset=utf-8'
        const filename = customFilename || `data-dictionary-${connId}.${ext}`
        downloadFile(text, filename, mime)
      } catch (err: any) {
        setError(err.message || `Failed to export documentation as ${format}`)
      }
    },
    [connId, selectedSchema, profiles]
  )

  const filteredSchemas = useMemo(() => {
    if (!dictionary) return []
    return filterDictionary(dictionary, selectedSchema, searchQuery, piiOnly)
  }, [dictionary, selectedSchema, searchQuery, piiOnly])

  return {
    dictionary,
    loading,
    error,
    selectedSchema,
    setSelectedSchema,
    searchQuery,
    setSearchQuery,
    piiOnly,
    setPiiOnly,
    updatingComment,
    filteredSchemas,
    fetchDictionary,
    updateComment,
    exportDictionary,
  }
}
