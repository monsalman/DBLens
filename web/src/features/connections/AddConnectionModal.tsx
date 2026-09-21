import React, { useState, useEffect } from 'react'
import { X, CheckCircle2, AlertCircle, Loader2, Shield, Key, Lock, Terminal } from 'lucide-react'
import {
  api,
  type DatabaseDriver,
  type ConnectionConfig,
  type TestConnectionResult,
  type SSHTunnelConfig,
  type TunnelTestResult,
} from '../../lib/api'
import { defaultTunnelConfig, validateTunnelConfig } from './tunnelHelper'

interface Props {
  isOpen?: boolean
  initialData?: ConnectionConfig | null
  onClose?: () => void
  onAdded?: (conn: ConnectionConfig) => void
  onUpdated?: (conn: ConnectionConfig) => void
}

export const AddConnectionModal: React.FC<Props> = ({ isOpen = true, initialData = null, onClose, onAdded, onUpdated }) => {
  const [modalTab, setModalTab] = useState<'general' | 'ssh'>('general')
  const [driver, setDriver] = useState<DatabaseDriver>('postgres')
  const [name, setName] = useState('')
  const [dsnInput, setDsnInput] = useState('')
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState('5432')
  const [db, setDb] = useState('postgres')
  const [showAllDatabases, setShowAllDatabases] = useState(false)
  const [user, setUser] = useState('postgres')
  const [password, setPassword] = useState('')
  const [environment, setEnvironment] = useState<'production' | 'staging' | 'development' | 'local'>('development')
  const [readOnly, setReadOnly] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // SSH Bastion Tunnel State
  const [sshTunnel, setSshTunnel] = useState<SSHTunnelConfig>(defaultTunnelConfig())
  const [testingTunnel, setTestingTunnel] = useState(false)
  const [tunnelTestResult, setTunnelTestResult] = useState<TunnelTestResult | null>(null)

  // Helper to parse DSN string into form fields
  function parseDSNToFields(dsnStr: string, currentDriver: DatabaseDriver) {
    if (!dsnStr) return
    try {
      if (currentDriver === 'sqlite') return

      let str = dsnStr.trim()
      if (currentDriver === 'postgres') {
        // postgres://user:***@host:5432/db?sslmode=disable
        if (str.startsWith('postgres://') || str.startsWith('postgresql://')) {
          const urlStr = str.replace(/^postgres(ql)?:\/\//, 'http://')
          const url = new URL(urlStr)
          if (url.hostname) setHost(url.hostname)
          if (url.port) setPort(url.port)
          if (url.username) setUser(decodeURIComponent(url.username))
          if (url.password) {
            const p = decodeURIComponent(url.password)
            setPassword(p === '***' ? '' : p)
          }
          const pathDb = url.pathname.replace(/^\//, '')
          if (pathDb) setDb(pathDb)
        }
      } else if (currentDriver === 'mysql') {
        // mysql://user:***@tcp(host:3306)/db or user:***@tcp(host:3306)/db
        const match = str.match(/^(?:mysql:\/\/)?(?:([^:]+)(?::([^@]*))?@)?tcp\(([^:]+):(\d+)\)(?:\/([^?]*))?/)
        if (match) {
          const [, u, p, h, pt, d] = match
          if (u !== undefined) setUser(decodeURIComponent(u))
          if (p !== undefined) {
            const decodedPass = decodeURIComponent(p)
            setPassword(decodedPass === '***' ? '' : decodedPass)
          }
          if (h) setHost(h)
          if (pt) setPort(pt)
          if (d !== undefined) setDb(d)
        } else {
          // fallback standard URL attempt: mysql://user:***@host:3306/db
          if (str.startsWith('mysql://')) {
            const urlStr = str.replace(/^mysql:\/\//, 'http://')
            const url = new URL(urlStr)
            if (url.hostname) setHost(url.hostname)
            if (url.port) setPort(url.port)
            if (url.username) setUser(decodeURIComponent(url.username))
            if (url.password) {
              const p = decodeURIComponent(url.password)
              setPassword(p === '***' ? '' : p)
            }
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
      setEnvironment(initialData.environment || 'development')
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
      if (initialData.ssh_tunnel) {
        setSshTunnel({ ...defaultTunnelConfig(), ...initialData.ssh_tunnel })
      } else {
        setSshTunnel(defaultTunnelConfig())
      }
    } else {
      setName('')
      setDsnInput('')
      setReadOnly(false)
      setEnvironment('development')
      setDriver('postgres')
      setHost('localhost')
      setPort('5432')
      setUser('postgres')
      setDb('postgres')
      setPassword('')
      setShowAllDatabases(false)
      setSshTunnel(defaultTunnelConfig())
    }
    setModalTab('general')
    setTestResult(null)
    setTunnelTestResult(null)
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
    if (newDriver === 'sqlite' && sshTunnel.enabled) {
      setSshTunnel(prev => ({ ...prev, enabled: false }))
    }
  }

  if (!isOpen) return null

  function buildDSN(): string {
    if (dsnInput.trim()) return dsnInput.trim()
    const auth = user ? `${encodeURIComponent(user)}${password ? `:${encodeURIComponent(password)}` : ''}@` : ''
    switch (driver) {
      case 'sqlite':
        return `file:/data/app.db`
      case 'mysql': {
        const targetDb = showAllDatabases ? (db.trim() || 'mysql') : db.trim()
        const dbPath = targetDb ? `/${targetDb}` : ''
        return `mysql://${auth}tcp(${host}:${port || 3306})${dbPath}`
      }
      default: {
        const targetDb = showAllDatabases ? (db.trim() || 'postgres') : db.trim()
        return `postgres://${auth}${host}:${port || 5432}/${targetDb}?sslmode=disable`
      }
    }
  }

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const activeTunnel = (sshTunnel.enabled && driver !== 'sqlite') ? sshTunnel : undefined
      const res = await api.testConnection(buildDSN(), name.trim() || `${driver} DB`, activeTunnel)
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

  async function handleTestSSHTunnel() {
    const val = validateTunnelConfig({ ...sshTunnel, enabled: true })
    if (!val.valid) {
      setTunnelTestResult({
        success: false,
        message: val.errors.join('. '),
      })
      return
    }

    setTestingTunnel(true)
    setTunnelTestResult(null)
    try {
      const res = await api.testSSHTunnel(sshTunnel)
      setTunnelTestResult(res)
    } catch (err: any) {
      setTunnelTestResult({
        success: false,
        message: err?.message || 'SSH tunnel test failed',
      })
    } finally {
      setTestingTunnel(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const activeTunnel = (sshTunnel.enabled && driver !== 'sqlite') ? sshTunnel : undefined
    if (activeTunnel) {
      const val = validateTunnelConfig(activeTunnel)
      if (!val.valid) {
        setError(val.errors.join('. '))
        setModalTab('ssh')
        return
      }
    }

    setSubmitting(true)
    try {
      const label = name.trim() || `${driver} DB`
      const dsn = buildDSN()
      if (initialData) {
        const conn = await api.updateProfile(
          initialData.id,
          dsn,
          label,
          initialData.color || '#6366f1',
          readOnly,
          environment,
          activeTunnel
        )
        setTestResult({ success: true, message: 'Updated successfully', dialect: conn.dialect })
        if (onUpdated) onUpdated(conn)
      } else {
        const conn = await api.addProfile(
          dsn,
          label,
          '#6366f1',
          readOnly,
          environment,
          activeTunnel
        )
        setTestResult({ success: true, message: 'Connection successful', dialect: conn.dialect })
        if (onAdded) onAdded(conn)
      }
      if (onClose) onClose()
    } catch (err: any) {
      const msg = err?.message || 'Failed to save connection'
      setError(msg)
      setTestResult({ success: false, message: msg })
    } finally {
      setSubmitting(false)
    }
  }

  const useFormMode = driver !== 'sqlite' && !dsnInput.trim()

  return (
    <div className="modal-overlay">
      <div className="modal-content w-full max-w-lg overflow-hidden p-5 bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] shadow-xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[var(--border)] shrink-0">
          <span className="font-mono text-xs font-medium text-[var(--fg)] tracking-wide">
            {initialData ? 'EDIT CONNECTION' : 'ADD CONNECTION'}
          </span>
          {onClose && (
            <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--fg)] p-1 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-[var(--border)] pt-2.5 pb-0 gap-5 text-xs font-mono shrink-0">
          <button
            type="button"
            onClick={() => setModalTab('general')}
            className={`pb-2 font-medium border-b-2 -mb-px transition-colors ${
              modalTab === 'general'
                ? 'border-[var(--fg)] text-[var(--fg)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            General
          </button>
          <button
            type="button"
            onClick={() => setModalTab('ssh')}
            className={`pb-2 font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
              modalTab === 'ssh'
                ? 'border-[var(--fg)] text-[var(--fg)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>SSH Tunnel</span>
            {sshTunnel.enabled && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            )}
          </button>
        </div>

        <form onSubmit={submit} className="pt-3 space-y-4 overflow-y-auto flex-1 pr-0.5">
          {error && (
            <div className="px-3 py-2.5 bg-[#ef4444] border-2 border-[#fca5a5] rounded-md text-white font-bold text-xs font-mono shadow-md">
              {error}
            </div>
          )}

          {testResult && (
            <div className={`p-3 rounded-md border-2 text-xs font-mono flex items-start gap-2.5 shadow-md ${
              testResult.success
                ? 'bg-[#22c55e] border-[#86efac] text-slate-950 font-semibold'
                : 'bg-[#ef4444] border-[#fca5a5] text-white font-semibold'
            }`}>
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-slate-950 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-white shrink-0 mt-0.5" />
              )}
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center justify-between gap-2 font-bold">
                  <span>{testResult.success ? 'Connection Successful' : 'Connection Failed'}</span>
                  {testResult.dialect && (
                    <span className={`px-1.5 py-0.5 text-[10px] rounded uppercase tracking-wider font-bold border ${
                      testResult.success 
                        ? 'bg-black/20 text-slate-950 border-black/20' 
                        : 'bg-black/30 text-white border-white/20'
                    }`}>
                      {testResult.dialect}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[11px] break-words font-medium opacity-95">{testResult.message}</div>
              </div>
            </div>
          )}

          {modalTab === 'general' ? (
            <div className="space-y-4">
              {/* Environment selector */}
              <div>
                <label className="form-label text-[var(--muted)] mb-1.5 block text-xs">
                  ENVIRONMENT
                </label>
                <div className="grid grid-cols-4 gap-1.5 p-1 rounded border border-[var(--border)] bg-[var(--bg)]">
                  {(
                    [
                      { id: 'production', label: 'Production', active: 'bg-red-500 text-white font-semibold' },
                      { id: 'staging', label: 'Staging', active: 'bg-amber-500 text-slate-950 font-semibold' },
                      { id: 'development', label: 'Development', active: 'bg-blue-500 text-white font-semibold' },
                      { id: 'local', label: 'Local', active: 'bg-slate-600 text-white font-semibold' },
                    ] as const
                  ).map((env) => (
                    <button
                      key={env.id}
                      type="button"
                      onClick={() => {
                        setEnvironment(env.id)
                        if (env.id === 'production') {
                          setReadOnly(true)
                        }
                      }}
                      className={`py-1 text-[11px] font-mono rounded uppercase transition-colors text-center ${
                        environment === env.id
                          ? `${env.active} shadow-xs`
                          : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                      }`}
                    >
                      {env.label}
                    </button>
                  ))}
                </div>
                {environment === 'production' && (
                  <p className="text-[11px] text-red-500 mt-1 font-mono">
                    Production environment: Read-only protection recommended.
                  </p>
                )}
              </div>

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
                    : driver === 'postgres' ? 'postgres://user:***@host:5432/db'
                    : 'mysql://user:***@tcp(host:3306)/db'}
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
            </div>
          ) : (
            /* SSH Tunnel Tab */
            <div className="space-y-4">
              {/* Enable toggle */}
              <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]/60 space-y-1">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sshTunnel.enabled}
                    disabled={driver === 'sqlite'}
                    onChange={e => setSshTunnel(prev => ({ ...prev, enabled: e.target.checked }))}
                    className="mt-0.5 rounded border-[var(--border)] bg-[var(--surface)] accent-[var(--fg)] w-4 h-4 cursor-pointer disabled:opacity-40"
                  />
                  <div>
                    <span className="text-xs font-semibold text-[var(--fg)]">Use SSH Bastion Tunnel</span>
                    <p className="text-[11px] text-[var(--muted)] mt-0.5">
                      Connect to private cloud VPCs or firewalled DB instances through an intermediate SSH jump host.
                    </p>
                  </div>
                </label>
                {driver === 'sqlite' && (
                  <p className="text-[11px] text-amber-500 font-mono pl-6.5 pt-1">
                    SQLite is a local embedded file engine and does not support SSH tunneling.
                  </p>
                )}
              </div>

              {/* SSH Test Result Banner */}
              {tunnelTestResult && (
                <div className={`p-3 rounded-md border text-xs font-mono flex items-start gap-2.5 shadow-sm ${
                  tunnelTestResult.success
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
                }`}>
                  {tunnelTestResult.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center justify-between gap-2 font-bold">
                      <span>{tunnelTestResult.success ? 'SSH Bastion Reachable' : 'SSH Connection Failed'}</span>
                      {tunnelTestResult.latency_ms !== undefined && tunnelTestResult.latency_ms >= 0 && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/20 font-mono">
                          {tunnelTestResult.latency_ms}ms
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] break-words">{tunnelTestResult.message}</div>
                    {tunnelTestResult.banner && (
                      <div className="mt-1 text-[10px] opacity-75 font-mono">{tunnelTestResult.banner}</div>
                    )}
                  </div>
                </div>
              )}

              {sshTunnel.enabled && (
                <div className="space-y-3.5 pt-1">
                  {/* Bastion Host & Port */}
                  <div className="grid grid-cols-[1fr_120px] gap-3">
                    <div>
                      <label className="form-label text-[var(--muted)]">BASTION HOST</label>
                      <input
                        value={sshTunnel.host}
                        onChange={e => setSshTunnel(prev => ({ ...prev, host: e.target.value }))}
                        placeholder="bastion.example.com or 54.x.x.x"
                        className="form-input text-xs font-mono bg-[var(--surface)] text-[var(--fg)] border-[var(--border)]"
                      />
                    </div>
                    <div>
                      <label className="form-label text-[var(--muted)]">PORT</label>
                      <input
                        type="number"
                        value={sshTunnel.port || 22}
                        onChange={e => setSshTunnel(prev => ({ ...prev, port: parseInt(e.target.value, 10) || 22 }))}
                        placeholder="22"
                        className="form-input text-xs font-mono bg-[var(--surface)] text-[var(--fg)] border-[var(--border)]"
                      />
                    </div>
                  </div>

                  {/* Bastion User */}
                  <div>
                    <label className="form-label text-[var(--muted)]">BASTION USER</label>
                    <input
                      value={sshTunnel.user}
                      onChange={e => setSshTunnel(prev => ({ ...prev, user: e.target.value }))}
                      placeholder="ubuntu, ec2-user, or root"
                      className="form-input text-xs font-mono bg-[var(--surface)] text-[var(--fg)] border-[var(--border)]"
                    />
                  </div>

                  {/* Auth Method Selector */}
                  <div>
                    <label className="form-label text-[var(--muted)] mb-1.5 block">AUTHENTICATION METHOD</label>
                    <div className="grid grid-cols-3 gap-1.5 p-1 rounded border border-[var(--border)] bg-[var(--bg)]">
                      {(
                        [
                          { id: 'key', label: 'Private Key', icon: Key },
                          { id: 'password', label: 'Password', icon: Lock },
                          { id: 'agent', label: 'SSH Agent', icon: Terminal },
                        ] as const
                      ).map(method => {
                        const Icon = method.icon
                        const isSelected = (sshTunnel.auth_method || 'key') === method.id
                        return (
                          <button
                            key={method.id}
                            type="button"
                            onClick={() => setSshTunnel(prev => ({ ...prev, auth_method: method.id }))}
                            className={`py-1.5 text-[11px] font-mono rounded flex items-center justify-center gap-1.5 transition-colors ${
                              isSelected
                                ? 'bg-[var(--active)] text-[var(--fg)] font-semibold shadow-xs'
                                : 'text-[var(--muted)] hover:text-[var(--fg)]'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{method.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Dynamic Auth Inputs */}
                  {(sshTunnel.auth_method === 'key' || !sshTunnel.auth_method) && (
                    <div className="space-y-2.5">
                      <div>
                        <label className="form-label text-[var(--muted)]">PRIVATE KEY (PEM / OPENSSH)</label>
                        <textarea
                          rows={4}
                          value={sshTunnel.private_key || ''}
                          onChange={e => setSshTunnel(prev => ({ ...prev, private_key: e.target.value }))}
                          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                          className="form-input text-xs font-mono bg-[var(--surface)] text-[var(--fg)] border-[var(--border)] resize-none"
                        />
                      </div>
                      <div>
                        <label className="form-label text-[var(--muted)]">KEY PASSPHRASE (OPTIONAL)</label>
                        <input
                          type="password"
                          value={sshTunnel.passphrase || ''}
                          onChange={e => setSshTunnel(prev => ({ ...prev, passphrase: e.target.value }))}
                          placeholder="Passphrase if key is encrypted"
                          className="form-input text-xs font-mono bg-[var(--surface)] text-[var(--fg)] border-[var(--border)]"
                        />
                      </div>
                    </div>
                  )}

                  {sshTunnel.auth_method === 'password' && (
                    <div>
                      <label className="form-label text-[var(--muted)]">BASTION PASSWORD</label>
                      <input
                        type="password"
                        value={sshTunnel.password || ''}
                        onChange={e => setSshTunnel(prev => ({ ...prev, password: e.target.value }))}
                        placeholder="••••••••"
                        className="form-input text-xs font-mono bg-[var(--surface)] text-[var(--fg)] border-[var(--border)]"
                      />
                    </div>
                  )}

                  {sshTunnel.auth_method === 'agent' && (
                    <div className="p-3 rounded border border-[var(--border)] bg-[var(--bg)] text-xs font-mono text-[var(--muted)] flex items-start gap-2">
                      <Terminal className="w-4 h-4 text-[var(--fg)] shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-[var(--fg)]">Native SSH Agent Socket</p>
                        <p className="text-[11px] mt-0.5">
                          DBLens will query your local <code className="text-[var(--fg)]">$SSH_AUTH_SOCK</code> UNIX domain socket
                          for active signers. Ensure your key is loaded via <code className="text-[var(--fg)]">ssh-add</code>.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Test Tunnel Action */}
                  <div className="pt-1 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={handleTestSSHTunnel}
                      disabled={testingTunnel || !sshTunnel.host.trim()}
                      className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40"
                    >
                      {testingTunnel && <Loader2 className="w-3 h-3 animate-spin" />}
                      <Shield className="w-3.5 h-3.5" />
                      <span>{testingTunnel ? 'Testing Bastion...' : 'Test SSH Tunnel'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Modal Footer & Styling */}
          <div className="flex items-center justify-between pt-4 border-t border-[var(--border)] mt-4 shrink-0">
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
