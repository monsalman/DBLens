import React, { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface ColDef {
  name: string
  type: string
  nullable: boolean
  isPk: boolean
}

interface Props {
  colDefs: ColDef[]
  onSubmit: (data: Record<string, any>) => Promise<void>
  onClose: () => void
  error?: string | null
  loading?: boolean
}

export const AddRowModal: React.FC<Props> = ({ colDefs, onSubmit, onClose, error, loading }) => {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(colDefs.map(c => [c.name, '']))
  )
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // filter out blank PK fields (likely auto-increment)
    const data: Record<string, any> = {}
    for (const c of colDefs) {
      const v = values[c.name]
      if (c.isPk && v === '') continue
      if (v === '') {
        data[c.name] = c.nullable ? null : ''
      } else {
        data[c.name] = v
      }
    }
    await onSubmit(data)
  }

  const isLargeType = (t: string) => /json|text|blob/i.test(t)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Add Row"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <span className="text-sm font-mono text-[var(--fg)]">Add Row</span>
          <button onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--fg)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form id="add-row-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {colDefs.map((c, i) => {
            const isLarge = isLargeType(c.type)
            const hint = c.isPk ? ' (leave blank for auto)' : ''
            const inputClass = "w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono text-[var(--fg)] focus:outline-none focus:border-indigo-500"
            return (
              <div key={c.name}>
                <label className="block text-[10px] font-mono text-[var(--muted)] mb-0.5">
                  {c.name}
                  <span className="ml-1 text-[9px] opacity-60">{c.type}{hint}</span>
                </label>
                {isLarge ? (
                  <textarea
                    ref={i === 0 ? (el => { firstRef.current = el }) : undefined}
                    className={inputClass + ' h-16 resize-y'}
                    value={values[c.name]}
                    onChange={e => setValues(p => ({ ...p, [c.name]: e.target.value }))}
                    placeholder={c.nullable ? 'null' : ''}
                  />
                ) : (
                  <input
                    ref={i === 0 ? (el => { firstRef.current = el }) : undefined}
                    type="text"
                    className={inputClass}
                    value={values[c.name]}
                    onChange={e => setValues(p => ({ ...p, [c.name]: e.target.value }))}
                    placeholder={c.isPk ? 'auto' : (c.nullable ? 'null' : '')}
                  />
                )}
              </div>
            )
          })}

          {error && (
            <div className="text-[11px] font-mono text-red-400 bg-red-950/20 border border-red-800/40 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </form>

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
            type="submit"
            form="add-row-form"
            disabled={loading}
            className="px-3 py-1 text-xs font-mono bg-indigo-600 hover:bg-indigo-500 text-white rounded disabled:opacity-50"
          >
            {loading ? 'Inserting…' : 'Insert Row'}
          </button>
        </div>
      </div>
    </div>
  )
}
