import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, ArrowUpDown, Trash2, RefreshCw, Key } from 'lucide-react'
import { api } from '../../lib/api'
import type { ColumnMeta } from '../../lib/api'

interface Props {
  connId: string
  schema: string
  table: string
}

export const TableGridView: React.FC<Props> = ({ connId, schema, table }) => {
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize] = useState(50)
  const [sortCol, setSortCol] = useState('')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  
  const qc = useQueryClient()

  // Columns metadata
  const { data: cols, isLoading: colsLoading } = useQuery({
    queryKey: ['columns', connId, schema, table],
    queryFn: () => api.getTableDetails(connId, table, schema),
    enabled: !!table,
  })
  
  const pkCol = cols?.columns?.find((c: ColumnMeta) => c.isPrimaryKey || c.isPrimary)?.name ?? 'id'
  const metaCols: ColumnMeta[] = cols?.columns ?? []

  // Data rows
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['data', connId, table, schema, pageIndex, pageSize, sortCol, sortDir, searchTerm],
    queryFn: () => api.queryTableData(connId, table, {
      schema, limit: pageSize, offset: pageIndex * pageSize, orderBy: sortCol, orderDir: sortDir, filters: searchTerm ? [{column:'*',operator:'LIKE',value:searchTerm}] : [],
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

  const handleDelete = async () => {
    const pks = Object.keys(selectedRows).filter(k => selectedRows[k])
    if (!pks.length || !table) return
    for (const pk of pks) {
      await mutateM.mutateAsync({ schema, table, type: 'DELETE', where: { [pkCol]: pk } })
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
    URL.revokeObjectURL(url)
  }

  // Column headers
  const colDefs = metaCols.map(col => ({
    name: col.name,
    type: col.dataType || col.type || 'text',
    nullable: col.isNullable ?? true,
    isPk: !!(col.isPrimaryKey || col.isPrimary),
  }))

  const formatValue = (val: any) => {
    if (val === null || val === undefined) return <span className="italic text-[var(--muted)] opacity-60 font-mono text-xs">null</span>
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }

  if (!table) return <div className="flex-1 flex items-center justify-center text-[var(--muted)] font-mono text-xs">Select a table</div>
  if (isLoading || colsLoading) return <div className="flex-1 flex items-center justify-center text-[var(--muted)] font-mono text-xs">Loading...</div>

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg)] overflow-hidden">
      {/* Toolbar */}
      <div className="h-10 border-b border-[var(--border)] px-3 flex items-center gap-3 shrink-0">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3 h-3 text-[var(--muted)] absolute left-2 top-1/2 -translate-y-1/2" />
          <input type="text" value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setPageIndex(0); }}
            placeholder={`Filter ${table}...`}
            className="form-input pl-7 pr-2 py-0.5 text-xs" />
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
                <input type="checkbox" checked={rows.length > 0 && rows.every(r => selectedRows[String(r[pkCol])])}
                  onChange={e => {
                    const checked = e.target.checked
                    setSelectedRows(checked ? Object.fromEntries(rows.map(r => [String(r[pkCol]), true])) : {} as Record<string, boolean>)
                  }}
                  className="rounded border-[var(--border)] bg-[var(--surface)] text-indigo-500 w-3 h-3" />
              </th>
              {colDefs.map(c => (
                <th key={c.name} className="px-2 py-1.5 text-[10px] text-[var(--muted)] font-mono border-r border-[var(--border)] whitespace-nowrap">
                  <div className="flex items-center gap-1 group cursor-pointer" onClick={() => {
                    if (sortCol === c.name) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
                    else { setSortCol(c.name); setSortDir('asc') }
                  }}>
                    {c.isPk && <Key className="w-2.5 h-2.5 text-amber-500" />}
                    <span className="text-[var(--fg)]">{c.name}</span>
                    <span className="text-[9px] text-[var(--muted)]">{c.type}</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-[var(--muted)] group-hover:text-[var(--fg)]" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="data-row-hover border-b border-[var(--border)]">
                <td className="px-2 py-1.5">
                  <input type="checkbox" checked={!!selectedRows[String(row[pkCol])] }
                    onChange={e => setSelectedRows(p => ({ ...p, [String(row[pkCol])]: e.target.checked }))}
                    className="rounded border-[var(--border)] bg-[var(--surface)] text-indigo-500 w-3 h-3" />
                </td>
                {colDefs.map(c => (
                  <td key={c.name} className="px-2 py-1.5 font-mono-data text-[var(--fg)] truncate max-w-[280px]">{formatValue(row[c.name])}</td>
                ))}
              </tr>
            ))}
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
    </div>
  )
}
