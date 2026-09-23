import {
  buildPivot,
  exportPivotToCSV,
  exportPivotToMarkdown,
  inferPivotDefaults,
  computeCellHeat,
  formatPivotValue,
  parseNumber,
  type PivotConfig,
  type PivotMatrix,
} from './pivotHelper.ts'

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

console.log('--- Running Pivot Helper Unit Tests ---')

test('parseNumber handles various types', () => {
  assert(parseNumber(42) === 42, 'number 42')
  assert(parseNumber('100.5') === 100.5, 'string 100.5')
  assert(parseNumber(null) === null, 'null')
  assert(parseNumber(undefined) === null, 'undefined')
  assert(parseNumber('invalid') === null, 'invalid string')
  assert(parseNumber(true) === 1, 'boolean true')
  assert(parseNumber(false) === 0, 'boolean false')
})

test('formatPivotValue formats integers, decimals, counts, and empty states', () => {
  assert(formatPivotValue(1250) === '1,250', 'integer with commas')
  assert(formatPivotValue(1234.567) === '1,234.57', 'decimal rounding')
  assert(formatPivotValue(null) === '-', 'null produces dash')
  assert(formatPivotValue(10, 'count') === '10', 'count format')
})

test('buildPivot computes sum with row/col totals and grand total', () => {
  const rows = [
    { region: 'North', quarter: 'Q1', revenue: 100 },
    { region: 'North', quarter: 'Q2', revenue: 200 },
    { region: 'South', quarter: 'Q1', revenue: 150 },
    { region: 'South', quarter: 'Q2', revenue: 250 },
  ]

  const config: PivotConfig = {
    rowFields: ['region'],
    colField: 'quarter',
    valueField: 'revenue',
    aggregator: 'sum',
    subtotals: true,
  }

  const matrix = buildPivot(rows, config)
  assert(matrix.colHeaders.length === 2, '2 col headers')
  assert(matrix.colHeaders[0] === 'Q1' && matrix.colHeaders[1] === 'Q2', 'Q1, Q2')
  assert(matrix.rowHeaders.length === 2, '2 row headers')
  assert(matrix.cells[0][0] === 100 && matrix.cells[0][1] === 200, 'North cells')
  assert(matrix.cells[1][0] === 150 && matrix.cells[1][1] === 250, 'South cells')

  // Row totals
  assert(matrix.rowTotals?.[0] === 300, 'North row total 300')
  assert(matrix.rowTotals?.[1] === 400, 'South row total 400')

  // Col totals
  assert(matrix.colTotals?.[0] === 250, 'Q1 col total 250')
  assert(matrix.colTotals?.[1] === 450, 'Q2 col total 450')

  // Grand total
  assert(matrix.grandTotal === 700, 'Grand total 700')
})

test('buildPivot computes count, avg, min, and max aggregators', () => {
  const rows = [
    { cat: 'A', val: 10 },
    { cat: 'A', val: 30 },
    { cat: 'B', val: 50 },
  ]

  // Count
  const countMatrix = buildPivot(rows, {
    rowFields: ['cat'],
    colField: 'cat',
    valueField: 'val',
    aggregator: 'count',
    subtotals: true,
  })
  assert(countMatrix.cells[0][0] === 2, 'A count is 2')
  assert(countMatrix.grandTotal === 3, 'Grand total count 3')

  // Avg
  const avgMatrix = buildPivot(rows, {
    rowFields: ['cat'],
    colField: 'cat',
    valueField: 'val',
    aggregator: 'avg',
    subtotals: true,
  })
  assert(avgMatrix.cells[0][0] === 20, 'A average is 20')
  assert(avgMatrix.grandTotal === 30, 'Grand total average 30')

  // Min / Max
  const minMatrix = buildPivot(rows, {
    rowFields: ['cat'],
    colField: 'cat',
    valueField: 'val',
    aggregator: 'min',
    subtotals: false,
  })
  assert(minMatrix.cells[0][0] === 10, 'A min is 10')

  const maxMatrix = buildPivot(rows, {
    rowFields: ['cat'],
    colField: 'cat',
    valueField: 'val',
    aggregator: 'max',
    subtotals: false,
  })
  assert(maxMatrix.cells[0][0] === 30, 'A max is 30')
})

test('buildPivot truncates columns when colLimit is exceeded', () => {
  const rows = [
    { tag: 'A', val: 1 },
    { tag: 'B', val: 2 },
    { tag: 'C', val: 3 },
  ]
  const matrix = buildPivot(rows, {
    rowFields: [],
    colField: 'tag',
    valueField: 'val',
    aggregator: 'sum',
    subtotals: false,
    colLimit: 2,
  })

  assert(matrix.colHeaders.length === 2, 'truncated to 2 columns')
  assert(matrix.truncatedAt === 2, 'truncatedAt is set to 2')
})

test('exportPivotToCSV generates valid CSV with headers and totals', () => {
  const matrix: PivotMatrix = {
    colHeaders: ['2023', '2024'],
    rowHeaders: [['Widgets'], ['Gadgets']],
    cells: [
      [10, 20],
      [30, 40],
    ],
    rowTotals: [30, 70],
    colTotals: [40, 60],
    grandTotal: 100,
  }

  const csv = exportPivotToCSV(matrix, ['Product'])
  assert(csv.includes('Product,2023,2024,Total'), 'contains CSV header')
  assert(csv.includes('Widgets,10,20,30'), 'contains Widgets row')
  assert(csv.includes('Total,40,60,100'), 'contains Total row')
})

test('exportPivotToMarkdown generates clean Markdown table', () => {
  const matrix: PivotMatrix = {
    colHeaders: ['Q1', 'Q2'],
    rowHeaders: [['EMEA']],
    cells: [[150, 250]],
    rowTotals: [400],
    colTotals: [150, 250],
    grandTotal: 400,
  }

  const md = exportPivotToMarkdown(matrix, ['Region'])
  assert(md.includes('| Region | Q1 | Q2 | Total |'), 'contains table header')
  assert(md.includes('| :--- | ---: | ---: | ---: |'), 'contains alignment row')
  assert(md.includes('| EMEA | 150 | 250 | 400 |'), 'contains data row')
  assert(md.includes('**Total**') && md.includes('**400**'), 'contains bold total')
})

test('computeCellHeat calculates intensity and background alpha correctly', () => {
  const heatLow = computeCellHeat(10, 0, 100)
  assert(heatLow.intensity === 0.1, 'intensity 0.1')
  assert(heatLow.bg.includes('rgba(59, 130, 246,'), 'blue rgba background')

  const heatHigh = computeCellHeat(90, 0, 100)
  assert(heatHigh.intensity === 0.9, 'intensity 0.9')
  assert(heatHigh.text !== undefined, 'highlight text color on high intensity')

  const heatNull = computeCellHeat(null, 0, 100)
  assert(heatNull.intensity === 0 && heatNull.bg === 'transparent', 'null is transparent')
})

test('inferPivotDefaults suggests sensible row, col, and value fields', () => {
  const cols = ['department', 'quarter', 'revenue', 'created_at']
  const rows = [{ department: 'Sales', quarter: 'Q1', revenue: 50000 }]

  const config = inferPivotDefaults(cols, rows)
  assert(config.rowFields[0] === 'department', 'picks department as row')
  assert(config.colField === 'quarter', 'picks quarter as col')
  assert(config.valueField === 'revenue', 'picks revenue as value')
  assert(config.aggregator === 'sum', 'defaults to sum for numeric value')
  assert(config.subtotals === true, 'subtotals enabled by default')
})

console.log(`\nPivot Helper Tests Summary: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
