import React, { useState } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { api, type DatabaseDriver } from '../../lib/api'

export const AddConnectionModal: React.FC = () => {
  const { isAddConnOpen, setIsAddConnOpen, setConnections } = useAppStore()

  const [mode, setMode] = useState<'form' | 'uri'>('form')
  const [driver, setDriver] = useState<DatabaseDriver>('postgres')
  const [name, setName] = useState('')
  const [uri, setUri] = useState('')
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState('5432')
  const [user, setUser] = useState('postgres')
  const [password, setPassword] = useState('')
  const [database, setDatabase] = useState('postgres')
  const [color, setColor] = useState('#818cf8')
  const [readOnly, setReadOnly] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isAddConnOpen) return null

  const handleDriverChange = (d: DatabaseDriver) => {
    setDriver(d)
    if (d === 'postgres') {
      setPort('5432')
      setUser('postgres')
      setDatabase('postgres')
    } else if (d === 'mysql') {
      setPort('3306')
      setUser('root')
      setDatabase('mydb')
    } else if (d === 'sqlite') {
      setUri('file:/data/app.db')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    let dsn = uri
    if (mode === 'form' && driver !== 'sqlite') {
      if (driver === 'postgres') {
        const auth = password ? `${user}:${encodeURIComponent(password)}` : user
        dsn = `postgres://${auth}@${host}:${port || 5432}/${database}?sslmode=disable`
      } else if (driver === 'mysql') {
        const auth = password ? `${user}:${encodeURIComponent(password)}` : user
        dsn = `mysql://${auth}@tcp(${host}:${port || 3306})/${database}`
      }
    }

    try {
      await api.addProfile(dsn, name || `${driver.toUpperCase()} Connection`, color, readOnly)
      const freshProfiles = await api.getProfiles()
      setConnections(freshProfiles)
      setIsAddConnOpen(false)
      setName('')
      setPassword('')
    } catch (err: any) {
      setError(err?.message || 'Failed to save connection')
    } finally {
      setIsSubmitting(false)
    }
  }

  const colors = ['#818cf8', '#34d399', '#60a5fa', '#fbbf24', '#f472b6', '#a78bfa', '#f87171']

  return (
    <div className="modal-overlay p-4">
      <div className="modal-content w-full max-w-md bg-[#16181d] border border-white/[0.08] rounded-md p-4 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
          <span className="font-mono text-xs font-semibold text-zinc-100 uppercase tracking-wide">
            Add Connection
          </span>
          <button
            onClick={() => setIsAddConnOpen(false)}
            className="text-zinc-500 hover:text-zinc-300 p-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-2 rounded bg-red-950/40 border border-red-800/40 text-red-300 text-xs font-mono">
            {error}
          </div>
        )}

        {/* Driver Selection */}
        <div className="grid grid-cols-3 gap-1.5">
          {(['postgres', 'mysql', 'sqlite'] as DatabaseDriver[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => handleDriverChange(d)}
              className={`py-1 px-2 rounded border text-xs font-mono capitalize transition-colors ${
                driver === d
                  ? 'bg-white/[0.08] border-white/[0.15] text-zinc-100'
                  : 'bg-transparent border-white/[0.04] text-zinc-400 hover:bg-white/[0.02]'
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        {/* Mode switcher */}
        {driver !== 'sqlite' && (
          <div className="flex border border-white/[0.06] rounded p-0.5 text-xs font-mono">
            <button
              type="button"
              onClick={() => setMode('form')}
              className={`flex-1 py-0.5 rounded text-center transition-colors ${
                mode === 'form' ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Form
            </button>
            <button
              type="button"
              onClick={() => setMode('uri')}
              className={`flex-1 py-0.5 rounded text-center transition-colors ${
                mode === 'uri' ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              URI / DSN
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-2.5">
          <div>
            <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">Label</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production DB"
              className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2.5 py-1 text-xs text-zinc-200 focus:border-white/[0.15] outline-none font-mono"
            />
          </div>

          {driver === 'sqlite' || mode === 'uri' ? (
            <div>
              <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">
                {driver === 'sqlite' ? 'SQLite DSN' : 'Connection DSN / URI'}
              </label>
              <input
                type="text"
                value={uri}
                onChange={(e) => setUri(e.target.value)}
                placeholder={
                  driver === 'sqlite'
                    ? 'file:/data/app.db'
                    : driver === 'postgres'
                    ? 'postgres://user:pass@localhost:5432/db'
                    : 'mysql://user:pass@tcp(localhost:3306)/db'
                }
                className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2.5 py-1 text-xs font-mono text-zinc-200 focus:border-white/[0.15] outline-none"
                required
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">Host</label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-white/[0.15] outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">Port</label>
                  <input
                    type="text"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-white/[0.15] outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">Database</label>
                  <input
                    type="text"
                    value={database}
                    onChange={(e) => setDatabase(e.target.value)}
                    className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-white/[0.15] outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">User</label>
                  <input
                    type="text"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-white/[0.15] outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase text-zinc-500 font-semibold mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#0b0c0e] border border-white/[0.06] rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-white/[0.15] outline-none"
                />
              </div>
            </>
          )}

          <div className="pt-2 flex items-center justify-between border-t border-white/[0.06]">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase font-semibold">Dot:</span>
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-3 h-3 rounded-full ${
                    color === c ? 'ring-1 ring-white/80' : 'opacity-60 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>

            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-zinc-400 font-mono">
              <input
                type="checkbox"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
                className="rounded border-white/[0.1] bg-[#0b0c0e] text-indigo-500 focus:ring-0 w-3 h-3"
              />
              <span>Read-only</span>
            </label>
          </div>

          <div className="pt-2 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setIsAddConnOpen(false)}
              className="btn-secondary px-3 py-1 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary px-3 py-1 text-xs disabled:opacity-40"
            >
              {isSubmitting ? 'Saving...' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
