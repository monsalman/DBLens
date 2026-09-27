import {
  formatBytes,
  formatRows,
  formatShare,
  getSkewBadge,
  getStatusBadge,
  getHealthScoreColor,
  computeTreemapLayout,
  buildUpcomingPartitionDDL,
  buildDetachDDL,
  type PartitionNode,
} from './partitionHelper.ts'

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

console.log('--- Running Partition Helper Unit Tests ---')

// 1. Formatters
test('formatBytes: handles zero, KB, MB, GB', () => {
  assert(formatBytes(0) === '0 B', '0 bytes should return 0 B')
  assert(formatBytes(500) === '500 B', '500 bytes should return 500 B')
  assert(formatBytes(2048) === '2.0 KB', '2048 bytes should return 2.0 KB')
  assert(formatBytes(1048576 * 5) === '5.0 MB', '5MB should format correctly')
  assert(formatBytes(1073741824 * 2.5) === '2.5 GB', '2.5GB should format correctly')
})

test('formatRows: formats counts with separators', () => {
  assert(formatRows(0) === '0', '0 rows')
  assert(formatRows(1250) === '1,250', 'thousands separator')
  assert(formatRows(1000000) === '1,000,000', 'millions separator')
})

test('formatShare: formats percentages', () => {
  assert(formatShare(0) === '0%', '0 share')
  assert(formatShare(33.333) === '33.3%', '1 decimal place')
  assert(formatShare(100) === '100.0%', 'full share')
})

// 2. Skew Badges
test('getSkewBadge: returns proper categories and colors', () => {
  const b1 = getSkewBadge(0.2)
  assert(b1.label === 'Balanced', '0.2 is Balanced')

  const b2 = getSkewBadge(0.8)
  assert(b2.label === 'Moderate Skew', '0.8 is Moderate')

  const b3 = getSkewBadge(1.5)
  assert(b3.label === 'High Skew', '1.5 is High Skew')

  const b4 = getSkewBadge(2.4)
  assert(b4.label === 'Severe Skew', '2.4 is Severe Skew')
})

// 3. Status Badges & Health Score Colors
test('getStatusBadge: returns proper badges and colors', () => {
  assert(getStatusBadge('hot_skew').label === 'HOT SKEW', 'hot_skew label')
  assert(getStatusBadge('approaching_capacity').label === 'CAPACITY WARN', 'capacity label')
  assert(getStatusBadge('missing_future').label === 'HEADROOM LOW', 'headroom label')
  assert(getStatusBadge('healthy').label === 'HEALTHY', 'healthy label')
})

test('getHealthScoreColor: evaluates severity thresholds', () => {
  assert(getHealthScoreColor(90).textClass.includes('emerald'), '90 is emerald')
  assert(getHealthScoreColor(65).textClass.includes('amber'), '65 is amber')
  assert(getHealthScoreColor(40).textClass.includes('rose'), '40 is rose')
})

// 4. Treemap Layout Math
test('computeTreemapLayout: returns empty array for empty or zero inputs', () => {
  assert(computeTreemapLayout([], 800, 400).length === 0, 'empty nodes')
  assert(
    computeTreemapLayout([{ name: 'p1', bytes: 100 } as any], 0, 400).length === 0,
    'zero width'
  )
})

test('computeTreemapLayout: calculates non-overlapping bounds within container', () => {
  const nodes: PartitionNode[] = [
    {
      name: 'part_2026_01',
      schema: 'public',
      parentTable: 'orders',
      boundExpression: '',
      partitionType: 'range',
      rows: 500,
      bytes: 5000000,
      rowSharePct: 50,
      byteSharePct: 50,
      status: 'healthy',
    },
    {
      name: 'part_2026_02',
      schema: 'public',
      parentTable: 'orders',
      boundExpression: '',
      partitionType: 'range',
      rows: 300,
      bytes: 3000000,
      rowSharePct: 30,
      byteSharePct: 30,
      status: 'healthy',
    },
    {
      name: 'part_2026_03',
      schema: 'public',
      parentTable: 'orders',
      boundExpression: '',
      partitionType: 'range',
      rows: 200,
      bytes: 2000000,
      rowSharePct: 20,
      byteSharePct: 20,
      status: 'healthy',
    },
  ]

  const width = 800
  const height = 400
  const rects = computeTreemapLayout(nodes, width, height, 'bytes')

  assert(rects.length === 3, `expected 3 rects, got ${rects.length}`)

  for (const r of rects) {
    assert(r.x >= 0, `r.x should be >= 0 (got ${r.x})`)
    assert(r.y >= 0, `r.y should be >= 0 (got ${r.y})`)
    assert(r.x + r.width <= width + 1, `r right boundary within container width (got ${r.x + r.width})`)
    assert(r.y + r.height <= height + 1, `r bottom boundary within container height (got ${r.y + r.height})`)
    assert(r.width > 0, 'width must be positive')
    assert(r.height > 0, 'height must be positive')
  }

  // First partition has highest weight, should have largest area
  const area0 = rects[0].width * rects[0].height
  const area2 = rects[2].width * rects[2].height
  assert(area0 > area2, 'first rect area must exceed third rect area')
})

test('computeTreemapLayout: safely handles nodes with zero bytes', () => {
  const nodes: PartitionNode[] = [
    {
      name: 'p_empty_1',
      schema: 'public',
      parentTable: 'logs',
      boundExpression: '',
      partitionType: 'range',
      rows: 0,
      bytes: 0,
      rowSharePct: 0,
      byteSharePct: 0,
      status: 'healthy',
    },
    {
      name: 'p_full_1',
      schema: 'public',
      parentTable: 'logs',
      boundExpression: '',
      partitionType: 'range',
      rows: 100,
      bytes: 10000,
      rowSharePct: 100,
      byteSharePct: 100,
      status: 'healthy',
    },
  ]

  const rects = computeTreemapLayout(nodes, 500, 300)
  assert(rects.length === 2, 'both rects rendered despite zero byte node')
  assert(rects.every((r) => r.width > 0 && r.height > 0), 'all rects have positive dimensions')
})

// 5. DDL Generators
test('buildUpcomingPartitionDDL: generates Postgres monthly DDL', () => {
  const ddl = buildUpcomingPartitionDDL({
    parentTable: 'measurements',
    schema: 'sensor',
    dialect: 'postgres',
    interval: 'month',
    count: 2,
    startDate: '2026-11-01',
  })

  assert(ddl.length === 2, '2 DDL statements generated')
  assert(
    ddl[0].includes('CREATE TABLE IF NOT EXISTS "sensor".measurements_2026_11 PARTITION OF "sensor".measurements'),
    `unexpected DDL: ${ddl[0]}`
  )
  assert(ddl[0].includes("FROM ('2026-11-01') TO ('2026-12-01')"), 'correct date bounds')
})

test('buildUpcomingPartitionDDL: generates MySQL daily DDL', () => {
  const ddl = buildUpcomingPartitionDDL({
    parentTable: 'audit',
    dialect: 'mysql',
    interval: 'day',
    count: 1,
    startDate: '2026-12-15',
  })

  assert(ddl.length === 1, '1 MySQL DDL statement')
  assert(
    ddl[0] === "ALTER TABLE `audit` ADD PARTITION (PARTITION `p20261215` VALUES LESS THAN ('2026-12-16'));",
    `unexpected MySQL DDL: ${ddl[0]}`
  )
})

test('buildDetachDDL: generates dialect-specific safe detach SQL', () => {
  // Postgres concurrent
  const pgConc = buildDetachDDL(
    {
      parentTable: 'events',
      schema: 'public',
      partitionName: 'events_2025_01',
      concurrently: true,
    },
    'postgres'
  )
  assert(
    pgConc === 'ALTER TABLE "public"."events" DETACH PARTITION "public"."events_2025_01" CONCURRENTLY;',
    `unexpected pgConc: ${pgConc}`
  )

  // MySQL drop partition
  const myDrop = buildDetachDDL(
    {
      parentTable: 'orders',
      partitionName: 'p2024',
    },
    'mysql'
  )
  assert(myDrop === 'ALTER TABLE `orders` DROP PARTITION `p2024`;', `unexpected myDrop: ${myDrop}`)

  // SQLite drop table
  const sqDrop = buildDetachDDL(
    {
      parentTable: 'tbl',
      partitionName: 'tbl_2024',
    },
    'sqlite'
  )
  assert(sqDrop === 'DROP TABLE IF EXISTS `tbl_2024`;', `unexpected sqDrop: ${sqDrop}`)

  // Injection prevention in identifiers
  const injPg = buildDetachDDL(
    {
      schema: 'pub"lic',
      parentTable: 'ord"ers',
      partitionName: 'p"; DROP TABLE users;--',
    },
    'postgres'
  )
  assert(
    injPg === 'ALTER TABLE "pub""lic"."ord""ers" DETACH PARTITION "pub""lic"."p""; DROP TABLE users;--";',
    `unexpected injPg: ${injPg}`
  )

  const injMy = buildDetachDDL(
    {
      parentTable: 'ord`ers',
      partitionName: 'p`; DROP TABLE users;--',
    },
    'mysql'
  )
  assert(
    injMy === 'ALTER TABLE `ord``ers` DROP PARTITION `p``; DROP TABLE users;--`;',
    `unexpected injMy: ${injMy}`
  )
})

console.log(`\nPartition Helper Tests Summary: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  throw new Error(`${failed} tests failed`)
}
