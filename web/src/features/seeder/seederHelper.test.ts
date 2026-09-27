declare const process: any

import {
  computeDAGLevels,
  calculateRowEstimates,
  formatNumber,
  formatDuration,
  formatSpeed,
  formatStatusBadge,
  validateSeederForm,
  GENERATOR_PRESETS,
  type TableSeedPlan,
} from './seederHelper.ts'

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

console.log('--- Running Seeder Helper Unit Tests ---')

test('computeDAGLevels: assigns levels accurately based on dependencies', () => {
  const tables: TableSeedPlan[] = [
    { table: 'users', rowCount: 10, level: 0, dependencies: [], columns: [], sampleRows: [] },
    { table: 'departments', rowCount: 5, level: 0, dependencies: [], columns: [], sampleRows: [] },
    { table: 'orders', rowCount: 20, level: 0, dependencies: ['users'], columns: [], sampleRows: [] },
    { table: 'order_items', rowCount: 50, level: 0, dependencies: ['orders'], columns: [], sampleRows: [] },
  ]
  const levels = computeDAGLevels(tables)
  assert(levels.get('users') === 0, 'users should be level 0')
  assert(levels.get('departments') === 0, 'departments should be level 0')
  assert(levels.get('orders') === 1, 'orders should be level 1')
  assert(levels.get('order_items') === 2, 'order_items should be level 2')
})

test('calculateRowEstimates: sums row count and duration', () => {
  const tables: TableSeedPlan[] = [
    { table: 'users', rowCount: 1000, level: 0, dependencies: [], columns: [], sampleRows: [] },
    { table: 'posts', rowCount: 2000, level: 1, dependencies: ['users'], columns: [], sampleRows: [] },
  ]
  const est = calculateRowEstimates(tables, 100)
  assert(est.totalRows === 3000, 'totalRows should be 3000')
  assert(est.estimatedDurationSec === 2.0, 'duration estimate should be 2.0s')
})

test('formatters: formatNumber, formatDuration, formatSpeed', () => {
  assert(formatNumber(12500) === '12,500', 'formatNumber thousands')
  assert(formatNumber(0) === '0', 'formatNumber 0')
  assert(formatDuration(450) === '450ms', 'formatDuration under 1000ms')
  assert(formatDuration(2500) === '2.5s', 'formatDuration over 1000ms')
  assert(formatSpeed(1250) === '1,250 rows/s', 'formatSpeed valid rate')
  assert(formatSpeed(0) === '0 rows/s', 'formatSpeed zero')
})

test('formatStatusBadge: returns styled badges', () => {
  const planning = formatStatusBadge('planning')
  assert(planning.label.includes('Resolving'), 'planning label')
  assert(planning.badgeClass.includes('indigo'), 'planning class')

  const seeding = formatStatusBadge('seeding')
  assert(seeding.label.includes('Seeding'), 'seeding label')
  assert(seeding.badgeClass.includes('blue'), 'seeding class')

  const completed = formatStatusBadge('completed')
  assert(completed.label.includes('Completed'), 'completed label')
  assert(completed.badgeClass.includes('emerald'), 'completed class')

  const failedBadge = formatStatusBadge('failed')
  assert(failedBadge.label.includes('Failed'), 'failed label')
  assert(failedBadge.badgeClass.includes('rose'), 'failed class')
})

test('validateSeederForm: validates table count and bounds', () => {
  const resEmpty = validateSeederForm([], 20)
  assert(!resEmpty.valid, 'empty tables should be invalid')
  assert(resEmpty.errors[0].includes('At least one table'), 'empty error message')

  const resZero = validateSeederForm(['users'], 0)
  assert(!resZero.valid, 'zero row count should be invalid')

  const resOver = validateSeederForm(['users'], 200000)
  assert(!resOver.valid, 'excessive row count should be invalid')

  const resValid = validateSeederForm(['users', 'orders'], 100)
  assert(resValid.valid, 'valid inputs should pass')
  assert(resValid.errors.length === 0, 'no errors on valid')
})

test('null-safety: computeDAGLevels and calculateRowEstimates handle null/undefined tables', () => {
  // @ts-ignore
  const levelsNull = computeDAGLevels(null)
  assert(levelsNull.size === 0, 'levelsNull should be empty map')

  // @ts-ignore
  const levelsUndefined = computeDAGLevels(undefined)
  assert(levelsUndefined.size === 0, 'levelsUndefined should be empty map')

  // @ts-ignore
  const estNull = calculateRowEstimates(null, 20)
  assert(estNull.totalRows === 0, 'estNull totalRows should be 0')

  // @ts-ignore
  const estUndefined = calculateRowEstimates(undefined, 20)
  assert(estUndefined.totalRows === 0, 'estUndefined totalRows should be 0')
})

test('GENERATOR_PRESETS: contains essential types', () => {
  const types = GENERATOR_PRESETS.map((p) => p.type)
  assert(types.includes('sequence'), 'should include sequence')
  assert(types.includes('uuid'), 'should include uuid')
  assert(types.includes('name'), 'should include name')
  assert(types.includes('email'), 'should include email')
  assert(types.includes('timestamp'), 'should include timestamp')
  assert(types.includes('integer'), 'should include integer')
  assert(types.includes('boolean'), 'should include boolean')
  assert(types.includes('fk'), 'should include fk')
})

console.log(`\nSeeder Helper Tests Summary: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
