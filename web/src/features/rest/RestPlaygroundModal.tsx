import React, { useState, useEffect, useMemo } from 'react'
import {
  X,
  Send,
  Code2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Clock,
  Database,
  Layers,
  Sparkles,
  FileCode,
} from 'lucide-react'
import { api, type TableDetailResponse, type ColumnMeta } from '../../lib/api'
import { useAppStore } from '../../stores/appStore'
import {
  generateCurl,
  generateJavaScript,
  generatePython,
  generateGo,
} from './codeGenerators'

const OPERATORS = [
  { value: 'eq', label: 'eq (=)' },
  { value: 'neq', label: 'neq (<>)' },
  { value: 'gt', label: 'gt (>)' },
  { value: 'gte', label: 'gte (>=)' },
  { value: 'lt', label: 'lt (<)' },
  { value: 'lte', label: 'lte (<=)' },
  { value: 'like', label: 'like (LIKE)' },
  { value: 'in', label: 'in (IN)' },
]

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

interface FilterRow {
  id: string
  column: string
  operator: string
  value: string
}

export const RestPlaygroundModal: React.FC = () => {
  const isOpen = useAppStore((s) => s.isRestModalOpen)
  const closeRestModal = useAppStore((s) => s.closeRestModal)
  const restTarget = useAppStore((s) => s.restModalTarget)
  const activeConnId = useAppStore((s) => s.activeConnectionId)
  const connections = useAppStore((s) => s.connections)
  const isSafeModeActive = useAppStore((s) => s.isSafeModeActive)

  const selectedSchema = restTarget?.schema || useAppStore((s) => s.selectedSchema) || 'public'
  const selectedTable = restTarget?.table || useAppStore((s) => s.selectedTable) || ''

  const [activeTab, setActiveTab] = useState<'testbench' | 'snippets'>('testbench')
  const [snippetLang, setSnippetLang] = useState<'curl' | 'js' | 'python' | 'go'>('curl')

  const [method, setMethod] = useState<HttpMethod>('GET')
  const [filters, setFilters] = useState<FilterRow[]>([])
  const [selectCols, setSelectCols] = useState('')
  const [orderBy, setOrderBy] = useState('')
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [requestBody, setRequestBody] = useState('{\n  \n}')

  // Available columns from schema inspection
  const [columns, setColumns] = useState<string[]>([])

  // Execution state
  const [isSending, setIsSending] = useState(false)
  const [responseTime, setResponseTime] = useState<number | null>(null)
  const [responseStatus, setResponseStatus] = useState<number | null>(null)
  const [responseStatusText, setResponseStatusText] = useState<string | null>(null)
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({})
  const [responseBody, setResponseBody] = useState<string | null>(null)
  const [showHeaders, setShowHeaders] = useState(false)

  // Clipboard copy state
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedResponse, setCopiedResponse] = useState(false)

  // Fetch columns when modal opens with table
  useEffect(() => {
    if (!isOpen || !activeConnId || !selectedTable) return

    let cancelled = false
    api
      .getTableDetails(activeConnId, selectedSchema, selectedTable, connections)
      .then((detail: TableDetailResponse) => {
        if (!cancelled && detail?.columns) {
          const colNames = detail.columns.map((c: ColumnMeta) => c.name)
          setColumns(colNames)
          // Pre-populate sample JSON body for POST/PATCH
          const sampleObj: Record<string, any> = {}
          detail.columns.slice(0, 4).forEach((c: ColumnMeta) => {
            if (!c.isPrimary && !c.isPrimaryKey) {
              sampleObj[c.name] = c.type.toLowerCase().includes('int')
                ? 1
                : c.type.toLowerCase().includes('bool')
                ? true
                : 'sample'
            }
          })
          if (Object.keys(sampleObj).length > 0) {
            setRequestBody(JSON.stringify(sampleObj, null, 2))
          }
        }
      })
      .catch(() => {
        // Fallback gracefully
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, activeConnId, selectedSchema, selectedTable, connections])

  // Build current REST URL and Query string
  const { fullUrl, relativeUrl } = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080'
    const connIdPart = activeConnId || 'default'
    const path =
      selectedSchema && selectedSchema !== 'public' && selectedSchema !== 'main'
        ? `/api/connections/${connIdPart}/rest/${encodeURIComponent(selectedSchema)}/${encodeURIComponent(selectedTable || 'table')}`
        : `/api/connections/${connIdPart}/rest/${encodeURIComponent(selectedTable || 'table')}`

    const params = new URLSearchParams()
    for (const f of filters) {
      if (f.column && f.value) {
        if (f.operator === 'in') {
          const formattedVal = f.value.startsWith('(') && f.value.endsWith(')') ? f.value : `(${f.value})`
          params.append(f.column, `in.${formattedVal}`)
        } else {
          params.append(f.column, `${f.operator}.${f.value}`)
        }
      }
    }

    if (method === 'GET') {
      if (selectCols.trim()) {
        params.append('select', selectCols.trim())
      }
      if (orderBy.trim()) {
        params.append('order', orderBy.trim())
      }
      if (limit !== 50) {
        params.append('limit', String(limit))
      }
      if (offset > 0) {
        params.append('offset', String(offset))
      }
    }

    const qs = params.toString()
    const rel = qs ? `${path}?${qs}` : path
    return {
      baseUrl: `${origin}${path}`,
      fullUrl: `${origin}${rel}`,
      relativeUrl: rel,
    }
  }, [activeConnId, selectedSchema, selectedTable, filters, selectCols, orderBy, limit, offset, method])

  // Compute request headers
  const computedHeaders = useMemo(() => {
    const dsn = activeConnId ? api._getDSN(activeConnId, connections) : ''
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    if (method === 'POST' || method === 'PATCH') {
      headers['Content-Type'] = 'application/json'
    }
    if (dsn) {
      headers['X-DBLENS-DSN'] = dsn
    }
    const isRO = isSafeModeActive(activeConnId) || connections.find((c) => c.id === activeConnId)?.readOnly
    if (isRO) {
      headers['X-DBLENS-READONLY'] = 'true'
    }
    return headers
  }, [activeConnId, connections, isSafeModeActive, method])

  // Generate code snippet
  const generatedCode = useMemo(() => {
    const opts = {
      method,
      url: fullUrl,
      headers: computedHeaders,
      body: method === 'POST' || method === 'PATCH' ? requestBody : undefined,
    }

    switch (snippetLang) {
      case 'curl':
        return generateCurl(opts)
      case 'js':
        return generateJavaScript(opts)
      case 'python':
        return generatePython(opts)
      case 'go':
        return generateGo(opts)
      default:
        return ''
    }
  }, [snippetLang, method, fullUrl, computedHeaders, requestBody])

  const handleCopyCode = () => {
    navigator.clipboard.writeText(generatedCode)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const handleCopyResponse = () => {
    if (!responseBody) return
    navigator.clipboard.writeText(responseBody)
    setCopiedResponse(true)
    setTimeout(() => setCopiedResponse(false), 2000)
  }

  const handleAddFilter = () => {
    const initialCol = columns[0] || 'id'
    setFilters((prev) => [
      ...prev,
      {
        id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        column: initialCol,
        operator: 'eq',
        value: '',
      },
    ])
  }

  const handleRemoveFilter = (id: string) => {
    setFilters((prev) => prev.filter((f) => f.id !== id))
  }

  const handleUpdateFilter = (id: string, field: keyof FilterRow, val: string) => {
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, [field]: val } : f)))
  }

  const handleSendRequest = async () => {
    setIsSending(true)
    setResponseStatus(null)
    setResponseStatusText(null)
    setResponseBody(null)
    setResponseHeaders({})

    const start = performance.now()
    try {
      const fetchOpts: RequestInit = {
        method,
        headers: computedHeaders,
      }
      if (method === 'POST' || method === 'PATCH') {
        fetchOpts.body = requestBody
      }

      const res = await fetch(fullUrl, fetchOpts)
      const elapsed = Math.round(performance.now() - start)
      setResponseTime(elapsed)
      setResponseStatus(res.status)
      setResponseStatusText(res.statusText)

      const hdrs: Record<string, string> = {}
      res.headers.forEach((val, key) => {
        hdrs[key] = val
      })
      setResponseHeaders(hdrs)

      const text = await res.text()
      try {
        const json = JSON.parse(text)
        setResponseBody(JSON.stringify(json, null, 2))
      } catch {
        setResponseBody(text)
      }
    } catch (err: any) {
      const elapsed = Math.round(performance.now() - start)
      setResponseTime(elapsed)
      setResponseStatus(0)
      setResponseStatusText('Network Error')
      setResponseBody(JSON.stringify({ error: err?.message || 'Failed to fetch' }, null, 2))
    } finally {
      setIsSending(false)
    }
  }

  if (!isOpen) return null

  const getStatusBadgeColor = (status: number | null) => {
    if (!status) return 'bg-zinc-800 text-zinc-400 border-zinc-700'
    if (status >= 200 && status < 300) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    if (status >= 400 && status < 500) return 'bg-amber-500/10 text-amber-400 border-amber-500/30'
    return 'bg-rose-500/10 text-rose-400 border-rose-500/30'
  }

  const getMethodBadgeColor = (m: HttpMethod) => {
    switch (m) {
      case 'GET':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30'
      case 'POST':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
      case 'PATCH':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30'
      case 'DELETE':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/30'
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-[var(--fg)] text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] bg-[var(--card)]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Code2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-[var(--fg)]">Instant Table REST API</h2>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  PostgREST-compatible
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-[var(--muted)] mt-0.5 font-mono">
                <Database className="w-3 h-3" />
                <span>{selectedSchema}</span>
                <span>/</span>
                <span className="font-semibold text-[var(--fg)]">{selectedTable || 'table'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Mode Tabs */}
            <div className="flex items-center bg-[var(--bg)] p-0.5 rounded-lg border border-[var(--border)]">
              <button
                onClick={() => setActiveTab('testbench')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  activeTab === 'testbench'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                API Testbench
              </button>
              <button
                onClick={() => setActiveTab('snippets')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  activeTab === 'snippets'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                Code Snippets
              </button>
            </div>

            <button
              onClick={closeRestModal}
              className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* URL Request Bar */}
          <div className="flex items-center gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as HttpMethod)}
              aria-label="HTTP Method"
              className={`h-9 px-3 font-mono font-bold text-xs rounded-lg border focus:outline-none transition-colors ${getMethodBadgeColor(
                method
              )}`}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>

            <div className="flex-1 flex items-center h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--card)] font-mono text-xs overflow-x-auto whitespace-nowrap text-[var(--fg)]">
              <span className="text-[var(--muted)] select-none">
                {window.location.origin}
              </span>
              <span className="text-blue-400 select-all font-medium">
                {relativeUrl}
              </span>
            </div>

            <button
              onClick={handleSendRequest}
              disabled={isSending}
              className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-50"
            >
              <Send className={`w-3.5 h-3.5 ${isSending ? 'animate-spin' : ''}`} />
              <span>{isSending ? 'Sending...' : 'Send'}</span>
            </button>
          </div>

          {activeTab === 'testbench' ? (
            <div className="space-y-4">
              {/* Parameters & Filters Section */}
              <div className="border border-[var(--border)] rounded-xl bg-[var(--card)] p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-[var(--fg)] flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-blue-400" />
                    Filters & Query Options
                  </span>
                  <button
                    onClick={handleAddFilter}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Filter</span>
                  </button>
                </div>

                {/* Filter Rows */}
                {filters.length > 0 ? (
                  <div className="space-y-2 pt-1">
                    {filters.map((f) => (
                      <div key={f.id} className="flex items-center gap-2">
                        {/* Column selector */}
                        {columns.length > 0 ? (
                          <select
                            value={f.column}
                            onChange={(e) => handleUpdateFilter(f.id, 'column', e.target.value)}
                            className="h-8 px-2 rounded-md border border-[var(--border)] bg-[var(--bg)] font-mono text-xs w-40"
                          >
                            {columns.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            placeholder="column"
                            value={f.column}
                            onChange={(e) => handleUpdateFilter(f.id, 'column', e.target.value)}
                            className="h-8 px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg)] font-mono text-xs w-40"
                          />
                        )}

                        {/* Operator selector */}
                        <select
                          value={f.operator}
                          onChange={(e) => handleUpdateFilter(f.id, 'operator', e.target.value)}
                          className="h-8 px-2 rounded-md border border-[var(--border)] bg-[var(--bg)] font-mono text-xs w-32"
                        >
                          {OPERATORS.map((op) => (
                            <option key={op.value} value={op.value}>
                              {op.label}
                            </option>
                          ))}
                        </select>

                        {/* Value input */}
                        <input
                          type="text"
                          placeholder={f.operator === 'in' ? 'v1, v2, v3' : 'value'}
                          value={f.value}
                          onChange={(e) => handleUpdateFilter(f.id, 'value', e.target.value)}
                          className="flex-1 h-8 px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg)] font-mono text-xs"
                        />

                        {/* Remove filter */}
                        <button
                          onClick={() => handleRemoveFilter(f.id)}
                          className="p-1.5 text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-[var(--muted)] py-1 italic">
                    No filters configured. Non-GET update/delete operations require at least one filter for safety.
                  </div>
                )}

                {/* GET modifiers: Select, Order, Limit, Offset */}
                {method === 'GET' && (
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-2 border-t border-[var(--border)]">
                    <div>
                      <label className="text-[10px] uppercase font-mono text-[var(--muted)] block mb-1">
                        Select Columns
                      </label>
                      <input
                        type="text"
                        placeholder="col1,col2 (empty = *)"
                        value={selectCols}
                        onChange={(e) => setSelectCols(e.target.value)}
                        className="w-full h-7 px-2 rounded border border-[var(--border)] bg-[var(--bg)] font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-mono text-[var(--muted)] block mb-1">
                        Order By
                      </label>
                      <input
                        type="text"
                        placeholder="col.asc or col.desc"
                        value={orderBy}
                        onChange={(e) => setOrderBy(e.target.value)}
                        className="w-full h-7 px-2 rounded border border-[var(--border)] bg-[var(--bg)] font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-mono text-[var(--muted)] block mb-1">
                        Limit
                      </label>
                      <input
                        type="number"
                        value={limit}
                        onChange={(e) => setLimit(Number(e.target.value))}
                        min={1}
                        max={1000}
                        className="w-full h-7 px-2 rounded border border-[var(--border)] bg-[var(--bg)] font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-mono text-[var(--muted)] block mb-1">
                        Offset
                      </label>
                      <input
                        type="number"
                        value={offset}
                        onChange={(e) => setOffset(Number(e.target.value))}
                        min={0}
                        className="w-full h-7 px-2 rounded border border-[var(--border)] bg-[var(--bg)] font-mono text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Body Editor for POST / PATCH */}
              {(method === 'POST' || method === 'PATCH') && (
                <div className="border border-[var(--border)] rounded-xl bg-[var(--card)] p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-[var(--fg)] flex items-center gap-1.5">
                      <FileCode className="w-3.5 h-3.5 text-emerald-400" />
                      JSON Request Body
                    </span>
                    <button
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(requestBody)
                          setRequestBody(JSON.stringify(parsed, null, 2))
                        } catch {}
                      }}
                      className="text-[11px] text-blue-400 hover:text-blue-300 font-mono"
                    >
                      Prettify JSON
                    </button>
                  </div>
                  <textarea
                    value={requestBody}
                    onChange={(e) => setRequestBody(e.target.value)}
                    rows={5}
                    aria-label="JSON Request Body"
                    className="w-full font-mono text-xs p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder='{\n  "name": "example"\n}'
                  />
                </div>
              )}

              {/* Response Section */}
              <div className="border border-[var(--border)] rounded-xl bg-[var(--card)] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg)]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs">Response</span>
                    {responseStatus !== null && (
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-mono border ${getStatusBadgeColor(
                          responseStatus
                        )}`}
                      >
                        {responseStatus} {responseStatusText || ''}
                      </span>
                    )}
                    {responseTime !== null && (
                      <span className="flex items-center gap-1 text-[11px] font-mono text-[var(--muted)]">
                        <Clock className="w-3 h-3" />
                        <span>{responseTime} ms</span>
                      </span>
                    )}
                    {responseHeaders['x-total-count'] && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        Total: {responseHeaders['x-total-count']} rows
                      </span>
                    )}
                  </div>

                  {responseBody && (
                    <button
                      onClick={handleCopyResponse}
                      className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
                    >
                      {copiedResponse ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Response</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Headers Accordion */}
                {Object.keys(responseHeaders).length > 0 && (
                  <div className="border-b border-[var(--border)]">
                    <button
                      onClick={() => setShowHeaders((prev) => !prev)}
                      className="w-full flex items-center justify-between px-4 py-1.5 text-[11px] text-[var(--muted)] hover:text-[var(--fg)] bg-[var(--card)]/50 transition-colors"
                    >
                      <span>Response Headers ({Object.keys(responseHeaders).length})</span>
                      {showHeaders ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {showHeaders && (
                      <div className="p-3 bg-[var(--bg)] font-mono text-[11px] space-y-1 max-h-36 overflow-y-auto">
                        {Object.entries(responseHeaders).map(([k, v]) => (
                          <div key={k} className="flex gap-2">
                            <span className="text-blue-400 select-all">{k}:</span>
                            <span className="text-[var(--fg)] select-all">{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Response Body Display */}
                <div className="p-4 bg-[var(--bg)]">
                  {responseBody ? (
                    <pre className="font-mono text-xs text-[var(--fg)] overflow-x-auto max-h-72 p-2 rounded bg-[var(--card)] border border-[var(--border)] leading-relaxed">
                      {responseBody}
                    </pre>
                  ) : (
                    <div className="py-8 text-center text-[var(--muted)]">
                      Click <strong className="text-blue-400">Send</strong> to execute API request against {selectedTable}.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Code Snippets Tab */
            <div className="space-y-3">
              {/* Language Selector */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 bg-[var(--card)] p-1 rounded-lg border border-[var(--border)]">
                  {(['curl', 'js', 'python', 'go'] as const).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setSnippetLang(lang)}
                      className={`px-3 py-1 rounded text-xs font-mono font-medium transition-all ${
                        snippetLang === lang
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-[var(--muted)] hover:text-[var(--fg)]'
                      }`}
                    >
                      {lang === 'curl'
                        ? 'cURL'
                        : lang === 'js'
                        ? 'JavaScript'
                        : lang === 'python'
                        ? 'Python'
                        : 'Go'}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleCopyCode}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-all shadow-xs"
                >
                  {copiedCode ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Code</span>
                    </>
                  )}
                </button>
              </div>

              {/* Code Snippet Box */}
              <div className="relative border border-[var(--border)] rounded-xl bg-zinc-950 p-4 font-mono text-xs text-zinc-200 overflow-x-auto max-h-[500px]">
                <pre className="leading-relaxed">{generatedCode}</pre>
              </div>

              <div className="text-[11px] text-[var(--muted)] flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                <span>
                  Snippet automatically synchronizes with active filters, headers, body, and query parameters.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
