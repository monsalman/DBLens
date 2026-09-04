import React, { useState, useEffect } from 'react'
import { X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { api, type DatabaseDriver, type ConnectionConfig, type TestConnectionResult } from '../../lib/api'

interface Props {
  isOpen?: boolean
  initialData?: ConnectionConfig | null
  onClose?: () => void
  onAdded?: (conn: ConnectionConfig) => void
  onUpdated?: (conn: ConnectionConfig) => void
}

export const AddConnectionModal: React.FC<Props> = ({ isOpen = true, initialData = null, onClose, onAdded, onUpdated }) => {
  const [driver, setDriver] = useState<DatabaseDriver>('postgres')
  const [name, setName] = useState('')
  const [dsnInput, setDsnInput] = useState('')
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState('5432')
  const [db, setDb] = useState('postgres')
  const [showAllDatabases, setShowAllDatabases] = useState(false)
  const [user, setUser] = useState('postgres')
  const [password, setPassword] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Helper to parse DSN string into form fields
  function parseDSNToFields(dsnStr: string, currentDriver: DatabaseDriver) {
    if (!dsnStr) return
    try {
      if (currentDriver === 'sqlite') return

      let str = dsnStr.trim()
      if (currentDriver === 'postgres') {
        // postgres://user:pass@host:5432/db?sslmode=disable
        if (str.startsWith('postgres://') || str.startsWith('postgresql://')) {
          const urlStr = str.replace(/^postgres(ql)?:\/\//, 'http://')
          const url = new URL(urlStr)
          if (url.hostname) setHost(url.hostname)
          if (url.port) setPort(url.port)
          if (url.username) setUser(decodeURIComponent(url.username))
          if (url.password) setPassword(decodeURIComponent(url.password))
          const pathDb = url.pathname.replace(/^\//, '')
          if (pathDb) setDb(pathDb)
        }
      } else if (currentDriver === 'mysql') {
        // mysql://user:pass@tcp(host:3306)/db
        const match = str.match(/^mysql:\/\/(?:([^:]+)(?::([^@]*))?@)?tcp\(([^:]+):(\d+)\)\/(.*)$/)
        if (match) {
          const [, u, p, h, pt, d] = match
          if (u !== undefined) setUser(decodeURIComponent(u))
          if (p !== undefined) setPassword(decodeURIComponent(p))
          if (h) setHost(h)
          if (pt) setPort(pt)
          if (d !== undefined) setDb(d)
        } else {
          // fallback standard URL attempt: mysql://user:pass@host:3306/db
          if (str.startsWith('mysql://')) {
            const urlStr = str.replace(/^mysql:\/\//, 'http://')
            const url = new URL(urlStr)
            if (url.hostname) setHost(url.hostname)
            if (url.port) setPort(url.port)
            if (url.username) setUser(decodeURIComponent(url.username))
            if (url.password) setPassword(decodeURIComponent(url.password))
            const pathDb = url.pathname.replace(/^\//, '')
            if (pathDb) setDb(pathDb)
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  useEffect(() => {
    if (initialData) {
      setName(initialData.label || initialData.name || '')
      setDsnInput(initialData.dsn || '')
      setReadOnly(!!initialData.readOnly)
      const d = initialData.driver || 'postgres'
      setDriver(d)
      if (d === 'mysql') {
        setPort('3306')
        setUser('root')
      } else if (d === 'postgres') {
        setPort('5432')
        setUser('postgres')
      }
      if (initialData.dsn) {
        parseDSNToFields(initialData.dsn, d)
      }
    } else {
      setName('')
      setDsnInput('')
      setReadOnly(false)
      setDriver('postgres')
      setHost('localhost')
      setPort('5432')
      setUser('postgres')
      setDb('postgres')
      setPassword('')
      setShowAllDatabases(false)
    }
    setTestResult(null)
    setError(null)
  }, [initialData, isOpen])

  const handleDriverChange = (newDriver: DatabaseDriver) => {
    setDriver(newDriver)
    if (newDriver === 'mysql') {
      if (port === '5432' || !port) setPort('3306')
      if (user === 'postgres' || !user) setUser('root')
      if (db === 'postgres') setDb('')
    } else if (newDriver === 'postgres') {
      if (port === '3306' || !port) setPort('5432')
      if (user === 'root' || !user) setUser('postgres')
      if (!db) setDb('postgres')
    }
  }

  if (!isOpen) return null

  function buildDSN(): string {
    if (dsnInput.trim()) return dsnInput.trim()
    switch (driver) {
      case 'sqlite':
        return `file:/data/app.db`
      case 'mysql': {
        const targetDb = showAllDatabases ? (db.trim() || 'mysql') : db.trim()
        const dbPath = targetDb ? `/${targetDb}` : ''
        return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@tcp(${host}:${port || 3306})${dbPath}`
      }
      default: {
        const targetDb = showAllDatabases ? (db.trim() || 'postgres') : db.trim()
        return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port || 5432}/${targetDb}?sslmode=disable`
      }
    }
  }

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const res = await api.testConnection(buildDSN(), name.trim() || `${driver} DB`)
      setTestResult(res)
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || 'Connection test failed',
      })
    } finally {
      setTesting(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const label = name.trim() || `${driver} DB`
      const dsn = buildDSN()
      if (initialData) {
        const conn = await api.updateProfile(initialData.id, dsn, label, initialData.color || '#6366f1', readOnly)
        if (onUpdated) onUpdated(conn)
      } else {
        const conn = await api.addProfile(dsn, label, '#6366f1', readOnly)
        if (onAdded) onAdded(conn)
      }
      if (onClose) onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to save connection')
    } finally {
      setSubmitting(false)
    }
  }

  const useFormMode = driver !== 'sqlite' && !dsnInput.trim()

  return (
    <div className="modal-overlay">
      <div className="modal-content w-full max-w-lg overflow-hidden p-5 bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
          <span className="font-mono text-xs font-medium text-[var(--fg)] tracking-wide">
            {initialData ? 'EDIT CONNECTION' : 'ADD CONNECTION'}
          </span>
          {onClose && (
            <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--fg)] p-1 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <form onSubmit={submit} className="pt-4 space-y-4">
          {error && (
            <div className="px-3 py-2 bg-red-950/40 border border-red-800/40 rounded text-red-400 text-xs font-mono">
              {error}
            </div>
          )}

          {testResult && (
            <div className={`p-3 rounded border text-xs font-mono flex items-start gap-2 ${
              testResult.success
                ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-800/40 dark:text-emerald-300 bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-950/40 border-red-800/40 text-red-300 dark:bg-red-950/40 dark:border-red-800/40 dark:text-red-300 bg-red-50 border-red-200 text-red-800'
            }`}>
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center justify-between gap-2 font-semibold">
                  <span>{testResult.success ? 'Connection Successful' : 'Connection Failed'}</span>
                  {testResult.dialect && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      {testResult.dialect}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[11px] break-words opacity-90">{testResult.message}</div>
              </div>
            </div>
          )}

          {/* Driver tabs */}
          <div className="flex border border-[var(--border)] rounded overflow-hidden p-0.5 bg-[var(--bg)]">
            {(['postgres', 'mysql', 'sqlite'] as const).map(d => (
              <button key={d} type="button" onClick={() => handleDriverChange(d)}
                className={`flex-1 py-1.5 text-[11px] font-mono uppercase transition-colors rounded ${
                  driver === d ? 'bg-[var(--active)] text-[var(--fg)] font-semibold shadow-xs' : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}>
                {d}
              </button>
            ))}
          </div>

          {/* Direct DSN input */}
          <div>
            <label className="form-label text-[var(--muted)]">
              {driver === 'sqlite' ? 'SQLite Path' : 'DSN / Connection String (Optional)'}
            </label>
            <input value={dsnInput} onChange={e => setDsnInput(e.target.value)}
              placeholder={driver === 'sqlite' ? '/path/to/file.db'
                : driver === 'postgres' ? 'postgres://user:pass@host:5432/db'
                : 'mysql://user:pass@tcp(host:3306)/db'}
              className="form-input text-xs font-mono bg-[var(--surface)] text-[var(--fg)] border-[var(--border)]" />
          </div>

          {/* Form fields for Postgres and MySQL */}
          {useFormMode && (
            <div className="space-y-3.5 pt-1">
              <div>
                <label className="form-label text-[var(--muted)]">Label</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="my-database"
                  className="form-input text-xs font-mono bg-[var(--surface)] text-[var(--fg)] border-[var(--border)]" />
              </div>

              {/* Row 1: HOST (left) and PORT (right) */}
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <div>
                  <label className="form-label text-[var(--muted)]">HOST</label>
                  <input value={host} onChange={e => setHost(e.target.value)}
                    placeholder="localhost"
                    className="form-input text-xs font-mono bg-[var(--surface)] text-[var(--fg)] border-[var(--border)]" />
                </div>
                <div>
                  <label className="form-label text-[var(--muted)]">PORT</label>
                  <input value={port} onChange={e => setPort(e.target.value)}
                    placeholder={driver === 'mysql' ? '3306' : '5432'}
                    className="form-input text-xs font-mono bg-[var(--surface)] text-[var(--fg)] border-[var(--border)]" />
                </div>
              </div>

              {/* Row 2: USER / USERNAME (left), DATABASE (center-right), and "Show all databases" checkbox (far-right) */}
              <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
                <div>
                  <label className="form-label text-[var(--muted)]">USER / USERNAME</label>
                  <input value={user} onChange={e => setUser(e.target.value)}
                    placeholder={driver === 'mysql' ? 'root' : 'postgres'}
                    className="form-input text-xs font-mono bg-[var(--surface)] text-[var(--fg)] border-[var(--border)]" />
                </div>
                <div>
                  <label className={`form-label transition-colors ${showAllDatabases ? 'text-[var(--muted)] opacity-50' : 'text-[var(--muted)]'}`}>
                    DATABASE
                  </label>
                  <input
                    id="modal-db-name"
                    value={db}
                    onChange={e => setDb(e.target.value)}
                    disabled={showAllDatabases}
                    placeholder={showAllDatabases ? '(All databases)' : (driver === 'postgres' ? 'postgres' : 'my_db')}
                    className={`form-input text-xs font-mono transition-all bg-[var(--surface)] text-[var(--fg)] border-[var(--border)] ${
                      showAllDatabases
                        ? 'opacity-40 bg-[var(--bg)] cursor-not-allowed border-[var(--border)]'
                        : ''
                    }`}
                  />
                </div>
                <div className="pb-2">
                  <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap select-none">
                    <input
                      id="show-all-dbs-modal"
                      type="checkbox"
                      checked={showAllDatabases}
                      onChange={e => setShowAllDatabases(e.target.checked)}
                      className="rounded border-[var(--border)] bg-[var(--surface)] accent-[var(--fg)] w-3.5 h-3.5 focus:ring-0 cursor-pointer"
                    />
                    <span className="text-xs text-[var(--muted)]">Show all databases</span>
                  </label>
                </div>
              </div>

              {/* Row 3: PASSWORD input field */}
              <div>
                <label className="form-label text-[var(--muted)]">PASSWORD</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                  className="form-input text-xs font-mono bg-[var(--surface)] text-[var(--fg)] border-[var(--border)]" />
              </div>
            </div>
          )}

          {/* Modal Footer & Styling */}
          <div className="flex items-center justify-between pt-4 border-t border-[var(--border)] mt-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)}
                className="rounded border-[var(--border)] bg-[var(--surface)] accent-[var(--fg)] w-3.5 h-3.5 focus:ring-0 cursor-pointer" />
              <span className="text-xs text-[var(--muted)]">Read-only</span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing || submitting}
                className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40"
              >
                {testing && <Loader2 className="w-3 h-3 animate-spin" />}
                <span>{testing ? 'Testing...' : 'Test Connection'}</span>
              </button>
              {onClose && (
                <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancel</button>
              )}
              <button type="submit" disabled={submitting || testing} className="btn-primary text-xs disabled:opacity-40 min-w-[72px]">
                {submitting ? '...' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

