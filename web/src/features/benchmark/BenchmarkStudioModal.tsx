import React, { useState, useEffect } from 'react'
import {
  X,
  Gauge,
  Sliders,
  BarChart3,
  GitCompare,
  Download,
  Copy,
  Check,
  RotateCcw,
  Zap,
  Code2,
  Trash2,
  History,
} from 'lucide-react'
import type { ConnectionConfig } from '../../lib/api'
import type { BenchmarkConfig, BenchmarkResult } from './benchmarkHelper'
import {
  generateMarkdownReport,
  formatLatency,
  formatQps,
} from './benchmarkHelper'
import { useBenchmark } from './useBenchmark'
import { BenchmarkConfigDrawer } from './BenchmarkConfigDrawer'
import { QpsLiveGauge } from './QpsLiveGauge'
import { LatencyDistributionChart } from './LatencyDistributionChart'
import { BenchmarkComparisonView } from './BenchmarkComparisonView'

interface BenchmarkStudioModalProps {
  isOpen: boolean
  onClose: () => void
  connId: string | null
  initialSql?: string
  profiles?: ConnectionConfig[]
}

type TabType = 'configure' | 'live' | 'results' | 'compare'

export const BenchmarkStudioModal: React.FC<BenchmarkStudioModalProps> = ({
  isOpen,
  onClose,
  connId,
  initialSql = 'SELECT 1;',
  profiles,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('configure')
  const [copiedMd, setCopiedMd] = useState<boolean>(false)
  const [showRawJson, setShowRawJson] = useState<boolean>(false)

  const {
    isRunning,
    activeProgress,
    result,
    error,
    history,
    startBenchmark,
    cancelBenchmark,
    deleteFromHistory,
    setResult,
  } = useBenchmark({ connId: connId || '', profiles })

  // Auto switch tabs on run complete
  useEffect(() => {
    if (!isRunning && result && activeTab === 'live') {
      const timer = setTimeout(() => setActiveTab('results'), 50)
      return () => clearTimeout(timer)
    }
  }, [isRunning, result, activeTab])

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (!isRunning) {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isRunning, onClose])

  if (!isOpen) return null

  const handleStart = async (cfg: BenchmarkConfig) => {
    setActiveTab('live')
    await startBenchmark(cfg)
  }

  const handleCopyReport = (res: BenchmarkResult) => {
    const md = generateMarkdownReport(res)
    navigator.clipboard.writeText(md)
    setCopiedMd(true)
    setTimeout(() => setCopiedMd(false), 2000)
  }

  const handleDownloadReport = (res: BenchmarkResult) => {
    const md = generateMarkdownReport(res)
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `benchmark_report_${res.id}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-5xl h-[88vh] max-h-[850px] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-sky-500/20 to-blue-600/10 border border-sky-500/30 text-sky-400">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-zinc-100">
                  Query Latency Benchmark Studio
                </h2>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                  Feature-48
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Multi-worker concurrency stress tester, latency distribution & A/B comparison studio
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tab navigation pills */}
            <div className="flex bg-zinc-900 border border-zinc-800 rounded-xl p-1 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('configure')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'configure'
                    ? 'bg-zinc-800 text-sky-400 font-semibold shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                Configure
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('live')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'live'
                    ? 'bg-zinc-800 text-sky-400 font-semibold shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Gauge className="w-3.5 h-3.5" />
                Live Run
                {isRunning && (
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('results')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'results'
                    ? 'bg-zinc-800 text-sky-400 font-semibold shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                Results
                {result && <span className="text-[10px] text-zinc-400 font-mono">({result.id})</span>}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('compare')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'compare'
                    ? 'bg-zinc-800 text-sky-400 font-semibold shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <GitCompare className="w-3.5 h-3.5" />
                A/B Compare
                {history.length >= 2 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body with Scroll */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center justify-between">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setActiveTab('configure')}
                className="underline font-semibold hover:text-rose-200"
              >
                Back to Config
              </button>
            </div>
          )}

          {/* TAB 1: CONFIGURE */}
          {activeTab === 'configure' && (
            <BenchmarkConfigDrawer
              initialSql={result?.sql || initialSql}
              isRunning={isRunning}
              onRun={handleStart}
              onCancel={cancelBenchmark}
            />
          )}

          {/* TAB 2: LIVE RUN */}
          {activeTab === 'live' && (
            <div className="space-y-6">
              <QpsLiveGauge
                currentQps={activeProgress?.currentQps || 0}
                percent={activeProgress?.percent || 0}
                elapsedMs={activeProgress?.elapsedMs || 0}
                totalQueries={activeProgress?.totalQueries || 0}
                successfulQueries={activeProgress?.successfulQueries || 0}
                failedQueries={activeProgress?.failedQueries || 0}
                status={activeProgress?.status || (isRunning ? 'running' : 'idle')}
              />

              {isRunning && (
                <div className="flex items-center justify-center pt-4">
                  <button
                    type="button"
                    onClick={cancelBenchmark}
                    className="px-6 py-2 rounded-lg bg-rose-600/90 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg transition-all"
                  >
                    Cancel Running Benchmark
                  </button>
                </div>
              )}

              {!isRunning && !activeProgress && (
                <div className="p-8 text-center text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-xl">
                  No active benchmark session. Go to Configure tab and click Start.
                </div>
              )}
            </div>
          )}

          {/* TAB 3: RESULTS */}
          {activeTab === 'results' && (
            <>
              {result ? (
                <div className="space-y-6">
                  {/* Results Header Card */}
                  <div className="p-5 bg-zinc-950/80 border border-zinc-800 rounded-xl flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-zinc-100 font-mono">
                          {result.id}
                        </span>
                        {result.label && (
                          <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium">
                            {result.label}
                          </span>
                        )}
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                          {result.status}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-400 mt-1 flex items-center gap-4">
                        <span>{result.concurrency} concurrent workers</span>
                        <span>•</span>
                        <span>{(result.durationMs / 1000).toFixed(2)}s wall duration</span>
                        <span>•</span>
                        <span>{result.totalQueries.toLocaleString()} total queries</span>
                        {result.rollback && (
                          <>
                            <span>•</span>
                            <span className="text-emerald-400 font-medium">Rollback Active</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyReport(result)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs font-medium text-zinc-300 transition-colors"
                      >
                        {copiedMd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedMd ? 'Copied' : 'Copy Report'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadReport(result)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs font-medium text-zinc-300 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Export .md
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('configure')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 text-sky-400 rounded-lg text-xs font-semibold transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Tune &amp; Re-run
                      </button>
                    </div>
                  </div>

                  {/* Quality Gate SLA Result */}
                  {result.assertPassed !== undefined && (
                    <div
                      className={`p-3.5 rounded-xl border flex items-center justify-between text-xs ${
                        result.assertPassed
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 shrink-0" />
                        <span className="font-semibold">
                          Quality Gate SLA Assertion:
                        </span>
                        <span>
                          {result.assertPassed
                            ? 'PASSED (P99 latency satisfies threshold)'
                            : 'FAILED (P99 latency violated quality gate)'}
                        </span>
                      </div>
                      <span className="font-mono font-bold">
                        P99 = {formatLatency(result.p99LatencyMs)}
                      </span>
                    </div>
                  )}

                  {/* Primary KPI Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="p-3.5 bg-zinc-950/70 border border-zinc-800/80 rounded-xl">
                      <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                        Throughput (QPS)
                      </div>
                      <div className="text-xl font-bold font-mono text-sky-400 mt-1">
                        {formatQps(result.qps)}
                      </div>
                    </div>
                    <div className="p-3.5 bg-zinc-950/70 border border-zinc-800/80 rounded-xl">
                      <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                        P50 Median
                      </div>
                      <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                        {formatLatency(result.p50LatencyMs)}
                      </div>
                    </div>
                    <div className="p-3.5 bg-zinc-950/70 border border-zinc-800/80 rounded-xl">
                      <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                        P95 Latency
                      </div>
                      <div className="text-xl font-bold font-mono text-amber-400 mt-1">
                        {formatLatency(result.p95LatencyMs)}
                      </div>
                    </div>
                    <div className="p-3.5 bg-zinc-950/70 border border-zinc-800/80 rounded-xl">
                      <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                        P99 Latency
                      </div>
                      <div className="text-xl font-bold font-mono text-rose-400 mt-1">
                        {formatLatency(result.p99LatencyMs)}
                      </div>
                    </div>
                  </div>

                  {/* Latency Distribution Histogram */}
                  <div>
                    <LatencyDistributionChart
                      buckets={result.histogram}
                      p50={result.p50LatencyMs}
                      p95={result.p95LatencyMs}
                      p99={result.p99LatencyMs}
                      minLatencyMs={result.minLatencyMs}
                      maxLatencyMs={result.maxLatencyMs}
                      totalQueries={result.successfulQueries}
                    />
                  </div>

                  {/* Detailed Latency Statistics Table */}
                  <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/60">
                    <div className="px-4 py-2 bg-zinc-900/50 border-b border-zinc-800 text-xs font-semibold text-zinc-300">
                      Percentiles &amp; Latency Dispersion
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-zinc-800/60 text-center py-3 text-xs">
                      <div>
                        <div className="text-[11px] text-zinc-400">Min</div>
                        <div className="font-mono font-medium text-zinc-200 mt-0.5">
                          {formatLatency(result.minLatencyMs)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-zinc-400">Mean (Avg)</div>
                        <div className="font-mono font-medium text-zinc-200 mt-0.5">
                          {formatLatency(result.meanLatencyMs)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-zinc-400">P90</div>
                        <div className="font-mono font-medium text-zinc-200 mt-0.5">
                          {formatLatency(result.p90LatencyMs)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-zinc-400">Max</div>
                        <div className="font-mono font-medium text-zinc-200 mt-0.5">
                          {formatLatency(result.maxLatencyMs)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Errors if any */}
                  {result.errors && result.errors.length > 0 && (
                    <div className="border border-rose-500/30 rounded-xl p-4 bg-rose-500/5">
                      <div className="text-xs font-semibold text-rose-400 mb-2">
                        Errors Encountered ({result.failedQueries} failed queries)
                      </div>
                      <div className="space-y-1">
                        {result.errors.map((err, i) => (
                          <div key={i} className="flex justify-between text-xs font-mono text-rose-300">
                            <span className="truncate pr-4">{err.message}</span>
                            <span className="shrink-0">{err.count} occurrences</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SQL Statement Card */}
                  <div className="p-4 bg-zinc-950/70 border border-zinc-800 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400">
                        <Code2 className="w-3.5 h-3.5 text-sky-400" />
                        Executed Query Statement
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowRawJson(!showRawJson)}
                        className="text-[11px] text-zinc-400 hover:text-zinc-200 underline"
                      >
                        {showRawJson ? 'Hide Raw JSON' : 'Show Raw JSON'}
                      </button>
                    </div>
                    <pre className="font-mono text-xs text-zinc-300 p-3 bg-zinc-900 rounded-lg overflow-x-auto">
                      {result.sql}
                    </pre>

                    {showRawJson && (
                      <pre className="font-mono text-[11px] text-zinc-400 p-3 bg-zinc-900 rounded-lg overflow-x-auto mt-3 max-h-48 border border-zinc-800">
                        {JSON.stringify(result, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-xl">
                  No benchmark results available yet. Configure and run a test first.
                </div>
              )}
            </>
          )}

          {/* TAB 4: A/B COMPARE */}
          {activeTab === 'compare' && (
            <BenchmarkComparisonView
              history={history}
              defaultCandidate={result || undefined}
            />
          )}

          {/* Recent Runs History Bar */}
          {history.length > 0 && activeTab !== 'compare' && (
            <div className="pt-4 border-t border-zinc-800/80">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 mb-2.5">
                <History className="w-3.5 h-3.5 text-sky-400" />
                Recent Runs History
              </div>
              <div className="flex flex-wrap gap-2">
                {history.map((h) => (
                  <div
                    key={h.id}
                    onClick={() => {
                      setResult(h)
                      setActiveTab('results')
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-all ${
                      result?.id === h.id
                        ? 'bg-sky-500/10 border-sky-500/40 text-sky-300'
                        : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                    }`}
                  >
                    <span className="font-mono font-medium">{h.id}</span>
                    <span className="text-zinc-500 font-mono">
                      {h.qps.toFixed(0)} QPS
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteFromHistory(h.id)
                      }}
                      className="text-zinc-500 hover:text-rose-400 p-0.5 rounded ml-1"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
