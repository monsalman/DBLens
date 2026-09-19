import {
  detectColumns,
  aggregateData,
  parseNumeric,
  formatValue,
  calculateTicks,
  describeArc,
  THEMES,
} from './SqlChartStudioHelpers.ts'

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

console.log('--- Running SqlChartStudio Unit Tests ---')

// 1. Column Detection Tests
test('detectColumns: identifies text dimension as X and numeric as Y', () => {
  const columns = ['category', 'sales', 'region']
  const rows = [
    { category: 'Electronics', sales: 1200, region: 'East' },
    { category: 'Books', sales: 450, region: 'West' },
    { category: 'Furniture', sales: 900, region: 'North' },
  ]
  const result = detectColumns(columns, rows)
  assert(result.defaultX === 'category', `expected defaultX 'category', got '${result.defaultX}'`)
  assert(result.defaultY === 'sales', `expected defaultY 'sales', got '${result.defaultY}'`)
  assert(result.numericCols.includes('sales'), 'sales should be in numericCols')
  assert(!result.numericCols.includes('category'), 'category should not be in numericCols')
})

test('detectColumns: handles array-of-arrays rows', () => {
  const columns = ['department', 'headcount', 'budget']
  const rows = [
    ['Engineering', 45, 500000],
    ['Marketing', 20, 200000],
    ['Sales', 35, 350000],
  ]
  const result = detectColumns(columns, rows)
  assert(result.defaultX === 'department', `expected 'department', got '${result.defaultX}'`)
  assert(result.defaultY === 'headcount', `expected 'headcount', got '${result.defaultY}'`)
  assert(result.numericCols.includes('headcount'), 'headcount should be numeric')
  assert(result.numericCols.includes('budget'), 'budget should be numeric')
})

test('detectColumns: handles empty or null data safely', () => {
  const emptyRes = detectColumns([], [])
  assert(emptyRes.defaultX === '', 'defaultX should be empty')
  assert(emptyRes.defaultY === '', 'defaultY should be empty')

  const noRows = detectColumns(['colA', 'colB'], [])
  assert(noRows.defaultX === 'colA', 'fallback defaultX should be colA')
  assert(noRows.defaultY === 'colB', 'fallback defaultY should be colB')
})

// 2. Numeric Parsing & Value Formatting Tests
test('parseNumeric: parses various inputs correctly', () => {
  assert(parseNumeric(123) === 123, 'number')
  assert(parseNumeric('456.78') === 456.78, 'string float')
  assert(parseNumeric('-50') === -50, 'negative')
  assert(parseNumeric(null) === null, 'null')
  assert(parseNumeric(undefined) === null, 'undefined')
  assert(parseNumeric('') === null, 'empty string')
  assert(parseNumeric('abc') === null, 'non-numeric string')
  assert(parseNumeric(true) === null, 'boolean')
})

test('formatValue: formats metrics with compact units', () => {
  assert(formatValue(2_500_000_000) === '2.5B', 'billions')
  assert(formatValue(1_200_000) === '1.2M', 'millions')
  assert(formatValue(3_500) === '3.5k', 'thousands')
  assert(formatValue(42) === '42', 'integer')
  assert(formatValue(0) === '0', 'zero')
})

// 3. Aggregation Algorithm Tests
test('aggregateData: raw mode (none) returns row items', () => {
  const columns = ['city', 'temp']
  const rows = [
    { city: 'Tokyo', temp: 22 },
    { city: 'London', temp: 15 },
    { city: 'Paris', temp: 18 },
  ]
  const agg = aggregateData(rows, columns, 'city', 'temp', 'none')
  assert(agg.items.length === 3, `expected 3 items, got ${agg.items.length}`)
  assert(agg.total === 55, `expected total 55, got ${agg.total}`)
  assert(agg.min === 15, `expected min 15, got ${agg.min}`)
  assert(agg.max === 22, `expected max 22, got ${agg.max}`)
  assert(Math.abs(agg.avg - 18.33) < 0.01, `expected avg 18.33, got ${agg.avg}`)
})

test('aggregateData: sum aggregation groups and aggregates', () => {
  const columns = ['dept', 'salary']
  const rows = [
    { dept: 'Tech', salary: 100 },
    { dept: 'Tech', salary: 150 },
    { dept: 'HR', salary: 80 },
    { dept: 'HR', salary: 70 },
  ]
  const agg = aggregateData(rows, columns, 'dept', 'salary', 'sum')
  assert(agg.items.length === 2, `expected 2 groups, got ${agg.items.length}`)
  const tech = agg.items.find((it) => it.label === 'Tech')
  const hr = agg.items.find((it) => it.label === 'HR')
  assert(tech?.value === 250, `Tech sum should be 250, got ${tech?.value}`)
  assert(hr?.value === 150, `HR sum should be 150, got ${hr?.value}`)
  assert(agg.total === 400, `overall sum should be 400, got ${agg.total}`)
  assert(tech?.percent === 62.5, `Tech pct should be 62.5%, got ${tech?.percent}`)
})

test('aggregateData: avg aggregation calculates accurate group mean', () => {
  const columns = ['store', 'rating']
  const rows = [
    { store: 'Downtown', rating: 4 },
    { store: 'Downtown', rating: 5 },
    { store: 'Uptown', rating: 2 },
    { store: 'Uptown', rating: 4 },
  ]
  const agg = aggregateData(rows, columns, 'store', 'rating', 'avg')
  const dt = agg.items.find((it) => it.label === 'Downtown')
  const ut = agg.items.find((it) => it.label === 'Uptown')
  assert(dt?.value === 4.5, `Downtown avg should be 4.5, got ${dt?.value}`)
  assert(ut?.value === 3.0, `Uptown avg should be 3.0, got ${ut?.value}`)
})

test('aggregateData: count aggregation counts records per group', () => {
  const columns = ['status', 'id']
  const rows = [
    { status: 'active', id: 1 },
    { status: 'active', id: 2 },
    { status: 'active', id: 3 },
    { status: 'inactive', id: 4 },
  ]
  const agg = aggregateData(rows, columns, 'status', 'id', 'count')
  const active = agg.items.find((it) => it.label === 'active')
  const inactive = agg.items.find((it) => it.label === 'inactive')
  assert(active?.value === 3, `active count should be 3, got ${active?.value}`)
  assert(inactive?.value === 1, `inactive count should be 1, got ${inactive?.value}`)
})

test('aggregateData: min and max aggregations find extreme values', () => {
  const columns = ['group', 'score']
  const rows = [
    { group: 'A', score: 10 },
    { group: 'A', score: 50 },
    { group: 'A', score: 90 },
  ]
  const minAgg = aggregateData(rows, columns, 'group', 'score', 'min')
  const maxAgg = aggregateData(rows, columns, 'group', 'score', 'max')
  assert(minAgg.items[0].value === 10, `min should be 10, got ${minAgg.items[0].value}`)
  assert(maxAgg.items[0].value === 90, `max should be 90, got ${maxAgg.items[0].value}`)
})

// 4. SVG Calculation Helpers
test('calculateTicks: generates evenly distributed tick values', () => {
  const ticks = calculateTicks(0, 100, 5)
  assert(ticks.length === 5, 'should have 5 ticks')
  assert(ticks[0] === 0, 'first tick 0')
  assert(ticks[1] === 25, 'second tick 25')
  assert(ticks[2] === 50, 'third tick 50')
  assert(ticks[3] === 75, 'fourth tick 75')
  assert(ticks[4] === 100, 'last tick 100')
})

test('describeArc: generates valid SVG path data', () => {
  const arc = describeArc(100, 100, 80, 40, 0, Math.PI)
  assert(arc.startsWith('M '), `arc must start with M: ${arc}`)
  assert(arc.includes('A 80 80'), 'must contain outer arc command')
  assert(arc.includes('A 40 40'), 'must contain inner arc command')
  assert(arc.endsWith('Z'), 'must close with Z')
})

// 5. Theme Definitions
test('THEMES: all presets have valid attributes and palette', () => {
  const themeKeys = ['emerald', 'indigo', 'cyan', 'amber', 'violet', 'rose']
  for (const key of themeKeys) {
    const t = THEMES[key]
    assert(!!t, `theme ${key} exists`)
    assert(t.primary.startsWith('#'), `${key} primary has hex`)
    assert(t.palette.length >= 8, `${key} palette has at least 8 colors`)
  }
})

console.log(`\nResult: ${passed} passed, ${failed} failed.`)
if (failed > 0) {
  process.exit(1)
}
