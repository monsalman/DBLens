import React, { useState, useMemo } from 'react'
import { X, Sparkles, Copy, Check, Terminal } from 'lucide-react'
import {
  buildUpcomingPartitionDDL,
  type GeneratePartitionDDLRequest,
} from './partitionHelper'

interface AutoPartitionGeneratorModalProps {
  isOpen: boolean
  parentTable: string
  schema: string
  dialect: string
  partitionKey?: string
  onClose: () => void
  onExecuteDDL?: (sqlStatements: string[]) => Promise<void>
}

export const AutoPartitionGeneratorModal: React.FC<AutoPartitionGeneratorModalProps> = ({
  isOpen,
  parentTable,
  schema,
  dialect,
  partitionKey,
  onClose,
  onExecuteDDL,
}) => {
  const [interval, setInterval] = useState<'day' | 'month' | 'year'>('month')
  const [count, setCount] = useState<number>(3)
  const [startDate, setStartDate] = useState<string>('')
  const [keyInput, setKeyInput] = useState<string>(partitionKey || '')
  const [isCopied, setIsCopied] = useState<boolean>(false)
  const [isExecuting, setIsExecuting] = useState<boolean>(false)

  const generatedDDL = useMemo(() => {
    const req: GeneratePartitionDDLRequest = {
      parentTable,
      schema,
      dialect,
      strategy: 'range',
      partitionKey: keyInput,
      interval,
      count,
      startDate: startDate || undefined,
    }
    return buildUpcomingPartitionDDL(req)
  }, [parentTable, schema, dialect, keyInput, interval, count, startDate])

  if (!isOpen) return null

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedDDL.join('\n\n'))
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 1500)
  }

  const handleExecute = async () => {
    if (!onExecuteDDL) return
    setIsExecuting(true)
    try {
      await onExecuteDDL(generatedDDL)
      onClose()
    } catch (err: any) {
      alert(`Failed to execute DDL: ${err.message || err}`)
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl space-y-5 text-zinc-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-400" />
            <h2 className="text-base font-semibold text-white">Upcoming Partition Generator</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Configuration Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-zinc-400 mb-1 font-medium">Interval</label>
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value as any)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="month">Monthly</option>
              <option value="day">Daily</option>
              <option value="year">Yearly</option>
            </select>
          </div>

          <div>
            <label className="block text-zinc-400 mb-1 font-medium">Count ({count})</label>
            <input
              type="number"
              min={1}
              max={24}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(24, parseInt(e.target.value) || 1)))}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1 font-medium">Start Date (Optional)</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1 font-medium">Partition Key</label>
            <input
              type="text"
              placeholder="e.g. created_at"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none font-mono"
            />
          </div>
        </div>

        {/* Live DDL Preview */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium text-zinc-400">
              <Terminal className="h-3.5 w-3.5 text-zinc-500" />
              Live DDL Preview ({generatedDDL.length} statements)
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-zinc-400 hover:text-white transition-colors"
            >
              {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{isCopied ? 'Copied!' : 'Copy SQL'}</span>
            </button>
          </div>

          <div className="max-h-48 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 font-mono text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap select-text">
            {generatedDDL.join('\n\n')}
          </div>
        </div>

        {/* Actions Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          >
            <Copy className="h-3.5 w-3.5" />
            <span>Copy DDL</span>
          </button>

          {onExecuteDDL && (
            <button
              type="button"
              disabled={isExecuting}
              onClick={handleExecute}
              className="flex items-center gap-1.5 rounded-md border border-emerald-600 bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{isExecuting ? 'Applying...' : 'Apply DDL'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
