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
  Filter,
} from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { api, type MutateRowPayload } from '../../lib/api'

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

  // Filters and Pagination
  const [searchTerm, setSearchTerm] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [sortColumn, setSortColumn] = useState<string | undefined>(undefined)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{
    rowPk: any
    columnName: string
    originalValue: any
    currentValue: any
  } | null>(null)

  // Fetch Schema Metadata
  const { data: schemaMeta } = useQuery({
    queryKey: ['schema', activeConnectionId, selectedSchema],
    queryFn: () => (activeConnectionId ? api.getSchema(activeConnectionId, selectedSchema) : null),
    enabled: !!activeConnectionId,
  })

  const currentTableMeta = schemaMeta?.tables.find((t) => t.name === selectedTable)
  const primaryKeyCol =
    currentTableMeta?.columns.find((c) => c.isPrimaryKey)?.name || 'id'

  // Fetch Table Rows Data
  const {
    data: tableData,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: [
      'tableData',
      activeConnectionId,
      selectedTable,
      pageIndex,
      pageSize,
      sortColumn,
      sortOrder,
      searchTerm,
    ],
    queryFn: () =>
      activeConnectionId && selectedTable
        ? api.getTableData(activeConnectionId, selectedTable, {
            limit: pageSize,
            offset: pageIndex * pageSize,
            sortBy: sortColumn,
            sortOrder,
            filter: searchTerm,
          })
        : null,
    enabled: !!activeConnectionId && !!selectedTable,
  })

  const rows = tableData?.rows || []
  const totalCount = tableData?.totalCount || 0
  const totalPages = Math.ceil(totalCount / pageSize) || 1

  // Row Mutation Mutation
  const mutateRowMutation = useMutation({
    mutationFn: (payload: MutateRowPayload) =>
      activeConnectionId ? api.mutateRow(activeConnectionId, payload) : Promise.reject(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tableData', activeConnectionId, selectedTable] })
    },
  })

  // Columns definition
  const columns = useMemo<ColumnDef<Record<string, any>>[]>(() => {
    if (!currentTableMeta) return []

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
          className="rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-0 cursor-pointer"
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
            className="rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-0 cursor-pointer"
          />
        )
      },
      size: 40,
    }

    const dataCols: ColumnDef<Record<string, any>>[] = currentTableMeta.columns.map((col) => {
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
            <div className="flex items-center gap-1.5 truncate">
              {col.isPrimaryKey && (
                <Key className="w-3 h-3 text-amber-400 shrink-0" />
              )}
              <span className="font-semibold text-zinc-200">{col.name}</span>
              <span className="text-[10px] font-normal text-zinc-400 font-mono">
                {col.type}
              </span>
              {col.nullable && (
                <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400">
                  null
                </span>
              )}
            </div>
            <ArrowUpDown className="w-3 h-3 text-zinc-400 group-hover:text-zinc-300" />
          </div>
        ),
        cell: ({ row }) => {
          const value = row.original[col.name]
          const pkVal = row.original[primaryKeyCol]
          const isEditing =
            editingCell?.rowPk === pkVal && editingCell?.columnName === col.name

          if (isEditing) {
            return (
              <input
                autoFocus
                type="text"
                value={editingCell.currentValue ?? ''}
                onChange={(e) =>
                  setEditingCell((prev) =>
                    prev ? { ...prev, currentValue: e.target.value } : null
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveEdit()
                  } else if (e.key === 'Escape') {
                    setEditingCell(null)
                  }
                }}
                onBlur={handleSaveEdit}
                className="w-full h-full bg-zinc-950 border border-indigo-500 rounded px-1.5 py-0.5 text-xs font-mono text-zinc-100 focus:outline-hidden"
              />
            )
          }

          // Foreign key badge preview
          if (col.isForeignKey && col.foreignKeyTarget && value != null) {
            return (
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-zinc-200">{String(value)}</span>
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
                  className="px-1.5 py-0.5 rounded bg-indigo-950/60 hover:bg-indigo-900 border border-indigo-700/50 text-[10px] text-indigo-300 flex items-center gap-1 transition-colors"
                  title={`Peek in ${col.foreignKeyTarget.table}`}
                >
                  <span>FK</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </button>
              </div>
            )
          }

          if (value === null || value === undefined) {
            return <span className="text-zinc-400 italic text-[11px]">NULL</span>
          }

          if (typeof value === 'boolean') {
            return (
              <span
                className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
                  value
                    ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/40'
                    : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                }`}
              >
                {String(value)}
              </span>
            )
          }

          return (
            <span
              className="font-mono text-xs text-zinc-300 truncate block select-text cursor-cell"
              onDoubleClick={() => {
                if (!isReadOnly) {
                  setEditingCell({
                    rowPk: pkVal,
                    columnName: col.name,
                    originalValue: value,
                    currentValue: value,
                  })
                }
              }}
            >
              {String(value)}
            </span>
          )
        },
      }
    })

    return [selectCol, ...dataCols]
  }, [currentTableMeta, rows, selectedRows, primaryKeyCol, editingCell, isReadOnly, sortColumn])

  const handleSaveEdit = () => {
    if (!editingCell || !selectedTable) return
    const { rowPk, columnName, originalValue, currentValue } = editingCell
    if (originalValue === currentValue) {
      setEditingCell(null)
      return
    }

    const sqlPreview = `UPDATE "${selectedTable}" SET "${columnName}" = '${currentValue}' WHERE "${primaryKeyCol}" = '${rowPk}';`

    // Open Dry Run Modal
    openDryRunModal('Confirm Inline Cell Update', sqlPreview, () => {
      mutateRowMutation.mutate({
        table: selectedTable,
        action: 'update',
        pkColumn: primaryKeyCol,
        pkValue: rowPk,
        data: { [columnName]: currentValue },
      })
      setEditingCell(null)
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
            table: selectedTable,
            action: 'delete',
            pkColumn: primaryKeyCol,
            pkValue: pk,
          })
        }
        setSelectedRows({})
      }
    )
  }

  const handleExport = (format: 'csv' | 'json' | 'sql') => {
    if (!rows.length || !selectedTable) return
    let content = ''
    let filename = `${selectedTable}_export.${format}`
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
    if (!selectedTable || !currentTableMeta) return
    const defaultData: Record<string, any> = {}
    currentTableMeta.columns.forEach((c) => {
      if (!c.isPrimaryKey) {
        defaultData[c.name] = c.defaultValue || ''
      } else {
        defaultData[c.name] = `new_${Date.now()}`
      }
    })

    const sqlPreview = `INSERT INTO "${selectedTable}" (${Object.keys(defaultData)
      .map((k) => `"${k}"`)
      .join(', ')}) VALUES (${Object.values(defaultData)
      .map((v) => `'${v}'`)
      .join(', ')});`

    openDryRunModal('Add New Record', sqlPreview, () => {
      mutateRowMutation.mutate({
        table: selectedTable,
        action: 'insert',
        pkColumn: primaryKeyCol,
        pkValue: defaultData[primaryKeyCol],
        data: defaultData,
      })
    })
  }

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  // Table Virtualizer for 60fps rendering
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 36,
    overscan: 15,
  })

  if (!selectedTable) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 bg-zinc-950">
        <Filter className="w-8 h-8 stroke-1 text-zinc-600 mb-2" />
        <p className="text-sm">Select a table from the sidebar to inspect data</p>
      </div>
    )
  }

  const selectedCount = Object.values(selectedRows).filter(Boolean).length

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden">
      {/* Top Toolbar */}
      <div className="h-12 border-b border-zinc-800 px-4 flex items-center justify-between gap-4 bg-zinc-900/40 shrink-0">
        {/* Left: Search & Filter */}
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setPageIndex(0)
              }}
              placeholder={`Search within ${selectedTable}...`}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-8 pr-2.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-hidden focus:border-zinc-700"
            />
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <button
              onClick={handleDeleteSelected}
              disabled={isReadOnly}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-red-950/60 hover:bg-red-900 border border-red-800/60 text-xs text-red-300 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete ({selectedCount})</span>
            </button>
          )}

          <button
            onClick={handleAddRow}
            disabled={isReadOnly}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-xs transition-colors disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Row</span>
          </button>

          <button
            onClick={() => refetch()}
            className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${isRefetching ? 'animate-spin' : ''}`} />
          </button>

          {/* Export dropdown */}
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded p-0.5 text-xs">
            <button
              onClick={() => handleExport('csv')}
              className="px-2 py-0.5 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded"
              title="Export CSV"
            >
              CSV
            </button>
            <button
              onClick={() => handleExport('json')}
              className="px-2 py-0.5 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded"
              title="Export JSON"
            >
              JSON
            </button>
            <button
              onClick={() => handleExport('sql')}
              className="px-2 py-0.5 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded"
              title="Export SQL"
            >
              SQL
            </button>
          </div>
        </div>
      </div>

      {/* Spreadsheet Virtual Grid */}
      <div
        ref={tableContainerRef}
        className="flex-1 overflow-auto bg-zinc-950 relative border-b border-zinc-800"
      >
        <table className="w-full text-left border-collapse">
          {/* Header */}
          <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-2 text-xs font-medium text-zinc-400 border-r border-zinc-800 whitespace-nowrap bg-zinc-900 select-none"
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

          {/* Body */}
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-zinc-500 text-xs">
                  Loading table rows...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-zinc-500 text-xs">
                  No records in table
                </td>
              </tr>
            ) : (
              rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = table.getRowModel().rows[virtualRow.index]
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-zinc-800/60 hover:bg-zinc-900/50 transition-colors ${
                      selectedRows[String(row.original[primaryKeyCol])] ? 'bg-indigo-950/20' : ''
                    }`}
                    style={{ height: `${virtualRow.size}px` }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-3 py-1.5 text-xs text-zinc-200 border-r border-zinc-800/60 truncate max-w-[280px]"
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
      </div>

      {/* Pagination Footer */}
      <div className="h-10 border-t border-zinc-800 px-4 flex items-center justify-between bg-zinc-950 shrink-0 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <span>Total {totalCount} rows</span>
          <span className="text-zinc-600">•</span>
          <span className="text-zinc-500">Double click cell to edit</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPageIndex(0)
              }}
              className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-xs text-zinc-200 focus:outline-hidden"
            >
              {[25, 50, 100, 200].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              disabled={pageIndex === 0}
              className="p-1 rounded hover:bg-zinc-800 disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 font-mono">
              {pageIndex + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
              disabled={pageIndex >= totalPages - 1}
              className="p-1 rounded hover:bg-zinc-800 disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
