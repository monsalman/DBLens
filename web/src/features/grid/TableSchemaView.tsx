import React, { useState, useEffect } from 'react'
import {
  Code2,
  Key,
  Layers,
  Link2,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Wrench,
  GitCompare,
} from 'lucide-react'
import { api, type TableDetailResponse } from '../../lib/api'
import { useAppStore } from '../../stores/appStore'
import { DdlModal } from './DdlModal'
import { TableDesignerModal } from './TableDesignerModal'

interface TableSchemaViewProps {
  connId: string
  table: string
  schema?: string
  detail?: TableDetailResponse | null
  isLoading?: boolean
  onRefresh?: () => void
}

type SchemaSubTab = 'columns' | 'indexes' | 'fks'

export const TableSchemaView: React.FC<TableSchemaViewProps> = ({
  connId,
  table,
  schema,
  detail,
  isLoading = false,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<SchemaSubTab>('columns')
  const [ddlModalOpen, setDdlModalOpen] = useState(false)
  const [designerModalOpen, setDesignerModalOpen] = useState(false)
  const [ddlLoading, setDdlLoading] = useState(false)
  const [ddlError, setDdlError] = useState<string | null>(null)
  const [ddlData, setDdlData] = useState<{ ddl: string; dialect?: string } | null>(null)

  useEffect(() => {
    setDdlData(null)
    setDdlError(null)
    setDdlModalOpen(false)
    setDesignerModalOpen(false)
  }, [connId, schema, table])

  const columns = detail?.columns ?? []
  const indexes = detail?.indexes ?? []
  const fks = detail?.fks ?? []

  const handleOpenDDL = async () => {
    setDdlModalOpen(true)

    if (detail?.ddl) {
      setDdlData({ ddl: detail.ddl, dialect: detail.dialect })
      return
    }

    if (ddlData?.ddl) return // already loaded

    setDdlLoading(true)
    setDdlError(null)
    try {
      const res = await api.getTableDDL(connId, table, schema)
      setDdlData({ ddl: res.ddl, dialect: res.dialect })
    } catch (err: any) {
      setDdlError(err?.message || 'Failed to generate DDL')
    } finally {
      setDdlLoading(false)
    }
  }

  const handleCompareTable = () => {
    useAppStore.getState().setDiffPreload({
      sourceConnId: connId,
      sourceSchema: schema || 'public',
      sourceTable: table,
    })
    useAppStore.getState().setActiveTab('diff')
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg)] overflow-hidden">
      {/* Sub-toolbar */}
      <div className="h-10 border-b border-[var(--border)] px-4 flex items-center justify-between shrink-0 bg-[var(--surface)]">
        {/* Navigation tabs */}
        <div role="tablist" aria-label="Schema Views" className="flex items-center gap-1">
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
              {columns.length}
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
              {indexes.length}
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
              {fks.length}
            </span>
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              title="Refresh Schema"
              className="p-1.5 text-[var(--muted)] hover:text-[var(--fg)] rounded hover:bg-[var(--hover)] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          )}

          <button
            onClick={handleCompareTable}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:bg-[var(--hover)] text-xs font-mono font-medium transition-colors cursor-pointer"
            title="Compare Table Schema in Diff Tool"
          >
            <GitCompare className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>Compare Table</span>
          </button>

          <button
            onClick={handleOpenDDL}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 text-xs font-mono font-medium transition-colors"
            title="Generate & View Native DDL"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Generate DDL</span>
          </button>

          <button
            onClick={() => setDesignerModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 text-xs font-mono font-medium transition-colors shadow-xs"
            title="Visual Table Designer & Alter Table"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Table Designer</span>
          </button>
        </div>
      </div>

      {/* Main Table Content */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="h-48 flex items-center justify-center text-[var(--muted)] font-mono text-xs">
            Loading table schema...
          </div>
        ) : activeTab === 'columns' ? (
          <div role="tabpanel" aria-label="Columns" className="border border-[var(--border)] rounded-md overflow-hidden bg-[var(--bg)]">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead className="bg-[var(--surface)] border-b border-[var(--border)] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium w-1/4">Column Name</th>
                  <th className="px-4 py-2.5 font-medium w-1/4">Data Type</th>
                  <th className="px-4 py-2.5 font-medium w-1/6">Nullable</th>
                  <th className="px-4 py-2.5 font-medium w-1/6">Default Value</th>
                  <th className="px-4 py-2.5 font-medium text-right">Key / Attributes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {columns.map((col, idx) => {
                  const isPk = col.isPrimaryKey || col.isPrimary
                  const isFk = col.isForeignKey || fks.some((f) => f.column === col.name)
                  const isNullable = col.nullable ?? col.isNullable ?? true
                  const defVal = col.defaultValue ?? col.default
                  const displayType = col.type || col.dataType || '—'

                  return (
                    <tr
                      key={col.name || idx}
                      className="hover:bg-[var(--hover)] transition-colors group"
                    >
                      <td className="px-4 py-2.5 font-medium text-[var(--fg)] flex items-center gap-2">
                        {isPk && isFk ? (
                          <span title="Primary & Foreign Key" className="inline-flex items-center gap-0.5">
                            <Key className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <Link2 className="w-3 h-3 text-blue-400 shrink-0" />
                          </span>
                        ) : isPk ? (
                          <span title="Primary Key" className="inline-flex">
                            <Key className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          </span>
                        ) : isFk ? (
                          <span title="Foreign Key" className="inline-flex">
                            <Link2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          </span>
                        ) : (
                          <span className="w-3.5 shrink-0" />
                        )}
                        <span className="truncate">{col.name}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--muted)]">
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] font-mono">
                          {displayType}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {isNullable ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)]">
                            <CheckCircle2 className="w-3 h-3 text-green-500/70" />
                            <span>Nullable</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-500">
                            <XCircle className="w-3 h-3 text-amber-500" />
                            <span>NOT NULL</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--muted)] truncate max-w-[200px]">
                        {defVal !== undefined && defVal !== null ? (
                          <span className="px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] text-[11px]">
                            {defVal}
                          </span>
                        ) : (
                          <span className="text-[var(--muted)]/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right space-x-1.5">
                        {isPk && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            PK
                          </span>
                        )}
                        {isFk && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                            FK
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : activeTab === 'indexes' ? (
          indexes.length === 0 ? (
            <div role="tabpanel" aria-label="Indexes" className="h-48 flex flex-col items-center justify-center text-[var(--muted)] border border-dashed border-[var(--border)] rounded-md">
              <Key className="w-6 h-6 mb-2 opacity-40" />
              <p className="text-xs font-mono">No secondary indexes found on this table.</p>
            </div>
          ) : (
            <div role="tabpanel" aria-label="Indexes" className="border border-[var(--border)] rounded-md overflow-hidden bg-[var(--bg)]">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead className="bg-[var(--surface)] border-b border-[var(--border)] text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-2.5 font-medium w-1/3">Index Name</th>
                    <th className="px-4 py-2.5 font-medium w-1/3">Indexed Columns</th>
                    <th className="px-4 py-2.5 font-medium w-1/6">Uniqueness</th>
                    <th className="px-4 py-2.5 font-medium text-right">Method / Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {indexes.map((idx, i) => (
                    <tr key={idx.name || i} className="hover:bg-[var(--hover)] transition-colors">
                      <td className="px-4 py-2.5 font-medium text-[var(--fg)] flex items-center gap-2">
                        <Key
                          className={`w-3.5 h-3.5 shrink-0 ${
                            idx.isPrimary
                              ? 'text-amber-500'
                              : idx.isUnique
                              ? 'text-purple-400'
                              : 'text-[var(--muted)]'
                          }`}
                        />
                        <span>{idx.name}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {idx.columns.map((c, ci) => (
                            <span
                              key={ci}
                              className="px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] text-[11px]"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {idx.isPrimary ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            PRIMARY KEY
                          </span>
                        ) : idx.isUnique ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/30">
                            UNIQUE
                          </span>
                        ) : (
                          <span className="text-[var(--muted)] text-[11px]">NON-UNIQUE</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)] text-[10px]">
                          {idx.type || 'BTREE'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          fks.length === 0 ? (
            <div role="tabpanel" aria-label="Foreign Keys" className="h-48 flex flex-col items-center justify-center text-[var(--muted)] border border-dashed border-[var(--border)] rounded-md">
              <Link2 className="w-6 h-6 mb-2 opacity-40" />
              <p className="text-xs font-mono">No foreign key constraints found on this table.</p>
            </div>
          ) : (
            <div role="tabpanel" aria-label="Foreign Keys" className="border border-[var(--border)] rounded-md overflow-hidden bg-[var(--bg)]">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead className="bg-[var(--surface)] border-b border-[var(--border)] text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-2.5 font-medium w-1/4">Constraint Name</th>
                    <th className="px-4 py-2.5 font-medium w-2/5">Relationship</th>
                    <th className="px-4 py-2.5 font-medium w-1/6">On Update</th>
                    <th className="px-4 py-2.5 font-medium text-right">On Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {fks.map((fk, i) => (
                    <tr key={fk.name || i} className="hover:bg-[var(--hover)] transition-colors">
                      <td className="px-4 py-2.5 font-medium text-[var(--fg)]">
                        <span className="text-[11px]">{fk.name || `fk_${table}_${i}`}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] font-semibold">
                            {fk.column}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
                            {fk.refTable}
                          </span>
                          <span className="text-[var(--muted)] font-normal">({fk.refColumn})</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">
                          {fk.onUpdate || 'NO ACTION'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">
                          {fk.onDelete || 'NO ACTION'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* DDL Modal */}
      <DdlModal
        isOpen={ddlModalOpen}
        onClose={() => setDdlModalOpen(false)}
        table={table}
        schema={schema}
        ddl={ddlData?.ddl ?? ''}
        dialect={ddlData?.dialect}
        loading={ddlLoading}
        error={ddlError}
      />

      {/* Visual Table Designer Modal */}
      <TableDesignerModal
        isOpen={designerModalOpen}
        onClose={() => setDesignerModalOpen(false)}
        connId={connId}
        table={table}
        schema={schema}
        detail={detail}
        onRefresh={onRefresh}
      />
    </div>
  )
}
