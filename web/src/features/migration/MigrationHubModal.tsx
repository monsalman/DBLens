import React, { useState, useEffect, useMemo, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  X,
  GitBranch,
  Clock,
  Plus,
  History,
  RotateCcw,
  Copy,
  Check,
  Download,
  Search,
  Play,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  FileCode2,
  Layers,
  ChevronDown,
  ChevronRight,
  Shield,
} from 'lucide-react'
import {
  api,
  type MigrationRecord,
  type MigrationFormat,
  type MigrationFile,
} from '../../lib/api'
import {
  MIGRATION_FORMATS,
  sanitizeMigrationSlug,
  formatTimestampVersion,
  validateMigrationInput,
  formatMigrationFiles,
  filterMigrations,
  formatExecutionDuration,
  calculateMigrationStats,
} from './migrationHelper'
import { useAppStore } from '../../stores/appStore'

interface Props {
  isOpen?: boolean
  onClose?: () => void
}

export const MigrationHubModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const storeIsOpen = useAppStore((s) => s.isMigrationModalOpen)
  const setStoreIsOpen = useAppStore((s) => s.setIsMigrationModalOpen)
  const activeConnId = useAppStore((s) => s.activeConnectionId)
  const connections = useAppStore((s) => s.connections)
  const show = isOpen !== undefined ? isOpen : storeIsOpen
  const handleClose = () => {
    if (onClose) onClose()
    else setStoreIsOpen(false)
  }

  const isDark = typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true

  const activeConn = useMemo(
    () => connections.find((c) => c.id === activeConnId),
    [connections, activeConnId]
  )
  const isReadOnly = Boolean(activeConn?.readOnly)

  // Tabs
  const [activeTab, setActiveTab] = useState<'timeline' | 'new' | 'history'>('timeline')

  // Migration data
  const [migrations, setMigrations] = useState<MigrationRecord[]>([])
  const [isInitialized, setIsInitialized] = useState<boolean>(true)
  const [dialect, setDialect] = useState<string>('postgres')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  // Search / filter for history
  const [searchQuery, setSearchQuery] = useState<string>('')

  // New Migration form state
  const [name, setName] = useState<string>('')
  const [version, setVersion] = useState<string>(formatTimestampVersion())
  const [format, setFormat] = useState<MigrationFormat>('goose')
  const [upSql, setUpSql] = useState<string>(
    '-- Write DDL/DML migration to apply\nCREATE TABLE example_items (\n  id SERIAL PRIMARY KEY,\n  title VARCHAR(255) NOT NULL,\n  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP\n);'
  )
  const [downSql, setDownSql] = useState<string>(
    '-- Write reversible rollback DDL\nDROP TABLE IF EXISTS example_items;'
  )
  const [activePreviewFileIdx, setActivePreviewFileIdx] = useState<number>(0)
  const [applying, setApplying] = useState<boolean>(false)
  const [copiedFile, setCopiedFile] = useState<string | null>(null)

  // Rollback state
  const [rollbackCandidate, setRollbackCandidate] = useState<MigrationRecord | null>(null)
  const [rollingBack, setRollingBack] = useState<boolean>(false)

  // Expanded items in timeline
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Inspect drawer/dialog
  const [inspectRecord, setInspectRecord] = useState<MigrationRecord | null>(null)
  const [inspectTab, setInspectTab] = useState<'up' | 'down'>('up')

  // Fetch migrations from backend
  const loadMigrations = useCallback(async () => {
    if (!activeConnId) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.getMigrations(activeConnId, connections)
      setMigrations(res.migrations || [])
      setIsInitialized(res.initialized)
      if (res.dialect) setDialect(res.dialect)
    } catch (err: any) {
      setError(err.message || 'Failed to load migrations')
    } finally {
      setLoading(false)
    }
  }, [activeConnId, connections])

  useEffect(() => {
    if (show && activeConnId) {
      loadMigrations()
      setVersion(formatTimestampVersion())
    }
  }, [show, activeConnId, loadMigrations])

  // Initialize tracking table
  const handleInitTracker = async () => {
    if (!activeConnId) return
    setLoading(true)
    setError(null)
    try {
      await api.initMigrationTracker(activeConnId, connections)
      setStatusMessage('Tracking table _dblens_migrations initialized!')
      setTimeout(() => setStatusMessage(null), 4000)
      await loadMigrations()
    } catch (err: any) {
      setError(err.message || 'Failed to initialize tracking table')
    } finally {
      setLoading(false)
    }
  }

  // Live generated files
  const generatedFiles: MigrationFile[] = useMemo(() => {
    return formatMigrationFiles(version, name, upSql, downSql, format)
  }, [version, name, upSql, downSql, format])

  // Handle Apply Migration
  const handleApply = async () => {
    if (!activeConnId) return
    const validation = validateMigrationInput(name, upSql)
    if (!validation.valid) {
      setError(validation.error || 'Invalid migration')
      return
    }

    setApplying(true)
    setError(null)
    try {
      const res = await api.applyMigration(
        activeConnId,
        {
          name: sanitizeMigrationSlug(name),
          version,
          upSql,
          downSql,
        },
        connections
      )
      setStatusMessage(`Migration ${res.version} applied successfully in ${res.executionTimeMs}ms!`)
      setTimeout(() => setStatusMessage(null), 5000)
      // Reset form and timestamp
      setName('')
      setVersion(formatTimestampVersion())
      await loadMigrations()
      setActiveTab('timeline')
    } catch (err: any) {
      setError(err.message || 'Failed to apply migration')
    } finally {
      setApplying(false)
    }
  }

  // Handle Rollback
  const handleConfirmRollback = async () => {
    if (!activeConnId || !rollbackCandidate) return
    setRollingBack(true)
    setError(null)
    try {
      const res = await api.rollbackMigration(activeConnId, rollbackCandidate.version, connections)
      setStatusMessage(`Migration ${res.version} (${res.name}) rolled back successfully!`)
      setTimeout(() => setStatusMessage(null), 5000)
      setRollbackCandidate(null)
      await loadMigrations()
    } catch (err: any) {
      setError(err.message || 'Failed to rollback migration')
    } finally {
      setRollingBack(false)
    }
  }

  // Copy bundle/file
  const handleCopyFile = (fileName: string, content: string) => {
    navigator.clipboard.writeText(content)
    setCopiedFile(fileName)
    setTimeout(() => setCopiedFile(null), 2000)
  }

  // Download files
  const handleDownload = () => {
    generatedFiles.forEach((file) => {
      const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    })
  }

  // Stats & filtered history
  const stats = useMemo(() => calculateMigrationStats(migrations), [migrations])
  const filteredHistory = useMemo(() => filterMigrations(migrations, searchQuery), [migrations, searchQuery])
  const latestMigration = migrations.length > 0 ? migrations[migrations.length - 1] : null

  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden text-[var(--fg)]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between gap-4 bg-[var(--surface)]/50 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 border border-blue-500/20">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[var(--fg)]">
                  Migration Hub & Changelog
                </h2>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20">
                  {dialect}
                </span>
                {isReadOnly && (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/30 flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Read-Only Safe Mode
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--muted)]">
                Automated reversible migrations for Goose, Golang-Migrate, Flyway, DB-Mate, Prisma
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {latestMigration && (
              <button
                onClick={() => setRollbackCandidate(latestMigration)}
                disabled={isReadOnly || rollingBack}
                className="px-3 py-1.5 text-xs font-medium rounded border border-rose-500/30 text-rose-500 hover:bg-rose-500/10 disabled:opacity-40 transition-colors flex items-center gap-1.5 cursor-pointer"
                title={isReadOnly ? 'Disabled in read-only mode' : `Rollback ${latestMigration.version}`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Rollback Latest</span>
              </button>
            )}

            <button
              onClick={loadMigrations}
              disabled={loading}
              className="p-1.5 rounded hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
              title="Refresh migrations"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={handleClose}
              className="p-1.5 rounded hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Notifications / Status */}
        {error && (
          <div className="px-6 py-2.5 bg-rose-500/10 border-b border-rose-500/20 text-rose-400 text-xs flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="hover:text-rose-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {statusMessage && (
          <div className="px-6 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-400 text-xs flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{statusMessage}</span>
            </div>
            <button onClick={() => setStatusMessage(null)} className="hover:text-emerald-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Uninitialized Banner */}
        {!isInitialized && !loading && (
          <div className="px-6 py-3 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-xs flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                Tracking table <code className="font-mono font-semibold">_dblens_migrations</code> is not yet initialized in this database.
              </span>
            </div>
            <button
              onClick={handleInitTracker}
              disabled={isReadOnly || loading}
              className="px-3 py-1 bg-amber-500 text-black font-semibold rounded text-xs hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer"
            >
              Initialize Table
            </button>
          </div>
        )}

        {/* Tabs Bar */}
        <div className="px-6 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface)]/20 shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('timeline')}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                activeTab === 'timeline'
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Changelog Timeline</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[var(--surface)] border border-[var(--border)] font-mono">
                {stats.total}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('new')}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                activeTab === 'new'
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Migration</span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                activeTab === 'history'
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>History Table</span>
            </button>
          </div>

          {/* Quick Stats Pill */}
          <div className="hidden sm:flex items-center gap-4 text-xs font-mono text-[var(--muted)]">
            <span>Total: <strong className="text-[var(--fg)]">{stats.total}</strong></span>
            <span>Duration: <strong className="text-[var(--fg)]">{formatExecutionDuration(stats.totalExecutionTimeMs)}</strong></span>
          </div>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* TAB 1: TIMELINE */}
          {activeTab === 'timeline' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              {/* Stats overview cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-[var(--surface)]/40 border border-[var(--border)]">
                  <div className="text-xs text-[var(--muted)] font-medium">Applied Migrations</div>
                  <div className="text-2xl font-bold font-mono mt-1 text-blue-500">{stats.total}</div>
                </div>
                <div className="p-4 rounded-lg bg-[var(--surface)]/40 border border-[var(--border)]">
                  <div className="text-xs text-[var(--muted)] font-medium">Current Version</div>
                  <div className="text-sm font-bold font-mono mt-2 truncate text-[var(--fg)]">
                    {stats.latestVersion || 'None'}
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-[var(--surface)]/40 border border-[var(--border)]">
                  <div className="text-xs text-[var(--muted)] font-medium">Total Execution Time</div>
                  <div className="text-2xl font-bold font-mono mt-1 text-emerald-500">
                    {formatExecutionDuration(stats.totalExecutionTimeMs)}
                  </div>
                </div>
              </div>

              {migrations.length === 0 ? (
                <div className="py-16 text-center border border-dashed border-[var(--border)] rounded-xl bg-[var(--surface)]/20">
                  <FileCode2 className="w-10 h-10 mx-auto text-[var(--muted)] opacity-60 mb-3" />
                  <h3 className="text-sm font-semibold text-[var(--fg)]">No Applied Migrations Yet</h3>
                  <p className="text-xs text-[var(--muted)] mt-1 max-w-sm mx-auto">
                    Create and apply schema changes with versioned reversible files using the New Migration tab.
                  </p>
                  <button
                    onClick={() => setActiveTab('new')}
                    className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create First Migration</span>
                  </button>
                </div>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-[var(--border)]">
                  {migrations.map((m, idx) => {
                    const isLatest = idx === migrations.length - 1
                    const isExpanded = expandedId === m.id

                    return (
                      <div key={m.id} className="relative group">
                        {/* Timeline Marker Dot */}
                        <div
                          className={`absolute -left-6 top-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isLatest
                              ? 'border-blue-500 bg-blue-500/20 text-blue-500'
                              : 'border-emerald-500 bg-emerald-500/20 text-emerald-500'
                          }`}
                        >
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </div>

                        {/* Migration Card */}
                        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]/30 hover:border-blue-500/40 transition-colors">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-xs font-semibold text-blue-400">
                                  {m.version}
                                </span>
                                <span className="text-sm font-medium text-[var(--fg)]">
                                  {m.name}
                                </span>
                                {isLatest && (
                                  <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                    LATEST
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--muted)] flex-wrap">
                                <span className="flex items-center gap-1 font-mono text-[11px]">
                                  <Clock className="w-3 h-3" />
                                  {new Date(m.appliedAt).toLocaleString()}
                                </span>
                                <span>•</span>
                                <span className="font-mono text-[11px] text-emerald-400">
                                  {formatExecutionDuration(m.executionTimeMs)}
                                </span>
                                <span>•</span>
                                <span
                                  className="font-mono text-[10px] truncate max-w-[120px] bg-[var(--surface)] px-1 py-0.5 rounded border border-[var(--border)]"
                                  title={`Checksum: ${m.checksum}`}
                                >
                                  SHA: {m.checksum.slice(0, 10)}...
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => {
                                  setInspectRecord(m)
                                  setInspectTab('up')
                                }}
                                className="px-2.5 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--surface)] text-[var(--fg)] transition-colors cursor-pointer"
                              >
                                View SQL
                              </button>

                              {isLatest && (
                                <button
                                  onClick={() => setRollbackCandidate(m)}
                                  disabled={isReadOnly || rollingBack}
                                  className="px-2.5 py-1 text-xs rounded border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 transition-colors flex items-center gap-1 cursor-pointer"
                                  title="Rollback this migration"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Rollback</span>
                                </button>
                              )}

                              <button
                                onClick={() => setExpandedId(isExpanded ? null : m.id)}
                                className="p-1 text-[var(--muted)] hover:text-[var(--fg)]"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>

                          {/* Inline preview when expanded */}
                          {isExpanded && (
                            <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-3">
                              <div>
                                <div className="text-[11px] font-semibold text-emerald-400 mb-1">
                                  Up SQL (Applied):
                                </div>
                                <pre className="p-2.5 rounded bg-[var(--bg)] border border-[var(--border)] font-mono text-xs overflow-x-auto text-[var(--fg)] max-h-40">
                                  {m.upSql}
                                </pre>
                              </div>
                              <div>
                                <div className="text-[11px] font-semibold text-rose-400 mb-1">
                                  Down SQL (Rollback):
                                </div>
                                <pre className="p-2.5 rounded bg-[var(--bg)] border border-[var(--border)] font-mono text-xs overflow-x-auto text-[var(--fg)] max-h-40">
                                  {m.downSql || '-- No down SQL defined'}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: NEW MIGRATION GENERATOR & APPLY */}
          {activeTab === 'new' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
              {/* Form Input Column */}
              <div className="lg:col-span-7 flex flex-col space-y-4">
                {/* Meta Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-[var(--fg)] block mb-1">
                      Migration Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. create users and audit log"
                      className="w-full bg-[var(--surface)] text-xs text-[var(--fg)] border border-[var(--border)] rounded px-3 py-2 outline-none font-medium focus:border-blue-500"
                    />
                    <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                      Slug: {sanitizeMigrationSlug(name)}
                    </span>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[var(--fg)] block mb-1">
                      Version Identifier
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={version}
                        onChange={(e) => setVersion(e.target.value)}
                        className="flex-1 bg-[var(--surface)] text-xs text-[var(--fg)] border border-[var(--border)] rounded px-3 py-2 outline-none font-mono focus:border-blue-500"
                      />
                      <button
                        onClick={() => setVersion(formatTimestampVersion())}
                        className="px-2.5 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)] cursor-pointer"
                        title="Reset to current UTC timestamp"
                      >
                        Now
                      </button>
                    </div>
                  </div>
                </div>

                {/* Tool Format Selector */}
                <div>
                  <label className="text-xs font-semibold text-[var(--fg)] block mb-1">
                    Target CI/CD Tool Format
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {MIGRATION_FORMATS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFormat(f.id)}
                        className={`px-3 py-2 rounded-lg border text-left transition-all cursor-pointer ${
                          format === f.id
                            ? 'border-blue-500 bg-blue-500/10 text-blue-400 font-semibold shadow-xs'
                            : 'border-[var(--border)] bg-[var(--surface)]/30 text-[var(--fg)] hover:bg-[var(--surface)]'
                        }`}
                      >
                        <div className="text-xs">{f.name}</div>
                        <div className="text-[10px] font-mono text-[var(--muted)] truncate mt-0.5">
                          {f.filePattern}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Up SQL Editor */}
                <div className="flex-1 flex flex-col min-h-[160px]">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                      <span>Up SQL (Deploy)</span>
                      <span className="text-[10px] font-normal text-[var(--muted)]">Executed on apply</span>
                    </label>
                  </div>
                  <div className="flex-1 rounded border border-[var(--border)] overflow-hidden font-mono text-xs">
                    <CodeMirror
                      value={upSql}
                      height="170px"
                      extensions={isDark ? [sql(), oneDark] : [sql()]}
                      theme={isDark ? 'dark' : 'light'}
                      onChange={(val) => setUpSql(val)}
                    />
                  </div>
                </div>

                {/* Down SQL Editor */}
                <div className="flex-1 flex flex-col min-h-[140px]">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-rose-400 flex items-center gap-1.5">
                      <span>Down SQL (Reversible Rollback)</span>
                      <span className="text-[10px] font-normal text-[var(--muted)]">Executed on rollback</span>
                    </label>
                  </div>
                  <div className="flex-1 rounded border border-[var(--border)] overflow-hidden font-mono text-xs">
                    <CodeMirror
                      value={downSql}
                      height="140px"
                      extensions={isDark ? [sql(), oneDark] : [sql()]}
                      theme={isDark ? 'dark' : 'light'}
                      onChange={(val) => setDownSql(val)}
                    />
                  </div>
                </div>

                {/* Action Bar */}
                <div className="pt-2 flex items-center justify-between gap-3 border-t border-[var(--border)]">
                  <span className="text-[11px] text-[var(--muted)]">
                    Format: <strong className="text-[var(--fg)]">{format}</strong> ({generatedFiles.length} file{generatedFiles.length > 1 ? 's' : ''})
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDownload}
                      className="px-3 py-2 text-xs font-medium rounded border border-[var(--border)] hover:bg-[var(--surface)] text-[var(--fg)] transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Bundle</span>
                    </button>

                    <button
                      onClick={handleApply}
                      disabled={applying || isReadOnly || !name.trim() || !upSql.trim()}
                      className="px-4 py-2 text-xs font-semibold rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <Play className={`w-3.5 h-3.5 ${applying ? 'animate-spin' : ''}`} />
                      <span>{applying ? 'Applying...' : '1-Click Apply to DB'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Preview Column */}
              <div className="lg:col-span-5 flex flex-col border border-[var(--border)] rounded-xl bg-[var(--surface)]/20 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface)]/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileCode2 className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-semibold text-[var(--fg)]">Generated File Preview</span>
                  </div>

                  {generatedFiles.length > 0 && (
                    <button
                      onClick={() =>
                        handleCopyFile(
                          generatedFiles[activePreviewFileIdx]?.fileName || 'file',
                          generatedFiles[activePreviewFileIdx]?.content || ''
                        )
                      }
                      className="text-xs text-[var(--muted)] hover:text-[var(--fg)] flex items-center gap-1 cursor-pointer"
                    >
                      {copiedFile ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedFile ? 'Copied!' : 'Copy'}</span>
                    </button>
                  )}
                </div>

                {/* File tab headers */}
                <div className="px-2 py-1.5 border-b border-[var(--border)] flex items-center gap-1 bg-[var(--surface)]/10 overflow-x-auto">
                  {generatedFiles.map((file, i) => (
                    <button
                      key={file.fileName}
                      onClick={() => setActivePreviewFileIdx(i)}
                      className={`px-3 py-1 text-xs font-mono rounded transition-colors truncate max-w-[200px] cursor-pointer ${
                        activePreviewFileIdx === i
                          ? 'bg-[var(--surface)] text-blue-400 font-semibold border border-[var(--border)]'
                          : 'text-[var(--muted)] hover:text-[var(--fg)]'
                      }`}
                      title={file.fileName}
                    >
                      {file.fileName}
                    </button>
                  ))}
                </div>

                {/* File preview code */}
                <div className="flex-1 p-3 overflow-auto bg-[var(--bg)] font-mono text-xs text-[var(--fg)] select-all whitespace-pre">
                  {generatedFiles[activePreviewFileIdx]?.content || ''}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: HISTORY TABLE */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              {/* Search input */}
              <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by version, name, or checksum..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-[var(--surface)] border border-[var(--border)] rounded-lg outline-none font-medium text-[var(--fg)] focus:border-blue-500"
                  />
                </div>

                <div className="text-xs font-mono text-[var(--muted)]">
                  Showing {filteredHistory.length} of {migrations.length} entries
                </div>
              </div>

              {/* Table */}
              <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--surface)]/20">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface)]/60 text-[var(--muted)] font-mono uppercase text-[10px]">
                      <th className="py-2.5 px-4">ID</th>
                      <th className="py-2.5 px-4">Version</th>
                      <th className="py-2.5 px-4">Name</th>
                      <th className="py-2.5 px-4">Applied At</th>
                      <th className="py-2.5 px-4">Execution Time</th>
                      <th className="py-2.5 px-4">Checksum</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {filteredHistory.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-[var(--muted)]">
                          No migrations found matching query
                        </td>
                      </tr>
                    ) : (
                      filteredHistory.map((m) => (
                        <tr key={m.id} className="hover:bg-[var(--surface)]/40 transition-colors">
                          <td className="py-2.5 px-4 font-mono text-[var(--muted)]">#{m.id}</td>
                          <td className="py-2.5 px-4 font-mono font-semibold text-blue-400">
                            {m.version}
                          </td>
                          <td className="py-2.5 px-4 font-medium text-[var(--fg)]">{m.name}</td>
                          <td className="py-2.5 px-4 font-mono text-[var(--muted)]">
                            {new Date(m.appliedAt).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-emerald-400">
                            {formatExecutionDuration(m.executionTimeMs)}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-[10px] text-[var(--muted)]">
                            <span
                              className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] cursor-pointer hover:text-[var(--fg)]"
                              onClick={() => {
                                navigator.clipboard.writeText(m.checksum)
                                setStatusMessage('Checksum copied to clipboard')
                                setTimeout(() => setStatusMessage(null), 2000)
                              }}
                              title="Click to copy full SHA-256"
                            >
                              {m.checksum.slice(0, 10)}...
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              onClick={() => {
                                setInspectRecord(m)
                                setInspectTab('down')
                              }}
                              className="px-2 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--surface)] text-[var(--fg)] cursor-pointer"
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[var(--border)] flex items-center justify-between text-xs text-[var(--muted)] bg-[var(--surface)]/40 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Tracking Table: <strong className="font-mono text-[var(--fg)]">_dblens_migrations</strong></span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-1.5 text-xs font-medium rounded border border-[var(--border)] hover:bg-[var(--surface)] text-[var(--fg)] transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* INSPECTION MODAL */}
      {inspectRecord && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface)]/50">
              <div className="flex items-center gap-2 min-w-0">
                <FileCode2 className="w-4 h-4 text-blue-400 shrink-0" />
                <span className="text-xs font-semibold truncate">
                  {inspectRecord.version} — {inspectRecord.name}
                </span>
              </div>
              <button
                onClick={() => setInspectRecord(null)}
                className="p-1 rounded hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-2 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface)]/20">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setInspectTab('up')}
                  className={`px-3 py-1 text-xs font-medium rounded cursor-pointer ${
                    inspectTab === 'up'
                      ? 'bg-emerald-500/20 text-emerald-400 font-semibold'
                      : 'text-[var(--muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  Up SQL
                </button>
                <button
                  onClick={() => setInspectTab('down')}
                  className={`px-3 py-1 text-xs font-medium rounded cursor-pointer ${
                    inspectTab === 'down'
                      ? 'bg-rose-500/20 text-rose-400 font-semibold'
                      : 'text-[var(--muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  Down SQL (Rollback)
                </button>
              </div>

              <button
                onClick={() => {
                  const txt = inspectTab === 'up' ? inspectRecord.upSql : inspectRecord.downSql
                  navigator.clipboard.writeText(txt)
                  setCopiedFile('inspect')
                  setTimeout(() => setCopiedFile(null), 2000)
                }}
                className="text-xs text-[var(--muted)] hover:text-[var(--fg)] flex items-center gap-1 cursor-pointer"
              >
                {copiedFile === 'inspect' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedFile === 'inspect' ? 'Copied!' : 'Copy SQL'}</span>
              </button>
            </div>

            <div className="p-4 flex-1 overflow-auto bg-[var(--bg)] font-mono text-xs text-[var(--fg)] whitespace-pre">
              {inspectTab === 'up' ? inspectRecord.upSql : inspectRecord.downSql || '-- No down SQL defined'}
            </div>

            <div className="px-5 py-2.5 border-t border-[var(--border)] bg-[var(--surface)]/40 flex items-center justify-between text-xs text-[var(--muted)]">
              <span className="font-mono text-[10px] truncate max-w-md">
                SHA-256: {inspectRecord.checksum}
              </span>
              <button
                onClick={() => setInspectRecord(null)}
                className="px-3 py-1 bg-[var(--surface)] border border-[var(--border)] rounded text-xs text-[var(--fg)]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ROLLBACK CONFIRMATION DIALOG */}
      {rollbackCandidate && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-[var(--bg)] border border-rose-500/40 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-2 rounded-full bg-rose-500/15 border border-rose-500/30">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--fg)]">Confirm Rollback</h3>
                <p className="text-xs text-[var(--muted)]">Revert schema migration</p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs space-y-1.5">
              <div>
                <span className="text-[var(--muted)]">Version: </span>
                <span className="font-mono font-semibold text-blue-400">{rollbackCandidate.version}</span>
              </div>
              <div>
                <span className="text-[var(--muted)]">Name: </span>
                <span className="font-medium text-[var(--fg)]">{rollbackCandidate.name}</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-rose-400 block mb-1">
                Down SQL to be executed:
              </label>
              <pre className="p-2.5 rounded bg-[var(--surface)] border border-[var(--border)] font-mono text-xs overflow-x-auto text-[var(--fg)] max-h-32">
                {rollbackCandidate.downSql || '-- Warning: No down SQL specified'}
              </pre>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setRollbackCandidate(null)}
                disabled={rollingBack}
                className="px-4 py-1.5 text-xs font-medium rounded border border-[var(--border)] hover:bg-[var(--surface)] text-[var(--fg)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRollback}
                disabled={rollingBack}
                className="px-4 py-1.5 text-xs font-semibold rounded bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${rollingBack ? 'animate-spin' : ''}`} />
                <span>{rollingBack ? 'Rolling back...' : 'Confirm Rollback'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
