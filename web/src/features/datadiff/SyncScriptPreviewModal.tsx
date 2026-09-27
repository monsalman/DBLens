import React, { useState, useEffect, useCallback } from 'react'
import {
  X,
  Copy,
  Check,
  Download,
  Play,
  CheckCircle2,
  XCircle,
  Shield,
  Sparkles,
} from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  api,
  type SyncConflictStrategy,
  type SyncScriptResponse,
  type ApplySyncResponse,
  type RowDiffItem,
} from '../../lib/api'
import { useAppStore } from '../../stores/appStore'

export interface SyncScriptPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  sourceConnId: string
  sourceSchema?: string
  sourceTable: string
  targetConnId: string
  targetSchema?: string
  targetTable: string
  primaryKeys: string[]
  columns: string[]
  selectedRows: RowDiffItem[]
  sourceDialect?: string
  targetDialect: string
  isTargetReadOnly?: boolean
  strategy?: SyncConflictStrategy
  onStrategyChange?: (strategy: SyncConflictStrategy) => void
  onSyncApplied?: () => void
}

export const SyncScriptPreviewModal: React.FC<SyncScriptPreviewModalProps> = ({
  isOpen,
  onClose,
  sourceConnId,
  sourceSchema,
  sourceTable,
  targetConnId,
  targetSchema,
  targetTable,
  primaryKeys,
  columns,
  selectedRows,
  sourceDialect,
  targetDialect,
  isTargetReadOnly = false,
  strategy: propStrategy,
  onStrategyChange,
  onSyncApplied,
}) => {
  const connections = useAppStore((s) => s.connections)
  const [strategy, setStrategy] = useState<SyncConflictStrategy>(propStrategy || 'source_wins')
  const [deleteExcess, setDeleteExcess] = useState(false)
  const [scriptResp, setScriptResp] = useState<SyncScriptResponse | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [confirmMutate, setConfirmMutate] = useState(false)
  const [applyResult, setApplyResult] = useState<ApplySyncResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (propStrategy) {
      setStrategy(propStrategy)
    }
  }, [propStrategy])

  const handleStrategyChange = (newStrategy: SyncConflictStrategy) => {
    setStrategy(newStrategy)
    if (onStrategyChange) {
      onStrategyChange(newStrategy)
    }
  }

  const isTargetWins = strategy === 'target_wins'
  const effectiveConnId = isTargetWins ? sourceConnId : targetConnId
  const effectiveSchema = isTargetWins ? sourceSchema : targetSchema
  const effectiveTable = isTargetWins ? sourceTable : targetTable
  const effectiveProfile = connections.find((c) => c.id === effectiveConnId)
  const isEffectiveReadOnly = isTargetReadOnly || effectiveProfile?.readOnly || false

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true)
    setError(null)
    setApplyResult(null)
    try {
      const resp = await api.generateDataDiffSync(
        {
          sourceConnId,
          sourceSchema,
          sourceTable,
          sourceDialect,
          targetConnId,
          targetSchema,
          targetTable,
          primaryKeys,
          columns,
          strategy,
          deleteExcess,
          targetDialect,
          rows: selectedRows,
        },
        connections
      )
      setScriptResp(resp)
    } catch (err: any) {
      setError(err.message || 'Failed to generate sync script')
    } finally {
      setIsGenerating(false)
    }
  }, [
    sourceConnId,
    sourceSchema,
    sourceTable,
    sourceDialect,
    targetConnId,
    targetSchema,
    targetTable,
    primaryKeys,
    columns,
    strategy,
    deleteExcess,
    targetDialect,
    selectedRows,
    connections,
  ])

  useEffect(() => {
    if (isOpen) {
      handleGenerate()
    } else {
      setScriptResp(null)
      setApplyResult(null)
      setError(null)
      setConfirmMutate(false)
    }
  }, [isOpen, handleGenerate])

  const handleCopy = () => {
    if (!scriptResp?.sql) return
    navigator.clipboard.writeText(scriptResp.sql)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExport = () => {
    if (!scriptResp?.sql) return
    const blob = new Blob([scriptResp.sql], { type: 'application/sql;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sync_${effectiveTable || 'data'}.sql`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleApply = async () => {
    if (!scriptResp || !scriptResp.statements.length) return
    if (isEffectiveReadOnly) {
      setError(
        `Safe Mode Active: ${isTargetWins ? 'Source' : 'Target'} connection (${effectiveConnId}) is read-only. Database mutations are blocked.`
      )
      return
    }
    if (!confirmMutate) {
      setError('Please check the confirmation box before applying sync statements.')
      return
    }

    setIsApplying(true)
    setError(null)
    setApplyResult(null)

    try {
      const res = await api.applyDataDiffSync(
        {
          targetConnId: effectiveConnId,
          targetSchema: effectiveSchema,
          targetTable: effectiveTable,
          statements: scriptResp.statements,
          sql: scriptResp.sql,
          readOnly: false,
          confirmed: true,
        },
        connections
      )
      setApplyResult(res)
      if (onSyncApplied) {
        onSyncApplied()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to apply sync')
    } finally {
      setIsApplying(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col overflow-hidden font-mono text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] bg-[var(--hover)]/30">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--fg)]">Bi-Directional Sync Studio</h2>
              <p className="text-[11px] text-[var(--muted)]">
                Review and execute atomic DML statements to synchronize datasets
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Configuration Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-[var(--border)] bg-[var(--hover)]/10">
          {/* Strategy Selector */}
          <div className="flex items-center gap-2">
            <span className="text-[var(--muted)] font-medium">Sync Strategy:</span>
            <select
              value={strategy}
              onChange={(e) => handleStrategyChange(e.target.value as SyncConflictStrategy)}
              className="px-2.5 py-1 rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] focus:outline-hidden cursor-pointer"
            >
              <option value="source_wins">Source Wins (Update Target to match Source)</option>
              <option value="target_wins">Target Wins (Update Source to match Target)</option>
              <option value="insert_missing_only">Insert Missing Only (No updates or deletes)</option>
            </select>
          </div>

          {/* Target To Mutate Display */}
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-[var(--muted)]">Target to Mutate:</span>
            <span
              className={`px-2 py-0.5 rounded font-semibold border ${
                isTargetWins
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
              }`}
            >
              {isTargetWins ? `SOURCE: ${sourceConnId}` : `TARGET: ${targetConnId}`} ({effectiveTable})
            </span>
          </div>

          {/* Delete Excess Toggle */}
          {strategy !== 'insert_missing_only' && (
            <label className="flex items-center gap-2 cursor-pointer text-[11px] select-none text-[var(--fg)]">
              <input
                type="checkbox"
                checked={deleteExcess}
                onChange={(e) => setDeleteExcess(e.target.checked)}
                className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-0"
              />
              <span>Delete excess rows missing in origin</span>
              {deleteExcess && (
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 font-bold">
                  DESTRUCTIVE
                </span>
              )}
            </label>
          )}

          {/* Regenerate Button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-3 py-1 rounded-md border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover)] text-[var(--fg)] text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            {isGenerating ? 'Generating...' : 'Refresh Script'}
          </button>
        </div>

        {/* Summary Info */}
        {scriptResp && (
          <div className="flex items-center justify-between px-5 py-2 border-b border-[var(--border)] bg-[var(--bg)] text-[11px] text-[var(--muted)]">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                +{scriptResp.insertCount} Inserts
              </span>
              <span className="flex items-center gap-1.5 text-amber-400 font-semibold">
                ~{scriptResp.updateCount} Updates
              </span>
              <span className="flex items-center gap-1.5 text-rose-400 font-semibold">
                -{scriptResp.deleteCount} Deletes
              </span>
            </div>
            <div>
              Total Statements:{' '}
              <span className="font-bold text-[var(--fg)]">{scriptResp.statements.length}</span>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="m-4 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-rose-400 hover:text-rose-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Apply Success Alert */}
        {applyResult && (
          <div className="m-4 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                {applyResult.message} in {applyResult.durationMs}ms!
              </span>
            </div>
          </div>
        )}

        {/* Code Editor Preview */}
        <div className="flex-1 overflow-hidden p-4">
          <div className="h-72 border border-[var(--border)] rounded-lg overflow-hidden flex flex-col">
            <CodeMirror
              value={scriptResp?.sql || (isGenerating ? '-- Generating DML sync script...' : '-- No statements')}
              height="100%"
              extensions={[sql()]}
              theme={oneDark}
              editable={false}
              className="h-full text-xs font-mono"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-[var(--border)] bg-[var(--hover)]/30">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!scriptResp?.sql}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover)] text-[var(--fg)] transition-colors cursor-pointer disabled:opacity-50"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy SQL'}</span>
            </button>

            <button
              type="button"
              onClick={handleExport}
              disabled={!scriptResp?.sql}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover)] text-[var(--fg)] transition-colors cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export .sql</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Safe Mode indicator or confirmation checkbox */}
            {isEffectiveReadOnly ? (
              <div className="flex items-center gap-1.5 text-amber-400 font-semibold px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20">
                <Shield className="w-3.5 h-3.5" />
                <span>
                  Safe Mode Active ({isTargetWins ? 'Source' : 'Target'}: {effectiveConnId})
                </span>
              </div>
            ) : (
              <label className="flex items-center gap-2 text-[11px] text-[var(--muted)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={confirmMutate}
                  onChange={(e) => setConfirmMutate(e.target.checked)}
                  className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-0"
                />
                <span>Confirm database mutation on {effectiveConnId}</span>
              </label>
            )}

            <button
              type="button"
              onClick={handleApply}
              disabled={isApplying || isEffectiveReadOnly || !confirmMutate || !scriptResp?.statements.length}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
            >
              <Play className={`w-3.5 h-3.5 ${isApplying ? 'animate-spin' : ''}`} />
              <span>{isApplying ? 'Executing...' : 'Apply Sync'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
