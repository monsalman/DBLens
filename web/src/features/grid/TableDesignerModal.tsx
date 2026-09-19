import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Undo2,
  AlertTriangle,
  Check,
  Copy,
  Layers,
  Key,
  Link2,
  Loader2,
  Play,
  FileCode,
} from 'lucide-react'
import {
  api,
  type TableDetailResponse,
  type AlterTablePayload,
  type ColumnMeta,
  type RenameColumnSpec,
  type AlterColumnSpec,
  type IndexMeta,
  type TableForeignKey,
} from '../../lib/api'

interface TableDesignerModalProps {
  isOpen: boolean
  onClose: () => void
  connId: string
  table: string
  schema?: string
  detail?: TableDetailResponse | null
  onRefresh?: () => void
}

interface ColumnRow {
  id: string
  originalName: string
  name: string
  originalType: string
  type: string
  originalNullable: boolean
  nullable: boolean
  originalPrimary: boolean
  isPrimary: boolean
  originalDefault: string
  defaultValue: string
  isNew: boolean
  isDropped: boolean
}

interface IndexRow {
  id: string
  originalName: string
  name: string
  columns: string
  isUnique: boolean
  isNew: boolean
  isDropped: boolean
}

interface FkRow {
  id: string
  originalName: string
  name: string
  column: string
  refTable: string
  refColumn: string
  onUpdate: string
  onDelete: string
  isNew: boolean
  isDropped: boolean
}

type TabType = 'columns' | 'indexes' | 'fks'

const COMMON_DATA_TYPES = [
  'INTEGER',
  'BIGINT',
  'SMALLINT',
  'DECIMAL(10,2)',
  'NUMERIC',
  'REAL',
  'FLOAT',
  'VARCHAR(255)',
  'VARCHAR(100)',
  'VARCHAR(50)',
  'TEXT',
  'BOOLEAN',
  'TIMESTAMP',
  'TIMESTAMPTZ',
  'DATETIME',
  'DATE',
  'TIME',
  'JSON',
  'JSONB',
  'BLOB',
  'UUID',
]

export const TableDesignerModal: React.FC<TableDesignerModalProps> = ({
  isOpen,
  onClose,
  connId,
  table,
  schema,
  detail,
  onRefresh,
}) => {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabType>('columns')
  const [columns, setColumns] = useState<ColumnRow[]>([])
  const [indexes, setIndexes] = useState<IndexRow[]>([])
  const [fks, setFks] = useState<FkRow[]>([])

  // Preview state
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewSql, setPreviewSql] = useState('')
  const [previewDialect, setPreviewDialect] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Execution state
  const [applying, setApplying] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const prevIsOpenRef = useRef(false)

  // Initialize data from detail only when modal transitions from closed to open
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current
    prevIsOpenRef.current = isOpen

    if (!wasOpen && isOpen) {
      const initialCols: ColumnRow[] = (detail?.columns ?? []).map((c, i) => {
        const isPk = !!(c.isPrimaryKey || c.isPrimary)
        const isNull = c.nullable ?? c.isNullable ?? true
        const def = c.defaultValue ?? c.default ?? ''
        const colType = c.type || c.dataType || 'VARCHAR(255)'
        return {
          id: `col_init_${i}_${c.name}`,
          originalName: c.name,
          name: c.name,
          originalType: colType,
          type: colType,
          originalNullable: isNull,
          nullable: isNull,
          originalPrimary: isPk,
          isPrimary: isPk,
          originalDefault: def,
          defaultValue: def,
          isNew: false,
          isDropped: false,
        }
      })

      const initialIdxs: IndexRow[] = (detail?.indexes ?? []).map((idx, i) => ({
        id: `idx_init_${i}_${idx.name}`,
        originalName: idx.name,
        name: idx.name,
        columns: (idx.columns || []).join(', '),
        isUnique: !!idx.isUnique,
        isNew: false,
        isDropped: false,
      }))

      const initialFks: FkRow[] = (detail?.fks ?? []).map((fk, i) => ({
        id: `fk_init_${i}_${fk.name || fk.column}`,
        originalName: fk.name || '',
        name: fk.name || '',
        column: fk.column,
        refTable: fk.refTable,
        refColumn: fk.refColumn,
        onUpdate: fk.onUpdate || 'NO ACTION',
        onDelete: fk.onDelete || 'NO ACTION',
        isNew: false,
        isDropped: false,
      }))

      setColumns(initialCols)
      setIndexes(initialIdxs)
      setFks(initialFks)
      setIsPreviewOpen(false)
      setPreviewSql('')
      setStatusMessage(null)
    }
  }, [isOpen, detail])

  // Close modal or preview on Escape key press
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (isPreviewOpen) {
          setIsPreviewOpen(false)
        } else if (!applying) {
          onClose()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, isPreviewOpen, applying, onClose])

  // Compute pending changes diff
  const {
    payload,
    stagedCount,
    hasDestructiveDrops,
    diffSummary,
  } = useMemo(() => {
    const addedColumns: ColumnMeta[] = []
    const droppedColumns: string[] = []
    const renamedColumns: RenameColumnSpec[] = []
    const alteredColumns: AlterColumnSpec[] = []

    for (const c of columns) {
      if (c.isNew) {
        if (!c.isDropped && c.name.trim()) {
          addedColumns.push({
            name: c.name.trim(),
            type: c.type.trim() || 'TEXT',
            isNullable: c.nullable,
            isPrimary: c.isPrimary,
            default: c.defaultValue.trim() ? c.defaultValue.trim() : null,
          })
        }
      } else {
        if (c.isDropped) {
          droppedColumns.push(c.originalName)
        } else {
          const nameChanged = c.name.trim() !== c.originalName
          if (nameChanged && c.name.trim()) {
            renamedColumns.push({
              from: c.originalName,
              to: c.name.trim(),
            })
          }
          const typeChanged = c.type.trim() !== c.originalType.trim()
          const nullChanged = c.nullable !== c.originalNullable
          const defChanged = c.defaultValue.trim() !== c.originalDefault.trim()

          if (typeChanged || nullChanged || defChanged) {
            const spec: AlterColumnSpec = {
              name: c.name.trim() || c.originalName,
            }
            if (typeChanged && c.type.trim()) {
              spec.type = c.type.trim()
            }
            if (nullChanged) {
              spec.nullable = c.nullable
            }
            if (defChanged) {
              if (!c.defaultValue.trim() && c.originalDefault.trim()) {
                spec.dropDefault = true
              } else if (c.defaultValue.trim()) {
                spec.default = c.defaultValue.trim()
              }
            }
            alteredColumns.push(spec)
          }
        }
      }
    }

    const droppedIndexes: string[] = []
    const addedIndexes: IndexMeta[] = []
    for (const idx of indexes) {
      if (idx.isNew) {
        if (!idx.isDropped && idx.name.trim()) {
          const colList = idx.columns
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
          if (colList.length > 0) {
            addedIndexes.push({
              name: idx.name.trim(),
              columns: colList,
              isUnique: idx.isUnique,
              isPrimary: false,
            })
          }
        }
      } else if (idx.isDropped) {
        droppedIndexes.push(idx.originalName || idx.name)
      }
    }

    const droppedForeignKeys: string[] = []
    const addedForeignKeys: TableForeignKey[] = []
    for (const fk of fks) {
      if (fk.isNew) {
        if (!fk.isDropped && fk.column.trim() && fk.refTable.trim() && fk.refColumn.trim()) {
          addedForeignKeys.push({
            name: fk.name.trim() || undefined,
            column: fk.column.trim(),
            refTable: fk.refTable.trim(),
            refColumn: fk.refColumn.trim(),
            onUpdate: fk.onUpdate || undefined,
            onDelete: fk.onDelete || undefined,
          })
        }
      } else if (fk.isDropped) {
        droppedForeignKeys.push(fk.originalName || fk.name)
      }
    }

    const stagedCount =
      addedColumns.length +
      droppedColumns.length +
      renamedColumns.length +
      alteredColumns.length +
      droppedIndexes.length +
      addedIndexes.length +
      droppedForeignKeys.length +
      addedForeignKeys.length

    const hasDestructiveDrops =
      droppedColumns.length > 0 || droppedIndexes.length > 0 || droppedForeignKeys.length > 0

    const summaryParts: string[] = []
    if (addedColumns.length > 0) summaryParts.push(`${addedColumns.length} added col`)
    if (droppedColumns.length > 0) summaryParts.push(`${droppedColumns.length} dropped col`)
    if (renamedColumns.length > 0) summaryParts.push(`${renamedColumns.length} renamed col`)
    if (alteredColumns.length > 0) summaryParts.push(`${alteredColumns.length} altered col`)
    if (addedIndexes.length > 0) summaryParts.push(`${addedIndexes.length} added idx`)
    if (droppedIndexes.length > 0) summaryParts.push(`${droppedIndexes.length} dropped idx`)
    if (addedForeignKeys.length > 0) summaryParts.push(`${addedForeignKeys.length} added FK`)
    if (droppedForeignKeys.length > 0) summaryParts.push(`${droppedForeignKeys.length} dropped FK`)

    const payload: AlterTablePayload = {
      schema: schema || '',
      table,
      addedColumns,
      droppedColumns,
      renamedColumns,
      alteredColumns,
      addedIndexes,
      droppedIndexes,
      addedForeignKeys,
      droppedForeignKeys,
    }

    return {
      payload,
      stagedCount,
      hasDestructiveDrops,
      diffSummary: summaryParts.join(', ') || 'No changes',
    }
  }, [columns, indexes, fks, schema, table])

  if (!isOpen) return null

  // Column operations
  const handleAddColumn = () => {
    const newId = `col_new_${Date.now()}_${Math.floor(Math.random() * 1000)}`
    setColumns((prev) => [
      ...prev,
      {
        id: newId,
        originalName: '',
        name: '',
        originalType: '',
        type: 'VARCHAR(255)',
        originalNullable: true,
        nullable: true,
        originalPrimary: false,
        isPrimary: false,
        originalDefault: '',
        defaultValue: '',
        isNew: true,
        isDropped: false,
      },
    ])
    setActiveTab('columns')
  }

  const handleToggleDropColumn = (id: string) => {
    setColumns((prev) =>
      prev
        .map((c) => {
          if (c.id !== id) return c
          if (c.isNew) return null
          return { ...c, isDropped: !c.isDropped }
        })
        .filter(Boolean) as ColumnRow[]
    )
  }

  const handleMoveColumn = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1
    if (targetIdx < 0 || targetIdx >= columns.length) return
    setColumns((prev) => {
      const next = [...prev]
      const temp = next[index]
      next[index] = next[targetIdx]
      next[targetIdx] = temp
      return next
    })
  }

  const handleUpdateColumn = (id: string, updates: Partial<ColumnRow>) => {
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)))
  }

  // Index operations
  const handleAddIndex = () => {
    const newId = `idx_new_${Date.now()}`
    setIndexes((prev) => [
      ...prev,
      {
        id: newId,
        originalName: '',
        name: `idx_${table}_`,
        columns: '',
        isUnique: false,
        isNew: true,
        isDropped: false,
      },
    ])
    setActiveTab('indexes')
  }

  const handleToggleDropIndex = (id: string) => {
    setIndexes((prev) =>
      prev
        .map((idx) => {
          if (idx.id !== id) return idx
          if (idx.isNew) return null
          return { ...idx, isDropped: !idx.isDropped }
        })
        .filter(Boolean) as IndexRow[]
    )
  }

  const handleUpdateIndex = (id: string, updates: Partial<IndexRow>) => {
    setIndexes((prev) => prev.map((idx) => (idx.id === id ? { ...idx, ...updates } : idx)))
  }

  // Foreign Key operations
  const handleAddFk = () => {
    const newId = `fk_new_${Date.now()}`
    const firstCol = columns.find((c) => !c.isDropped)?.name || ''
    setFks((prev) => [
      ...prev,
      {
        id: newId,
        originalName: '',
        name: `fk_${table}_`,
        column: firstCol,
        refTable: '',
        refColumn: 'id',
        onUpdate: 'NO ACTION',
        onDelete: 'NO ACTION',
        isNew: true,
        isDropped: false,
      },
    ])
    setActiveTab('fks')
  }

  const handleToggleDropFk = (id: string) => {
    setFks((prev) =>
      prev
        .map((fk) => {
          if (fk.id !== id) return fk
          if (fk.isNew) return null
          return { ...fk, isDropped: !fk.isDropped }
        })
        .filter(Boolean) as FkRow[]
    )
  }

  const handleUpdateFk = (id: string, updates: Partial<FkRow>) => {
    setFks((prev) => prev.map((fk) => (fk.id === id ? { ...fk, ...updates } : fk)))
  }

  // Actions: Dry Run Preview
  const handlePreview = async () => {
    if (stagedCount === 0) return
    setPreviewLoading(true)
    setStatusMessage(null)
    try {
      const res = await api.alterTablePreview(connId, table, payload, schema)
      setPreviewSql(res.sql || '-- No statements generated')
      setPreviewDialect(res.dialect || detail?.dialect || 'sql')
      setIsPreviewOpen(true)
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Failed to generate preview' })
    } finally {
      setPreviewLoading(false)
    }
  }

  // Actions: Apply Changes
  const handleApply = async () => {
    if (stagedCount === 0) return
    setApplying(true)
    setStatusMessage(null)
    try {
      const res = await api.alterTableApply(connId, table, payload, schema)
      // Invalidate query caches
      await qc.invalidateQueries({ queryKey: ['columns', connId, schema, table] })
      await qc.invalidateQueries({ queryKey: ['tables'] })
      await qc.invalidateQueries({ queryKey: ['data', connId, table] })
      await qc.invalidateQueries({ queryKey: ['schema-autocomplete', connId] })
      await qc.invalidateQueries({ queryKey: ['erd', connId] })

      onRefresh?.()
      setStatusMessage({
        type: 'success',
        text: res.message || `Successfully applied ${res.statementsExecuted} DDL statement(s)`,
      })

      // Brief pause so user sees success confirmation before closing
      setTimeout(() => {
        setIsPreviewOpen(false)
        onClose()
      }, 1200)
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Failed to apply alter changes' })
    } finally {
      setApplying(false)
    }
  }

  const handleCopySql = async () => {
    if (!previewSql) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(previewSql)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = previewSql
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  const availableColNames = columns.filter((c) => !c.isDropped && c.name.trim()).map((c) => c.name.trim())

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !applying) onClose()
      }}
    >
      <datalist id="common-sql-types">
        {COMMON_DATA_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div
        className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden text-[var(--fg)]"
        role="dialog"
        aria-label="Table Designer"
      >
        {/* Modal Header */}
        <div className="h-13 border-b border-[var(--border)] px-4 flex items-center justify-between shrink-0 bg-[var(--surface)]">
          <div className="flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold font-mono">
                  {schema ? `${schema}.` : ''}
                  {table}
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] font-mono font-medium">
                  Table Designer
                </span>
                {detail?.dialect && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] font-mono uppercase">
                    {detail.dialect}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--muted)] font-mono">
                Visual column, index, and constraint editor with dry-run DDL preview
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {stagedCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 text-xs font-mono">
                <span className="font-semibold">{stagedCount}</span>
                <span>staged</span>
              </div>
            )}
            {hasDestructiveDrops && (
              <div
                className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 text-xs font-mono"
                title="Destructive drops detected"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Drops</span>
              </div>
            )}
            <button
              onClick={onClose}
              disabled={applying}
              className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors disabled:opacity-50"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-toolbar & Tabs */}
        <div className="h-11 border-b border-[var(--border)] px-4 flex items-center justify-between shrink-0 bg-[var(--bg)]">
          <div role="tablist" aria-label="Designer Tabs" className="flex items-center gap-1">
            <button
              role="tab"
              aria-selected={activeTab === 'columns'}
              onClick={() => setActiveTab('columns')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono transition-colors ${
                activeTab === 'columns'
                  ? 'bg-[var(--accent)] text-white font-medium shadow-xs'
                  : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Columns</span>
              <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-black/20 font-bold">
                {columns.filter((c) => !c.isDropped).length}
              </span>
            </button>

            <button
              role="tab"
              aria-selected={activeTab === 'indexes'}
              onClick={() => setActiveTab('indexes')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono transition-colors ${
                activeTab === 'indexes'
                  ? 'bg-[var(--accent)] text-white font-medium shadow-xs'
                  : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              <span>Indexes</span>
              <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-black/20 font-bold">
                {indexes.filter((i) => !i.isDropped).length}
              </span>
            </button>

            <button
              role="tab"
              aria-selected={activeTab === 'fks'}
              onClick={() => setActiveTab('fks')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono transition-colors ${
                activeTab === 'fks'
                  ? 'bg-[var(--accent)] text-white font-medium shadow-xs'
                  : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>Foreign Keys</span>
              <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-black/20 font-bold">
                {fks.filter((f) => !f.isDropped).length}
              </span>
            </button>
          </div>

          <div>
            {activeTab === 'columns' && (
              <button
                onClick={handleAddColumn}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--surface)] hover:bg-[var(--hover)] border border-[var(--border)] text-xs font-mono transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Add Column</span>
              </button>
            )}
            {activeTab === 'indexes' && (
              <button
                onClick={handleAddIndex}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--surface)] hover:bg-[var(--hover)] border border-[var(--border)] text-xs font-mono transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Add Index</span>
              </button>
            )}
            {activeTab === 'fks' && (
              <button
                onClick={handleAddFk}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--surface)] hover:bg-[var(--hover)] border border-[var(--border)] text-xs font-mono transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Add Foreign Key</span>
              </button>
            )}
          </div>
        </div>

        {/* Status notification banner */}
        {statusMessage && (
          <div
            className={`px-4 py-2 text-xs font-mono border-b flex items-center gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                : 'bg-red-500/10 text-red-500 border-red-500/20'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Modal Main Content */}
        <div className="flex-1 overflow-auto p-4">
          {activeTab === 'columns' && (
            <div className="border border-[var(--border)] rounded-md overflow-hidden bg-[var(--bg)]">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead className="bg-[var(--surface)] border-b border-[var(--border)] text-[var(--muted)]">
                  <tr>
                    <th className="px-2 py-2 w-12 text-center">Order</th>
                    <th className="px-3 py-2 font-medium w-1/4">Column Name</th>
                    <th className="px-3 py-2 font-medium w-1/4">Data Type</th>
                    <th className="px-3 py-2 font-medium w-16 text-center">Nullable</th>
                    <th className="px-3 py-2 font-medium w-12 text-center">PK</th>
                    <th className="px-3 py-2 font-medium w-1/4">Default Value</th>
                    <th className="px-3 py-2 font-medium w-20 text-center">Status</th>
                    <th className="px-3 py-2 font-medium w-16 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {columns.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-[var(--muted)]">
                        No columns defined. Click "+ Add Column" above.
                      </td>
                    </tr>
                  ) : (
                    columns.map((col, idx) => {
                      const isDropped = col.isDropped
                      const isNew = col.isNew
                      const isRenamed = !isNew && !isDropped && col.name.trim() !== col.originalName
                      const isModified =
                        !isNew &&
                        !isDropped &&
                        (col.type.trim() !== col.originalType.trim() ||
                          col.nullable !== col.originalNullable ||
                          col.defaultValue.trim() !== col.originalDefault.trim())

                      return (
                        <tr
                          key={col.id}
                          className={`transition-colors ${
                            isDropped
                              ? 'bg-red-500/10 opacity-60 line-through'
                              : isNew
                              ? 'bg-emerald-500/5'
                              : isRenamed || isModified
                              ? 'bg-blue-500/5'
                              : 'hover:bg-[var(--hover)]/50'
                          }`}
                        >
                          {/* Reorder */}
                          <td className="px-2 py-1.5 text-center">
                            <div className="flex items-center justify-center gap-0.5">
                              <button
                                disabled={idx === 0 || isDropped}
                                onClick={() => handleMoveColumn(idx, 'up')}
                                className="p-0.5 text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-20"
                                title="Move Up"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                disabled={idx === columns.length - 1 || isDropped}
                                onClick={() => handleMoveColumn(idx, 'down')}
                                className="p-0.5 text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-20"
                                title="Move Down"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                            </div>
                          </td>

                          {/* Column Name */}
                          <td className="px-3 py-1.5">
                            <input
                              type="text"
                              disabled={isDropped}
                              value={col.name}
                              onChange={(e) => handleUpdateColumn(col.id, { name: e.target.value })}
                              placeholder="column_name"
                              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono focus:border-[var(--accent)] outline-hidden disabled:opacity-50"
                            />
                          </td>

                          {/* Data Type */}
                          <td className="px-3 py-1.5">
                            <input
                              type="text"
                              list="common-sql-types"
                              disabled={isDropped}
                              value={col.type}
                              onChange={(e) => handleUpdateColumn(col.id, { type: e.target.value })}
                              placeholder="DATA_TYPE"
                              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono focus:border-[var(--accent)] outline-hidden uppercase disabled:opacity-50"
                            />
                          </td>

                          {/* Nullable */}
                          <td className="px-3 py-1.5 text-center">
                            <input
                              type="checkbox"
                              disabled={isDropped || col.isPrimary}
                              checked={col.nullable}
                              onChange={(e) => handleUpdateColumn(col.id, { nullable: e.target.checked })}
                              className="rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer disabled:opacity-50"
                            />
                          </td>

                          {/* Primary Key */}
                          <td className="px-3 py-1.5 text-center">
                            <input
                              type="checkbox"
                              disabled={isDropped || !isNew}
                              checked={col.isPrimary}
                              onChange={(e) => {
                                const nextPrimary = e.target.checked
                                handleUpdateColumn(col.id, {
                                  isPrimary: nextPrimary,
                                  nullable: nextPrimary ? false : col.nullable,
                                })
                              }}
                              className="rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer disabled:opacity-50"
                            />
                          </td>

                          {/* Default Value */}
                          <td className="px-3 py-1.5">
                            <input
                              type="text"
                              disabled={isDropped}
                              value={col.defaultValue}
                              onChange={(e) => handleUpdateColumn(col.id, { defaultValue: e.target.value })}
                              placeholder="NULL, 'val', 0, now()"
                              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono focus:border-[var(--accent)] outline-hidden disabled:opacity-50"
                            />
                          </td>

                          {/* Status */}
                          <td className="px-3 py-1.5 text-center">
                            {isDropped ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">
                                DROP
                              </span>
                            ) : isNew ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                                NEW
                              </span>
                            ) : isRenamed ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold">
                                RENAME
                              </span>
                            ) : isModified ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">
                                EDIT
                              </span>
                            ) : (
                              <span className="text-[10px] text-[var(--muted)]">—</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-3 py-1.5 text-right">
                            {isDropped ? (
                              <button
                                onClick={() => handleToggleDropColumn(col.id)}
                                className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors"
                                title="Undo drop"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleToggleDropColumn(col.id)}
                                className="p-1 text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                title={isNew ? 'Remove column' : 'Drop column'}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'indexes' && (
            <div className="border border-[var(--border)] rounded-md overflow-hidden bg-[var(--bg)]">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead className="bg-[var(--surface)] border-b border-[var(--border)] text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2 font-medium w-1/3">Index Name</th>
                    <th className="px-3 py-2 font-medium w-1/3">Columns (comma-separated)</th>
                    <th className="px-3 py-2 font-medium w-20 text-center">Unique</th>
                    <th className="px-3 py-2 font-medium w-20 text-center">Status</th>
                    <th className="px-3 py-2 font-medium w-16 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {indexes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-[var(--muted)]">
                        No indexes configured. Click "+ Add Index" above.
                      </td>
                    </tr>
                  ) : (
                    indexes.map((idx) => {
                      const isDropped = idx.isDropped
                      const isNew = idx.isNew
                      return (
                        <tr
                          key={idx.id}
                          className={`transition-colors ${
                            isDropped
                              ? 'bg-red-500/10 opacity-60 line-through'
                              : isNew
                              ? 'bg-emerald-500/5'
                              : 'hover:bg-[var(--hover)]/50'
                          }`}
                        >
                          <td className="px-3 py-1.5">
                            <input
                              type="text"
                              disabled={isDropped || !isNew}
                              value={idx.name}
                              onChange={(e) => handleUpdateIndex(idx.id, { name: e.target.value })}
                              placeholder="idx_name"
                              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono focus:border-[var(--accent)] outline-hidden disabled:opacity-50"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="text"
                              disabled={isDropped || !isNew}
                              value={idx.columns}
                              onChange={(e) => handleUpdateIndex(idx.id, { columns: e.target.value })}
                              placeholder="col1, col2"
                              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono focus:border-[var(--accent)] outline-hidden disabled:opacity-50"
                            />
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <input
                              type="checkbox"
                              disabled={isDropped || !isNew}
                              checked={idx.isUnique}
                              onChange={(e) => handleUpdateIndex(idx.id, { isUnique: e.target.checked })}
                              className="rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer disabled:opacity-50"
                            />
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {isDropped ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">
                                DROP
                              </span>
                            ) : isNew ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                                NEW
                              </span>
                            ) : (
                              <span className="text-[10px] text-[var(--muted)]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {isDropped ? (
                              <button
                                onClick={() => handleToggleDropIndex(idx.id)}
                                className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors"
                                title="Undo drop"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleToggleDropIndex(idx.id)}
                                className="p-1 text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                title={isNew ? 'Remove index' : 'Drop index'}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'fks' && (
            <div className="border border-[var(--border)] rounded-md overflow-hidden bg-[var(--bg)]">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead className="bg-[var(--surface)] border-b border-[var(--border)] text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2 font-medium w-1/5">Constraint Name</th>
                    <th className="px-3 py-2 font-medium w-1/5">Local Column</th>
                    <th className="px-3 py-2 font-medium w-1/5">Ref Table</th>
                    <th className="px-3 py-2 font-medium w-1/6">Ref Column</th>
                    <th className="px-3 py-2 font-medium w-1/6">On Delete</th>
                    <th className="px-3 py-2 font-medium w-16 text-center">Status</th>
                    <th className="px-3 py-2 font-medium w-14 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {fks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-[var(--muted)]">
                        No foreign keys configured. Click "+ Add Foreign Key" above.
                      </td>
                    </tr>
                  ) : (
                    fks.map((fk) => {
                      const isDropped = fk.isDropped
                      const isNew = fk.isNew
                      return (
                        <tr
                          key={fk.id}
                          className={`transition-colors ${
                            isDropped
                              ? 'bg-red-500/10 opacity-60 line-through'
                              : isNew
                              ? 'bg-emerald-500/5'
                              : 'hover:bg-[var(--hover)]/50'
                          }`}
                        >
                          <td className="px-3 py-1.5">
                            <input
                              type="text"
                              disabled={isDropped || !isNew}
                              value={fk.name}
                              onChange={(e) => handleUpdateFk(fk.id, { name: e.target.value })}
                              placeholder="fk_name"
                              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono focus:border-[var(--accent)] outline-hidden disabled:opacity-50"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            {isNew ? (
                              <select
                                disabled={isDropped}
                                value={fk.column}
                                onChange={(e) => handleUpdateFk(fk.id, { column: e.target.value })}
                                className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono focus:border-[var(--accent)] outline-hidden disabled:opacity-50"
                              >
                                {availableColNames.map((cn) => (
                                  <option key={cn} value={cn}>
                                    {cn}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="font-semibold">{fk.column}</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="text"
                              disabled={isDropped || !isNew}
                              value={fk.refTable}
                              onChange={(e) => handleUpdateFk(fk.id, { refTable: e.target.value })}
                              placeholder="target_table"
                              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono focus:border-[var(--accent)] outline-hidden disabled:opacity-50"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="text"
                              disabled={isDropped || !isNew}
                              value={fk.refColumn}
                              onChange={(e) => handleUpdateFk(fk.id, { refColumn: e.target.value })}
                              placeholder="id"
                              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono focus:border-[var(--accent)] outline-hidden disabled:opacity-50"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <select
                              disabled={isDropped || !isNew}
                              value={fk.onDelete}
                              onChange={(e) => handleUpdateFk(fk.id, { onDelete: e.target.value })}
                              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono focus:border-[var(--accent)] outline-hidden disabled:opacity-50"
                            >
                              <option value="NO ACTION">NO ACTION</option>
                              <option value="CASCADE">CASCADE</option>
                              <option value="SET NULL">SET NULL</option>
                              <option value="RESTRICT">RESTRICT</option>
                            </select>
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {isDropped ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">
                                DROP
                              </span>
                            ) : isNew ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                                NEW
                              </span>
                            ) : (
                              <span className="text-[10px] text-[var(--muted)]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {isDropped ? (
                              <button
                                onClick={() => handleToggleDropFk(fk.id)}
                                className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors"
                                title="Undo drop"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleToggleDropFk(fk.id)}
                                className="p-1 text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                title={isNew ? 'Remove foreign key' : 'Drop foreign key'}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="h-14 border-t border-[var(--border)] px-4 flex items-center justify-between shrink-0 bg-[var(--surface)]">
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--muted)]">
            <span>Diff:</span>
            <span className={stagedCount > 0 ? 'text-[var(--fg)] font-medium' : ''}>
              {diffSummary}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={applying}
              className="px-3 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] text-xs font-mono transition-colors disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              onClick={handlePreview}
              disabled={stagedCount === 0 || previewLoading || applying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 text-xs font-mono font-medium transition-colors disabled:opacity-40"
              title="Preview generated ALTER TABLE SQL"
            >
              {previewLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileCode className="w-3.5 h-3.5" />
              )}
              <span>Dry Run / Preview DDL</span>
            </button>

            <button
              onClick={handleApply}
              disabled={stagedCount === 0 || applying}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 text-xs font-mono font-medium transition-colors shadow-xs disabled:opacity-40"
              title="Execute ALTER TABLE DDL against the database"
            >
              {applying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>{applying ? 'Applying...' : 'Apply Changes'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* DDL Preview Modal / Drawer Overlay */}
      {isPreviewOpen && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-100"
          onClick={(e) => {
            if (e.target === e.currentTarget && !applying) setIsPreviewOpen(false)
          }}
        >
          <div
            className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-3xl h-[75vh] flex flex-col overflow-hidden text-[var(--fg)]"
            role="dialog"
            aria-label="DDL Preview"
          >
            {/* Header */}
            <div className="h-12 border-b border-[var(--border)] px-4 flex items-center justify-between shrink-0 bg-[var(--surface)]">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-[var(--accent)]" />
                <h3 className="text-xs font-semibold font-mono">
                  ALTER TABLE Preview — {schema ? `${schema}.` : ''}
                  {table}
                </h3>
                {previewDialect && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] font-mono uppercase">
                    {previewDialect}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopySql}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--hover)] text-xs font-mono transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  onClick={() => setIsPreviewOpen(false)}
                  className="p-1 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Warning banner for drops */}
            {hasDestructiveDrops && (
              <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-500 text-xs font-mono flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  Warning: This ALTER operation contains destructive DROP operations (data loss may occur).
                </span>
              </div>
            )}

            {/* CodeMirror preview */}
            <div className="flex-1 overflow-auto bg-[var(--bg)] font-mono text-xs">
              <CodeMirror
                value={previewSql}
                height="100%"
                extensions={isDark ? [sql(), oneDark] : [sql()]}
                theme={isDark ? 'dark' : 'light'}
                editable={false}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: false,
                  highlightActiveLine: false,
                }}
              />
            </div>

            {/* Preview Footer */}
            <div className="h-12 border-t border-[var(--border)] px-4 flex items-center justify-between shrink-0 bg-[var(--surface)]">
              <span className="text-xs font-mono text-[var(--muted)]">
                {stagedCount} statement(s) staged
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPreviewOpen(false)}
                  disabled={applying}
                  className="px-3 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)] text-xs font-mono transition-colors"
                >
                  Back to Designer
                </button>
                <button
                  onClick={handleApply}
                  disabled={applying}
                  className="flex items-center gap-1.5 px-3.5 py-1 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 text-xs font-mono font-medium transition-colors shadow-xs disabled:opacity-40"
                >
                  {applying ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  )}
                  <span>{applying ? 'Applying...' : 'Apply Changes'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
