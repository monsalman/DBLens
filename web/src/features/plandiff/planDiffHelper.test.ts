import {
  calculateDeltaPct,
  getDeltaBadgeClass,
  getSeverityBadgeClass,
  flattenAlignedTree,
  formatPlanDiffMarkdown,
  type AlignedNode,
  type PlanDiffResult,
} from './planDiffHelper.ts'

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

console.log('--- Running Plan Diff Helper Unit Tests ---')

test('calculateDeltaPct: calculates positive, negative, and zero deltas correctly', () => {
  assert(calculateDeltaPct(100, 50) === -50, '100 -> 50 should be -50%')
  assert(calculateDeltaPct(100, 150) === 50, '100 -> 150 should be +50%')
  assert(calculateDeltaPct(100, 100) === 0, '100 -> 100 should be 0%')
  assert(calculateDeltaPct(0, 0) === 0, '0 -> 0 should be 0%')
  assert(calculateDeltaPct(0, 50) === 100, '0 -> 50 should be 100%')
  assert(calculateDeltaPct(50, 0) === -100, '50 -> 0 should be -100%')
})

test('getDeltaBadgeClass: returns proper Tailwind badge classes', () => {
  // Improvements (cost reduced)
  const improved = getDeltaBadgeClass(-45.2)
  assert(improved.includes('text-emerald-400'), 'negative cost delta should be emerald')

  // Regressions (cost increased)
  const regressed = getDeltaBadgeClass(82.4)
  assert(regressed.includes('text-rose-400'), 'positive cost delta should be rose')

  // Zero / Neutral
  const neutral = getDeltaBadgeClass(0)
  assert(neutral.includes('text-zinc-400'), 'zero delta should be zinc')
})

test('getSeverityBadgeClass: returns proper badge styles for severity levels', () => {
  assert(getSeverityBadgeClass('critical').includes('text-rose-400'), 'critical should be rose')
  assert(getSeverityBadgeClass('high').includes('text-amber-400'), 'high should be amber')
  assert(getSeverityBadgeClass('medium').includes('text-yellow-400'), 'medium should be yellow')
  assert(getSeverityBadgeClass('low').includes('text-emerald-400'), 'low should be emerald')
})

test('flattenAlignedTree: correctly flattens hierarchy and computes depth', () => {
  const tree: AlignedNode = {
    id: 'node-0',
    operation: 'Nested Loop',
    relation: '',
    costBefore: 500,
    costAfter: 100,
    costDeltaPct: -80,
    timeBeforeMs: 10,
    timeAfterMs: 2,
    timeDeltaPct: -80,
    rowsBefore: 1000,
    rowsAfter: 100,
    rowsDeltaPct: -90,
    bottleneckSeverity: 'low',
    children: [
      {
        id: 'node-0-0',
        operation: 'Seq Scan -> Index Scan',
        relation: 'orders',
        costBefore: 300,
        costAfter: 40,
        costDeltaPct: -86.7,
        timeBeforeMs: 6,
        timeAfterMs: 1,
        timeDeltaPct: -83.3,
        rowsBefore: 800,
        rowsAfter: 50,
        rowsDeltaPct: -93.8,
        bottleneckSeverity: 'low',
      },
      {
        id: 'node-0-1',
        operation: 'Index Scan',
        relation: 'users',
        costBefore: 200,
        costAfter: 60,
        costDeltaPct: -70,
        timeBeforeMs: 4,
        timeAfterMs: 1,
        timeDeltaPct: -75,
        rowsBefore: 200,
        rowsAfter: 50,
        rowsDeltaPct: -75,
        bottleneckSeverity: 'low',
      },
    ],
  }

  const flattened = flattenAlignedTree(tree)
  assert(flattened.length === 3, `expected 3 nodes, got ${flattened.length}`)
  assert(flattened[0].depth === 0, 'root depth should be 0')
  assert(flattened[1].depth === 1, 'child depth should be 1')
  assert(flattened[2].depth === 1, 'child depth should be 1')
  assert(flattened[1].relation === 'orders', 'child 1 relation should be orders')
})

test('formatPlanDiffMarkdown: renders full markdown report with tables and DDL', () => {
  const diff: PlanDiffResult = {
    dialect: 'postgres',
    summary: {
      baselineTotalCost: 1500,
      candidateTotalCost: 120,
      costDeltaPct: -92.0,
      baselineTimeMs: 45.5,
      candidateTimeMs: 2.1,
      timeDeltaPct: -95.4,
      bottleneckCount: 0,
      recommendationsCount: 1,
    },
    alignedTree: {
      id: 'node-0',
      operation: 'Seq Scan -> Index Scan',
      relation: 'users',
      costBefore: 1500,
      costAfter: 120,
      costDeltaPct: -92.0,
      timeBeforeMs: 45.5,
      timeAfterMs: 2.1,
      timeDeltaPct: -95.4,
      rowsBefore: 50000,
      rowsAfter: 100,
      rowsDeltaPct: -99.8,
      bottleneckSeverity: 'low',
    },
    recommendations: [
      {
        table: 'users',
        columns: ['status', 'created_at'],
        indexType: 'btree',
        reason: 'Sequential scan on table users with filter lacks supporting index',
        estimatedCostSavingsPct: 85.0,
        ddl: 'CREATE INDEX CONCURRENTLY idx_users_status_created_at ON users (status, created_at);',
        rollbackDdl: 'DROP INDEX CONCURRENTLY IF EXISTS idx_users_status_created_at;',
      },
    ],
  }

  const md = formatPlanDiffMarkdown(diff)
  assert(md.includes('# Execution Plan Diff Report'), 'markdown must contain main title')
  assert(md.includes('1500.00'), 'markdown must contain baseline cost')
  assert(md.includes('120.00'), 'markdown must contain candidate cost')
  assert(md.includes('-92.0% (Improved)'), 'markdown must contain cost delta badge')
  assert(md.includes('CREATE INDEX CONCURRENTLY'), 'markdown must contain DDL block')
  assert(md.includes('DROP INDEX CONCURRENTLY'), 'markdown must contain rollback block')
})

console.log(`\nPlan Diff Helper Tests Summary: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
