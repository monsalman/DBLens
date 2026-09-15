import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, ArrowUpDown, Trash2, RefreshCw, Key, Link2, Plus, Sparkles } from 'lucide-react'
import { api } from '../../lib/api'
import type { ColumnMeta } from '../../lib/api'
import { useAppStore } from '../../stores/appStore'
import { AddRowModal } from './AddRowModal'
import { MockDataModal } from './MockDataModal'

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
  const editInputRef = useRef<HTMLInputElement>(null)
  const cancelledRef = useRef(false)
  const isCommittingRef = useRef(false)

  useEffect(() => {
    setPageIndex(0)
    setSortCol('')
    setSelectedRows({})
    setSearchTerm('')
    setSelectedCol('')
    setEditingCell(null)
  }, [table, schema, connId])

  // Focus edit input when entering edit mode
  useEffect(() => {
    if (editingCell) {
      setTimeout(() => editInputRef.current?.focus(), 0)
    }
  }, [editingCell])

  const qc = useQueryClient()
  const { openPeekDrawer } = useAppStore()

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

  const handleExport = (format: 'csv' | 'json') => {
    if (!rows.length || !table) return
    let content = ''
    const filename = `${table}_export.${format}`
    let mimeType = 'text/plain'

    if (format === 'json') {
      content = JSON.stringify(rows, null, 2)
      mimeType = 'application/json'
    } else if (format === 'csv') {
      const keys = metaCols.length > 0 ? metaCols.map(c => c.name) : Object.keys(rows[0])
      const header = keys.join(',')
      const lines = rows.map((r) =>
        keys.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(',')
      )
      content = [header, ...lines].join('\n')
      mimeType = 'text/csv'
    }

    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Column headers
  const colDefs = metaCols.map(col => ({
    name: col.name,
    type: col.dataType || col.type || 'text',
    nullable: col.isNullable ?? true,
    isPk: !!(col.isPrimaryKey || col.isPrimary),
    fk: fkMap.get(col.name),
  }))

  const formatValue = (val: any) => {
    if (val === null || val === undefined) return <span className="italic text-[var(--muted)] opacity-60 font-mono text-xs">null</span>
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
      const { col } = editingCell
      setEditingCell(null)
      const originalVal = row[col]
      const newVal = editValue
      // skip if unchanged
      if (String(originalVal ?? '') === newVal) return
      setInlineError(null)
      const where: Record<string, any> = {}
      for (const pk of pkCols) {
        where[pk.name] = row[pk.name]
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
      {inlineError && (
        <div className="bg-red-500/10 border-b border-red-500/30 text-red-400 text-xs px-3 py-1.5 flex items-center justify-between font-mono shrink-0">
          <span>{inlineError}</span>
          <button onClick={() => setInlineError(null)} className="hover:text-red-300 font-bold ml-2">✕</button>
        </div>
      )}
      {/* Toolbar */}
      <div className="h-10 border-b border-[var(--border)] px-3 flex items-center gap-3 shrink-0">
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
          
          <button onClick={() => refetch()} className="p-1 text-[var(--muted)] hover:text-[var(--fg)]">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          
          <div className="flex items-center border border-[var(--border)] rounded overflow-hidden">
            <button onClick={() => handleExport('csv')} className="px-2 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-r border-[var(--border)]">CSV</button>
            <button onClick={() => handleExport('json')} className="px-2 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]">JSON</button>
          </div>
        </div>
      </div>

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
                    <span className="text-[var(--fg)]">{c.name}</span>
                    <span className="text-[9px] text-[var(--muted)]">{c.type}</span>
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
                    const val = row[c.name]
                    const isFkValue = !!c.fk && val !== null && val !== undefined && String(val) !== ''
                    const isEditing = editingCell?.rowIdx === i && editingCell?.col === c.name
                    const isPending = mutateM.isPending

                    return (
                      <td
                        key={c.name}
                        title={!hasPk ? 'Inline edit requires a primary key' : undefined}
                        className={`px-2 py-1.5 font-mono-data text-[var(--fg)] truncate max-w-[280px] ${hasPk && !isFkValue ? 'cursor-text' : ''} ${isPending && isEditing ? 'opacity-50' : ''}`}
                        onDoubleClick={() => {
                          if (!hasPk) return
                          if (isFkValue) return
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
                          onClick={(e) => {
                            e.stopPropagation()
                            openPeekDrawer(c.fk!.refTable, c.fk!.refColumn, val)
                          }}
                          className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer group text-left max-w-full truncate"
                          title={`Peek ${c.fk!.refTable}.${c.fk!.refColumn} = ${String(val)}`}
                        >
                          <span className="truncate">{formatValue(val)}</span>
                          <Link2 className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 shrink-0" />
                        </button>
                      ) : (
                        formatValue(val)
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
    </div>
  )
}
