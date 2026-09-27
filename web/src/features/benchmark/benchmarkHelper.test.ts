import {
  calculatePercentile,
  generateHistogramBuckets,
  calculateLatencyStats,
  compareBenchmarks,
  generateMarkdownReport,
  generateComparisonMarkdown,
  generateCliCommand,
  formatLatency,
  formatQps,
  getWinnerBadge,
  type BenchmarkResult,
} from './benchmarkHelper.ts'

declare const process: { exit: (code: number) => void }

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`)
  }
}

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err: any) {
    failed++
    console.error(`  ✗ ${name}: ${err.message}`)
  }
}

console.log('--- Running Benchmark Helper Unit Tests ---')

test('calculatePercentile: computes accurate interpolated percentiles', () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
  assert(calculatePercentile(sorted, 0) === 10, 'P0 is min')
  assert(calculatePercentile(sorted, 100) === 100, 'P100 is max')
  assert(Math.abs(calculatePercentile(sorted, 50) - 55) < 0.1, 'P50 is 55')
  assert(calculatePercentile([], 50) === 0, 'empty returns 0')
  assert(calculatePercentile([42], 50) === 42, 'single returns value')
})

test('generateHistogramBuckets: partitions distribution evenly', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const buckets = generateHistogramBuckets(sorted, 1, 10, 5)
  assert(buckets.length === 5, '5 buckets generated')
  const totalCount = buckets.reduce((s, b) => s + b.count, 0)
  assert(totalCount === 10, 'all items counted across buckets')
  assert(buckets[0].fromMs === 1, 'first bucket start')
})

test('calculateLatencyStats: returns comprehensive metrics', () => {
  const latencies = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]
  const stats = calculateLatencyStats(latencies, 5)
  assert(stats.min === 5, 'min')
  assert(stats.max === 50, 'max')
  assert(stats.mean === 27.5, 'mean')
  assert(stats.p50 === 27.5, 'p50')
  assert(stats.buckets.length === 5, 'buckets count')
})

test('compareBenchmarks: accurately calculates deltas and decides winner', () => {
  const base: BenchmarkResult = {
    id: 'base_1',
    sql: 'SELECT * FROM users',
    concurrency: 5,
    rollback: false,
    status: 'completed',
    totalQueries: 1000,
    successfulQueries: 1000,
    failedQueries: 0,
    durationMs: 2000,
    qps: 500,
    minLatencyMs: 1,
    meanLatencyMs: 4,
    p50LatencyMs: 3.5,
    p90LatencyMs: 8,
    p95LatencyMs: 10,
    p99LatencyMs: 15,
    maxLatencyMs: 25,
    stdDevMs: 2,
    histogram: [],
    startedAt: '2026-09-27T00:00:00Z',
  }

  const candidate: BenchmarkResult = {
    ...base,
    id: 'cand_1',
    qps: 1000,
    p50LatencyMs: 1.8,
    p95LatencyMs: 5.0,
    p99LatencyMs: 7.5,
    meanLatencyMs: 2.1,
  }

  const comp = compareBenchmarks(base, candidate)
  assert(comp.winner === 'candidate', 'candidate wins')
  assert(comp.qpsDelta === 500, 'qps delta +500')
  assert(comp.qpsDeltaPct === 100, 'qps delta pct +100%')
  assert(comp.p95DeltaMs === -5, 'p95 delta -5ms')

  const tie = compareBenchmarks(base, base)
  assert(tie.winner === 'tie', 'self comparison is tie')
})

test('generateMarkdownReport: produces valid markdown structure', () => {
  const res: BenchmarkResult = {
    id: 'bm_md',
    sql: 'SELECT id FROM users WHERE active = 1',
    concurrency: 8,
    rollback: false,
    status: 'completed',
    totalQueries: 500,
    successfulQueries: 500,
    failedQueries: 0,
    durationMs: 1000,
    qps: 500,
    minLatencyMs: 0.5,
    meanLatencyMs: 2,
    p50LatencyMs: 1.8,
    p90LatencyMs: 3.5,
    p95LatencyMs: 4.2,
    p99LatencyMs: 7.8,
    maxLatencyMs: 12,
    stdDevMs: 1.1,
    histogram: [{ fromMs: 0.5, toMs: 5, count: 480 }],
    startedAt: '2026-09-27T00:00:00Z',
    assertPassed: true,
    label: 'User Query',
  }

  const md = generateMarkdownReport(res)
  assert(md.includes('User Query'), 'includes label')
  assert(md.includes('500.0 queries/sec'), 'includes QPS')
  assert(md.includes('PASSED'), 'includes assertion pass')
})

test('generateComparisonMarkdown: outputs comparison table', () => {
  const res: BenchmarkResult = {
    id: 'b1',
    sql: 'SELECT 1',
    concurrency: 1,
    rollback: false,
    status: 'completed',
    totalQueries: 100,
    successfulQueries: 100,
    failedQueries: 0,
    durationMs: 100,
    qps: 1000,
    minLatencyMs: 0.1,
    meanLatencyMs: 0.2,
    p50LatencyMs: 0.2,
    p90LatencyMs: 0.3,
    p95LatencyMs: 0.4,
    p99LatencyMs: 0.5,
    maxLatencyMs: 0.8,
    stdDevMs: 0.1,
    histogram: [],
    startedAt: '2026-09-27T00:00:00Z',
  }
  const comp = compareBenchmarks(res, res)
  const md = generateComparisonMarkdown(comp)
  assert(md.includes('Head-to-Head Comparison'), 'includes table')
  assert(md.includes('TIE'), 'includes tie')
})

test('generateCliCommand: formats flags properly', () => {
  const cmd = generateCliCommand({
    sql: 'SELECT * FROM users;',
    concurrency: 10,
    durationSec: 10,
    rollback: true,
    assertP99Lt: 25.5,
  })
  assert(cmd.includes('dblens benchmark'), 'base command')
  assert(cmd.includes('--concurrency 10'), 'concurrency flag')
  assert(cmd.includes('--duration 10s'), 'duration flag')
  assert(cmd.includes('--rollback'), 'rollback flag')
  assert(cmd.includes('--assert-p99-lt 25.5'), 'assert flag')

  // Iterations variant
  const cmdIter = generateCliCommand({
    sql: 'SELECT 1',
    concurrency: 5,
    iterations: 200,
    rollback: false,
  })
  assert(cmdIter.includes('--iterations 200'), 'iterations flag')
  assert(!cmdIter.includes('--duration'), 'no duration when iterations specified')
})

test('formatters & badges: format values correctly', () => {
  assert(formatLatency(0.005) === '< 0.01 ms', 'sub millisecond')
  assert(formatLatency(5.42) === '5.42 ms', 'standard ms')
  assert(formatLatency(1500) === '1.50 s', 'seconds')
  assert(formatQps(1234.5).includes('1,234.5 QPS'), 'formatted QPS')

  const badge = getWinnerBadge('candidate')
  assert(badge.label === 'Candidate Won', 'candidate badge')
})

console.log(`\nBenchmark Helper Tests Summary: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
