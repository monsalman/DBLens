import React, { useState, useMemo, useRef } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search,
  Plus,
  Trash2,
  RefreshCw,
  Key,
  ArrowUpDown,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Download,
} from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { api, type ColumnMeta } from '../../lib/api'

export const TableGridView: React.FC = () => {
  const {
    activeConnectionId,
    selectedSchema,
    selectedTable,
    connections,
    openPeekDrawer,
    openDryRunModal,
  } = useAppStore()

  const queryClient = useQueryClient()
  const activeConn = connections.find((c) => c.id === activeConnectionId)
  const isReadOnly = activeConn?.readOnly ?? false

  // State
  const [searchTerm, setSearchTerm] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [sortColumn, setSortColumn] = useState<string | undefined>(undefined)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})

  // Inline editing modal state
  const [inlineModal, setInlineModal] = useState<{
    rowPk: any
    columnName: string
    value: string
  } | null>(null)

  // Fetch Tables
  const {
    data: tablesList,
    isLoading: isTablesLoading,
    error: tablesError,
  } = useQuery({
    queryKey: ['tables', activeConnectionId, selectedSchema],
    queryFn: () => (activeConnectionId ? api.getTables(activeConnectionId, selectedSchema) : []),
    enabled: !!activeConnectionId,
  })

  // Fetch Table Details
  const {
    data: tableDetails,
    isLoading: isDetailsLoading,
    error: detailsError,
  } = useQuery({
    queryKey: ['tableDetails', activeConnectionId, selectedTable, selectedSchema],
    queryFn: () =>
      activeConnectionId && selectedTable
        ? api.getTableDetails(activeConnectionId, selectedTable, selectedSchema)
        : null,
    enabled: !!activeConnectionId && !!selectedTable,
  })

  const rawColumns: ColumnMeta[] = tableDetails?.columns || []
  const primaryKeyCol =
    rawColumns.find((c) => c.isPrimaryKey || c.isPrimary)?.name ||
    rawColumns[0]?.name ||
    'id'

  // Fetch Table Rows
  const {
    data: tableData,
    isLoading: isDataLoading,
    isRefetching,
    error: dataError,
    refetch,
  } = useQuery({
    queryKey: [
      'tableData',
      activeConnectionId,
      selectedTable,
      selectedSchema,
      pageIndex,
      pageSize,
      sortColumn,
      sortOrder,
      searchTerm,
    ],
    queryFn: () =>
      activeConnectionId && selectedTable
        ? api.queryTableData(activeConnectionId, selectedTable, {
            schema: selectedSchema,
            limit: pageSize,
            offset: pageIndex * pageSize,
            orderBy: sortColumn,
            orderDir: sortOrder,
            filters: searchTerm ? [{ column: '*', operator: 'LIKE', value: searchTerm }] : [],
          })
        : null,
    enabled: !!activeConnectionId && !!selectedTable,
  })

  const rows = tableData?.rows || []
  const totalCount = tableData?.totalCount ?? rows.length
  const totalPages = Math.ceil(totalCount / pageSize) || 1

  // Mutation
  const mutateRowMutation = useMutation({
    mutationFn: (payload: {
      schema?: string
      table: string
      data?: Record<string, any>
      where?: Record<string, any>
      type: 'INSERT' | 'UPDATE' | 'DELETE'
    }) =>
      activeConnectionId ? api.mutateRow(activeConnectionId, payload) : Promise.reject(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['tableData', activeConnectionId, selectedTable],
      })
    },
  })

  // Columns definition
  const columns = useMemo<ColumnDef<Record<string, any>>[]>(() => {
    const metaCols: ColumnMeta[] =
      rawColumns.length > 0
        ? rawColumns
        : (tableData?.columns || (rows[0] ? Object.keys(rows[0]) : [])).map((colName) => ({
            name: colName,
            type: 'text',
          }))

    if (metaCols.length === 0) return []

    const selectCol: ColumnDef<Record<string, any>> = {
      id: '__select',
      header: () => (
        <input
          type="checkbox"
          checked={
            rows.length > 0 && rows.every((r) => selectedRows[String(r[primaryKeyCol])])
          }
          onChange={(e) => {
            const checked = e.target.checked
            const next: Record<string, boolean> = {}
            if (checked) {
              rows.forEach((r) => {
                next[String(r[primaryKeyCol])] = true
              })
            }
            setSelectedRows(next)
          }}
          className="rounded border-white/[0.1] bg-[#0b0c0e] text-indigo-500 focus:ring-0 cursor-pointer w-3 h-3"
        />
      ),
      cell: ({ row }) => {
        const pk = String(row.original[primaryKeyCol])
        return (
          <input
            type="checkbox"
            checked={!!selectedRows[pk]}
            onChange={(e) => {
              setSelectedRows((prev) => ({
                ...prev,
                [pk]: e.target.checked,
              }))
            }}
            className="rounded border-white/[0.1] bg-[#0b0c0e] text-indigo-500 focus:ring-0 cursor-pointer w-3 h-3"
          />
        )
      },
      size: 32,
    }

    const dataCols: ColumnDef<Record<string, any>>[] = metaCols.map((col) => {
      const isPk = !!(col.isPrimaryKey || col.isPrimary)
      const colType = col.dataType || col.type || 'text'
      const isNullable = col.isNullable ?? col.nullable

      return {
        id: col.name,
        accessorKey: col.name,
        header: () => (
          <div
            className="flex items-center justify-between gap-1.5 cursor-pointer select-none group"
            onClick={() => {
              if (sortColumn === col.name) {
                setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
              } else {
                setSortColumn(col.name)
                setSortOrder('asc')
              }
            }}
          >
            <div className="flex items-center gap-1 truncate">
              {isPk && <Key className="w-2.5 h-2.5 text-amber-400 shrink-0" />}
              <span className="font-mono text-xs text-zinc-200">{col.name}</span>
              <span className="text-[10px] text-zinc-500 font-mono">
                {colType}
              </span>
              {isNullable && (
                <span className="text-[9px] px-1 rounded bg-white/[0.04] text-zinc-500 font-mono">
                  null
                </span>
              )}
            </div>
            <ArrowUpDown className="w-2.5 h-2.5 text-zinc-600 group-hover:text-zinc-400" />
          </div>
        ),
        cell: ({ row }) => {
          const value = row.original[col.name]
          const pkVal = row.original[primaryKeyCol]

          if (col.isForeignKey && col.foreignKeyTarget && value != null) {
            return (
              <div className="flex items-center gap-1.5 font-mono text-xs">
                <span className="text-zinc-200">{String(value)}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    openPeekDrawer(
                      col.foreignKeyTarget!.table,
                      col.foreignKeyTarget!.column,
                      value
                    )
                  }}
                  className="px-1 py-0.2 rounded bg-white/[0.05] hover:bg-white/[0.1] text-[9px] text-indigo-300 flex items-center gap-0.5"
                  title={`Peek in ${col.foreignKeyTarget.table}`}
                >
                  <span>FK</span>
                  <ExternalLink className="w-2 h-2" />
                </button>
              </div>
            )
          }

          if (value === null || value === undefined) {
            return <span className="text-zinc-600 italic font-mono text-xs">null</span>
          }

          if (typeof value === 'boolean') {
            return (
              <span className="font-mono text-xs text-zinc-400">
                {String(value)}
              </span>
            )
          }

          return (
            <span
              className="font-mono text-xs text-zinc-300 truncate block select-text cursor-cell"
              onDoubleClick={() => {
                if (!isReadOnly) {
                  setInlineModal({
                    rowPk: pkVal,
                    columnName: col.name,
                    value: typeof value === 'object' ? JSON.stringify(value) : String(value),
                  })
                }
              }}
            >
              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </span>
          )
        },
      }
    })

    return [selectCol, ...dataCols]
  }, [
    rawColumns,
    tableData?.columns,
    rows,
    selectedRows,
    primaryKeyCol,
    isReadOnly,
    sortColumn,
  ])

  const handleSaveModalEdit = () => {
    if (!inlineModal || !selectedTable) return
    const { rowPk, columnName, value } = inlineModal

    const sqlPreview = `UPDATE "${selectedTable}" SET "${columnName}" = '${value}' WHERE "${primaryKeyCol}" = '${rowPk}';`

    openDryRunModal('Confirm Cell Update', sqlPreview, () => {
      mutateRowMutation.mutate({
        schema: selectedSchema,
        table: selectedTable,
        type: 'UPDATE',
        where: { [primaryKeyCol]: rowPk },
        data: { [columnName]: value },
      })
      setInlineModal(null)
    })
  }

  const handleDeleteSelected = () => {
    const pks = Object.keys(selectedRows).filter((k) => selectedRows[k])
    if (pks.length === 0 || !selectedTable) return

    const sqlPreview = `DELETE FROM "${selectedTable}" WHERE "${primaryKeyCol}" IN (${pks
      .map((k) => `'${k}'`)
      .join(', ')});`

    openDryRunModal(
      `Delete ${pks.length} Selected Row(s)`,
      sqlPreview,
      async () => {
        for (const pk of pks) {
          await mutateRowMutation.mutateAsync({
            schema: selectedSchema,
            table: selectedTable,
            type: 'DELETE',
            where: { [primaryKeyCol]: pk },
          })
        }
        setSelectedRows({})
      }
    )
  }

  const handleExport = (format: 'csv' | 'json' | 'sql') => {
    if (!rows.length || !selectedTable) return
    let content = ''
    const filename = `${selectedTable}_export.${format}`
    let mimeType = 'text/plain'

    if (format === 'json') {
      content = JSON.stringify(rows, null, 2)
      mimeType = 'application/json'
    } else if (format === 'csv') {
      const keys = Object.keys(rows[0])
      const header = keys.join(',')
      const lines = rows.map((r) =>
        keys.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(',')
      )
      content = [header, ...lines].join('\n')
      mimeType = 'text/csv'
    } else if (format === 'sql') {
      const keys = Object.keys(rows[0])
      const inserts = rows.map((r) => {
        const vals = keys.map((k) => {
          const v = r[k]
          if (v === null || v === undefined) return 'NULL'
          return `'${String(v).replace(/'/g, "''")}'`
        })
        return `INSERT INTO "${selectedTable}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${vals.join(', ')});`
      })
      content = inserts.join('\n')
    }

    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleAddRow = () => {
    if (!selectedTable) return
    const defaultData: Record<string, any> = {}
    if (rawColumns.length > 0) {
      rawColumns.forEach((c) => {
        const isPk = c.isPrimaryKey || c.isPrimary
        if (!isPk) {
          defaultData[c.name] = c.defaultValue ?? c.default ?? ''
        } else {
          defaultData[c.name] = `new_${Date.now()}`
        }
      })
    } else {
      defaultData['id'] = `new_${Date.now()}`
    }

    const sqlPreview = `INSERT INTO "${selectedTable}" (${Object.keys(defaultData)
      .map((k) => `"${k}"`)
      .join(', ')}) VALUES (${Object.values(defaultData)
      .map((v) => `'${v}'`)
      .join(', ')});`

    openDryRunModal('Add New Record', sqlPreview, () => {
      mutateRowMutation.mutate({
        schema: selectedSchema,
        table: selectedTable,
        type: 'INSERT',
        data: defaultData,
      })
    })
  }

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  // Virtualizer
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 28,
    overscan: 20,
  })

  if (!activeConnectionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 bg-[#0b0c0e] text-xs font-mono">
        No active connection
      </div>
    )
  }

  if (isTablesLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 bg-[#0b0c0e] text-xs font-mono">
        Loading...
      </div>
    )
  }

  if (tablesError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-red-400 bg-[#0b0c0e] p-4 text-xs font-mono">
        <span className="font-semibold">Failed to load schema</span>
        <span className="text-zinc-500 mt-1">{(tablesError as Error).message}</span>
      </div>
    )
  }

  if (tablesList && tablesList.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600 bg-[#0b0c0e] text-xs font-mono">
        No tables found
      </div>
    )
  }

  if (!selectedTable) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600 bg-[#0b0c0e] text-xs font-mono">
        Select a table
      </div>
    )
  }

  const selectedCount = Object.values(selectedRows).filter(Boolean).length
  const activeError = dataError || detailsError

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0c0e] overflow-hidden select-none">
      {/* Compact Toolbar */}
      <div className="h-9 border-b border-white/[0.06] px-2.5 flex items-center justify-between gap-3 bg-[#0b0c0e] shrink-0">
        {/* Left: Search & Meta */}
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <div className="relative w-full">
            <Search className="w-3 h-3 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setPageIndex(0)
              }}
              placeholder={`Filter ${selectedTable}...`}
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded pl-6 pr-2 py-0.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-white/[0.15] outline-none font-mono"
            />
          </div>
          <span className="text-[11px] text-zinc-500 font-mono shrink-0">
            {rawColumns.length} cols
          </span>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          {selectedCount > 0 && (
            <button
              onClick={handleDeleteSelected}
              disabled={isReadOnly}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-950/40 border border-red-800/40 text-[11px] text-red-400 hover:bg-red-900/50 disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" />
              <span>Delete ({selectedCount})</span>
            </button>
          )}

          <button
            onClick={handleAddRow}
            disabled={isReadOnly}
            className="btn-primary flex items-center gap-1 px-2 py-0.5 text-[11px] disabled:opacity-40"
          >
            <Plus className="w-3 h-3" />
            <span>Add Row</span>
          </button>

          <button
            onClick={() => refetch()}
            className="p-1 text-zinc-500 hover:text-zinc-300 rounded"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
          </button>

          <div className="flex items-center border border-white/[0.06] rounded overflow-hidden">
            <span className="px-1.5 py-0.5 text-[10px] text-zinc-500 flex items-center gap-0.5 border-r border-white/[0.06]">
              <Download className="w-2.5 h-2.5" />
            </span>
            <button
              onClick={() => handleExport('csv')}
              className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"
            >
              CSV
            </button>
            <button
              onClick={() => handleExport('json')}
              className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"
            >
              JSON
            </button>
            <button
              onClick={() => handleExport('sql')}
              className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"
            >
              SQL
            </button>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div
        ref={tableContainerRef}
        className="flex-1 overflow-auto bg-[#0b0c0e] relative border-b border-white/[0.06]"
      >
        {activeError ? (
          <div className="flex flex-col items-center justify-center h-full p-4 text-center font-mono">
            <span className="text-xs text-red-400 font-semibold">Error loading table data</span>
            <span className="text-[11px] text-red-300/80 mt-1 max-w-md">
              {(activeError as Error).message}
            </span>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[#0e1013] border-b border-white/[0.06] z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-2 py-1 text-[11px] font-medium text-zinc-400 border-r border-white/[0.06] whitespace-nowrap bg-[#0e1013] select-none"
                      style={{ width: header.getSize() }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>

            <tbody>
              {isDataLoading || isDetailsLoading ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} className="text-center py-12 text-zinc-500 text-xs font-mono">
                    Loading...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} className="text-center py-12 text-zinc-600 text-xs font-mono">
                    No rows yet
                  </td>
                </tr>
              ) : (
                rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = table.getRowModel().rows[virtualRow.index]
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-white/[0.04] hover:bg-white/[0.02] ${
                        selectedRows[String(row.original[primaryKeyCol])] ? 'bg-white/[0.05]' : ''
                      }`}
                      style={{ height: `${virtualRow.size}px` }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className="px-2 py-1 text-xs text-zinc-200 border-r border-white/[0.04] truncate max-w-[280px]"
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Bar */}
      <div className="h-8 border-t border-white/[0.06] px-3 flex items-center justify-between bg-[#0b0c0e] shrink-0 text-[11px] text-zinc-500 font-mono">
        <div className="flex items-center gap-2">
          <span>{totalCount} rows</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span>Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPageIndex(0)
              }}
              className="bg-[#0b0c0e] border border-white/[0.06] rounded px-1 py-0.5 text-[11px] text-zinc-300 outline-none"
            >
              {[25, 50, 100, 200].map((s) => (
                <option key={s} value={s} className="bg-[#16181d]">
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              disabled={pageIndex === 0}
              className="p-0.5 rounded hover:bg-white/[0.04] disabled:opacity-20"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span>
              {pageIndex + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
              disabled={pageIndex >= totalPages - 1}
              className="p-0.5 rounded hover:bg-white/[0.04] disabled:opacity-20"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Minimal Inline Edit Modal */}
      {inlineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-none p-4">
          <div className="bg-[#16181d] border border-white/[0.08] rounded-md w-full max-w-sm p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-zinc-300 font-medium">Edit {inlineModal.columnName}</span>
              <span className="text-[10px] text-zinc-500 font-mono">PK: {String(inlineModal.rowPk)}</span>
            </div>
            <textarea
              autoFocus
              rows={3}
              value={inlineModal.value}
              onChange={(e) => setInlineModal({ ...inlineModal, value: e.target.value })}
              className="w-full bg-[#0b0c0e] border border-white/[0.08] rounded p-2 text-xs font-mono text-zinc-200 outline-none focus:border-indigo-500/50"
            />
            <div className="flex justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setInlineModal(null)}
                className="btn-secondary px-2.5 py-1 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveModalEdit}
                className="btn-primary px-3 py-1 text-xs"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
