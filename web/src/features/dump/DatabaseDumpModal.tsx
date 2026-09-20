import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  Download,
  Upload,
  Database,
  Archive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
  RotateCcw,
} from 'lucide-react'
import { api, type TableMeta } from '../../lib/api'
import { useAppStore } from '../../stores/appStore'

interface Props {
  isOpen?: boolean
  onClose?: () => void
  initialTab?: 'dump' | 'restore'
}

export const DatabaseDumpModal: React.FC<Props> = ({
  isOpen,
  onClose,
  initialTab = 'dump',
}) => {
  const storeIsOpen = useAppStore((s) => s.isDumpModalOpen)
  const setStoreIsOpen = useAppStore((s) => s.setIsDumpModalOpen)
  const activeConnId = useAppStore((s) => s.activeConnectionId)
  const selectedSchema = useAppStore((s) => s.selectedSchema)
  const connections = useAppStore((s) => s.connections)

  const show = isOpen !== undefined ? isOpen : storeIsOpen
  const handleClose = () => {
    if (loading) return
    if (onClose) {
      onClose()
    } else {
      setStoreIsOpen(false)
    }
  }

  const [activeTab, setActiveTab] = useState<'dump' | 'restore'>(initialTab)

  // Dump Options
  const [tables, setTables] = useState<TableMeta[]>([])
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [includeSchema, setIncludeSchema] = useState(true)
  const [includeData, setIncludeData] = useState(true)
  const [useGzip, setUseGzip] = useState(false)
  const [fetchingTables, setFetchingTables] = useState(false)

  // Restore State
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [restoreResult, setRestoreResult] = useState<{
    total: number
    executed: number
    errors: string[]
  } | null>(null)

  // Shared status
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch tables when opening dump tab
  useEffect(() => {
    if (!show || !activeConnId) return
    let cancelled = false
    setFetchingTables(true)
    api
      .getTables(activeConnId, selectedSchema, connections)
      .then((data) => {
        if (cancelled) return
        const tableList = (data || []).filter(
          (t) => !t.type || t.type === 'table'
        )
        setTables(tableList)
        setSelectedTables(tableList.map((t) => t.name))
      })
      .catch((err) => {
        if (!cancelled) console.error('Failed to fetch tables for dump:', err)
      })
      .finally(() => {
        if (!cancelled) setFetchingTables(false)
      })
    return () => {
      cancelled = true
    }
  }, [show, activeConnId, selectedSchema])

  // Escape key listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        if (onClose) {
          onClose()
        } else {
          setStoreIsOpen(false)
        }
      }
    }
    if (show) {
      window.addEventListener('keydown', onKeyDown)
    }
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [show, loading, onClose, setStoreIsOpen])

  if (!show) return null

  const handleSelectAllTables = () => {
    if (selectedTables.length === tables.length) {
      setSelectedTables([])
    } else {
      setSelectedTables(tables.map((t) => t.name))
    }
  }

  const handleToggleTable = (name: string) => {
    setSelectedTables((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    )
  }

  const handleDownloadDump = async () => {
    if (!activeConnId || loading) return
    if (!includeSchema && !includeData) {
      setError('Please select at least Schema or Data to dump.')
      return
    }
    if (tables.length > 0 && selectedTables.length === 0) {
      setError('Please select at least one table to dump.')
      return
    }

    setLoading(true)
    setError(null)
    setSuccessMessage(null)

    try {
      await api.downloadDatabaseDump(activeConnId, {
        schema: selectedSchema,
        tables: selectedTables.length === tables.length ? [] : selectedTables,
        includeSchema,
        includeData,
        gzip: useGzip,
      })
      setSuccessMessage('Dump downloaded successfully!')
    } catch (err: any) {
      setError(err?.message || 'Failed to generate database dump')
    } finally {
      setLoading(false)
    }
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (loading) return
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndSetFile(e.dataTransfer.files[0])
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0])
    }
  }

  const validateAndSetFile = (file: File) => {
    setError(null)
    setRestoreResult(null)
    setSuccessMessage(null)
    const name = file.name.toLowerCase()
    if (!name.endsWith('.sql') && !name.endsWith('.sql.gz')) {
      setError('Only .sql or .sql.gz dump files are supported.')
      return
    }
    setRestoreFile(file)
  }

  const handleExecuteRestore = async () => {
    if (!activeConnId || !restoreFile || loading) return

    setLoading(true)
    setError(null)
    setRestoreResult(null)
    setSuccessMessage(null)

    try {
      const result = await api.restoreDatabaseDump(activeConnId, restoreFile)
      setRestoreResult(result)
      if (result.errors && result.errors.length > 0) {
        if (result.executed > 0) {
          setSuccessMessage(
            `Restored ${result.executed} of ${result.total} statements with ${result.errors.length} error(s).`
          )
        } else {
          setError(`Restore encountered ${result.errors.length} errors.`)
        }
      } else {
        setSuccessMessage(
          `Restore completed successfully! Executed all ${result.executed} SQL statements.`
        )
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to restore database dump')
    } finally {
      setLoading(false)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-[var(--fg)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 border border-blue-500/20">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Database Dump & Restore</h2>
              <p className="text-xs text-[var(--muted)]">
                Self-contained logical backup engine with topological dependency resolution
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="p-1.5 text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-[var(--border)] bg-[var(--surface)] px-5 gap-4">
          <button
            onClick={() => {
              if (!loading) {
                setActiveTab('dump')
                setError(null)
                setSuccessMessage(null)
              }
            }}
            className={`flex items-center gap-2 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'dump'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            Database Dump
          </button>
          <button
            onClick={() => {
              if (!loading) {
                setActiveTab('restore')
                setError(null)
                setSuccessMessage(null)
              }
            }}
            className={`flex items-center gap-2 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'restore'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            Database Restore
          </button>
        </div>

        {/* Body content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {activeTab === 'dump' ? (
            /* Dump Configuration */
            <div className="space-y-4">
              {/* Options */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex items-center gap-2.5 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--hover)] cursor-pointer text-xs transition-colors">
                  <input
                    type="checkbox"
                    checked={includeSchema}
                    onChange={(e) => setIncludeSchema(e.target.checked)}
                    disabled={loading}
                    className="rounded border-[var(--border)] text-blue-500 focus:ring-blue-500"
                  />
                  <div>
                    <div className="font-medium">Include DDL (Schema)</div>
                    <div className="text-[10px] text-[var(--muted)]">CREATE TABLE & indexes</div>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--hover)] cursor-pointer text-xs transition-colors">
                  <input
                    type="checkbox"
                    checked={includeData}
                    onChange={(e) => setIncludeData(e.target.checked)}
                    disabled={loading}
                    className="rounded border-[var(--border)] text-blue-500 focus:ring-blue-500"
                  />
                  <div>
                    <div className="font-medium">Include Data</div>
                    <div className="text-[10px] text-[var(--muted)]">Stream rows into INSERTs</div>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--hover)] cursor-pointer text-xs transition-colors">
                  <input
                    type="checkbox"
                    checked={useGzip}
                    onChange={(e) => setUseGzip(e.target.checked)}
                    disabled={loading}
                    className="rounded border-[var(--border)] text-blue-500 focus:ring-blue-500"
                  />
                  <div>
                    <div className="font-medium">Gzip Compression</div>
                    <div className="text-[10px] text-[var(--muted)]">Export as .sql.gz</div>
                  </div>
                </label>
              </div>

              {/* Table Selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-[var(--muted)]" />
                    Tables to Export ({selectedTables.length}/{tables.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleSelectAllTables}
                    disabled={loading || tables.length === 0}
                    className="text-blue-500 hover:underline text-[11px]"
                  >
                    {selectedTables.length === tables.length ? 'Deselect all' : 'Select all'}
                  </button>
                </div>

                <div className="border border-[var(--border)] rounded-lg max-h-48 overflow-y-auto p-2 space-y-1 bg-[var(--surface)]">
                  {fetchingTables ? (
                    <div className="flex items-center justify-center py-6 text-xs text-[var(--muted)] gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading schema tables...
                    </div>
                  ) : tables.length === 0 ? (
                    <div className="text-center py-6 text-xs text-[var(--muted)]">
                      No tables found in this schema.
                    </div>
                  ) : (
                    tables.map((t) => {
                      const isChecked = selectedTables.includes(t.name)
                      return (
                        <label
                          key={t.name}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs hover:bg-[var(--hover)] transition-colors ${
                            isChecked ? 'bg-blue-500/5' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleTable(t.name)}
                            disabled={loading}
                            className="rounded border-[var(--border)] text-blue-500 focus:ring-blue-500"
                          />
                          <span className="font-mono text-[11px]">{t.name}</span>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Restore Configuration */
            <div className="space-y-4">
              {/* Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  if (!loading) setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                onClick={() => !loading && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 ${
                  isDragging
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-[var(--border)] hover:border-[var(--muted)] bg-[var(--surface)]'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".sql,.sql.gz"
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={loading}
                />
                <div className="p-3 rounded-full bg-[var(--hover)] text-blue-500">
                  <Archive className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-medium text-[var(--fg)]">
                    {restoreFile ? restoreFile.name : 'Click to select or drag & drop database dump'}
                  </p>
                  <p className="text-[11px] text-[var(--muted)] mt-0.5">
                    {restoreFile
                      ? `${formatFileSize(restoreFile.size)} • Ready to restore`
                      : 'Supports plain SQL (.sql) or gzip compressed (.sql.gz)'}
                  </p>
                </div>
              </div>

              {/* Execution Progress & Results */}
              {restoreResult && (
                <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)] space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 rounded bg-[var(--bg)] border border-[var(--border)]">
                      <div className="text-[10px] text-[var(--muted)]">Total Statements</div>
                      <div className="font-mono font-bold text-sm">{restoreResult.total}</div>
                    </div>
                    <div className="p-2 rounded bg-[var(--bg)] border border-[var(--border)]">
                      <div className="text-[10px] text-[var(--muted)]">Executed</div>
                      <div className="font-mono font-bold text-sm text-emerald-400">
                        {restoreResult.executed}
                      </div>
                    </div>
                    <div className="p-2 rounded bg-[var(--bg)] border border-[var(--border)]">
                      <div className="text-[10px] text-[var(--muted)]">Errors</div>
                      <div
                        className={`font-mono font-bold text-sm ${
                          restoreResult.errors.length > 0 ? 'text-red-400' : 'text-[var(--muted)]'
                        }`}
                      >
                        {restoreResult.errors.length}
                      </div>
                    </div>
                  </div>

                  {restoreResult.errors.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium text-red-400">Execution Errors:</div>
                      <div className="max-h-32 overflow-y-auto font-mono text-[10px] bg-red-950/20 text-red-300 p-2 rounded border border-red-500/20 space-y-0.5">
                        {restoreResult.errors.map((err, idx) => (
                          <div key={idx}>{err}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)] bg-[var(--surface)]">
          <div className="text-[11px] text-[var(--muted)]">
            {activeTab === 'dump'
              ? `${selectedTables.length} table(s) queued for dump`
              : restoreFile
              ? `Selected file: ${restoreFile.name}`
              : 'Zero external CLI dependencies'}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] rounded-md transition-colors"
            >
              Cancel
            </button>

            {activeTab === 'dump' ? (
              <button
                type="button"
                onClick={handleDownloadDump}
                disabled={loading || selectedTables.length === 0}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-md shadow-sm transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Generating Dump...
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    Download Dump
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleExecuteRestore}
                disabled={loading || !restoreFile}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-md shadow-sm transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Restoring Database...
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    Execute Restore
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
