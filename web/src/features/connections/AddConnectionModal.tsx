import React, { useState } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { api, type DatabaseDriver } from '../../lib/api'

export const AddConnectionModal: React.FC = () => {
  const { isAddConnOpen, setIsAddConnOpen, setConnections } = useAppStore()

  const [driver, setDriver] = useState<DatabaseDriver>('postgres')
  const [name, setName] = useState('')
  const [dsnInput, setDsnInput] = useState('')
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState('5432')
  const [db, setDb] = useState('postgres')
  const [user, setUser] = useState('postgres')
  const [password, setPassword] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isAddConnOpen) return null

  function buildDSN(): string {
    if (dsnInput.trim()) return dsnInput.trim()
    switch (driver) {
      case 'sqlite': return `file:/data/app.db`
      case 'mysql': return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@tcp(${host}:${port || 3306})/${db}`
      default: return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port || 5432}/${db}?sslmode=disable`
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.addProfile(buildDSN(), name.trim() || `${driver} DB`, '#818cf8', readOnly)
      const fresh = await api.getProfiles()
      setConnections(fresh)
      setIsAddConnOpen(false)
    } catch (err: any) {
      setError(err?.message || 'Failed to connect')
    } finally {
      setSubmitting(false)
    }
  }

  const formFieldsVisible = driver !== 'sqlite' && !dsnInput

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-sm mx-auto bg-[#16181d] rounded-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
          <span className="font-mono text-xs font-medium text-zinc-200 tracking-wide">ADD CONNECTION</span>
          <button onClick={() => setIsAddConnOpen(false)} className="text-zinc-500 hover:text-zinc-200 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={submit} className="px-3 pt-3 pb-4 space-y-3">
          {error && (
            <div className="px-2 py-1.5 bg-red-950/50 border border-red-800/50 rounded text-red-300 text-xs font-mono">
              {error}
            </div>
          )}

          {/* Driver tabs */}
          <div className="flex border border-white/[0.06] rounded overflow-hidden">
            {(['postgres', 'mysql', 'sqlite'] as const).map(d => (
              <button key={d} type="button" onClick={() => setDriver(d)}
                className={`flex-1 py-1.5 text-[11px] font-mono uppercase transition-colors ${
                  driver === d ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                }`}>
                {d}
              </button>
            ))}
          </div>

          {/* Label */}
          <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">Label</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="my-database"
            className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-white/[0.15] outline-none" />

          {/* Direct DSN */}
          {driver !== 'sqlite' && (
            <>
              <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">DSN / Connection String</label>
              <input value={dsnInput} onChange={e => setDsnInput(e.target.value)}
                placeholder={driver === 'postgres' ? 'postgres://user:pass@host:5432/db' : 'mysql://user:pass@tcp(host:3306)/db'}
                className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-white/[0.15] outline-none" />
            </>
          )}

          {/* Form fields */}
          {formFieldsVisible && (
            <>
              <div className="grid grid-cols-[1fr_80px] gap-2">
                <div>
                  <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">HOST</label>
                  <input value={host} onChange={e => setHost(e.target.value)} defaultValue="localhost"
                    className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-white/[0.15] outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">PORT</label>
                  <input value={port} onChange={e => setPort(e.target.value)} defaultValue="5432"
                    className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-white/[0.15] outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <div>
                  <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">DATABASE</label>
                  <input value={db} onChange={e => setDb(e.target.value)} defaultValue="postgres"
                    className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-white/[0.15] outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">USER</label>
                  <input value={user} onChange={e => setUser(e.target.value)} defaultValue="postgres"
                    className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-white/[0.15] outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">PASSWORD</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                  className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-white/[0.15] outline-none" />
              </div>
            </>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)}
                className="rounded border-white/[0.1] bg-[#0b0c0e] text-indigo-500 w-3.5 h-3.5 focus:ring-0" />
              <span className="text-xs text-zinc-500">Read-only</span>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setIsAddConnOpen(false)} className="btn-secondary text-xs">Cancel</button>
              <button type="submit" disabled={submitting} className="btn-primary text-xs disabled:opacity-40 min-w-[72px]">
                {submitting ? '...' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
