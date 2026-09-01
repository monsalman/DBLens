import React, { useState } from 'react'
import { X, Database } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { api, type DatabaseDriver, type ConnectionConfig } from '../../lib/api'

export const AddConnectionModal: React.FC = () => {
  const { isAddConnOpen, setIsAddConnOpen, addConnection } = useAppStore()

  const [mode, setMode] = useState<'form' | 'uri'>('form')
  const [driver, setDriver] = useState<DatabaseDriver>('postgres')
  const [name, setName] = useState('')
  const [uri, setUri] = useState('')
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState('5432')
  const [user, setUser] = useState('postgres')
  const [password, setPassword] = useState('')
  const [database, setDatabase] = useState('postgres')
  const [color, setColor] = useState('#6366f1')
  const [readOnly, setReadOnly] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

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

    const payload: Omit<ConnectionConfig, 'id'> = {
      name: name || `${driver.toUpperCase()} Connection`,
      driver,
      color,
      readOnly,
      ...(mode === 'uri' || driver === 'sqlite'
        ? { uri }
        : {
            host,
            port: parseInt(port, 10) || 5432,
            user,
            password,
            database,
          }),
    }

    try {
      const created = await api.createConnection(payload)
      addConnection(created)
      setIsAddConnOpen(false)
      // reset
      setName('')
      setPassword('')
    } finally {
      setIsSubmitting(false)
    }
  }

  const colors = ['#6366f1', '#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-zinc-800 flex items-center justify-center text-zinc-200">
              <Database className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Add New Database Connection</h2>
              <p className="text-xs text-zinc-400">Connect to PostgreSQL, MySQL, or SQLite</p>
            </div>
          </div>
          <button
            onClick={() => setIsAddConnOpen(false)}
            className="text-zinc-400 hover:text-zinc-200 p-1 rounded hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Driver Selection */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(['postgres', 'mysql', 'sqlite'] as DatabaseDriver[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => handleDriverChange(d)}
                className={`flex flex-col items-center justify-center py-2.5 px-3 rounded-lg border text-xs font-medium transition-all ${
                  driver === d
                    ? 'bg-zinc-800 border-indigo-500/80 text-zinc-100 ring-1 ring-indigo-500/50'
                    : 'bg-zinc-950/50 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                }`}
              >
                <span className="capitalize">{d === 'postgres' ? 'PostgreSQL' : d === 'mysql' ? 'MySQL' : 'SQLite'}</span>
                <span className="text-[10px] text-zinc-400 mt-0.5">
                  {d === 'postgres' ? 'Port 5432' : d === 'mysql' ? 'Port 3306' : 'Local File'}
                </span>
              </button>
            ))}
          </div>

          {/* Form / URI switch */}
          {driver !== 'sqlite' && (
            <div className="flex bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 text-xs">
              <button
                type="button"
                onClick={() => setMode('form')}
                className={`flex-1 py-1 text-center rounded font-medium transition-colors ${
                  mode === 'form' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Form Fields
              </button>
              <button
                type="button"
                onClick={() => setMode('uri')}
                className={`flex-1 py-1 text-center rounded font-medium transition-colors ${
                  mode === 'uri' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Connection URI
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Staging DB, Analytics Replica"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            {driver === 'sqlite' || mode === 'uri' ? (
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  {driver === 'sqlite' ? 'SQLite File Path / URI' : 'Database Connection URI'}
                </label>
                <input
                  type="text"
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder={
                    driver === 'sqlite'
                      ? 'file:/data/app.db or /path/to/db.sqlite'
                      : driver === 'postgres'
                      ? 'postgresql://user:password@localhost:5432/dbname?sslmode=disable'
                      : 'mysql://user:password@tcp(localhost:3306)/dbname'
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-100 focus:outline-hidden focus:border-indigo-500"
                  required
                />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                      Host
                    </label>
                    <input
                      type="text"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-100 focus:outline-hidden focus:border-indigo-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                      Port
                    </label>
                    <input
                      type="text"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-100 focus:outline-hidden focus:border-indigo-500"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                      Database
                    </label>
                    <input
                      type="text"
                      value={database}
                      onChange={(e) => setDatabase(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-100 focus:outline-hidden focus:border-indigo-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                      User
                    </label>
                    <input
                      type="text"
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-100 focus:outline-hidden focus:border-indigo-500"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-100 focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
              </>
            )}

            {/* Custom Color & Read-Only */}
            <div className="pt-2 flex items-center justify-between border-t border-zinc-800/80">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-400 mr-1">Badge:</span>
                {colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-4 h-4 rounded-full transition-transform ${
                      color === c ? 'scale-125 ring-2 ring-white/50' : 'opacity-70 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={readOnly}
                  onChange={(e) => setReadOnly(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-indigo-500 focus:ring-0"
                />
                <span>Read-Only</span>
              </label>
            </div>

            {/* Actions */}
            <div className="pt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddConnOpen(false)}
                className="px-3.5 py-1.5 rounded-lg border border-zinc-800 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                {isSubmitting ? 'Connecting...' : 'Connect Database'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
