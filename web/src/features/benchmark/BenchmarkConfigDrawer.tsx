import React, { useState } from 'react'
import {
  Play,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Terminal,
  Copy,
  Check,
  Zap,
} from 'lucide-react'
import type { BenchmarkConfig } from './benchmarkHelper'
import { generateCliCommand } from './benchmarkHelper'

interface BenchmarkConfigDrawerProps {
  initialSql: string
  isRunning: boolean
  onRun: (cfg: BenchmarkConfig) => void
  onCancel: () => void
}

export const BenchmarkConfigDrawer: React.FC<BenchmarkConfigDrawerProps> = ({
  initialSql,
  isRunning,
  onRun,
  onCancel,
}) => {
  const [sql, setSql] = useState<string>(initialSql || 'SELECT 1;')
  const [concurrency, setConcurrency] = useState<number>(5)
  const [runMode, setRunMode] = useState<'duration' | 'iterations'>('duration')
  const [durationSec, setDurationSec] = useState<number>(5)
  const [iterations, setIterations] = useState<number>(100)
  const [rollback, setRollback] = useState<boolean>(false)
  const [assertP99Lt, setAssertP99Lt] = useState<string>('')
  const [label, setLabel] = useState<string>('')
  const [copiedCli, setCopiedCli] = useState<boolean>(false)

  // Detect mutating SQL
  const isMutating =
    /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i.test(sql.trim())

  const handleRun = () => {
    const cfg: BenchmarkConfig = {
      sql: sql.trim(),
      concurrency,
      durationSec: runMode === 'duration' ? durationSec : 0,
      iterations: runMode === 'iterations' ? iterations : 0,
      rollback,
      assertP99Lt: assertP99Lt ? parseFloat(assertP99Lt) : undefined,
      label: label.trim() || undefined,
    }
    onRun(cfg)
  }

  const handleCopyCli = () => {
    const cfg: BenchmarkConfig = {
      sql: sql.trim(),
      concurrency,
      durationSec: runMode === 'duration' ? durationSec : 0,
      iterations: runMode === 'iterations' ? iterations : 0,
      rollback,
      assertP99Lt: assertP99Lt ? parseFloat(assertP99Lt) : undefined,
    }
    const cmd = generateCliCommand(cfg)
    navigator.clipboard.writeText(cmd)
    setCopiedCli(true)
    setTimeout(() => setCopiedCli(false), 2000)
  }

  return (
    <div className="space-y-5 text-sm text-zinc-300">
      {/* Target SQL Query */}
      <div>
        <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
          Benchmark Target SQL Query
        </label>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={5}
          disabled={isRunning}
          placeholder="SELECT * FROM table WHERE ..."
          className="w-full bg-zinc-950 font-mono text-xs border border-zinc-800 rounded-lg p-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all resize-y"
        />
        {isMutating && !rollback && (
          <div className="mt-2 flex items-start gap-2 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Mutating query detected!</span>{' '}
              Running stress tests on write queries without transaction rollback will repeatedly insert, update, or delete actual rows.
              Enable <span className="underline font-semibold">Rollback Mode</span> below to safely discard writes.
            </div>
          </div>
        )}
      </div>

      {/* Grid: Concurrency & Mode */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Concurrency slider */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
              <Sliders className="w-3.5 h-3.5 text-sky-400" />
              Concurrency (Workers)
            </div>
            <span className="text-xs font-mono font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded">
              {concurrency} threads
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={50}
            step={1}
            value={concurrency}
            disabled={isRunning}
            onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
            className="w-full accent-sky-500 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
          />
          <div className="flex justify-between text-[11px] text-zinc-500 mt-1">
            <span>1 (single)</span>
            <span>10</span>
            <span>25</span>
            <span>50 (heavy)</span>
          </div>
        </div>

        {/* Execution Mode */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-300">Execution Limit Mode</span>
            <div className="flex bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 text-[11px]">
              <button
                type="button"
                onClick={() => setRunMode('duration')}
                className={`px-2 py-1 rounded transition-colors ${
                  runMode === 'duration'
                    ? 'bg-zinc-800 text-sky-400 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Duration
              </button>
              <button
                type="button"
                onClick={() => setRunMode('iterations')}
                className={`px-2 py-1 rounded transition-colors ${
                  runMode === 'iterations'
                    ? 'bg-zinc-800 text-sky-400 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Iterations
              </button>
            </div>
          </div>

          {runMode === 'duration' ? (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                {[3, 5, 10, 30].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    disabled={isRunning}
                    onClick={() => setDurationSec(sec)}
                    className={`flex-1 py-1 text-xs rounded-md border transition-all ${
                      durationSec === sec
                        ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-medium'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-zinc-500">Run continuously for {durationSec} seconds</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                {[50, 100, 500, 1000].map((count) => (
                  <button
                    key={count}
                    type="button"
                    disabled={isRunning}
                    onClick={() => setIterations(count)}
                    className={`flex-1 py-1 text-xs rounded-md border transition-all ${
                      iterations === count
                        ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-medium'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-zinc-500">
                Stop exactly after {iterations.toLocaleString()} total queries
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Toggles & Options */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Rollback Mode */}
        <label className="flex items-start gap-2.5 p-3 bg-zinc-900/50 border border-zinc-800 rounded-xl cursor-pointer hover:border-zinc-700 transition-colors">
          <input
            type="checkbox"
            checked={rollback}
            disabled={isRunning}
            onChange={(e) => setRollback(e.target.checked)}
            className="mt-0.5 rounded border-zinc-700 bg-zinc-950 text-sky-500 focus:ring-0"
          />
          <div>
            <div className="text-xs font-medium text-zinc-200 flex items-center gap-1">
              <RotateCcw className="w-3 h-3 text-emerald-400" />
              Rollback Writes
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5">
              Wraps queries in BEGIN ... ROLLBACK so no rows persist.
            </div>
          </div>
        </label>

        {/* Quality Gate P99 SLA */}
        <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-xl">
          <div className="text-xs font-medium text-zinc-200 flex items-center gap-1 mb-1">
            <Zap className="w-3 h-3 text-amber-400" />
            Assert P99 Latency &lt; (ms)
          </div>
          <input
            type="number"
            value={assertP99Lt}
            disabled={isRunning}
            onChange={(e) => setAssertP99Lt(e.target.value)}
            placeholder="e.g. 50 (optional)"
            className="w-full bg-zinc-950 text-xs border border-zinc-800 rounded-md px-2 py-1 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>

        {/* Benchmark Label */}
        <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-xl">
          <div className="text-xs font-medium text-zinc-200 mb-1">Run Label (Optional)</div>
          <input
            type="text"
            value={label}
            disabled={isRunning}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. With B-Tree Index"
            className="w-full bg-zinc-950 text-xs border border-zinc-800 rounded-md px-2 py-1 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
        <button
          type="button"
          onClick={handleCopyCli}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors"
        >
          {copiedCli ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Copied CLI command!</span>
            </>
          ) : (
            <>
              <Terminal className="w-3.5 h-3.5 text-sky-400" />
              <Copy className="w-3.5 h-3.5 opacity-60" />
              <span>Copy CLI Command</span>
            </>
          )}
        </button>

        <div className="flex items-center gap-3">
          {isRunning ? (
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white shadow-lg transition-all"
            >
              Cancel Benchmark
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRun}
              disabled={!sql.trim()}
              className="flex items-center gap-2 px-6 py-2 text-xs font-semibold rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white shadow-lg shadow-sky-500/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Start Concurrency Benchmark
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
