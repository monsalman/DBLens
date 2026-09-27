import React, { useState, useEffect } from 'react'
import {
  X,
  Download,
  Copy,
  Check,
  FileCode,
  FileText,
  Globe,
  Sparkles,
  ShieldCheck,
} from 'lucide-react'
import type { DataDictionary } from './dictionaryHelper'
import {
  generateClientMarkdown,
  generateClientOpenAPI,
  downloadFile,
  copyToClipboard,
} from './dictionaryHelper'
import { api, type ConnectionConfig } from '../../lib/api'

interface ExportDocModalProps {
  isOpen: boolean
  onClose: () => void
  dictionary: DataDictionary
  connId: string | null
  profiles?: ConnectionConfig[]
}

type ExportFormat = 'html' | 'md' | 'openapi'

export const ExportDocModal: React.FC<ExportDocModalProps> = ({
  isOpen,
  onClose,
  dictionary,
  connId,
  profiles,
}) => {
  const [format, setFormat] = useState<ExportFormat>('html')
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [previewContent, setPreviewContent] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)

  // Update preview when format or dictionary changes
  useEffect(() => {
    if (!isOpen || !dictionary) return

    let cancelled = false
    setLoadingPreview(true)

    const updatePreview = async () => {
      try {
        if (format === 'html') {
          // If connId available, fetch real HTML template or fallback to client generator
          if (connId) {
            const html = await api.fetchDictionaryExportText(connId, 'html', undefined, profiles)
            if (!cancelled) setPreviewContent(html)
          } else {
            if (!cancelled) setPreviewContent('<!-- Offline HTML Bundle ready for download -->')
          }
        } else if (format === 'md') {
          const md = generateClientMarkdown(dictionary)
          if (!cancelled) setPreviewContent(md)
        } else if (format === 'openapi') {
          const oa = generateClientOpenAPI(dictionary)
          if (!cancelled) setPreviewContent(oa)
        }
      } catch {
        if (format === 'md') {
          if (!cancelled) setPreviewContent(generateClientMarkdown(dictionary))
        } else if (format === 'openapi') {
          if (!cancelled) setPreviewContent(generateClientOpenAPI(dictionary))
        } else {
          if (!cancelled) setPreviewContent('<!-- HTML preview unavailable, ready to download -->')
        }
      } finally {
        if (!cancelled) setLoadingPreview(false)
      }
    }

    updatePreview()
    return () => {
      cancelled = true
    }
  }, [isOpen, format, dictionary, connId, profiles])

  if (!isOpen) return null

  const handleDownload = async () => {
    setExporting(true)
    try {
      const ext = format === 'openapi' ? 'json' : format
      const mime =
        format === 'html'
          ? 'text/html;charset=utf-8'
          : format === 'md'
          ? 'text/markdown;charset=utf-8'
          : 'application/json;charset=utf-8'
      const filename = `data-dictionary-${connId || 'export'}.${ext}`

      let content = previewContent
      if (!content || format === 'html') {
        if (connId) {
          content = await api.fetchDictionaryExportText(connId, format, undefined, profiles)
        } else if (format === 'md') {
          content = generateClientMarkdown(dictionary)
        } else if (format === 'openapi') {
          content = generateClientOpenAPI(dictionary)
        }
      }

      downloadFile(content, filename, mime)
    } finally {
      setExporting(false)
    }
  }

  const handleCopy = async () => {
    if (!previewContent) return
    const success = await copyToClipboard(previewContent)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-150">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--fg)] flex items-center gap-2">
                <span>Export Schema Documentation</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-normal border border-emerald-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  <span>SOC 2 / HIPAA Ready</span>
                </span>
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Generate offline self-contained portal bundles, Git runbooks, or OpenAPI schemas.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Format Selection Cards */}
        <div className="p-5 border-b border-[var(--border)] bg-[var(--bg)] flex flex-col gap-3">
          <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
            Select Export Format
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* HTML */}
            <button
              type="button"
              onClick={() => setFormat('html')}
              className={`p-3 rounded-lg border text-left flex flex-col gap-1.5 transition-all cursor-pointer ${
                format === 'html'
                  ? 'border-blue-500 bg-blue-500/10 shadow-sm'
                  : 'border-[var(--border)] hover:bg-[var(--hover)]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-xs text-[var(--fg)]">
                  <Globe className="w-4 h-4 text-blue-500" />
                  <span>Offline HTML Portal</span>
                </div>
                {format === 'html' && <Sparkles className="w-3.5 h-3.5 text-blue-500" />}
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                Zero-dependency single-file HTML bundle with dark/light themes, search JS, and print-ready PDF styling.
              </p>
            </button>

            {/* Markdown */}
            <button
              type="button"
              onClick={() => setFormat('md')}
              className={`p-3 rounded-lg border text-left flex flex-col gap-1.5 transition-all cursor-pointer ${
                format === 'md'
                  ? 'border-blue-500 bg-blue-500/10 shadow-sm'
                  : 'border-[var(--border)] hover:bg-[var(--hover)]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-xs text-[var(--fg)]">
                  <FileText className="w-4 h-4 text-purple-500" />
                  <span>Markdown Runbook</span>
                </div>
                {format === 'md' && <Sparkles className="w-3.5 h-3.5 text-blue-500" />}
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                Standard GitHub Flavored Markdown with executive summary, tables, column constraints, and PII badges.
              </p>
            </button>

            {/* OpenAPI */}
            <button
              type="button"
              onClick={() => setFormat('openapi')}
              className={`p-3 rounded-lg border text-left flex flex-col gap-1.5 transition-all cursor-pointer ${
                format === 'openapi'
                  ? 'border-blue-500 bg-blue-500/10 shadow-sm'
                  : 'border-[var(--border)] hover:bg-[var(--hover)]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-xs text-[var(--fg)]">
                  <FileCode className="w-4 h-4 text-emerald-500" />
                  <span>OpenAPI 3.0 Schemas</span>
                </div>
                {format === 'openapi' && <Sparkles className="w-3.5 h-3.5 text-blue-500" />}
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                Machine-readable OpenAPI components.schemas JSON with SQL type mappings, nullability, and comments.
              </p>
            </button>
          </div>
        </div>

        {/* Preview Area */}
        <div className="flex-1 min-h-[260px] p-5 flex flex-col overflow-hidden bg-[var(--surface)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-[var(--muted)] uppercase tracking-wider">
              {format === 'html'
                ? 'Preview (HTML Bundle Source)'
                : format === 'md'
                ? 'Preview (Markdown Content)'
                : 'Preview (OpenAPI 3.0 Components JSON)'}
            </span>

            {format !== 'html' && (
              <button
                type="button"
                onClick={handleCopy}
                disabled={loadingPreview || !previewContent}
                className="px-2.5 py-1 rounded text-xs border border-[var(--border)] hover:bg-[var(--hover)] text-[var(--fg)] flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-emerald-500 font-semibold">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-[var(--muted)]" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-auto border border-[var(--border)] rounded-lg bg-[var(--bg)] p-3">
            {loadingPreview ? (
              <div className="flex items-center justify-center h-full text-xs text-[var(--muted)]">
                Rendering preview...
              </div>
            ) : format === 'html' ? (
              <div className="text-xs text-[var(--muted)] space-y-2 p-2">
                <div className="font-semibold text-[var(--fg)]">
                  Standalone Offline Single-File HTML Portal
                </div>
                <p>
                  The exported file contains embedded inline CSS and vanilla JavaScript search filters.
                  It requires zero internet connection or third-party CDN scripts to load and is formatted
                  for high-contrast PDF printing for compliance auditors.
                </p>
                <div className="p-3 bg-[var(--surface)] border border-[var(--border)] rounded font-mono text-[11px]">
                  data-dictionary-{connId || 'connection'}.html ({dictionary.schemas.length} schemas,{' '}
                  {dictionary.summary.totalTables} tables, {dictionary.summary.totalColumns} columns)
                </div>
              </div>
            ) : (
              <pre className="font-mono text-xs text-[var(--fg)] whitespace-pre leading-relaxed">
                {previewContent}
              </pre>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between">
          <div className="text-xs text-[var(--muted)]">
            Auditing {dictionary.summary.totalTables} tables across {dictionary.schemas.length} schema(s)
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-xs text-[var(--fg)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={exporting}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{exporting ? 'Exporting...' : `Download .${format === 'openapi' ? 'json' : format}`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
