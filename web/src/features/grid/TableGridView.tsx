import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, ArrowUpDown, Trash2, RefreshCw, Key, Link2, Plus, Sparkles, Upload, Download, ChevronDown, Loader2, X, Code2, Shield, Globe, StickyNote } from 'lucide-react'
import { api } from '../../lib/api'
import type { ColumnMeta } from '../../lib/api'
import { detectPIIType, maskValue, type MaskStrategy } from '../../lib/masker'
import { useAppStore } from '../../stores/appStore'
import { AddRowModal } from './AddRowModal'
import { MockDataModal } from './MockDataModal'
import { ImportModal } from './ImportModal'
import { TableSchemaView } from './TableSchemaView'
import { generateStagedSQL, type StagedChange } from './stagedMutations'
import { JsonStudioModal } from '../json/JsonStudioModal'
import { parseJsonSafely } from '../json/jsonPathHelper'
import { SpatialMapDrawer } from '../gis/SpatialMapDrawer'
import { isSpatialColumn, isSpatialValue } from '../gis/gisHelper'
import { LiveFeedDrawer } from '../livefeed/LiveFeedDrawer'
import { AnnotationBadge } from '../annotations/AnnotationBadge'
import { useAnnotations } from '../annotations/useAnnotations'

interface Props {
  connId: string
  schema: string
  table: string
}

export const TableGridView: React.FC<Props> = ({ connId, schema, table }) => {
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize] = useState(50)
  const [sortCol, setSortCol] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCol, setSelectedCol] = useState('')
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; col: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [showMockModal, setShowMockModal] = useState(false)
  const [mockError, setMockError] = useState<string | null>(null)
  const [mockLoading, setMockLoading] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'data' | 'schema'>('data')
  const qc = useQueryClient()
  const { openPeekDrawer, connections, openRestModal } = useAppStore()
  const activeConn = connections.find((c) => c.id === connId)
  const isProd = activeConn?.environment === 'production'

  // Feature-34: annotations for the current table (column badges + pinned banner)
  const { annotations: tableNotes } = useAnnotations(
    { conn: connId, table, schema },
    !!connId && !!table,
  )
  const pinnedNotes = useMemo(() => tableNotes.filter(n => n.pinned), [tableNotes])

  const [stagedMode, setStagedMode] = useState<boolean>(() => isProd)
  const [stagedChanges, setStagedChanges] = useState<Record<string, StagedChange>>({})
  const [showDiffModal, setShowDiffModal] = useState(false)
  const [isApplyingStaged, setIsApplyingStaged] = useState(false)
  const [privacyMode, setPrivacyMode] = useState<boolean>(false)
  const [privacyStrategy, setPrivacyStrategy] = useState<MaskStrategy>('partial')
  const [showPrivacyMenu, setShowPrivacyMenu] = useState<boolean>(false)
  const [maskExport, setMaskExport] = useState<boolean>(true)
  const privacyMenuRef = useRef<HTMLDivElement>(null)
  const [jsonModal, setJsonModal] = useState<{
    isOpen: boolean
    row: Record<string, any>
    col: string
    val: any
    rowIdx: number
  } | null>(null)
  const [spatialDrawer, setSpatialDrawer] = useState<{
    isOpen: boolean
    row: Record<string, any>
    col: string
    val: any
    rowIdx: number
  } | null>(null)
  const [showLiveFeed, setShowLiveFeed] = useState(false)

  const exportMenuRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const cancelledRef = useRef(false)
  const isCommittingRef = useRef(false)

  // Keyboard shortcut Alt+M for Privacy Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault()
        setPrivacyMode((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
      if (privacyMenuRef.current && !privacyMenuRef.current.contains(e.target as Node)) {
        setShowPrivacyMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    setPageIndex(0)
    setSortCol('')
    setSelectedRows({})
    setSearchTerm('')
    setSelectedCol('')
    setEditingCell(null)
    setViewMode('data')
    setStagedChanges({})
    setShowDiffModal(false)
    setIsApplyingStaged(false)
  }, [table, schema, connId])

  // Focus edit input when entering edit mode
  useEffect(() => {
    if (editingCell) {
      setTimeout(() => editInputRef.current?.focus(), 0)
    }
  }, [editingCell])

  useEffect(() => {
    if (isProd) {
      setStagedMode(true)
    }
  }, [isProd, connId, table])

  // Columns metadata
  const { data: cols, isLoading: colsLoading } = useQuery({
    queryKey: ['columns', connId, schema, table],
    queryFn: () => api.getTableDetails(connId, table, schema),
    enabled: !!table,
  })

  const metaCols: ColumnMeta[] = cols?.columns ?? []
  const pkCols = useMemo(() => metaCols.filter(c => c.isPrimaryKey || c.isPrimary), [metaCols])
  const hasPk = pkCols.length > 0

  // FK lookup map by column name
  const fkMap = useMemo(() => {
    const map = new Map<string, { column: string; refTable: string; refColumn: string }>()
    if (cols?.fks) {
      for (const f of cols.fks) {
        if (f.column && f.refTable && f.refColumn) {
          map.set(f.column, f)
        }
      }
    }
    if (cols?.columns) {
      for (const c of cols.columns) {
        if (c.isForeignKey && c.foreignKeyTarget && !map.has(c.name)) {
          map.set(c.name, {
            column: c.name,
            refTable: c.foreignKeyTarget.table,
            refColumn: c.foreignKeyTarget.column,
          })
        }
      }
    }
    return map
  }, [cols])

  // Active filter column
  const filterCol = (selectedCol && metaCols.some(c => c.name === selectedCol))
    ? selectedCol
    : (pkCols[0]?.name ?? metaCols[0]?.name ?? '')

  // Data rows
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['data', connId, table, schema, pageIndex, pageSize, sortCol, sortDir, searchTerm, filterCol],
    queryFn: () =>
      api.queryTableData(connId, table, {
        schema,
        limit: pageSize,
        offset: pageIndex * pageSize,
        orderBy: sortCol,
        orderDir: sortDir,
        filters: searchTerm.trim() && filterCol
          ? [{ column: filterCol, operator: 'LIKE', value: searchTerm.trim() }]
          : [],
      }),
    enabled: !!table,
  })

  // Mutate mutation
  const mutateM = useMutation({
    mutationFn: (payload: any) => api.mutateRow(connId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', connId, table] }),
  })

  const rows = data?.rows ?? []
  const totalCount = data?.totalCount ?? rows.length
  const totalPages = Math.ceil(totalCount / pageSize) || 1

  const getRowKey = (row: Record<string, any>, i: number) => {
    if (!hasPk) return String(i)
    return pkCols.map(c => `${c.name}:${row[c.name]}`).join('|')
  }

  const handleDelete = async () => {
    if (!hasPk || !table) return
    const toDelete = rows.filter((r, i) => selectedRows[getRowKey(r, i)])
    if (!toDelete.length) return
    for (const r of toDelete) {
      const where: Record<string, any> = {}
      for (const pk of pkCols) {
        where[pk.name] = r[pk.name]
      }
      await mutateM.mutateAsync({ schema, table, type: 'DELETE', where })
    }
    setSelectedRows({})
  }

  const colPIIMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of metaCols) {
      let sample = ''
      for (const r of rows) {
        if (r[c.name] !== null && r[c.name] !== undefined && String(r[c.name]).trim() !== '') {
          sample = String(r[c.name])
          break
        }
      }
      const pii = detectPIIType(c.name, sample)
      if (pii) {
        map.set(c.name, pii)
      }
    }
    return map
  }, [metaCols, rows])

  const handleExport = async (format: 'csv' | 'json' | 'sql') => {
    setShowExportMenu(false)
    if (!table) return
    setExportLoading(true)
    setInlineError(null)
    try {
      await api.exportTableBlob(
        connId,
        schema,
        table,
        format,
        undefined,
        maskExport,
        privacyStrategy
      )
    } catch (err: any) {
      setInlineError(`Export failed: ${err?.message ?? 'Unknown error'}`)
    } finally {
      setExportLoading(false)
    }
  }

  // Column headers
  const colDefs = metaCols.map(col => ({
    name: col.name,
    type: col.dataType || col.type || 'text',
    nullable: col.isNullable ?? true,
    isPk: !!(col.isPrimaryKey || col.isPrimary),
    fk: fkMap.get(col.name),
    pii: colPIIMap.get(col.name),
  }))

  const formatValue = (val: any, colName?: string) => {
    if (val === null || val === undefined) return <span className="italic text-[var(--muted)] opacity-60 font-mono text-xs">null</span>
    if (privacyMode && colName && colPIIMap.has(colName)) {
      val = maskValue(colName, val, privacyStrategy)
    }
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }

  // Inline edit handlers
  const startEdit = (rowIdx: number, col: string, currentVal: any) => {
    if (!hasPk) return
    cancelledRef.current = false
    isCommittingRef.current = false
    setEditingCell({ rowIdx, col })
    setEditValue(currentVal === null || currentVal === undefined ? '' : String(currentVal))
  }

  const cancelEdit = () => {
    cancelledRef.current = true
    setEditingCell(null)
  }

  const commitEdit = async (row: Record<string, any>) => {
    if (cancelledRef.current || isCommittingRef.current) return
    if (!editingCell) return
    isCommittingRef.current = true
    try {
      const { col, rowIdx } = editingCell
      setEditingCell(null)
      const originalVal = row[col]
      const newVal = editValue
      const rowKey = getRowKey(row, rowIdx)
      const cellKey = `${rowKey}:${col}`

      // skip if unchanged
      if (String(originalVal ?? '') === newVal) {
        if (stagedMode) {
          setStagedChanges((prev) => {
            const next = { ...prev }
            delete next[cellKey]
            return next
          })
        }
        return
      }

      setInlineError(null)
      const where: Record<string, any> = {}
      for (const pk of pkCols) {
        where[pk.name] = row[pk.name]
      }

      if (stagedMode) {
        setStagedChanges((prev) => ({
          ...prev,
          [cellKey]: {
            key: cellKey,
            row,
            col,
            oldVal: originalVal,
            newVal: newVal === '' ? null : newVal,
            where,
          },
        }))
        return
      }

      await mutateM.mutateAsync({
        schema,
        table,
        type: 'UPDATE',
        data: { [col]: newVal === '' ? null : newVal },
        where,
      })
    } catch (err: any) {
      setInlineError(`Update failed: ${err?.message ?? 'Unknown error'}`)
    } finally {
      isCommittingRef.current = false
      cancelledRef.current = false
    }
  }

  const handleJsonModalSave = async (newValue: string) => {
    if (!jsonModal) return
    const { row, col, rowIdx, val: oldVal } = jsonModal
    const rowKey = getRowKey(row, rowIdx)
    const cellKey = `${rowKey}:${col}`
    const where: Record<string, any> = {}
    for (const pk of pkCols) {
      where[pk.name] = row[pk.name]
    }

    if (stagedMode) {
      setStagedChanges((prev) => ({
        ...prev,
        [cellKey]: {
          key: cellKey,
          row,
          col,
          oldVal,
          newVal: newValue,
          where,
        },
      }))
    } else {
      try {
        await mutateM.mutateAsync({
          schema,
          table,
          type: 'UPDATE',
          data: { [col]: newValue },
          where,
        })
      } catch (err: any) {
        setInlineError(`Update failed: ${err?.message ?? 'Unknown error'}`)
      }
    }
  }

  const handleSpatialDrawerSave = async (newValue: string) => {
    if (!spatialDrawer) return
    const { row, col, rowIdx, val: oldVal } = spatialDrawer
    if (!row || !col) return
    const rowKey = getRowKey(row, rowIdx)
    const cellKey = `${rowKey}:${col}`
    const where: Record<string, any> = {}
    for (const pk of pkCols) {
      where[pk.name] = row[pk.name]
    }

    if (stagedMode) {
      setStagedChanges((prev) => ({
        ...prev,
        [cellKey]: {
          key: cellKey,
          row,
          col,
          oldVal,
          newVal: newValue,
          where,
        },
      }))
    } else {
      try {
        await mutateM.mutateAsync({
          schema,
          table,
          type: 'UPDATE',
          data: { [col]: newValue },
          where,
        })
      } catch (err: any) {
        setInlineError(`Update failed: ${err?.message ?? 'Unknown error'}`)
      }
    }
  }

  const stagedList = useMemo(() => Object.values(stagedChanges), [stagedChanges])
  const stagedCount = stagedList.length

  const handleApplyStagedChanges = async () => {
    if (stagedCount === 0 || isApplyingStaged) return
    if (activeConn?.readOnly) {
      setInlineError('Connection is read-only. Mutation blocked by Safe Mode.')
      return
    }
    setIsApplyingStaged(true)
    setInlineError(null)
    try {
      for (const change of stagedList) {
        await api.mutateRow(
          connId,
          {
            schema,
            table,
            type: 'UPDATE',
            data: { [change.col]: change.newVal },
            where: change.where,
          },
          connections
        )
        setStagedChanges((prev) => {
          const next = { ...prev }
          delete next[change.key]
          return next
        })
      }
      setShowDiffModal(false)
      qc.invalidateQueries({ queryKey: ['data', connId, table] })
    } catch (err: any) {
      setInlineError(`Failed to apply staged mutations: ${err?.message ?? 'Unknown error'}`)
      qc.invalidateQueries({ queryKey: ['data', connId, table] })
    } finally {
      setIsApplyingStaged(false)
    }
  }

  const handleAddRow = async (formData: Record<string, any>) => {
    setAddError(null)
    try {
      await mutateM.mutateAsync({ schema, table, type: 'INSERT', data: formData })
      setShowAddModal(false)
    } catch (err: any) {
      setAddError(err?.message ?? 'Insert failed')
    }
  }

  const handleMockSubmit = async (rows: Record<string, any>[]) => {
    setMockError(null)
    setMockLoading(true)
    try {
      await api.batchInsert(connId, schema, table, rows)
      qc.invalidateQueries({ queryKey: ['data', connId, table] })
      setShowMockModal(false)
    } catch (err: any) {
      setMockError(err?.message ?? 'Batch insert failed')
    } finally {
      setMockLoading(false)
    }
  }

  if (!table) return <div className="flex-1 flex items-center justify-center text-[var(--muted)] font-mono text-xs">Select a table</div>
  if (isLoading || colsLoading) return <div className="flex-1 flex items-center justify-center text-[var(--muted)] font-mono text-xs">Loading...</div>

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg)] overflow-hidden">
      {pinnedNotes.length > 0 && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-500 text-[11px] px-3 py-1.5 font-mono shrink-0 space-y-1">
          {pinnedNotes.map(n => (
            <div key={n.id} className="flex items-start gap-1.5">
              <StickyNote className="w-3 h-3 mt-0.5 shrink-0" />
              <span className="shrink-0 font-semibold">
                {n.column ? `${n.column}:` : 'Table note:'}
              </span>
              <span className="whitespace-pre-wrap break-words text-[var(--fg)]">{n.note}</span>
              {n.author && <span className="ml-auto shrink-0 opacity-70">— {n.author}</span>}
            </div>
          ))}
        </div>
      )}
      {inlineError && (
        <div className="bg-red-500/10 border-b border-red-500/30 text-red-400 text-xs px-3 py-1.5 flex items-center justify-between font-mono shrink-0">
          <span>{inlineError}</span>
          <button onClick={() => setInlineError(null)} className="hover:text-red-300 font-bold ml-2">✕</button>
        </div>
      )}
      {/* Toolbar */}
      <div className="h-10 border-b border-[var(--border)] px-3 flex items-center gap-3 shrink-0">
        {/* View Mode Switcher */}
        <div className="flex items-center bg-[var(--surface)] border border-[var(--border)] rounded p-0.5 shrink-0 font-mono text-xs">
          <button
            onClick={() => setViewMode('data')}
            className={`px-2.5 py-0.5 rounded transition-colors ${
              viewMode === 'data'
                ? 'bg-[var(--accent)] text-white font-medium shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            Data
          </button>
          <button
            onClick={() => setViewMode('schema')}
            className={`px-2.5 py-0.5 rounded transition-colors ${
              viewMode === 'schema'
                ? 'bg-[var(--accent)] text-white font-medium shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            Schema
          </button>
        </div>

        {viewMode === 'data' ? (
          <>
            {/* Search & Column Picker */}
            <div className="flex items-center gap-1.5 flex-1 max-w-sm">
              {metaCols.length > 0 && (
                <select
                  value={filterCol}
                  onChange={(e) => {
                    setSelectedCol(e.target.value)
                    setPageIndex(0)
                  }}
                  title="Search Column"
                  className="text-xs py-1 px-2 bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] rounded font-mono max-w-[130px] shrink-0 truncate focus:outline-none"
                >
                  {metaCols.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} {c.isPrimaryKey || c.isPrimary ? '(PK)' : ''}
                    </option>
                  ))}
                </select>
              )}
              <div className="relative flex-1">
                <Search className="w-3 h-3 text-[var(--muted)] absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => {
                    setSearchTerm(e.target.value)
                    setPageIndex(0)
                  }}
                  placeholder={filterCol ? `Filter ${table} by ${filterCol}...` : `Filter ${table}...`}
                  className="form-input pl-7 pr-2 py-0.5 text-xs w-full"
                />
              </div>
            </div>
            
            <span className="text-[11px] text-[var(--muted)] font-mono">{metaCols.length} cols</span>
            
            <span className="text-[11px] text-[var(--muted)]">{totalCount} rows</span>
            
            {/* Actions */}
            <div className="flex items-center gap-1.5 ml-auto">
              {/* Privacy Mode Toggle & Strategy Selector */}
              <div className="relative" ref={privacyMenuRef}>
                <div className="inline-flex items-center rounded border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setPrivacyMode(!privacyMode)}
                    className={`flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono transition-colors cursor-pointer ${
                      privacyMode
                        ? 'bg-purple-500/20 text-purple-300 font-medium'
                        : 'text-[var(--muted)] hover:text-[var(--fg)]'
                    }`}
                    title="Toggle Privacy Mode (Alt+M): Mask PII columns dynamically"
                  >
                    <Shield className={`w-3.5 h-3.5 ${privacyMode ? 'text-purple-400' : 'text-[var(--muted)]'}`} />
                    <span>Privacy: {privacyMode ? 'ON' : 'OFF'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPrivacyMenu(!showPrivacyMenu)}
                    className={`px-1 py-0.5 border-l border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors ${
                      privacyMode ? 'bg-purple-500/20 text-purple-300' : ''
                    }`}
                    title="Privacy Masking Strategy"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>

                {showPrivacyMenu && (
                  <div className="absolute left-0 mt-1 w-44 bg-[var(--bg)] border border-[var(--border)] rounded shadow-lg py-1 z-30 font-mono text-xs">
                    <div className="px-3 py-1 text-[10px] text-[var(--muted)] uppercase tracking-wider font-semibold border-b border-[var(--border)] mb-1">
                      Masking Strategy
                    </div>
                    {(['partial', 'redact', 'hash', 'faker'] as MaskStrategy[]).map((strat) => (
                      <button
                        key={strat}
                        type="button"
                        onClick={() => {
                          setPrivacyStrategy(strat)
                          setPrivacyMode(true)
                          setShowPrivacyMenu(false)
                        }}
                        className={`w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors ${
                          privacyStrategy === strat
                            ? 'bg-purple-500/15 text-purple-300 font-medium'
                            : 'text-[var(--fg)] hover:bg-[var(--hover)]'
                        }`}
                      >
                        <span className="capitalize">{strat}</span>
                        {privacyStrategy === strat && <span className="text-[10px] text-purple-400">●</span>}
                      </button>
                    ))}
                    <div className="px-3 py-1 mt-1 border-t border-[var(--border)] text-[10px] text-[var(--muted)]">
                      Shortcut: <kbd className="px-1 py-0.5 rounded bg-[var(--surface)] text-[var(--fg)]">Alt+M</kbd>
                    </div>
                  </div>
                )}
              </div>

              {/* Staged Mode Toggle */}
              <button
                type="button"
                onClick={() => setStagedMode(!stagedMode)}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border transition-colors cursor-pointer ${
                  stagedMode
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 font-medium'
                    : 'bg-[var(--surface)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--fg)]'
                }`}
                title="Toggle Staged Mode: Review changes and generate SQL diff before applying"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${stagedMode ? 'bg-amber-400 animate-pulse' : 'bg-[var(--muted)]'}`} />
                <span>Staged: {stagedMode ? 'ON' : 'OFF'}</span>
              </button>

              {Object.values(selectedRows).some(Boolean) && (
                <button onClick={handleDelete} className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-red-400 hover:bg-red-950/20">
                  <Trash2 className="w-3 h-3" /> <span>{Object.values(selectedRows).filter(Boolean).length}</span>
                </button>
              )}

              {/* Add Row */}
              <button
                onClick={() => { setAddError(null); setShowAddModal(true) }}
                title="Add Row"
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>

              {/* Mock Data */}
              <button
                onClick={() => { setMockError(null); setShowMockModal(true) }}
                title="Generate Mock Data"
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]"
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>

              {/* Import Data */}
              <button
                onClick={() => setShowImportModal(true)}
                title="Import Data (CSV / SQL)"
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] font-mono"
              >
                <Upload className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Import</span>
              </button>

              {/* Instant Table REST API Playground */}
              <button
                onClick={() => openRestModal(table, schema)}
                title="Instant Table REST API & Playground"
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border)] text-[11px] font-mono text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
              >
                <Code2 className="w-3.5 h-3.5 text-blue-400" />
                <span className="hidden sm:inline">REST API</span>
              </button>

              {/* Live Feed */}
              {table && (
                <button
                  onClick={() => setShowLiveFeed(true)}
                  title="Live Table Feed — watch rows change in real time"
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border)] text-[11px] font-mono text-[var(--muted)] hover:text-green-400 hover:border-green-500/40 hover:bg-green-500/10 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  <span>Live Feed ▶</span>
                </button>
              )}
              
              <button onClick={() => refetch()} className="p-1 text-[var(--muted)] hover:text-[var(--fg)]" title="Refresh Table">
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              
              {/* Export Dropdown */}
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setShowExportMenu(prev => !prev)}
                  disabled={exportLoading}
                  title="Export Full Table"
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border)] text-[11px] font-mono text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors disabled:opacity-50"
                >
                  <Download className={`w-3.5 h-3.5 ${exportLoading ? 'animate-bounce' : ''}`} />
                  <span>Export</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 mt-1 w-48 bg-[var(--bg)] border border-[var(--border)] rounded shadow-lg py-1 z-30 font-mono text-xs">
                    <label className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)] text-[11px] text-[var(--fg)] cursor-pointer hover:bg-[var(--hover)] select-none">
                      <span className="flex items-center gap-1.5">
                        <Shield className="w-3 h-3 text-purple-400" />
                        <span>Sanitize / Mask PII</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={maskExport}
                        onChange={(e) => setMaskExport(e.target.checked)}
                        className="rounded border-[var(--border)] bg-[var(--surface)] text-purple-500 w-3.5 h-3.5"
                      />
                    </label>
                    <button
                      onClick={() => handleExport('csv')}
                      className="w-full text-left px-3 py-1.5 text-[var(--fg)] hover:bg-[var(--hover)] flex items-center justify-between"
                    >
                      <span>Export CSV</span>
                      <span className="text-[10px] text-[var(--muted)]">.csv</span>
                    </button>
                    <button
                      onClick={() => handleExport('json')}
                      className="w-full text-left px-3 py-1.5 text-[var(--fg)] hover:bg-[var(--hover)] flex items-center justify-between"
                    >
                      <span>Export JSON</span>
                      <span className="text-[10px] text-[var(--muted)]">.json</span>
                    </button>
                    <button
                      onClick={() => handleExport('sql')}
                      className="w-full text-left px-3 py-1.5 text-[var(--fg)] hover:bg-[var(--hover)] flex items-center justify-between"
                    >
                      <span>Export SQL</span>
                      <span className="text-[10px] text-[var(--muted)]">.sql</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Feature-34: table-level notes */}
            <AnnotationBadge
              connId={connId}
              schema={schema}
              table={table}
              annotations={tableNotes}
            />
          </>
        ) : (
          <div className="text-xs font-mono text-[var(--muted)] flex items-center gap-2">
            <span>Table: <span className="text-[var(--fg)] font-semibold">{table}</span></span>
            {schema && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">{schema}</span>}
          </div>
        )}
      </div>

      {viewMode === 'data' ? (
        <>
          {/* Data Grid */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-[var(--bg)] z-10">
            <tr>
              <th className="w-8 px-2 py-1.5 text-[10px] text-[var(--muted)] font-mono border-r border-[var(--border)]">
                <input
                  type="checkbox"
                  disabled={!hasPk}
                  checked={hasPk && rows.length > 0 && rows.every((r, i) => selectedRows[getRowKey(r, i)])}
                  onChange={e => {
                    const checked = e.target.checked
                    setSelectedRows(checked ? Object.fromEntries(rows.map((r, i) => [getRowKey(r, i), true])) : {} as Record<string, boolean>)
                  }}
                  className="rounded border-[var(--border)] bg-[var(--surface)] text-indigo-500 w-3 h-3 disabled:opacity-30"
                />
              </th>
              {colDefs.map(c => (
                <th key={c.name} className="px-2 py-1.5 text-[10px] text-[var(--muted)] font-mono border-r border-[var(--border)] whitespace-nowrap">
                  <div className="flex items-center gap-1 group cursor-pointer" onClick={() => {
                    if (sortCol === c.name) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
                    else { setSortCol(c.name); setSortDir('asc') }
                  }}>
                    {c.isPk && <Key className="w-2.5 h-2.5 text-amber-500 shrink-0" />}
                    {c.fk && (
                      <span
                        className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-mono bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 shrink-0"
                        title={`Foreign key -> ${c.fk.refTable}.${c.fk.refColumn}`}
                      >
                        <Link2 className="w-2.5 h-2.5" />
                        <span>FK</span>
                      </span>
                    )}
                    {c.pii && (
                      <span
                        className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-mono bg-purple-500/15 text-purple-400 border border-purple-500/30 shrink-0"
                        title={`PII Column: ${c.pii}`}
                      >
                        <Shield className="w-2.5 h-2.5" />
                        <span>{c.pii}</span>
                      </span>
                    )}
                    {isSpatialColumn(c.name, c.type) && (
                      <span
                        className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0"
                        title="Spatial / GIS Column"
                      >
                        <Globe className="w-2.5 h-2.5" />
                        <span>GIS</span>
                      </span>
                    )}
                    <span className="text-[var(--fg)]">{c.name}</span>
                    <span className="text-[9px] text-[var(--muted)]">{c.type}</span>
                    <AnnotationBadge
                      connId={connId}
                      schema={schema}
                      table={table}
                      column={c.name}
                      annotations={tableNotes}
                    />
                    <ArrowUpDown className="w-2.5 h-2.5 text-[var(--muted)] group-hover:text-[var(--fg)] shrink-0" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          
          <tbody>
            {rows.map((row, i) => {
              const rowKey = getRowKey(row, i)
              return (
                <tr key={i} className="data-row-hover border-b border-[var(--border)]">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      disabled={!hasPk}
                      checked={!!selectedRows[rowKey]}
                      onChange={e => setSelectedRows(p => ({ ...p, [rowKey]: e.target.checked }))}
                      className="rounded border-[var(--border)] bg-[var(--surface)] text-indigo-500 w-3 h-3 disabled:opacity-30"
                    />
                  </td>
                  {colDefs.map(c => {
                    const rowKey = getRowKey(row, i)
                    const cellKey = `${rowKey}:${c.name}`
                    const staged = stagedChanges[cellKey]
                    const isStaged = !!staged
                    const val = isStaged ? staged.newVal : row[c.name]
                    const isFkValue = !isStaged && !!c.fk && val !== null && val !== undefined && String(val) !== ''
                    const isEditing = editingCell?.rowIdx === i && editingCell?.col === c.name
                    const isPending = mutateM.isPending
                    const isJsonType = !!(c.type && c.type.toLowerCase().includes('json'))
                    const jsonCheck = parseJsonSafely(val)
                    const isJson = isJsonType || jsonCheck.isJson
                    const isMaskedPII = privacyMode && colPIIMap.has(c.name)
                    const isSpatial = !isMaskedPII && (isSpatialValue(val) || isSpatialColumn(c.name, c.type)) && val !== null && val !== undefined && String(val).trim() !== ''

                    return (
                      <td
                        key={c.name}
                        title={
                          isMaskedPII
                            ? `Masked PII (${colPIIMap.get(c.name)})`
                            : isStaged
                            ? `Staged change: ${String(staged.oldVal ?? 'NULL')} ➔ ${String(staged.newVal ?? 'NULL')}`
                            : (!hasPk ? 'Inline edit requires a primary key' : undefined)
                        }
                        className={`px-2 py-1.5 font-mono-data text-[var(--fg)] truncate max-w-[280px] relative transition-colors ${
                          hasPk && !isFkValue && !isMaskedPII ? 'cursor-text' : ''
                        } ${isPending && isEditing ? 'opacity-50' : ''} ${
                          isStaged
                            ? 'bg-amber-500/15 text-amber-300 font-semibold border border-amber-500/40 rounded-xs'
                            : ''
                        }`}
                        onDoubleClick={() => {
                          if (!hasPk) return
                          if (isFkValue) return
                          if (isMaskedPII) return
                          startEdit(i, c.name, val)
                        }}
                      >
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(row)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                e.currentTarget.blur()
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelEdit()
                              }
                            }}
                            className="w-full bg-[var(--surface)] border border-indigo-500 rounded px-1 py-0 text-xs font-mono text-[var(--fg)] focus:outline-none"
                            onClick={e => e.stopPropagation()}
                          />
                        ) : isFkValue ? (
                          <button
                            type="button"
                            disabled={isMaskedPII}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (isMaskedPII) return
                              openPeekDrawer(c.fk!.refTable, c.fk!.refColumn, val)
                            }}
                            className={`inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer group text-left max-w-full truncate ${
                              isMaskedPII ? 'opacity-50 cursor-not-allowed hover:no-underline' : ''
                            }`}
                            title={isMaskedPII ? 'Peek disabled in Privacy Mode' : `Peek ${c.fk!.refTable}.${c.fk!.refColumn} = ${String(val)}`}
                          >
                            <span className="truncate">{formatValue(val, c.name)}</span>
                            <Link2 className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 shrink-0" />
                          </button>
                        ) : isJson ? (
                          <span className="flex items-center gap-1.5 truncate group/json">
                            {isStaged && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse"
                                title="Pending staged update"
                              />
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setJsonModal({
                                  isOpen: true,
                                  row,
                                  col: c.name,
                                  val,
                                  rowIdx: i,
                                })
                              }}
                              className="inline-flex items-center gap-1 px-1 py-0.2 rounded bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 text-[10px] font-mono border border-indigo-500/30 cursor-pointer shrink-0 transition-colors"
                              title="Open in JSON Document Studio"
                            >
                              <span className="font-bold">{'{ }'}</span>
                              <span className="text-[9px] uppercase tracking-wider font-semibold">JSON</span>
                            </button>
                            <span className="truncate">{formatValue(val, c.name)}</span>
                          </span>
                        ) : isSpatial ? (
                          <span className="flex items-center gap-1.5 truncate group/spatial">
                            {isStaged && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse"
                                title="Pending staged update"
                              />
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSpatialDrawer({
                                  isOpen: true,
                                  row,
                                  col: c.name,
                                  val,
                                  rowIdx: i,
                                })
                              }}
                              className="inline-flex items-center gap-1 px-1 py-0.2 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-[10px] font-mono border border-emerald-500/30 cursor-pointer shrink-0 transition-colors"
                              title="Open in Spatial & PostGIS Studio"
                            >
                              <Globe className="w-2.5 h-2.5" />
                              <span className="text-[9px] uppercase tracking-wider font-semibold">GIS</span>
                            </button>
                            <span className="truncate">{formatValue(val, c.name)}</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 truncate">
                            {isStaged && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse"
                                title="Pending staged update"
                              />
                            )}
                            <span className="truncate">{formatValue(val, c.name)}</span>
                          </span>
                        )}
                      </td>
                    )
                  })}
              </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={Math.max(colDefs.length + 1, 2)} className="text-center py-12 text-[var(--muted)] font-mono text-xs">No rows returned</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="h-9 border-t border-[var(--border)] px-3 flex items-center justify-between bg-[var(--bg)] text-[11px] text-[var(--muted)] font-mono">
        <span>{totalCount} total</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPageIndex(p => Math.max(0, p - 1))} disabled={pageIndex === 0}
            className="px-2 py-0.5 rounded hover:bg-[var(--hover)] disabled:opacity-30">&lt;</button>
          <span>{pageIndex + 1} / {totalPages}</span>
          <button onClick={() => setPageIndex(p => Math.min(totalPages - 1, p + 1))} disabled={pageIndex >= totalPages - 1}
            className="px-2 py-0.5 rounded hover:bg-[var(--hover)] disabled:opacity-30">&gt;</button>
        </div>
      </div>
        </>
      ) : (
        <TableSchemaView
          connId={connId}
          table={table}
          schema={schema}
          detail={cols}
          isLoading={colsLoading}
          onRefresh={() => qc.invalidateQueries({ queryKey: ['columns', connId, schema, table] })}
        />
      )}

      {/* Add Row Modal */}
      {showAddModal && (
        <AddRowModal
          colDefs={colDefs}
          onSubmit={handleAddRow}
          onClose={() => setShowAddModal(false)}
          error={addError}
          loading={mutateM.isPending}
        />
      )}

      {/* Mock Data Modal */}
      {showMockModal && (
        <MockDataModal
          connId={connId}
          schema={schema}
          table={table}
          columns={metaCols}
          onSubmit={handleMockSubmit}
          onClose={() => setShowMockModal(false)}
          error={mockError}
          loading={mockLoading}
        />
      )}

      {/* Import Modal */}
      {showImportModal && (
        <ImportModal
          connId={connId}
          schema={schema}
          table={table}
          onClose={() => setShowImportModal(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['data', connId, table] })
            refetch()
          }}
        />
      )}

      {/* Floating Action Bar for Staged Changes */}
      {stagedCount > 0 && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 bg-[var(--surface)] border-2 border-amber-500/60 rounded-xl shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2 font-mono text-xs font-semibold text-amber-400">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span>{stagedCount} Staged Change{stagedCount > 1 ? 's' : ''}</span>
          </div>
          <div className="h-4 w-px bg-[var(--border)]" />
          <button
            type="button"
            onClick={() => setShowDiffModal(true)}
            className="px-2.5 py-1 text-xs font-mono rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-colors cursor-pointer"
          >
            Review SQL Diff
          </button>
          <button
            type="button"
            onClick={() => setStagedChanges({})}
            disabled={isApplyingStaged}
            className="px-2.5 py-1 text-xs font-mono rounded text-[var(--muted)] hover:text-red-400 transition-colors cursor-pointer disabled:opacity-40"
          >
            Discard All
          </button>
          <button
            type="button"
            onClick={handleApplyStagedChanges}
            disabled={isApplyingStaged}
            className="px-3 py-1 text-xs font-mono font-medium rounded bg-amber-500 hover:bg-amber-600 text-slate-950 shadow transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            {isApplyingStaged && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>{isApplyingStaged ? 'Applying...' : 'Apply Changes'}</span>
          </button>
        </div>
      )}

      {/* Review SQL Diff Modal */}
      {showDiffModal && (
        <div className="modal-overlay p-4 z-50">
          <div className="modal-content w-full max-w-2xl p-5 flex flex-col gap-3.5 bg-[var(--surface)] border border-[var(--border)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-2.5">
              <div className="flex items-center gap-2 font-mono text-xs font-bold text-[var(--fg)]">
                <span className="text-amber-400 uppercase">Review SQL Diff</span>
                <span className="text-[var(--muted)]">({stagedCount} statement{stagedCount > 1 ? 's' : ''})</span>
              </div>
              <button
                type="button"
                onClick={() => setShowDiffModal(false)}
                className="text-[var(--muted)] hover:text-[var(--fg)] p-0.5 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase text-[var(--muted)] tracking-wider">
                Generated UPDATE Statements
              </label>
              <div className="p-3 bg-[var(--bg)] border border-[var(--border)] rounded font-mono text-xs text-amber-300 dark:text-amber-200 whitespace-pre-wrap max-h-80 overflow-auto">
                {generateStagedSQL(stagedChanges, table, schema, activeConn?.dialect)}
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setStagedChanges({})
                  setShowDiffModal(false)
                }}
                className="text-xs font-mono text-red-400 hover:text-red-300 cursor-pointer"
              >
                Discard All
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowDiffModal(false)}
                  className="btn-secondary px-3 py-1.5 text-xs font-mono"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDiffModal(false)
                    handleApplyStagedChanges()
                  }}
                  disabled={isApplyingStaged}
                  className="px-3 py-1.5 text-xs font-mono font-medium rounded bg-amber-500 hover:bg-amber-600 text-slate-950 shadow transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                >
                  {isApplyingStaged && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>{isApplyingStaged ? 'Applying...' : 'Apply Changes'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {jsonModal && (
        <JsonStudioModal
          isOpen={jsonModal.isOpen}
          initialValue={jsonModal.val}
          columnName={jsonModal.col}
          tableName={table}
          dialect={activeConn?.dialect || activeConn?.driver || 'postgres'}
          readOnly={!hasPk || activeConn?.readOnly}
          onClose={() => setJsonModal(null)}
          onSave={handleJsonModalSave}
        />
      )}

      {spatialDrawer && (
        <SpatialMapDrawer
          isOpen={spatialDrawer.isOpen}
          initialValue={spatialDrawer.val}
          columnName={spatialDrawer.col}
          tableName={table}
          connId={connId}
          dialect={activeConn?.dialect || activeConn?.driver || 'postgres'}
          readOnly={!hasPk || activeConn?.readOnly}
          onClose={() => setSpatialDrawer(null)}
          onSave={handleSpatialDrawerSave}
        />
      )}
      <LiveFeedDrawer
        isOpen={showLiveFeed}
        onClose={() => setShowLiveFeed(false)}
        connId={connId}
        schema={schema}
        table={table}
      />
    </div>
  )
}
