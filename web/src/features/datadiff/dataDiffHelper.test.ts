import {
  formatRowStatus,
  formatCellVal,
  getRowDiffCounts,
  isCellChanged,
  filterDiffRows,
  generateCLICommand,
  getRowKey,
  type RowDiffItem,
} from './dataDiffHelper.ts'

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

console.log('--- Running Data Diff Helper Unit Tests ---')

test('formatRowStatus: returns appropriate label and styling class', () => {
  const added = formatRowStatus('added')
  assert(added.label.includes('Added'), 'added status label')
  assert(added.badgeClass.includes('text-emerald-400'), 'added status class')

  const deleted = formatRowStatus('deleted')
  assert(deleted.label.includes('Deleted'), 'deleted status label')
  assert(deleted.badgeClass.includes('text-rose-400'), 'deleted status class')

  const modified = formatRowStatus('modified')
  assert(modified.label.includes('Modified'), 'modified status label')
  assert(modified.badgeClass.includes('text-amber-400'), 'modified status class')

  const identical = formatRowStatus('identical')
  assert(identical.label.includes('Identical'), 'identical status label')
  assert(identical.badgeClass.includes('text-zinc-400'), 'identical status class')
})

test('formatCellVal: handles null, primitives, and json objects', () => {
  assert(formatCellVal(null) === 'NULL', 'null should be NULL')
  assert(formatCellVal(undefined) === 'NULL', 'undefined should be NULL')
  assert(formatCellVal(42) === '42', 'number should be string')
  assert(formatCellVal(true) === 'true', 'true should be true')
  assert(formatCellVal(false) === 'false', 'false should be false')
  assert(formatCellVal({ foo: 'bar' }) === '{"foo":"bar"}', 'json object should stringify')
})

test('getRowDiffCounts: aggregates status counts accurately', () => {
  const rows: RowDiffItem[] = [
    { pkValues: { id: 1 }, status: 'added' },
    { pkValues: { id: 2 }, status: 'deleted' },
    { pkValues: { id: 3 }, status: 'modified' },
    { pkValues: { id: 4 }, status: 'modified' },
    { pkValues: { id: 5 }, status: 'identical' },
  ]
  const counts = getRowDiffCounts(rows)
  assert(counts.added === 1, 'added count')
  assert(counts.deleted === 1, 'deleted count')
  assert(counts.modified === 2, 'modified count')
  assert(counts.identical === 1, 'identical count')
  assert(counts.total === 5, 'total count')
})

test('isCellChanged: checks if column is among changedColumns', () => {
  assert(isCellChanged('price', ['name', 'price']) === true, 'price is changed')
  assert(isCellChanged('id', ['name', 'price']) === false, 'id is not changed')
  assert(isCellChanged('any', undefined) === false, 'undefined changedColumns')
  assert(isCellChanged('any', []) === false, 'empty changedColumns')
})

test('getRowKey: builds deterministic string key for row', () => {
  const row: RowDiffItem = {
    pkValues: { id: 42, tenant_id: 'org_1' },
    status: 'identical',
  }
  const key = getRowKey(row, ['id', 'tenant_id'])
  assert(key === 'id=42;tenant_id=org_1', 'row key composite')
})

test('filterDiffRows: filters by status and searches across cells', () => {
  const rows: RowDiffItem[] = [
    {
      pkValues: { id: 1 },
      status: 'added',
      sourceValues: { id: 1, name: 'Apple', sku: 'A100' },
    },
    {
      pkValues: { id: 2 },
      status: 'modified',
      sourceValues: { id: 2, name: 'Banana', sku: 'B200' },
      targetValues: { id: 2, name: 'Banana Old', sku: 'B200' },
    },
    {
      pkValues: { id: 3 },
      status: 'deleted',
      targetValues: { id: 3, name: 'Cherry', sku: 'C300' },
    },
  ]

  // Filter by status
  assert(filterDiffRows(rows, 'all').length === 3, 'all returns 3')
  assert(filterDiffRows(rows, 'added').length === 1, 'added returns 1')
  assert(filterDiffRows(rows, 'modified').length === 1, 'modified returns 1')
  assert(filterDiffRows(rows, 'deleted').length === 1, 'deleted returns 1')
  assert(filterDiffRows(rows, 'identical').length === 0, 'identical returns 0')

  // Search by text
  assert(filterDiffRows(rows, 'all', 'banana').length === 1, 'search banana')
  assert(filterDiffRows(rows, 'all', '300').length === 1, 'search sku 300')
  assert(filterDiffRows(rows, 'all', 'xyz').length === 0, 'search xyz not found')
})

test('generateCLICommand: constructs valid dblens command string', () => {
  const cmd = generateCLICommand(
    {
      sourceConnId: 'postgres_prod',
      sourceSchema: 'public',
      sourceTable: 'orders',
      targetConnId: 'postgres_staging',
      targetSchema: 'public',
      targetTable: 'orders',
      primaryKeys: ['id'],
      columns: ['id', 'status', 'total'],
      whereClause: 'created_at >= "2026-01-01"',
    },
    'source_wins',
    true
  )

  assert(cmd.startsWith('dblens diff data'), 'command start')
  assert(cmd.includes('--source "postgres_prod:public.orders"'), 'source ref')
  assert(cmd.includes('--target "postgres_staging:public.orders"'), 'target ref')
  assert(cmd.includes('--pks "id"'), 'primary keys')
  assert(cmd.includes('--strategy source_wins'), 'strategy')
  assert(cmd.includes('--delete-excess'), 'delete excess')
})

console.log(`\nData Diff Helper Tests Summary: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  throw new Error(`Data diff tests failed with ${failed} failures`)
}
