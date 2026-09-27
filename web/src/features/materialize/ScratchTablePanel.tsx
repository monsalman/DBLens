import { useState } from 'react'
import {
  Layers,
  Trash2,
  ArrowUpRight,
  Clock,
  Rows,
  RefreshCw,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react'
import { useMaterialize } from './useMaterialize'
import { formatExpiryRemaining, type ScratchTable } from './materializeHelper'

interface ScratchTablePanelProps {
  connId: string
  onSelectTable?: (tableName: string) => void
  onClose?: () => void
}

export function ScratchTablePanel({ connId, onSelectTable, onClose }: ScratchTablePanelProps) {
  const {
    scratchTables,
    scratchLoading,
    fetchScratch,
    deleteScratch,
    promoteScratch,
    expireScratch,
    error,
  } = useMaterialize(connId)

  const [busyTable, setBusyTable] = useState<string | null>(null)
  const [promotedSql, setPromotedSql] = useState<{ table: string; sql: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const handlePromote = async (st: ScratchTable) => {
    setBusyTable(st.table)
    try {
      const sql = await promoteScratch(st.schema || '', st.table)
      setPromotedSql({ table: st.table, sql })
    } catch {
      // Error is tracked in hook
    } finally {
      setBusyTable(null)
    }
  }

  const handleDelete = async (st: ScratchTable) => {
    if (!confirm(`Are you sure you want to drop scratch table "${st.table}"?`)) return
    setBusyTable(st.table)
    try {
      await deleteScratch(st.schema || '', st.table)
    } catch {
      // Handled
    } finally {
      setBusyTable(null)
    }
  }

  const handleExpireAll = async () => {
    try {
      await expireScratch()
    } catch {
      // Handled
    }
  }

  const handleCopySql = () => {
    if (promotedSql?.sql) {
      navigator.clipboard.writeText(promotedSql.sql)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] border-t border-[var(--border)] text-[var(--fg)] text-xs">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)]/40">
        <div className="flex items-center gap-1.5 font-medium">
          <Layers className="w-3.5 h-3.5 text-amber-500" />
          <span>Scratchpad Tables</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">
            {scratchTables.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => fetchScratch()}
            disabled={scratchLoading}
            className="p-1 rounded hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            title="Refresh Scratch Tables"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scratchLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleExpireAll}
            className="px-2 py-0.5 rounded text-[11px] text-amber-400 hover:bg-amber-500/10 border border-amber-500/30 transition-colors"
            title="Drop all expired scratch tables"
          >
            Purge Expired
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)]"
              title="Close panel"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-2 mx-3 my-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* Promoted notification */}
      {promotedSql && (
        <div className="m-2 p-2.5 rounded bg-emerald-500/10 border border-emerald-500/25 space-y-1.5">
          <div className="flex items-center justify-between text-emerald-400 font-medium text-[11px]">
            <span>Promoted &ldquo;{promotedSql.table}&rdquo; to permanent!</span>
            <button
              onClick={() => setPromotedSql(null)}
              className="text-[var(--muted)] hover:text-[var(--fg)]"
            >
              ✕
            </button>
          </div>
          <pre className="font-mono text-[10px] p-1.5 rounded bg-black/40 overflow-x-auto text-emerald-300">
            {promotedSql.sql}
          </pre>
          <button
            onClick={handleCopySql}
            className="flex items-center gap-1 text-[10px] text-emerald-400 hover:underline cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied migration SQL' : 'Copy migration SQL'}
          </button>
        </div>
      )}

      {/* Tables list */}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
        {scratchTables.length === 0 ? (
          <div className="p-4 text-center text-[var(--muted)] text-[11px]">
            No scratch tables found. Use &ldquo;Materialize&rdquo; in SQL Console with &ldquo;Temp Scratchpad&rdquo; mode to create one.
          </div>
        ) : (
          scratchTables.map((st) => {
            const exp = formatExpiryRemaining(st.expiresAt)
            const isBusy = busyTable === st.table

            return (
              <div
                key={`${st.schema || ''}.${st.table}`}
                className="p-2.5 flex items-center justify-between hover:bg-[var(--surface)]/50 transition-colors group"
              >
                <div
                  className="min-w-0 flex-1 cursor-pointer pr-2"
                  onClick={() => onSelectTable?.(st.table)}
                  title="Click to view table data"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-medium truncate text-[var(--fg)] group-hover:text-amber-400">
                      {st.schema ? `${st.schema}.${st.table}` : st.table}
                    </span>
                    {st.isTemporary && (
                      <span className="text-[9px] px-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        TEMP
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--muted)]">
                    <span className="flex items-center gap-1">
                      <Rows className="w-3 h-3" />
                      {st.rowCount.toLocaleString()} rows
                    </span>
                    <span>•</span>
                    <span
                      className={`flex items-center gap-1 ${
                        exp.isExpired
                          ? 'text-red-400 font-semibold'
                          : 'text-amber-400/90'
                      }`}
                    >
                      <Clock className="w-3 h-3" />
                      {exp.label}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handlePromote(st)}
                    disabled={isBusy}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 text-[10px] transition-colors"
                    title="Promote table to permanent schema"
                  >
                    <ArrowUpRight className="w-3 h-3" />
                    <span>Promote</span>
                  </button>

                  <button
                    onClick={() => handleDelete(st)}
                    disabled={isBusy}
                    className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Drop scratch table"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
