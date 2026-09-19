import React, { useState, useEffect, useRef, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  X,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  Code2,
  FolderTree,
  AlertCircle,
  Sparkles,
  Minimize2,
  Edit2,
  CheckCheck,
} from 'lucide-react'
import {
  parseJsonSafely,
  generateDialectSqlPath,
  setValueByPath,
  formatJsonPath,
} from './jsonPathHelper.ts'

export interface JsonStudioModalProps {
  isOpen: boolean
  initialValue: any
  columnName: string
  tableName?: string
  dialect?: string
  readOnly?: boolean
  onClose: () => void
  onSave?: (newValue: string) => void
}

type DialectType = 'postgres' | 'mysql' | 'sqlite'

interface TreeNodeProps {
  name?: string | number
  value: any
  path: string
  activePath: string
  onSelectPath: (path: string) => void
  onUpdateValue: (path: string, newVal: any) => void
  readOnly?: boolean
  depth: number
}

const JsonTreeNode: React.FC<TreeNodeProps> = ({
  name,
  value,
  path,
  activePath,
  onSelectPath,
  onUpdateValue,
  readOnly,
  depth,
}) => {
  const [isOpen, setIsOpen] = useState(depth < 2)
  const [isEditing, setIsEditing] = useState(false)
  const [editInput, setEditInput] = useState('')

  const isSelected = activePath === path
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value)
  const isArray = Array.isArray(value)
  const isContainer = isObject || isArray

  const type =
    value === null
      ? 'null'
      : isArray
        ? 'array'
        : isObject
          ? 'object'
          : typeof value

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (readOnly || isContainer) return
    setEditInput(value === null ? 'null' : String(value))
    setIsEditing(true)
  }

  const handleSaveEdit = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation()
    let parsedVal: any = editInput
    if (editInput === 'null') {
      parsedVal = null
    } else if (editInput === 'true') {
      parsedVal = true
    } else if (editInput === 'false') {
      parsedVal = false
    } else if (type === 'number' && !isNaN(Number(editInput)) && editInput.trim() !== '') {
      parsedVal = Number(editInput)
    } else if (type === 'string') {
      parsedVal = editInput
    }
    onUpdateValue(path, parsedVal)
    setIsEditing(false)
  }

  const handleCancelEdit = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation()
    setIsEditing(false)
  }

  return (
    <div className="flex flex-col text-xs font-mono">
      <div
        onClick={() => onSelectPath(path)}
        className={`flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer transition-colors group ${
          isSelected
            ? 'bg-indigo-500/20 text-indigo-300 font-semibold ring-1 ring-indigo-500/50'
            : 'hover:bg-[var(--hover)] text-[var(--fg)]'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Toggle chevron for containers */}
        {isContainer ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setIsOpen((prev) => !prev)
            }}
            className="w-4 h-4 flex items-center justify-center text-[var(--muted)] hover:text-[var(--fg)] p-0.5 rounded cursor-pointer"
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-4" />
        )}

        {/* Key or index */}
        {name !== undefined && (
          <span className="text-cyan-400 font-medium select-none">
            {name}
            <span className="text-[var(--muted)] mr-1">:</span>
          </span>
        )}

        {/* Value or container indicator */}
        {isContainer ? (
          <span className="flex items-center gap-1.5">
            <span className="text-[var(--muted)]">
              {isArray ? `[${value.length}]` : `{${Object.keys(value).length}}`}
            </span>
            <span
              className={`text-[10px] px-1 py-0.2 rounded uppercase font-semibold ${
                isArray
                  ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                  : 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
              }`}
            >
              {isArray ? 'array' : 'object'}
            </span>
          </span>
        ) : isEditing ? (
          <div
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {type === 'boolean' ? (
              <select
                value={editInput}
                onChange={(e) => setEditInput(e.target.value)}
                className="bg-[var(--surface)] border border-indigo-500 rounded px-1 py-0.5 text-xs text-[var(--fg)]"
                autoFocus
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                type="text"
                value={editInput}
                onChange={(e) => setEditInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveEdit(e)
                  if (e.key === 'Escape') handleCancelEdit(e)
                }}
                className="bg-[var(--surface)] border border-indigo-500 rounded px-1.5 py-0.5 text-xs text-[var(--fg)] min-w-[120px] focus:outline-none"
                autoFocus
              />
            )}
            <button
              type="button"
              onClick={handleSaveEdit}
              title="Apply (Enter)"
              className="p-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <Check className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={handleCancelEdit}
              title="Cancel (Esc)"
              className="p-1 rounded bg-[var(--hover)] hover:bg-[var(--border)] text-[var(--muted)]"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div
            className="flex items-center gap-1.5 group/val"
            onDoubleClick={handleStartEdit}
          >
            <span
              className={
                type === 'string'
                  ? 'text-emerald-400'
                  : type === 'number'
                    ? 'text-amber-400'
                    : type === 'boolean'
                      ? 'text-purple-400'
                      : 'text-zinc-500 italic'
              }
            >
              {type === 'string' ? `"${value}"` : String(value)}
            </span>
            <span
              className={`text-[9px] px-1 rounded uppercase ${
                type === 'string'
                  ? 'text-emerald-500/80 bg-emerald-500/10'
                  : type === 'number'
                    ? 'text-amber-500/80 bg-amber-500/10'
                    : type === 'boolean'
                      ? 'text-purple-500/80 bg-purple-500/10'
                      : 'text-zinc-500 bg-zinc-500/10'
              }`}
            >
              {type}
            </span>
            {!readOnly && (
              <button
                type="button"
                onClick={handleStartEdit}
                title="Edit value in place"
                className="opacity-0 group-hover/val:opacity-100 text-[var(--muted)] hover:text-indigo-400 p-0.5 rounded cursor-pointer transition-opacity"
              >
                <Edit2 className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Children */}
      {isContainer && isOpen && (
        <div className="flex flex-col">
          {isArray
            ? value.map((item: any, idx: number) => (
                <JsonTreeNode
                  key={idx}
                  name={idx}
                  value={item}
                  path={`${path}[${idx}]`}
                  activePath={activePath}
                  onSelectPath={onSelectPath}
                  onUpdateValue={onUpdateValue}
                  readOnly={readOnly}
                  depth={depth + 1}
                />
              ))
            : Object.keys(value).map((k) => (
                <JsonTreeNode
                  key={k}
                  name={k}
                  value={value[k]}
                  path={formatJsonPath([...(path === '$' ? [] : [path]), k]).replace(/^\$\.?\$/, '$')}
                  activePath={activePath}
                  onSelectPath={onSelectPath}
                  onUpdateValue={onUpdateValue}
                  readOnly={readOnly}
                  depth={depth + 1}
                />
              ))}
        </div>
      )}
    </div>
  )
}

export const JsonStudioModal: React.FC<JsonStudioModalProps> = ({
  isOpen,
  initialValue,
  columnName,
  tableName,
  dialect = 'postgres',
  readOnly = false,
  onClose,
  onSave,
}) => {
  const [viewMode, setViewMode] = useState<'tree' | 'raw'>('tree')
  const [activeJsonPath, setActiveJsonPath] = useState<string>('$')
  const [activeDialect, setActiveDialect] = useState<DialectType>(() => {
    const d = (dialect || '').toLowerCase()
    if (d.includes('sqlite')) return 'sqlite'
    if (d.includes('mysql') || d.includes('mariadb')) return 'mysql'
    return 'postgres'
  })

  const initialParsed = useMemo(() => {
    const parsedRes = parseJsonSafely(initialValue)
    if (parsedRes.isJson) {
      return {
        data: parsedRes.parsed,
        rawText: JSON.stringify(parsedRes.parsed, null, 2),
        error: null,
      }
    }
    const fallbackStr =
      typeof initialValue === 'string'
        ? initialValue
        : JSON.stringify(initialValue ?? {})
    try {
      const p = JSON.parse(fallbackStr)
      return { data: p, rawText: fallbackStr, error: null }
    } catch (err: any) {
      return {
        data: null,
        rawText: fallbackStr,
        error: err?.message || 'Invalid JSON format',
      }
    }
  }, [initialValue])

  const [data, setData] = useState<any>(initialParsed.data)
  const [rawText, setRawText] = useState<string>(initialParsed.rawText)
  const [validationError, setValidationError] = useState<string | null>(initialParsed.error)

  const [prevInitialValue, setPrevInitialValue] = useState(initialValue)
  if (prevInitialValue !== initialValue) {
    setPrevInitialValue(initialValue)
    setData(initialParsed.data)
    setRawText(initialParsed.rawText)
    setValidationError(initialParsed.error)
    setActiveJsonPath('$')
  }

  const [copiedPath, setCopiedPath] = useState(false)
  const [copiedSql, setCopiedSql] = useState(false)

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

  // Sync dark mode
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

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Handle tree node value update
  const handleTreeValueUpdate = (path: string, newVal: any) => {
    const nextData = setValueByPath(data, path, newVal)
    setData(nextData)
    setRawText(JSON.stringify(nextData, null, 2))
    setValidationError(null)
  }

  // Handle raw text changes in CodeMirror
  const handleRawChange = (newVal: string) => {
    setRawText(newVal)
    try {
      const parsed = JSON.parse(newVal)
      setData(parsed)
      setValidationError(null)
    } catch (err: any) {
      setValidationError(err?.message || 'Invalid JSON syntax')
    }
  }

  // Prettify action
  const handlePrettify = () => {
    try {
      const parsed = JSON.parse(rawText)
      const formatted = JSON.stringify(parsed, null, 2)
      setRawText(formatted)
      setData(parsed)
      setValidationError(null)
    } catch (err: any) {
      setValidationError(err?.message || 'Cannot format invalid JSON')
    }
  }

  // Minify action
  const handleMinify = () => {
    try {
      const parsed = JSON.parse(rawText)
      const minified = JSON.stringify(parsed)
      setRawText(minified)
      setData(parsed)
      setValidationError(null)
    } catch (err: any) {
      setValidationError(err?.message || 'Cannot minify invalid JSON')
    }
  }

  // Copy JSONPath
  const handleCopyJsonPath = () => {
    navigator.clipboard.writeText(activeJsonPath)
    setCopiedPath(true)
    setTimeout(() => setCopiedPath(false), 1500)
  }

  // Generated dialect SQL path
  const sqlSnippet = useMemo(() => {
    return generateDialectSqlPath(activeDialect, columnName, activeJsonPath)
  }, [activeDialect, columnName, activeJsonPath])

  // Copy SQL Snippet
  const handleCopySql = () => {
    navigator.clipboard.writeText(sqlSnippet)
    setCopiedSql(true)
    setTimeout(() => setCopiedSql(false), 1500)
  }

  // Apply / Save changes
  const handleSave = () => {
    if (readOnly || !onSave) return
    if (validationError) return

    try {
      const parsed = JSON.parse(rawText)
      const finalJsonStr = JSON.stringify(parsed)
      onSave(finalJsonStr)
      onClose()
    } catch (err: any) {
      setValidationError(err?.message || 'Please fix JSON syntax before saving')
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-2xl flex flex-col w-full max-w-4xl max-h-[88vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg)]">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-indigo-500/10 text-indigo-400 font-mono text-xs font-bold">
              {'{ }'}
            </span>
            <h3 className="font-semibold text-xs text-[var(--fg)]">
              JSON Document Studio
            </h3>
            {tableName && (
              <span className="text-[11px] text-[var(--muted)] font-mono">
                {tableName}.
              </span>
            )}
            <span className="text-[11px] font-mono text-cyan-400 font-medium">
              {columnName}
            </span>
            {readOnly && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 font-mono">
                Read-only
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center rounded bg-[var(--surface)] p-0.5 border border-[var(--border)] text-xs font-mono">
              <button
                type="button"
                onClick={() => {
                  if (viewMode === 'raw' && !validationError) {
                    try {
                      const p = JSON.parse(rawText)
                      setData(p)
                    } catch {}
                  }
                  setViewMode('tree')
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
                  viewMode === 'tree'
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <FolderTree className="w-3 h-3" />
                Tree
              </button>
              <button
                type="button"
                onClick={() => {
                  if (viewMode === 'tree' && data !== null) {
                    setRawText(JSON.stringify(data, null, 2))
                  }
                  setViewMode('raw')
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
                  viewMode === 'raw'
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <Code2 className="w-3 h-3" />
                Raw JSON
              </button>
            </div>

            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="text-[var(--muted)] hover:text-[var(--fg)] p-1 rounded hover:bg-[var(--hover)] transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* JSONPath & Dialect SQL Breadcrumb Bar */}
        <div className="bg-[var(--bg)]/60 border-b border-[var(--border)] px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-2 flex-1 min-w-[280px]">
            <span className="text-[10px] uppercase font-bold text-[var(--muted)] shrink-0">
              JSONPath:
            </span>
            <div className="flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 flex-1 overflow-hidden">
              <span className="text-indigo-400 font-semibold truncate select-all">
                {activeJsonPath}
              </span>
              <button
                type="button"
                onClick={handleCopyJsonPath}
                title="Copy JSONPath"
                className="ml-auto text-[var(--muted)] hover:text-[var(--fg)] p-0.5 rounded shrink-0 cursor-pointer"
              >
                {copiedPath ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[320px]">
            {/* Dialect Selector */}
            <select
              value={activeDialect}
              onChange={(e) => setActiveDialect(e.target.value as DialectType)}
              className="bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-1 text-[11px] font-mono text-[var(--fg)] focus:outline-none cursor-pointer"
            >
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL</option>
              <option value="sqlite">SQLite</option>
            </select>

            {/* SQL Snippet Preview */}
            <div className="flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 flex-1 overflow-hidden">
              <span className="text-emerald-400 truncate select-all">
                {sqlSnippet}
              </span>
              <button
                type="button"
                onClick={handleCopySql}
                title="Copy SQL Snippet"
                className="ml-auto text-[var(--muted)] hover:text-[var(--fg)] p-0.5 rounded shrink-0 cursor-pointer"
              >
                {copiedSql ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto min-h-[340px] max-h-[500px] p-3">
          {viewMode === 'tree' ? (
            data !== null ? (
              <div className="rounded border border-[var(--border)] bg-[var(--bg)] p-2">
                <JsonTreeNode
                  value={data}
                  path="$"
                  activePath={activeJsonPath}
                  onSelectPath={(p) => setActiveJsonPath(p)}
                  onUpdateValue={handleTreeValueUpdate}
                  readOnly={readOnly}
                  depth={0}
                />
              </div>
            ) : (
              <div className="p-8 text-center text-xs font-mono text-[var(--muted)]">
                Cannot display tree: invalid or empty JSON document.
              </div>
            )
          ) : (
            <div className="flex flex-col h-full gap-2">
              {/* Toolbar */}
              <div className="flex items-center justify-between gap-2 pb-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrettify}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--hover)] text-[11px] font-mono text-[var(--fg)] transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    Format / Prettify
                  </button>
                  <button
                    type="button"
                    onClick={handleMinify}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--hover)] text-[11px] font-mono text-[var(--fg)] transition-colors cursor-pointer"
                  >
                    <Minimize2 className="w-3 h-3 text-cyan-400" />
                    Minify
                  </button>
                </div>

                {validationError ? (
                  <div className="flex items-center gap-1 text-[11px] font-mono text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span className="truncate max-w-[340px]">{validationError}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-[11px] font-mono text-emerald-400">
                    <CheckCheck className="w-3 h-3 shrink-0" />
                    <span>Valid JSON</span>
                  </div>
                )}
              </div>

              {/* CodeMirror */}
              <div className="rounded border border-[var(--border)] overflow-hidden flex-1">
                <CodeMirror
                  value={rawText}
                  height="360px"
                  theme={isDark ? oneDark : 'light'}
                  readOnly={readOnly}
                  editable={!readOnly}
                  onChange={handleRawChange}
                  basicSetup={{
                    lineNumbers: true,
                    foldGutter: true,
                    highlightActiveLine: !readOnly,
                  }}
                  className="text-xs font-mono"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] bg-[var(--bg)]">
          <div className="text-[11px] font-mono text-[var(--muted)]">
            {viewMode === 'tree'
              ? 'Click any node to extract JSONPath & dialect SQL'
              : 'Edit raw JSON or format/minify'}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-xs font-mono rounded bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--hover)] text-[var(--fg)] transition-colors cursor-pointer"
            >
              Close
            </button>
            {!readOnly && onSave && (
              <button
                type="button"
                onClick={handleSave}
                disabled={!!validationError}
                className="px-3 py-1 text-xs font-mono font-medium rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                Apply / Save Changes
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
