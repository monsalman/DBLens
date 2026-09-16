import React, { useState, useEffect, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { X, Copy, Check, Download, Code2, AlertCircle } from 'lucide-react'

interface DdlModalProps {
  isOpen: boolean
  onClose: () => void
  table: string
  schema?: string
  ddl: string
  dialect?: string
  loading?: boolean
  error?: string | null
}

export const DdlModal: React.FC<DdlModalProps> = ({
  isOpen,
  onClose,
  table,
  schema,
  ddl,
  dialect,
  loading = false,
  error = null,
}) => {
  const [copied, setCopied] = useState(false)
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : true
  )
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isOpen) {
      closeBtnRef.current?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleCopy = async () => {
    if (!ddl) return
    let ok = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(ddl)
        ok = true
      }
    } catch {
      // fallback if clipboard API denied/unavailable
    }

    if (!ok) {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = ddl
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        ok = document.execCommand('copy')
        document.body.removeChild(textarea)
      } catch (err) {
        console.error('Failed to copy DDL:', err)
      }
    }

    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDownload = () => {
    if (!ddl) return
    const blob = new Blob([ddl], { type: 'text/sql;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${schema ? `${schema}_` : ''}${table}_ddl.sql`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const dialectLabel = (dialect || 'sql').toUpperCase()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ddl-modal-title"
        className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[85vh]"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface)] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Code2 className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <h2 id="ddl-modal-title" className="text-sm font-semibold text-[var(--fg)] truncate font-mono">
              {table} <span className="text-[var(--muted)] font-normal">DDL</span>
            </h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 shrink-0">
              {dialectLabel}
            </span>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--fg)] p-1 rounded hover:bg-[var(--hover)] transition-colors"
            title="Close (Esc)"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 flex-1 overflow-auto min-h-0">
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center text-[var(--muted)] font-mono text-xs gap-2">
              <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              <span>Generating table DDL...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-mono flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Error generating DDL</p>
                <p className="text-[11px] opacity-90 mt-1">{error}</p>
              </div>
            </div>
          ) : (
            <div className="rounded border border-[var(--border)] overflow-hidden">
              <CodeMirror
                value={ddl}
                height="320px"
                theme={isDark ? oneDark : 'light'}
                extensions={[sql()]}
                readOnly={true}
                editable={false}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: false,
                  highlightActiveLine: false,
                }}
                className="text-xs font-mono"
              />
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-4 py-2.5 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-[var(--muted)] font-mono">
            {schema ? `${schema}.${table}` : table}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={loading || !ddl}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border)] text-xs font-mono text-[var(--fg)] hover:bg-[var(--hover)] transition-colors disabled:opacity-50"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-green-500 font-medium">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[var(--muted)]" />
                  <span>Copy DDL</span>
                </>
              )}
            </button>
            <button
              onClick={handleDownload}
              disabled={loading || !ddl}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border)] text-xs font-mono text-[var(--fg)] hover:bg-[var(--hover)] transition-colors disabled:opacity-50"
              title="Download SQL File"
            >
              <Download className="w-3.5 h-3.5 text-[var(--muted)]" />
              <span>Download .sql</span>
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs font-mono bg-[var(--hover)] text-[var(--fg)] hover:bg-[var(--border)] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
