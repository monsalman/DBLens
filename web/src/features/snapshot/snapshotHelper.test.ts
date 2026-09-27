import {
  sortSnapshotsChronological,
  formatSnapshotDate,
  formatRelativeTime,
  getTagBadgeStyle,
  formatDriftSummary,
  getDeltaBadgeClass,
  filterSnapshots,
  calculateSnapshotStats,
  buildCliSnapshotCommand,
  type SchemaSnapshot,
  type DiffSummary,
} from './snapshotHelper.ts'

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

console.log('--- Running Snapshot Helper Unit Tests ---')

const sampleSnapshots: SchemaSnapshot[] = [
  {
    id: 'snap_1',
    connId: 'prod-pg',
    label: 'Initial Setup',
    description: 'First DB creation',
    dialect: 'postgres',
    createdAt: '2026-09-20T10:00:00Z',
    checksum: 'a1b2c3d4e5f6',
    tablesCount: 5,
    viewsCount: 1,
    routinesCount: 0,
    tag: 'manual',
    schemas: [],
  },
  {
    id: 'snap_2',
    connId: 'prod-pg',
    label: 'Migration v1.2',
    description: 'Added orders and payments',
    dialect: 'postgres',
    createdAt: '2026-09-25T14:30:00Z',
    checksum: 'f6e5d4c3b2a1',
    tablesCount: 8,
    viewsCount: 2,
    routinesCount: 1,
    tag: 'pre-migration',
    schemas: [],
  },
  {
    id: 'snap_3',
    connId: 'prod-pg',
    label: 'Auto Backup',
    dialect: 'postgres',
    createdAt: '2026-09-27T08:15:00Z',
    checksum: '998877665544',
    tablesCount: 8,
    viewsCount: 2,
    routinesCount: 1,
    tag: 'auto',
    schemas: [],
  },
]

test('sortSnapshotsChronological: sorts newest first by default', () => {
  const sorted = sortSnapshotsChronological(sampleSnapshots)
  assert(sorted[0].id === 'snap_3', 'Expected newest snapshot snap_3 first')
  assert(sorted[2].id === 'snap_1', 'Expected oldest snapshot snap_1 last')
})

test('sortSnapshotsChronological: sorts oldest first when ascending is true', () => {
  const sorted = sortSnapshotsChronological(sampleSnapshots, true)
  assert(sorted[0].id === 'snap_1', 'Expected oldest snapshot snap_1 first')
  assert(sorted[2].id === 'snap_3', 'Expected newest snapshot snap_3 last')
})

test('formatSnapshotDate: returns valid date string', () => {
  const formatted = formatSnapshotDate('2026-09-27T10:30:00Z')
  assert(typeof formatted === 'string' && formatted.length > 5, 'Expected non-empty formatted date')
})

test('formatRelativeTime: formats relative seconds and minutes', () => {
  const recent = new Date(Date.now() - 5000).toISOString()
  const rel = formatRelativeTime(recent)
  assert(rel.includes('s ago'), `Expected 's ago', got ${rel}`)
})

test('getTagBadgeStyle: returns appropriate styles per tag', () => {
  const pre = getTagBadgeStyle('pre-migration')
  assert(pre.label === 'Pre-Migration', 'Expected Pre-Migration label')
  assert(pre.text.includes('amber'), 'Expected amber text color')

  const auto = getTagBadgeStyle('auto')
  assert(auto.label === 'Auto', 'Expected Auto label')

  const def = getTagBadgeStyle('unknown-tag')
  assert(def.label === 'Manual', 'Expected fallback Manual label')
})

test('formatDriftSummary: aggregates changes accurately', () => {
  const diffSummary: DiffSummary = {
    addedTables: 2,
    droppedTables: 1,
    alteredTables: 3,
    addedColumns: 5,
    droppedColumns: 0,
    alteredColumns: 2,
    addedIndexes: 1,
    droppedIndexes: 0,
    addedForeignKeys: 0,
    droppedForeignKeys: 0,
  }

  const summary = formatDriftSummary(diffSummary)
  assert(summary.includes('+2 table(s)'), `Expected +2 table(s), got ${summary}`)
  assert(summary.includes('-1 table(s)'), `Expected -1 table(s), got ${summary}`)
  assert(summary.includes('~3 altered table(s)'), `Expected ~3 altered table(s), got ${summary}`)

  const identicalSummary: DiffSummary = {
    addedTables: 0,
    droppedTables: 0,
    alteredTables: 0,
    addedColumns: 0,
    droppedColumns: 0,
    alteredColumns: 0,
    addedIndexes: 0,
    droppedIndexes: 0,
    addedForeignKeys: 0,
    droppedForeignKeys: 0,
  }
  const idStr = formatDriftSummary(identicalSummary)
  assert(idStr === 'Schemas are structurally identical', 'Expected structurally identical message')
})

test('getDeltaBadgeClass: returns styling class based on change type', () => {
  const addClass = getDeltaBadgeClass(3, 'added')
  assert(addClass.includes('emerald'), 'Expected emerald class for added')

  const dropClass = getDeltaBadgeClass(2, 'dropped')
  assert(dropClass.includes('rose'), 'Expected rose class for dropped')

  const zeroClass = getDeltaBadgeClass(0, 'altered')
  assert(zeroClass.includes('opacity-50'), 'Expected muted class for zero')
})

test('filterSnapshots: filters by search query and tag', () => {
  const qFiltered = filterSnapshots(sampleSnapshots, 'orders')
  assert(qFiltered.length === 1 && qFiltered[0].id === 'snap_2', 'Expected 1 match for orders')

  const tagFiltered = filterSnapshots(sampleSnapshots, '', 'auto')
  assert(tagFiltered.length === 1 && tagFiltered[0].id === 'snap_3', 'Expected 1 match for auto tag')

  const allFiltered = filterSnapshots(sampleSnapshots, '', 'all')
  assert(allFiltered.length === 3, 'Expected 3 matches for all')
})

test('calculateSnapshotStats: computes metrics correctly', () => {
  const stats = calculateSnapshotStats(sampleSnapshots)
  assert(stats.total === 3, 'Expected total 3')
  assert(stats.latestChecksum === '99887766', 'Expected latest checksum prefix')
  assert(stats.avgTables === 7, `Expected avg tables 7, got ${stats.avgTables}`)
  assert(stats.tagsCount['manual'] === 1, 'Expected 1 manual tag')
  assert(stats.tagsCount['pre-migration'] === 1, 'Expected 1 pre-migration tag')
})

test('buildCliSnapshotCommand: generates correct CLI commands', () => {
  const capCmd = buildCliSnapshotCommand('capture', {
    connId: 'prod-pg',
    label: 'Nightly Baseline',
    tag: 'auto',
  })
  assert(capCmd.includes('dblens snapshot capture'), 'Expected capture command')
  assert(capCmd.includes('--label="Nightly Baseline"'), 'Expected label flag')

  const diffCmd = buildCliSnapshotCommand('diff', {
    connId: 'prod-pg',
    baseId: 'snap_1',
    targetId: 'snap_2',
  })
  assert(diffCmd.includes('dblens diff snapshot'), 'Expected diff command')
  assert(diffCmd.includes('--base="snap_1"'), 'Expected base flag')

  const rbCmd = buildCliSnapshotCommand('rollback', {
    connId: 'prod-pg',
    baseId: 'snap_1',
    targetId: 'snap_2',
    direction: 'down',
  })
  assert(rbCmd.includes('dblens snapshot rollback'), 'Expected rollback command')
  assert(rbCmd.includes('--direction=down'), 'Expected direction flag')
})

console.log(`\nSnapshot Helper Tests Summary: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  throw new Error(`${failed} tests failed`)
}
