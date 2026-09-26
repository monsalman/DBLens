export interface HistogramBucket {
  fromMs: number
  toMs: number
  count: number
}

export interface BenchmarkError {
  message: string
  count: number
}

export interface BenchmarkResult {
  id: string
  sql: string
  concurrency: number
  rollback: boolean
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  totalQueries: number
  successfulQueries: number
  failedQueries: number
  durationMs: number
  qps: number
  minLatencyMs: number
  meanLatencyMs: number
  p50LatencyMs: number
  p90LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  maxLatencyMs: number
  stdDevMs: number
  histogram: HistogramBucket[]
  errors?: BenchmarkError[]
  startedAt: string
  completedAt?: string
  assertPassed?: boolean
  label?: string
}

export interface BenchmarkComparison {
  baseline: BenchmarkResult
  candidate: BenchmarkResult
  qpsDelta: number
  qpsDeltaPct: number
  p50DeltaMs: number
  p50DeltaPct: number
  p95DeltaMs: number
  p95DeltaPct: number
  p99DeltaMs: number
  p99DeltaPct: number
  meanDeltaMs: number
  meanDeltaPct: number
  winner: 'candidate' | 'baseline' | 'tie'
  summary: string
}

export interface BenchmarkProgress {
  benchmarkId: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  elapsedMs: number
  percent: number
  totalQueries: number
  successfulQueries: number
  failedQueries: number
  currentQps: number
  p50LatencyMs: number
  p90LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  result?: BenchmarkResult
  error?: string
}

export interface BenchmarkConfig {
  id?: string
  sql: string
  concurrency: number
  durationSec?: number
  iterations?: number
  rollback: boolean
  assertP99Lt?: number
  label?: string
}

export function round2(num: number): number {
  return Math.round(num * 100) / 100
}

export function calculatePercentile(sorted: number[], p: number): number {
  const n = sorted.length
  if (n === 0) return 0
  if (p <= 0 || n === 1) return sorted[0]
  if (p >= 100) return sorted[n - 1]

  const rank = (p / 100.0) * (n - 1)
  const low = Math.floor(rank)
  const high = low + 1
  if (high >= n) return sorted[low]
  const weight = rank - low
  return sorted[low] * (1.0 - weight) + sorted[high] * weight
}

export function generateHistogramBuckets(
  sorted: number[],
  min: number,
  max: number,
  numBuckets = 10
): HistogramBucket[] {
  if (numBuckets <= 0) numBuckets = 10
  if (sorted.length === 0) return []
  if (min === max) {
    return [{ fromMs: min, toMs: max, count: sorted.length }]
  }

  const bucketWidth = (max - min) / numBuckets
  const buckets: HistogramBucket[] = []
  for (let i = 0; i < numBuckets; i++) {
    buckets.push({
      fromMs: round2(min + i * bucketWidth),
      toMs: round2(min + (i + 1) * bucketWidth),
      count: 0,
    })
  }

  for (const v of sorted) {
    let idx = Math.floor((v - min) / bucketWidth)
    if (idx < 0) idx = 0
    if (idx >= numBuckets) idx = numBuckets - 1
    buckets[idx].count++
  }

  return buckets
}

export function calculateLatencyStats(
  latencies: number[],
  numBuckets = 10
): {
  min: number
  p50: number
  p90: number
  p95: number
  p99: number
  max: number
  mean: number
  stdDev: number
  buckets: HistogramBucket[]
} {
  if (latencies.length === 0) {
    return { min: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0, mean: 0, stdDev: 0, buckets: [] }
  }

  const sorted = [...latencies].sort((a, b) => a - b)
  const n = sorted.length
  const min = round2(sorted[0])
  const max = round2(sorted[n - 1])

  const sum = sorted.reduce((acc, v) => acc + v, 0)
  const mean = round2(sum / n)

  const varSum = sorted.reduce((acc, v) => acc + Math.pow(v - (sum / n), 2), 0)
  const stdDev = round2(Math.sqrt(varSum / n))

  const p50 = round2(calculatePercentile(sorted, 50))
  const p90 = round2(calculatePercentile(sorted, 90))
  const p95 = round2(calculatePercentile(sorted, 95))
  const p99 = round2(calculatePercentile(sorted, 99))

  const buckets = generateHistogramBuckets(sorted, min, max, numBuckets)

  return { min, p50, p90, p95, p99, max, mean, stdDev, buckets }
}

export function compareBenchmarks(
  baseline: BenchmarkResult,
  candidate: BenchmarkResult
): BenchmarkComparison {
  const qpsDelta = round2(candidate.qps - baseline.qps)
  let qpsDeltaPct = 0
  if (baseline.qps > 0) {
    qpsDeltaPct = round2(((candidate.qps - baseline.qps) / baseline.qps) * 100.0)
  }

  const p50DeltaMs = round2(candidate.p50LatencyMs - baseline.p50LatencyMs)
  let p50DeltaPct = 0
  if (baseline.p50LatencyMs > 0) {
    p50DeltaPct = round2(((candidate.p50LatencyMs - baseline.p50LatencyMs) / baseline.p50LatencyMs) * 100.0)
  }

  const p95DeltaMs = round2(candidate.p95LatencyMs - baseline.p95LatencyMs)
  let p95DeltaPct = 0
  if (baseline.p95LatencyMs > 0) {
    p95DeltaPct = round2(((candidate.p95LatencyMs - baseline.p95LatencyMs) / baseline.p95LatencyMs) * 100.0)
  }

  const p99DeltaMs = round2(candidate.p99LatencyMs - baseline.p99LatencyMs)
  let p99DeltaPct = 0
  if (baseline.p99LatencyMs > 0) {
    p99DeltaPct = round2(((candidate.p99LatencyMs - baseline.p99LatencyMs) / baseline.p99LatencyMs) * 100.0)
  }

  const meanDeltaMs = round2(candidate.meanLatencyMs - baseline.meanLatencyMs)
  let meanDeltaPct = 0
  if (baseline.meanLatencyMs > 0) {
    meanDeltaPct = round2(((candidate.meanLatencyMs - baseline.meanLatencyMs) / baseline.meanLatencyMs) * 100.0)
  }

  let winner: 'candidate' | 'baseline' | 'tie' = 'tie'
  if (candidate.qps > baseline.qps * 1.02 && candidate.p95LatencyMs <= baseline.p95LatencyMs * 1.02) {
    winner = 'candidate'
  } else if (baseline.qps > candidate.qps * 1.02 && baseline.p95LatencyMs <= candidate.p95LatencyMs * 1.02) {
    winner = 'baseline'
  } else if (candidate.p95LatencyMs < baseline.p95LatencyMs * 0.98) {
    winner = 'candidate'
  } else if (baseline.p95LatencyMs < candidate.p95LatencyMs * 0.98) {
    winner = 'baseline'
  }

  let summary = ''
  if (winner === 'candidate') {
    summary = `Candidate outperforms baseline with ${qpsDeltaPct >= 0 ? '+' : ''}${qpsDeltaPct}% higher QPS and ${p95DeltaMs >= 0 ? '+' : ''}${p95DeltaMs}ms P95 latency difference.`
  } else if (winner === 'baseline') {
    summary = `Baseline outperforms candidate with ${-qpsDeltaPct >= 0 ? '+' : ''}${-qpsDeltaPct}% higher QPS and ${-p95DeltaMs >= 0 ? '+' : ''}${-p95DeltaMs}ms P95 latency difference.`
  } else {
    summary = 'Performance is comparable between baseline and candidate (within 2% margin).'
  }

  return {
    baseline,
    candidate,
    qpsDelta,
    qpsDeltaPct,
    p50DeltaMs,
    p50DeltaPct,
    p95DeltaMs,
    p95DeltaPct,
    p99DeltaMs,
    p99DeltaPct,
    meanDeltaMs,
    meanDeltaPct,
    winner,
    summary,
  }
}

export function generateMarkdownReport(res: BenchmarkResult): string {
  const title = res.label ? `DBLens Latency Benchmark Report: ${res.label}` : 'DBLens Latency Benchmark Report'
  const successRate = res.totalQueries > 0 ? ((res.successfulQueries / res.totalQueries) * 100).toFixed(1) : '0.0'
  const failRate = res.totalQueries > 0 ? ((res.failedQueries / res.totalQueries) * 100).toFixed(1) : '0.0'

  let out = `# ${title}\n\n`
  out += `## Overview\n`
  out += `- **Benchmark ID**: \`${res.id}\`\n`
  out += `- **Target SQL**:\n\`\`\`sql\n${res.sql.trim()}\n\`\`\`\n`
  out += `- **Concurrency**: ${res.concurrency} concurrent workers\n`
  out += `- **Rollback Mode**: \`${res.rollback}\`\n`
  out += `- **Status**: \`${res.status}\`\n`
  out += `- **Total Queries**: ${res.totalQueries.toLocaleString()}\n`
  out += `- **Successful Queries**: ${res.successfulQueries.toLocaleString()} (${successRate}%)\n`
  out += `- **Failed Queries**: ${res.failedQueries.toLocaleString()} (${failRate}%)\n`
  out += `- **Elapsed Wall Time**: ${res.durationMs.toFixed(2)} ms (${(res.durationMs / 1000).toFixed(2)}s)\n`
  out += `- **Throughput (QPS)**: **${res.qps.toFixed(1)} queries/sec**\n`

  if (res.assertPassed !== undefined) {
    out += res.assertPassed
      ? `- **Quality Gate Assertion**: ✅ **PASSED** (P99 within threshold)\n`
      : `- **Quality Gate Assertion**: ❌ **FAILED** (P99 violated latency threshold)\n`
  }
  out += '\n'

  out += `## Latency Statistics\n\n`
  out += `| Metric | Latency |\n`
  out += `| :--- | :--- |\n`
  out += `| **Min** | ${res.minLatencyMs.toFixed(2)} ms |\n`
  out += `| **P50 (Median)** | ${res.p50LatencyMs.toFixed(2)} ms |\n`
  out += `| **P90** | ${res.p90LatencyMs.toFixed(2)} ms |\n`
  out += `| **P95** | ${res.p95LatencyMs.toFixed(2)} ms |\n`
  out += `| **P99** | ${res.p99LatencyMs.toFixed(2)} ms |\n`
  out += `| **Max** | ${res.maxLatencyMs.toFixed(2)} ms |\n`
  out += `| **Mean** | ${res.meanLatencyMs.toFixed(2)} ms |\n`
  out += `| **Std Dev** | ${res.stdDevMs.toFixed(2)} ms |\n\n`

  if (res.histogram && res.histogram.length > 0) {
    out += `## Latency Distribution\n\n`
    out += `| Bucket Range (ms) | Query Count | Share |\n`
    out += `| :--- | :--- | :--- |\n`
    for (const b of res.histogram) {
      const share = res.successfulQueries > 0 ? ((b.count / res.successfulQueries) * 100).toFixed(1) : '0.0'
      out += `| ${b.fromMs.toFixed(2)} - ${b.toMs.toFixed(2)} ms | ${b.count.toLocaleString()} | ${share}% |\n`
    }
    out += '\n'
  }

  if (res.errors && res.errors.length > 0) {
    out += `## Errors Encountered\n\n`
    out += `| Error Message | Count |\n`
    out += `| :--- | :--- |\n`
    for (const e of res.errors) {
      out += `| \`${e.message}\` | ${e.count} |\n`
    }
    out += '\n'
  }

  return out
}

export function generateComparisonMarkdown(comp: BenchmarkComparison): string {
  let out = `# DBLens Benchmark A/B Comparison Report\n\n`
  out += `## Executive Summary\n`
  out += `- **Winner**: **${comp.winner.toUpperCase()}**\n`
  out += `- **Analysis**: ${comp.summary}\n\n`

  out += `## Head-to-Head Comparison\n\n`
  out += `| Metric | Baseline | Candidate | Delta | Change |\n`
  out += `| :--- | :--- | :--- | :--- | :--- |\n`

  const qpsSign = comp.qpsDelta > 0 ? '+' : ''
  out += `| **QPS** | ${comp.baseline.qps.toFixed(1)} | ${comp.candidate.qps.toFixed(1)} | ${qpsSign}${comp.qpsDelta.toFixed(1)} | ${qpsSign}${comp.qpsDeltaPct.toFixed(1)}% |\n`

  const p50Sign = comp.p50DeltaMs > 0 ? '+' : ''
  out += `| **P50 Latency** | ${comp.baseline.p50LatencyMs.toFixed(2)} ms | ${comp.candidate.p50LatencyMs.toFixed(2)} ms | ${p50Sign}${comp.p50DeltaMs.toFixed(2)} ms | ${p50Sign}${comp.p50DeltaPct.toFixed(1)}% |\n`

  const p95Sign = comp.p95DeltaMs > 0 ? '+' : ''
  out += `| **P95 Latency** | ${comp.baseline.p95LatencyMs.toFixed(2)} ms | ${comp.candidate.p95LatencyMs.toFixed(2)} ms | ${p95Sign}${comp.p95DeltaMs.toFixed(2)} ms | ${p95Sign}${comp.p95DeltaPct.toFixed(1)}% |\n`

  const p99Sign = comp.p99DeltaMs > 0 ? '+' : ''
  out += `| **P99 Latency** | ${comp.baseline.p99LatencyMs.toFixed(2)} ms | ${comp.candidate.p99LatencyMs.toFixed(2)} ms | ${p99Sign}${comp.p99DeltaMs.toFixed(2)} ms | ${p99Sign}${comp.p99DeltaPct.toFixed(1)}% |\n`

  const meanSign = comp.meanDeltaMs > 0 ? '+' : ''
  out += `| **Mean Latency** | ${comp.baseline.meanLatencyMs.toFixed(2)} ms | ${comp.candidate.meanLatencyMs.toFixed(2)} ms | ${meanSign}${comp.meanDeltaMs.toFixed(2)} ms | ${meanSign}${comp.meanDeltaPct.toFixed(1)}% |\n`

  out += `| **Total Queries** | ${comp.baseline.totalQueries} | ${comp.candidate.totalQueries} | ${comp.candidate.totalQueries - comp.baseline.totalQueries >= 0 ? '+' : ''}${comp.candidate.totalQueries - comp.baseline.totalQueries} | — |\n\n`

  out += `## Query Comparison\n`
  out += `### Baseline (\`${comp.baseline.id}\`)\n\`\`\`sql\n${comp.baseline.sql.trim()}\n\`\`\`\n\n`
  out += `### Candidate (\`${comp.candidate.id}\`)\n\`\`\`sql\n${comp.candidate.sql.trim()}\n\`\`\`\n`

  return out
}

export function generateCliCommand(cfg: BenchmarkConfig, conn = '$DB_CONN'): string {
  const parts: string[] = ['dblens benchmark']
  parts.push(`--conn "${conn}"`)

  const cleanSql = cfg.sql.replace(/\r?\n/g, ' ').replace(/"/g, '\\"').trim()
  parts.push(`--query "${cleanSql}"`)

  if (cfg.concurrency && cfg.concurrency !== 5) {
    parts.push(`--concurrency ${cfg.concurrency}`)
  }

  if (cfg.iterations && cfg.iterations > 0) {
    parts.push(`--iterations ${cfg.iterations}`)
  } else if (cfg.durationSec && cfg.durationSec !== 5) {
    parts.push(`--duration ${cfg.durationSec}s`)
  }

  if (cfg.rollback) {
    parts.push('--rollback')
  }

  if (cfg.assertP99Lt && cfg.assertP99Lt > 0) {
    parts.push(`--assert-p99-lt ${cfg.assertP99Lt}`)
  }

  return parts.join(' ')
}

export function formatLatency(ms: number): string {
  if (ms < 0.01 && ms > 0) return '< 0.01 ms'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  return `${ms.toFixed(2)} ms`
}

export function formatQps(qps: number): string {
  return `${qps.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} QPS`
}

export function getWinnerBadge(winner: 'candidate' | 'baseline' | 'tie'): {
  label: string
  bgClass: string
  textClass: string
} {
  switch (winner) {
    case 'candidate':
      return {
        label: 'Candidate Won',
        bgClass: 'bg-emerald-500/10 border-emerald-500/30',
        textClass: 'text-emerald-400',
      }
    case 'baseline':
      return {
        label: 'Baseline Won',
        bgClass: 'bg-amber-500/10 border-amber-500/30',
        textClass: 'text-amber-400',
      }
    default:
      return {
        label: 'Performance Tie',
        bgClass: 'bg-zinc-500/10 border-zinc-500/30',
        textClass: 'text-zinc-400',
      }
  }
}
