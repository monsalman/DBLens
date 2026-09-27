import React, { useState } from 'react'
import {
  X,
  BookOpen,
  Search,
  ShieldAlert,
  ShieldCheck,
  Download,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from 'lucide-react'
import { useDictionary } from './useDictionary'
import { TableDictionaryCard } from './TableDictionaryCard'
import { ExportDocModal } from './ExportDocModal'
import { formatCoverage } from './dictionaryHelper'
import type { ConnectionConfig } from '../../lib/api'

interface DataDictionaryPortalProps {
  isOpen: boolean
  onClose: () => void
  connId: string | null
  profiles?: ConnectionConfig[]
}

export const DataDictionaryPortal: React.FC<DataDictionaryPortalProps> = ({
  isOpen,
  onClose,
  connId,
  profiles,
}) => {
  const {
    dictionary,
    loading,
    error,
    selectedSchema,
    setSelectedSchema,
    searchQuery,
    setSearchQuery,
    piiOnly,
    setPiiOnly,
    filteredSchemas,
    fetchDictionary,
    updateComment,
  } = useDictionary(isOpen ? connId : null, profiles)

  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [expandAll, setExpandAll] = useState(true)

  if (!isOpen) return null

  const summary = dictionary?.summary
  const totalFilteredTables = filteredSchemas.reduce(
    (acc, s) => acc + s.tables.length,
    0
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-[var(--bg)] text-[var(--fg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden animate-in fade-in duration-150">
        {/* Portal Header */}
        <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-[var(--fg)]">
                  Living Data Dictionary & Schema Documentation
                </h1>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                  <ShieldCheck className="w-3 h-3" />
                  <span>SOC 2 / HIPAA Ready</span>
                </span>
              </div>
              <p className="text-xs text-[var(--muted)]">
                Connection: <span className="font-mono text-[var(--fg)]">{connId || 'None'}</span>
                {dictionary?.dialect && (
                  <span>
                    {' '}• Dialect: <span className="font-mono uppercase text-[var(--fg)]">{dictionary.dialect}</span>
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExportModalOpen(true)}
              disabled={!dictionary}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              title="Export offline HTML, Markdown runbook, or OpenAPI schemas"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Documentation</span>
            </button>

            <button
              type="button"
              onClick={() => fetchDictionary(selectedSchema)}
              disabled={loading}
              className="p-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
              title="Refresh Catalog Metadata"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Summary KPIs Banner */}
        {summary && (
          <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface)] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 shrink-0">
            <div className="p-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--muted)]">Schemas</div>
              <div className="text-lg font-bold">{summary.totalSchemas}</div>
            </div>

            <div className="p-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--muted)]">Tables / Views</div>
              <div className="text-lg font-bold">
                {summary.totalTables}
                {summary.totalViews > 0 && (
                  <span className="text-xs font-normal text-[var(--muted)] ml-1">
                    ({summary.totalViews} views)
                  </span>
                )}
              </div>
            </div>

            <div className="p-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--muted)]">Total Columns</div>
              <div className="text-lg font-bold">{summary.totalColumns}</div>
            </div>

            <div className="p-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--muted)]">Documented</div>
              <div className="text-lg font-bold text-blue-500">
                {summary.documentedColumns}
                <span className="text-xs font-normal text-[var(--muted)] ml-1">
                  / {summary.totalColumns}
                </span>
              </div>
            </div>

            <div className="p-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--muted)]">Coverage</div>
              <div className="text-lg font-bold text-emerald-500">
                {formatCoverage(summary.documentationCoverage)}
              </div>
              <div className="w-full bg-[var(--border)] h-1 rounded-full mt-1 overflow-hidden">
                <div
                  className="bg-emerald-500 h-1 rounded-full transition-all"
                  style={{ width: `${Math.min(100, summary.documentationCoverage)}%` }}
                />
              </div>
            </div>

            <div className="p-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--muted)]">PII Columns</div>
              <div className={`text-lg font-bold ${summary.totalPIIColumns > 0 ? 'text-rose-500' : ''}`}>
                {summary.totalPIIColumns}
              </div>
            </div>
          </div>
        )}

        {/* Toolbar & Filters */}
        <div className="px-5 py-2.5 border-b border-[var(--border)] bg-[var(--card)] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 flex-1 flex-wrap">
            {/* Search Input */}
            <div className="relative min-w-[260px] max-w-sm flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tables, columns, types, comments, PII tags..."
                className="w-full pl-8 pr-7 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-md text-xs focus:outline-none focus:border-blue-500 text-[var(--fg)]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--fg)] p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Schema Selector Tabs */}
            {dictionary && dictionary.schemas.length > 1 && (
              <div className="flex items-center gap-1 overflow-x-auto max-w-md py-0.5">
                <button
                  type="button"
                  onClick={() => setSelectedSchema('')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer whitespace-nowrap ${
                    selectedSchema === ''
                      ? 'bg-[var(--active)] text-[var(--fg)] font-semibold'
                      : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                  }`}
                >
                  All ({dictionary.schemas.reduce((a, s) => a + s.tables.length, 0)})
                </button>
                {dictionary.schemas.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setSelectedSchema(s.name)}
                    className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer whitespace-nowrap ${
                      selectedSchema === s.name
                        ? 'bg-[var(--active)] text-[var(--fg)] font-semibold'
                        : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                    }`}
                  >
                    {s.name} ({s.tables.length})
                  </button>
                ))}
              </div>
            )}

            {/* PII Only Filter Toggle */}
            <button
              type="button"
              onClick={() => setPiiOnly(!piiOnly)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors cursor-pointer ${
                piiOnly
                  ? 'border-rose-500 bg-rose-500/15 text-rose-500 font-semibold'
                  : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
              }`}
              title="Filter to show only tables with Personally Identifiable Information"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Show PII Only</span>
              {summary && summary.totalPIIColumns > 0 && (
                <span className="text-[10px] font-bold px-1 rounded bg-rose-500/20 text-rose-500">
                  {summary.totalPIIColumns}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* Expand / Collapse All */}
            <button
              type="button"
              onClick={() => setExpandAll(!expandAll)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs border border-[var(--border)] rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
            >
              {expandAll ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <span>{expandAll ? 'Collapse All' : 'Expand All'}</span>
            </button>
          </div>
        </div>

        {/* Content Body: Table Cards List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && !dictionary && (
            <div className="flex flex-col items-center justify-center h-64 text-[var(--muted)] gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
              <span className="text-xs">Extracting schema catalog & PII classifications...</span>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-500 flex items-start gap-3 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold">Failed to load data dictionary</div>
                <div>{error}</div>
                <button
                  type="button"
                  onClick={() => fetchDictionary(selectedSchema)}
                  className="mt-2 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-medium cursor-pointer"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {!loading && filteredSchemas.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-[var(--muted)] gap-2">
              <SlidersHorizontal className="w-8 h-8 opacity-40" />
              <div className="text-sm font-semibold">No schema tables matched</div>
              <div className="text-xs text-[var(--muted)]">
                Try adjusting your search query, schema filter, or disabling the PII filter.
              </div>
            </div>
          )}

          {filteredSchemas.map((schema) => (
            <div key={schema.name} className="space-y-3">
              {filteredSchemas.length > 1 && (
                <div className="text-xs font-mono font-bold text-[var(--muted)] uppercase tracking-wider pl-1">
                  Schema: {schema.name} ({schema.tables.length} tables)
                </div>
              )}
              {schema.tables.map((table) => (
                <TableDictionaryCard
                  key={`${table.schema}.${table.name}`}
                  table={table}
                  onUpdateComment={updateComment}
                  searchQuery={searchQuery}
                  defaultExpanded={expandAll}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Footer info bar */}
        <div className="px-5 py-2.5 border-t border-[var(--border)] bg-[var(--surface)] text-[11px] text-[var(--muted)] flex items-center justify-between shrink-0">
          <div>
            Showing <strong>{totalFilteredTables}</strong> table(s)
            {selectedSchema && <span> in schema <strong>{selectedSchema}</strong></span>}
          </div>
          <div className="flex items-center gap-3">
            <span>Shortcut: <kbd className="font-mono px-1 py-0.5 border border-[var(--border)] rounded text-[10px]">Alt+Shift+D</kbd></span>
          </div>
        </div>
      </div>

      {/* Export Doc Modal */}
      {isExportModalOpen && dictionary && (
        <ExportDocModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          dictionary={dictionary}
          connId={connId}
          profiles={profiles}
        />
      )}
    </div>
  )
}
