import React, { useState } from 'react'
import {
  Trophy,
  ArrowRight,
  Download,
  Copy,
  Check,
  Code2,
} from 'lucide-react'
import type { BenchmarkResult, BenchmarkComparison } from './benchmarkHelper'
import {
  compareBenchmarks,
  generateComparisonMarkdown,
  getWinnerBadge,
  formatLatency,
  formatQps,
} from './benchmarkHelper'
import { LatencyDistributionChart } from './LatencyDistributionChart'

interface BenchmarkComparisonViewProps {
  history: BenchmarkResult[]
  defaultBaseline?: BenchmarkResult
  defaultCandidate?: BenchmarkResult
}

export const BenchmarkComparisonView: React.FC<BenchmarkComparisonViewProps> = ({
  history,
  defaultBaseline,
  defaultCandidate,
}) => {
  const [baselineId, setBaselineId] = useState<string>(
    defaultBaseline?.id || (history.length >= 2 ? history[1].id : history[0]?.id || '')
  )
  const [candidateId, setCandidateId] = useState<string>(
    defaultCandidate?.id || history[0]?.id || ''
  )
  const [copiedMd, setCopiedMd] = useState<boolean>(false)

  const baseline = history.find((h) => h.id === baselineId) || defaultBaseline
  const candidate = history.find((h) => h.id === candidateId) || defaultCandidate

  if (!baseline || !candidate) {
    return (
      <div className="p-8 text-center border border-dashed border-zinc-800 rounded-xl text-zinc-500">
        <Trophy className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
        <p className="text-sm font-medium text-zinc-400">At least two benchmark runs are required for comparison</p>
        <p className="text-xs text-zinc-500 mt-1">Run another benchmark to compare A/B performance deltas</p>
      </div>
    )
  }

  const comparison: BenchmarkComparison = compareBenchmarks(baseline, candidate)
  const winnerBadge = getWinnerBadge(comparison.winner)

  const handleCopyMarkdown = () => {
    const md = generateComparisonMarkdown(comparison)
    navigator.clipboard.writeText(md)
    setCopiedMd(true)
    setTimeout(() => setCopiedMd(false), 2000)
  }

  const handleDownloadMarkdown = () => {
    const md = generateComparisonMarkdown(comparison)
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `benchmark_comparison_${baseline.id}_vs_${candidate.id}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Delta helpers: for latency lower is better, for QPS higher is better
  const renderDeltaPill = (delta: number, pct: number, higherIsBetter = true) => {
    const isZero = Math.abs(delta) < 0.001
    if (isZero) {
      return (
        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
          0.0%
        </span>
      )
    }

    const isPositive = delta > 0
    const isFavorable = higherIsBetter ? isPositive : !isPositive
    const sign = isPositive ? '+' : ''

    return (
      <span
        className={`text-[11px] font-mono px-1.5 py-0.5 rounded font-medium ${
          isFavorable
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
        }`}
      >
        {sign}
        {pct.toFixed(1)}%
      </span>
    )
  }

  return (
    <div className="space-y-6 text-zinc-200">
      {/* Selectors Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-zinc-950/70 border border-zinc-800 rounded-xl">
        <div className="flex items-center gap-3 flex-1 min-w-[280px]">
          <div className="flex-1">
            <label className="block text-[11px] text-zinc-400 uppercase tracking-wider mb-1 font-semibold">
              Baseline (A)
            </label>
            <select
              value={baselineId}
              onChange={(e) => setBaselineId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label ? `${h.label} (${h.id})` : `${h.id} - ${h.qps.toFixed(0)} QPS`}
                </option>
              ))}
            </select>
          </div>

          <div className="pt-5 text-zinc-600">
            <ArrowRight className="w-4 h-4" />
          </div>

          <div className="flex-1">
            <label className="block text-[11px] text-zinc-400 uppercase tracking-wider mb-1 font-semibold">
              Candidate (B)
            </label>
            <select
              value={candidateId}
              onChange={(e) => setCandidateId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label ? `${h.label} (${h.id})` : `${h.id} - ${h.qps.toFixed(0)} QPS`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-2 sm:pt-0">
          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded-lg text-xs font-medium text-zinc-300 transition-colors"
          >
            {copiedMd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedMd ? 'Copied!' : 'Copy Markdown'}
          </button>
          <button
            type="button"
            onClick={handleDownloadMarkdown}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded-lg text-xs font-medium text-zinc-300 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export MD
          </button>
        </div>
      </div>

      {/* Winner Summary Banner */}
      <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${winnerBadge.bgClass}`}>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800">
            <Trophy className={`w-5 h-5 ${winnerBadge.textClass}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold uppercase tracking-wider ${winnerBadge.textClass}`}>
                {winnerBadge.label}
              </span>
            </div>
            <p className="text-xs text-zinc-300 mt-0.5">{comparison.summary}</p>
          </div>
        </div>
        <div className="text-right font-mono">
          <div className="text-xs text-zinc-400">QPS Difference</div>
          <div className={`text-base font-bold ${comparison.qpsDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {comparison.qpsDelta >= 0 ? '+' : ''}
            {comparison.qpsDelta.toFixed(1)} QPS ({comparison.qpsDeltaPct >= 0 ? '+' : ''}
            {comparison.qpsDeltaPct.toFixed(1)}%)
          </div>
        </div>
      </div>

      {/* Metrics Comparison Table */}
      <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/60">
        <div className="px-4 py-2.5 bg-zinc-900/60 border-b border-zinc-800 text-xs font-semibold text-zinc-300 uppercase tracking-wider">
          Head-to-Head Performance Matrix
        </div>
        <table className="w-full text-xs text-left">
          <thead className="bg-zinc-900/30 text-zinc-400 border-b border-zinc-800/60">
            <tr>
              <th className="px-4 py-2.5 font-medium">Metric</th>
              <th className="px-4 py-2.5 font-medium">Baseline (A)</th>
              <th className="px-4 py-2.5 font-medium">Candidate (B)</th>
              <th className="px-4 py-2.5 font-medium">Absolute Delta</th>
              <th className="px-4 py-2.5 font-medium">Relative Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50 font-mono">
            {/* QPS */}
            <tr className="hover:bg-zinc-900/30">
              <td className="px-4 py-2.5 font-sans font-semibold text-zinc-200">Throughput (QPS)</td>
              <td className="px-4 py-2.5 text-zinc-300">{formatQps(baseline.qps)}</td>
              <td className="px-4 py-2.5 text-zinc-100 font-semibold">{formatQps(candidate.qps)}</td>
              <td className="px-4 py-2.5 text-zinc-300">
                {comparison.qpsDelta >= 0 ? '+' : ''}
                {comparison.qpsDelta.toFixed(1)} QPS
              </td>
              <td className="px-4 py-2.5">
                {renderDeltaPill(comparison.qpsDelta, comparison.qpsDeltaPct, true)}
              </td>
            </tr>

            {/* P50 */}
            <tr className="hover:bg-zinc-900/30">
              <td className="px-4 py-2.5 font-sans text-zinc-300">P50 (Median)</td>
              <td className="px-4 py-2.5 text-zinc-300">{formatLatency(baseline.p50LatencyMs)}</td>
              <td className="px-4 py-2.5 text-zinc-100 font-medium">{formatLatency(candidate.p50LatencyMs)}</td>
              <td className="px-4 py-2.5 text-zinc-300">
                {comparison.p50DeltaMs >= 0 ? '+' : ''}
                {comparison.p50DeltaMs.toFixed(2)} ms
              </td>
              <td className="px-4 py-2.5">
                {renderDeltaPill(comparison.p50DeltaMs, comparison.p50DeltaPct, false)}
              </td>
            </tr>

            {/* P95 */}
            <tr className="hover:bg-zinc-900/30">
              <td className="px-4 py-2.5 font-sans text-zinc-300">P95 Latency</td>
              <td className="px-4 py-2.5 text-zinc-300">{formatLatency(baseline.p95LatencyMs)}</td>
              <td className="px-4 py-2.5 text-zinc-100 font-medium">{formatLatency(candidate.p95LatencyMs)}</td>
              <td className="px-4 py-2.5 text-zinc-300">
                {comparison.p95DeltaMs >= 0 ? '+' : ''}
                {comparison.p95DeltaMs.toFixed(2)} ms
              </td>
              <td className="px-4 py-2.5">
                {renderDeltaPill(comparison.p95DeltaMs, comparison.p95DeltaPct, false)}
              </td>
            </tr>

            {/* P99 */}
            <tr className="hover:bg-zinc-900/30">
              <td className="px-4 py-2.5 font-sans text-zinc-300">P99 Latency</td>
              <td className="px-4 py-2.5 text-zinc-300">{formatLatency(baseline.p99LatencyMs)}</td>
              <td className="px-4 py-2.5 text-zinc-100 font-medium">{formatLatency(candidate.p99LatencyMs)}</td>
              <td className="px-4 py-2.5 text-zinc-300">
                {comparison.p99DeltaMs >= 0 ? '+' : ''}
                {comparison.p99DeltaMs.toFixed(2)} ms
              </td>
              <td className="px-4 py-2.5">
                {renderDeltaPill(comparison.p99DeltaMs, comparison.p99DeltaPct, false)}
              </td>
            </tr>

            {/* Mean */}
            <tr className="hover:bg-zinc-900/30">
              <td className="px-4 py-2.5 font-sans text-zinc-300">Mean Latency</td>
              <td className="px-4 py-2.5 text-zinc-300">{formatLatency(baseline.meanLatencyMs)}</td>
              <td className="px-4 py-2.5 text-zinc-100">{formatLatency(candidate.meanLatencyMs)}</td>
              <td className="px-4 py-2.5 text-zinc-300">
                {comparison.meanDeltaMs >= 0 ? '+' : ''}
                {comparison.meanDeltaMs.toFixed(2)} ms
              </td>
              <td className="px-4 py-2.5">
                {renderDeltaPill(comparison.meanDeltaMs, comparison.meanDeltaPct, false)}
              </td>
            </tr>

            {/* Total Queries */}
            <tr className="hover:bg-zinc-900/30">
              <td className="px-4 py-2.5 font-sans text-zinc-400">Total Run</td>
              <td className="px-4 py-2.5 text-zinc-400">{baseline.totalQueries.toLocaleString()}</td>
              <td className="px-4 py-2.5 text-zinc-400">{candidate.totalQueries.toLocaleString()}</td>
              <td className="px-4 py-2.5 text-zinc-500">
                {candidate.totalQueries - baseline.totalQueries >= 0 ? '+' : ''}
                {candidate.totalQueries - baseline.totalQueries}
              </td>
              <td className="px-4 py-2.5 text-zinc-500">—</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Side-by-Side Histograms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Baseline Distribution ({baseline.id})
          </div>
          <LatencyDistributionChart
            buckets={baseline.histogram}
            p50={baseline.p50LatencyMs}
            p95={baseline.p95LatencyMs}
            p99={baseline.p99LatencyMs}
            minLatencyMs={baseline.minLatencyMs}
            maxLatencyMs={baseline.maxLatencyMs}
            totalQueries={baseline.successfulQueries}
          />
        </div>
        <div>
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Candidate Distribution ({candidate.id})
          </div>
          <LatencyDistributionChart
            buckets={candidate.histogram}
            p50={candidate.p50LatencyMs}
            p95={candidate.p95LatencyMs}
            p99={candidate.p99LatencyMs}
            minLatencyMs={candidate.minLatencyMs}
            maxLatencyMs={candidate.maxLatencyMs}
            totalQueries={candidate.successfulQueries}
          />
        </div>
      </div>

      {/* Side-by-Side SQL Queries */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-xl">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 mb-2">
            <Code2 className="w-3.5 h-3.5 text-sky-400" />
            Baseline SQL
          </div>
          <pre className="font-mono text-xs text-zinc-300 p-2.5 bg-zinc-900 rounded-lg overflow-x-auto max-h-36">
            {baseline.sql}
          </pre>
        </div>
        <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-xl">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 mb-2">
            <Code2 className="w-3.5 h-3.5 text-sky-400" />
            Candidate SQL
          </div>
          <pre className="font-mono text-xs text-zinc-300 p-2.5 bg-zinc-900 rounded-lg overflow-x-auto max-h-36">
            {candidate.sql}
          </pre>
        </div>
      </div>
    </div>
  )
}
