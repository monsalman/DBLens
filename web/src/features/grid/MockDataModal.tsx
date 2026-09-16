import React, { useState, useMemo, useEffect } from 'react'
import { X } from 'lucide-react'
import type { ColumnMeta } from '../../lib/api'
import { generateMockRows, inferMockRule } from '../../lib/mockGenerator'

interface Props {
  connId: string
  schema: string
  table: string
  columns: ColumnMeta[]
  onSubmit: (rows: Record<string, any>[]) => Promise<void>
  onClose: () => void
  error?: string | null
  loading?: boolean
}

const COUNT_PRESETS = [10, 25, 50] as const

export const MockDataModal: React.FC<Props> = ({
  columns, onSubmit, onClose, error, loading,
}) => {
  const [count, setCount] = useState<number>(25)
  const [skipped, setSkipped] = useState<Set<string>>(() => {
    // Pre-skip auto-increment PKs
    const s = new Set<string>()
    for (const col of columns) {
      const rule = inferMockRule(col)
      if (rule === 'Auto Increment (Skipped)') s.add(col.name)
    }
    return s
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rules = useMemo(() => {
    const map: Record<string, string> = {}
    for (const col of columns) map[col.name] = inferMockRule(col)
    return map
  }, [columns])

  const preview = useMemo(() =>
    generateMockRows(columns, 3, undefined, skipped),
    [columns, skipped]
  )

  const handleSubmit = async () => {
    const rows = generateMockRows(columns, count, undefined, skipped)
    await onSubmit(rows)
  }

  const toggleSkip = (name: string) => {
    setSkipped(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const visibleCols = columns.filter(c => !skipped.has(c.name))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Generate Mock Data"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <span className="text-sm font-mono text-[var(--fg)]">Generate Mock Data</span>
          <button onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--fg)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
          {/* Count Selector */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-[var(--muted)]">Row count:</span>
            <div className="flex gap-1">
              {COUNT_PRESETS.map(n => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  className={`px-3 py-0.5 text-xs font-mono rounded border ${
                    count === n
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Column Rules Table */}
          <div>
            <div className="text-[10px] font-mono text-[var(--muted)] mb-1 uppercase tracking-wide">Columns</div>
            <div className="border border-[var(--border)] rounded overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[var(--surface)]">
                  <tr>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-[var(--muted)] border-b border-[var(--border)]">Column</th>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-[var(--muted)] border-b border-[var(--border)]">Type</th>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-[var(--muted)] border-b border-[var(--border)]">Mock Rule</th>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-[var(--muted)] border-b border-[var(--border)] text-center">Include</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map(col => {
                    const rule = rules[col.name]
                    const isAutoInc = rule === 'Auto Increment (Skipped)'
                    const isSkipped = skipped.has(col.name)
                    return (
                      <tr key={col.name} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-2 py-1 text-xs font-mono text-[var(--fg)]">{col.name}</td>
                        <td className="px-2 py-1 text-[10px] font-mono text-[var(--muted)]">{col.dataType ?? col.type}</td>
                        <td className="px-2 py-1 text-[10px] font-mono">
                          <span className={isAutoInc ? 'text-amber-500' : 'text-indigo-400'}>{rule}</span>
                        </td>
                        <td className="px-2 py-1 text-center">
                          {isAutoInc ? (
                            <span className="text-[9px] text-[var(--muted)]">auto</span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={!isSkipped}
                              onChange={() => toggleSkip(col.name)}
                              className="rounded border-[var(--border)] bg-[var(--surface)] text-indigo-500 w-3 h-3"
                            />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live Preview */}
          {visibleCols.length > 0 && preview.length > 0 && (
            <div>
              <div className="text-[10px] font-mono text-[var(--muted)] mb-1 uppercase tracking-wide">Preview (first 3 rows)</div>
              <div className="border border-[var(--border)] rounded overflow-auto max-h-32">
                <table className="w-full text-left border-collapse text-[10px] font-mono">
                  <thead className="bg-[var(--surface)] sticky top-0">
                    <tr>
                      {visibleCols.map(c => (
                        <th key={c.name} className="px-2 py-1 text-[var(--muted)] border-b border-[var(--border)] whitespace-nowrap">{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-b border-[var(--border)] last:border-0">
                        {visibleCols.map(c => (
                          <td key={c.name} className="px-2 py-1 text-[var(--fg)] whitespace-nowrap max-w-[120px] truncate">
                            {String(row[c.name] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-[11px] font-mono text-red-400 bg-red-950/20 border border-red-800/40 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border)] shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-xs font-mono text-[var(--muted)] hover:text-[var(--fg)] border border-[var(--border)] rounded hover:bg-[var(--hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || visibleCols.length === 0}
            className="px-3 py-1 text-xs font-mono bg-indigo-600 hover:bg-indigo-500 text-white rounded disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
                Inserting…
              </>
            ) : (
              `Generate ${count} Rows`
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
