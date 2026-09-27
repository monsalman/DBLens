import { useState, useEffect, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  X,
  Layers,
  AlertTriangle,
  Play,
  CheckCircle2,
  Copy,
  Check,
  Clock,
  Rows,
  Database,
} from 'lucide-react'
import {
  MATERIALIZE_MODES,
  generateClientDDL,
  validateMaterializeForm,
  type MaterializeMode,
  type MaterializeRequest,
  type MaterializeResult,
} from './materializeHelper'
import { useMaterialize } from './useMaterialize'

interface MaterializeModalProps {
  isOpen: boolean
  onClose: () => void
  connId: string
  dialect?: string
  initialQuery: string
  initialRowsCount?: number
  initialColumns?: string[]
  activeSchema?: string
  isProduction?: boolean
  onSuccess?: (res: MaterializeResult) => void
}

export function MaterializeModal({
  isOpen,
  onClose,
  connId,
  dialect = 'postgres',
  initialQuery,
  initialRowsCount = 0,
  initialColumns = [],
  activeSchema = '',
  isProduction = false,
  onSuccess,
}: MaterializeModalProps) {
  const [mode, setMode] = useState<MaterializeMode>('create')
  const [targetTable, setTargetTable] = useState(() => `res_${Date.now().toString().slice(-4)}`)
  const [targetSchema, setTargetSchema] = useState(activeSchema)
  const [ttlMinutes, setTtlMinutes] = useState(60)
  const [overrideProduction, setOverrideProduction] = useState(false)
  const [copied, setCopied] = useState(false)
  const [successResult, setSuccessResult] = useState<MaterializeResult | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const isDark = typeof document !== 'undefined'
    ? document.documentElement.classList.contains('dark')
    : true

  const { execute, loading } = useMaterialize(connId, false)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isOpen) {
      closeBtnRef.current?.focus()
    }
  }, [isOpen])

  // Generate live DDL preview
  const currentRequest: MaterializeRequest = useMemo(() => {
    return {
      targetConnId: connId,
      sourceQuery: initialQuery,
      targetSchema: targetSchema.trim() || undefined,
      targetTable: targetTable.trim() || 'target_table',
      mode,
      columns: initialColumns,
      estimatedRows: initialRowsCount,
      ttlMinutes: mode === 'temp' ? ttlMinutes : 0,
      overrideProduction,
      isProduction,
    }
  }, [connId, initialQuery, targetSchema, targetTable, mode, initialColumns, initialRowsCount, ttlMinutes, overrideProduction, isProduction])

  const previewDDL = useMemo(() => {
    try {
      return generateClientDDL(dialect, currentRequest)
    } catch (err: unknown) {
      return `-- ${err instanceof Error ? err.message : String(err)}`
    }
  }, [dialect, currentRequest])

  const validation = useMemo(() => {
    return validateMaterializeForm(currentRequest, isProduction)
  }, [currentRequest, isProduction])

  if (!isOpen) return null

  const handleCopyDDL = () => {
    navigator.clipboard.writeText(previewDDL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExecute = async () => {
    if (!validation.valid) {
      const firstError = Object.values(validation.errors)[0]
      setLocalError(firstError)
      return
    }

    setLocalError(null)
    try {
      const res = await execute(currentRequest)
      setSuccessResult(res)
      if (onSuccess) {
        onSuccess(res)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setLocalError(msg)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="flex flex-col w-full max-w-2xl max-h-[90vh] bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-[var(--fg)] text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]/30">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Layers className="w-4 h-4 text-amber-500" />
            <span>Materialize Query Result</span>
            {isProduction && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">
                PROD SAFE MODE
              </span>
            )}
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            className="p-1 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Mode Selection Tabs */}
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1.5">
              Materialization Target Mode
            </label>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {MATERIALIZE_MODES.map((m) => {
                const isSelected = mode === m.id
                const isPgOnly = m.requiresPg && !dialect.toLowerCase().includes('postgres')
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={isPgOnly}
                    onClick={() => {
                      setMode(m.id)
                      setLocalError(null)
                    }}
                    className={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all ${
                      isSelected
                        ? 'border-amber-500 bg-amber-500/10 text-amber-400 font-medium'
                        : isPgOnly
                        ? 'border-[var(--border)]/50 bg-[var(--surface)]/20 text-[var(--muted)] opacity-50 cursor-not-allowed'
                        : 'border-[var(--border)] bg-[var(--surface)]/30 text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface)]'
                    }`}
                    title={isPgOnly ? 'PostgreSQL only' : m.shortDesc}
                  >
                    <span className="text-xs truncate">{m.label}</span>
                    <span className="text-[9px] text-[var(--muted)] mt-0.5 scale-90 truncate max-w-full">
                      {m.id === 'create' ? 'CTAS' : m.id === 'temp' ? 'Scratch' : m.id}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Form Inputs: Schema & Table */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                Target Schema (Optional)
              </label>
              <input
                type="text"
                value={targetSchema}
                onChange={(e) => setTargetSchema(e.target.value)}
                placeholder="public / main"
                className="w-full px-2.5 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] focus:outline-hidden focus:border-amber-500 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                Target Table / View Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={targetTable}
                onChange={(e) => setTargetTable(e.target.value)}
                placeholder="e.g. active_users_summary"
                className={`w-full px-2.5 py-1.5 rounded border bg-[var(--surface)] text-[var(--fg)] focus:outline-hidden font-mono text-xs ${
                  validation.errors.targetTable
                    ? 'border-red-500 focus:border-red-500'
                    : 'border-[var(--border)] focus:border-amber-500'
                }`}
              />
              {validation.errors.targetTable && (
                <p className="mt-1 text-[10px] text-red-400">{validation.errors.targetTable}</p>
              )}
            </div>
          </div>

          {/* Mode-specific options */}
          {mode === 'temp' && (
            <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-2">
              <div className="flex items-center gap-1.5 text-amber-400 font-medium">
                <Clock className="w-3.5 h-3.5" />
                <span>Scratchpad Auto-Expiration (TTL)</span>
              </div>
              <div className="flex items-center gap-2">
                {[
                  { label: '15 Mins', val: 15 },
                  { label: '30 Mins', val: 30 },
                  { label: '1 Hour', val: 60 },
                  { label: '6 Hours', val: 360 },
                  { label: '24 Hours', val: 1440 },
                  { label: 'None', val: 0 },
                ].map((opt) => (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() => setTtlMinutes(opt.val)}
                    className={`px-2 py-1 rounded text-[11px] border transition-colors ${
                      ttlMinutes === opt.val
                        ? 'border-amber-500 bg-amber-500/20 text-amber-300 font-medium'
                        : 'border-[var(--border)] hover:bg-[var(--surface)] text-[var(--muted)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--muted)]">
                Scratch tables can be promoted to permanent schema or purged at any time from the Scratchpad panel.
              </p>
            </div>
          )}

          {/* Production Replace Warning & Override */}
          {mode === 'replace' && isProduction && (
            <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 space-y-2 text-red-300">
              <div className="flex items-center gap-1.5 font-semibold text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Production Safe Mode Warning</span>
              </div>
              <p className="text-[11px]">
                REPLACE mode will run <code className="font-mono text-red-200">DROP TABLE IF EXISTS</code> before recreating.
                This is a destructive operation on a production database.
              </p>
              <label className="flex items-center gap-2 mt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={overrideProduction}
                  onChange={(e) => setOverrideProduction(e.target.checked)}
                  className="rounded border-[var(--border)] text-red-500 focus:ring-0"
                />
                <span className="text-[11px] font-medium text-red-200">
                  I understand and confirm dropping the existing table in production.
                </span>
              </label>
            </div>
          )}

          {/* Row count impact warning */}
          {initialRowsCount > 20000 && (
            <div className="p-2.5 rounded border border-amber-500/20 bg-amber-500/5 text-amber-400 text-[11px] flex items-center gap-2">
              <Rows className="w-3.5 h-3.5 shrink-0" />
              <span>
                Query result contains <strong>{initialRowsCount.toLocaleString()}</strong> rows.
                Materialization will execute server-side CTAS without transferring rows to the client.
              </span>
            </div>
          )}

          {/* DDL Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
              <div className="flex items-center gap-1.5 font-medium">
                <Database className="w-3.5 h-3.5 text-amber-500" />
                <span>Generated DDL Preview</span>
                <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">
                  {dialect}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyDDL}
                className="flex items-center gap-1 hover:text-[var(--fg)] transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy SQL'}</span>
              </button>
            </div>

            <div className="rounded-lg border border-[var(--border)] overflow-hidden font-mono text-[11px]">
              <CodeMirror
                value={previewDDL}
                readOnly
                theme={isDark ? oneDark : undefined}
                extensions={[sql()]}
                height="120px"
              />
            </div>
          </div>

          {/* Error Message */}
          {localError && (
            <div className="p-2.5 rounded bg-red-500/10 border border-red-500/25 text-red-400 text-[11px] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{localError}</span>
            </div>
          )}

          {/* Success Banner */}
          {successResult && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-400 text-xs">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Materialization Succeeded</span>
              </div>
              <p className="text-[11px]">{successResult.message}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--surface)]/20">
          <div className="text-[11px] text-[var(--muted)]">
            {initialRowsCount > 0 && <span>{initialRowsCount.toLocaleString()} rows</span>}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            >
              {successResult ? 'Done' : 'Cancel'}
            </button>

            {!successResult && (
              <button
                type="button"
                onClick={handleExecute}
                disabled={loading || !validation.valid}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-black font-semibold transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-black" />
                <span>{loading ? 'Materializing...' : 'Execute Materialization'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
