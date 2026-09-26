import {
  formatPercentage,
  formatNumber,
  formatMetricVal,
  formatBytes,
  qualityBadgeColor,
  flagBadgeStyle,
  calculateQualityScoreClient,
  generateMarkdownReport,
  type ProfileReport,
  type ColumnProfile,
} from './profileHelper.ts'

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
  } catch (err: unknown) {
    failed++
    const message = err instanceof Error ? err.message : String(err)
    console.error(`  ✗ ${name}: ${message}`)
  }
}

console.log('--- Running Profile Helper Unit Tests ---')

test('formats percentages correctly', () => {
  assert(formatPercentage(25.456, 1) === '25.5%', 'format 25.5%')
  assert(formatPercentage(0) === '0.0%', 'format 0%')
  assert(formatPercentage(100, 2) === '100.00%', 'format 100.00%')
  assert(formatPercentage(NaN) === '0.0%', 'format NaN')
})

test('formats numbers with thousands separators', () => {
  assert(formatNumber(1250) === '1,250', '1250')
  assert(formatNumber(0) === '0', '0')
  assert(formatNumber(NaN) === '0', 'NaN')
})

test('formats metric values correctly', () => {
  assert(formatMetricVal(42) === '42', '42 integer')
  assert(formatMetricVal(42.567) === '42.57', '42.57 float')
  assert(formatMetricVal(undefined) === '-', 'undefined')
})

test('formats byte sizes cleanly', () => {
  assert(formatBytes(0) === '0 B', '0 B')
  assert(formatBytes(500).includes('B'), '500 bytes')
  assert(formatBytes(1536) === '1.5 KB', '1.5 KB')
  assert(formatBytes(1048576 * 2) === '2.0 MB', '2.0 MB')
})

test('assigns correct quality score and badge colors', () => {
  assert(qualityBadgeColor(95).label === 'Excellent', '95 is Excellent')
  assert(qualityBadgeColor(80).label === 'Good', '80 is Good')
  assert(qualityBadgeColor(60).label === 'Fair', '60 is Fair')
  assert(qualityBadgeColor(30).label === 'Needs Attention', '30 is Needs Attention')
})

test('maps quality flags to styling configs', () => {
  const highNull = flagBadgeStyle('high_nulls')
  assert(highNull.label === 'High Nulls', 'high_nulls label')
  const pii = flagBadgeStyle('potential_pii')
  assert(pii.label === 'PII Detected', 'potential_pii label')
  const unknown = flagBadgeStyle('custom_flag')
  assert(unknown.label === 'custom_flag', 'fallback label')
})

test('calculates quality score from column report', () => {
  const col1: ColumnProfile = {
    columnName: 'id',
    dataType: 'INTEGER',
    totalRows: 100,
    nullCount: 0,
    nullPercentage: 0,
    emptyCount: 0,
    distinctCount: 100,
    uniquenessRatio: 1,
    topValues: [],
    qualityFlags: ['unique_candidate'],
  }
  const score = calculateQualityScoreClient([col1])
  assert(score === 100, 'perfect score is 100')

  const col2: ColumnProfile = {
    columnName: 'email',
    dataType: 'VARCHAR',
    totalRows: 100,
    nullCount: 40,
    nullPercentage: 40,
    emptyCount: 0,
    distinctCount: 60,
    uniquenessRatio: 0.6,
    topValues: [],
    qualityFlags: ['high_nulls', 'potential_pii'],
  }
  const degradedScore = calculateQualityScoreClient([col1, col2])
  assert(degradedScore < 100, 'score degraded with flags')
})

test('generates valid markdown report with table columns', () => {
  const report: ProfileReport = {
    schema: 'public',
    table: 'users',
    dialect: 'postgres',
    totalRows: 50,
    qualityScore: 92.5,
    generatedAt: '2026-09-23 12:00:00',
    suggestions: [],
    columns: [
      {
        columnName: 'username',
        dataType: 'TEXT',
        totalRows: 50,
        nullCount: 0,
        nullPercentage: 0,
        emptyCount: 0,
        distinctCount: 50,
        uniquenessRatio: 1,
        topValues: [],
        qualityFlags: ['unique_candidate'],
      },
    ],
  }
  const md = generateMarkdownReport(report)
  assert(md.includes('# Data Profile Report: public.users'), 'contains header')
  assert(md.includes('`username`'), 'contains column name')
})

console.log(`\nProfile Helper Tests Summary: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
