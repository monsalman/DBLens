import React, { useState, useRef, useEffect } from 'react'
import { X, Upload, FileText, CheckCircle2, AlertCircle, Loader2, Database } from 'lucide-react'
import { api } from '../../lib/api'

interface Props {
  connId: string
  schema: string
  table: string
  onClose: () => void
  onSuccess: () => void
}

export const ImportModal: React.FC<Props> = ({
  connId,
  schema,
  table,
  onClose,
  onSuccess,
}) => {
  const [tab, setTab] = useState<'csv' | 'sql'>('csv')
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    message: string
    affectedRows?: number
    statementsExecuted?: number
  } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, loading])

  const handleTabChange = (newTab: 'csv' | 'sql') => {
    if (loading) return
    setTab(newTab)
    setFile(null)
    setError(null)
    setResult(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (loading) return
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const dropped = e.dataTransfer.files[0]
      validateAndSetFile(dropped)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0])
    }
  }

  const validateAndSetFile = (selected: File) => {
    setError(null)
    setResult(null)
    const name = selected.name.toLowerCase()
    if (tab === 'csv' && !name.endsWith('.csv') && selected.type !== 'text/csv') {
      setError('Please select a valid .csv file')
      return
    }
    if (tab === 'sql' && !name.endsWith('.sql') && selected.type !== 'application/sql' && selected.type !== 'text/plain') {
      setError('Please select a valid .sql file')
      return
    }
    setFile(selected)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const handleSubmit = async () => {
    if (!file || loading) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      if (tab === 'csv') {
        const res = await api.importCSV(connId, schema, table, file)
        setResult({
          message: res.message || `Successfully imported ${res.affectedRows} rows`,
          affectedRows: res.affectedRows,
        })
        onSuccess()
      } else {
        const res = await api.importSQL(connId, file)
        setResult({
          message: res.message || `Successfully executed ${res.statementsExecuted} SQL statements`,
          statementsExecuted: res.statementsExecuted,
          affectedRows: res.affectedRows,
        })
        onSuccess()
      }
    } catch (err: any) {
      setError(err?.message || 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[1px]"
      onClick={e => {
        if (e.target === e.currentTarget && !loading) onClose()
      }}
    >
      <div
        className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-lg flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-label="Import Data"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-mono font-medium text-[var(--fg)]">Import Data</span>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 text-[var(--muted)] hover:text-[var(--fg)] rounded transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)] bg-[var(--surface)] text-xs font-mono">
          <button
            onClick={() => handleTabChange('csv')}
            className={`flex-1 py-2.5 px-4 text-center border-b-2 font-medium transition-colors ${
              tab === 'csv'
                ? 'border-indigo-500 text-indigo-400 bg-[var(--bg)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            Import CSV
          </button>
          <button
            onClick={() => handleTabChange('sql')}
            className={`flex-1 py-2.5 px-4 text-center border-b-2 font-medium transition-colors ${
              tab === 'sql'
                ? 'border-indigo-500 text-indigo-400 bg-[var(--bg)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            Execute SQL Script
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-4">
          {/* Target Info */}
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--muted)] bg-[var(--surface)] p-2.5 rounded border border-[var(--border)]">
            {tab === 'csv' ? (
              <>
                <Database className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Target Table:</span>
                <span className="text-[var(--fg)] font-semibold truncate">
                  {schema ? `${schema}.${table}` : table}
                </span>
              </>
            ) : (
              <>
                <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Target: Current database connection</span>
              </>
            )}
          </div>

          {/* Upload Drop Zone */}
          <div
            onDragOver={e => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleFileDrop}
            onClick={() => !loading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
              isDragging
                ? 'border-indigo-500 bg-indigo-500/10'
                : 'border-[var(--border)] hover:border-indigo-500/60 bg-[var(--surface)]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={tab === 'csv' ? '.csv,text/csv' : '.sql,application/sql,text/plain'}
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="p-2.5 rounded-full bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)]">
              <Upload className="w-5 h-5 text-indigo-400" />
            </div>
            <div className="text-xs font-mono text-center">
              <span className="text-indigo-400 font-medium">Click to upload</span> or drag and drop
            </div>
            <span className="text-[11px] font-mono text-[var(--muted)]">
              {tab === 'csv' ? 'CSV files only (.csv)' : 'SQL script files (.sql)'}
            </span>
          </div>

          {/* Selected File Preview */}
          {file && (
            <div className="flex items-center justify-between p-3 rounded bg-[var(--surface)] border border-[var(--border)] text-xs font-mono">
              <div className="flex items-center gap-2 overflow-hidden mr-2">
                <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                <div className="truncate">
                  <span className="text-[var(--fg)] font-medium">{file.name}</span>
                  <span className="text-[var(--muted)] text-[11px] ml-2">({formatFileSize(file.size)})</span>
                </div>
              </div>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  if (!loading) {
                    setFile(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }
                }}
                disabled={loading}
                className="text-[var(--muted)] hover:text-red-400 p-1"
                title="Remove file"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Success Banner */}
          {result && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono p-3 rounded flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">{result.message}</p>
                {result.statementsExecuted !== undefined && (
                  <p className="text-[11px] opacity-80 mt-0.5">
                    Statements executed: {result.statementsExecuted}
                  </p>
                )}
                {result.affectedRows !== undefined && (
                  <p className="text-[11px] opacity-80 mt-0.5">
                    Affected rows: {result.affectedRows}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono p-3 rounded flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 overflow-hidden break-words">
                <p className="font-semibold">Import Error</p>
                <p className="text-[11px] opacity-90 mt-0.5">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border)] bg-[var(--surface)] shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-mono rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors disabled:opacity-40"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!file || loading}
            className="px-3 py-1.5 text-xs font-mono rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {loading
              ? tab === 'csv' ? 'Importing CSV...' : 'Executing SQL...'
              : tab === 'csv' ? 'Import CSV' : 'Execute SQL'}
          </button>
        </div>
      </div>
    </div>
  )
}
