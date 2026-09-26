export type AggregatorType = 'sum' | 'count' | 'avg' | 'min' | 'max'

export interface PivotConfig {
  rowFields: string[]
  colField: string
  valueField: string
  aggregator: AggregatorType
  subtotals: boolean
  colLimit?: number
}

export interface PivotMatrix {
  cells: (number | string | null)[][]
  rowHeaders: string[][]
  colHeaders: string[]
  rowTotals?: (number | string | null)[]
  colTotals?: (number | string | null)[]
  grandTotal?: number | string | null
  truncatedAt?: number
}

export interface PushdownRequest {
  query: string
  dialect: string
  rowFields: string[]
  colField: string
  valueField: string
  aggregator: string
  subtotals: boolean
  colValues: string[]
}

export interface PushdownResult {
  sql: string
  dialect: string
}

// Convert any value to a number if valid
export function parseNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number') return isNaN(val) ? null : val
  if (typeof val === 'boolean') return val ? 1 : 0
  const n = Number(val)
  return isNaN(n) ? null : n
}

// Formats a cell value or total for display
export function formatPivotValue(val: unknown, agg?: AggregatorType): string {
  if (val === null || val === undefined || val === '') return '-'
  if (typeof val === 'number') {
    if (agg === 'count' || Number.isInteger(val)) {
      return val.toLocaleString()
    }
    return val.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  }
  return String(val)
}

function computeAgg(agg: AggregatorType, nums: number[], rowCount: number): number | null {
  switch (agg) {
    case 'count':
      return rowCount === 0 ? null : rowCount
    case 'sum':
      if (nums.length === 0) return rowCount > 0 ? 0 : null
      return Math.round(nums.reduce((a, b) => a + b, 0) * 10000) / 10000
    case 'avg':
      if (nums.length === 0) return null
      return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10000) / 10000
    case 'min':
      if (nums.length === 0) return null
      return Math.min(...nums)
    case 'max':
      if (nums.length === 0) return null
      return Math.max(...nums)
    default:
      return null
  }
}

// In-memory cross-tabulation of raw rows
export function buildPivot(
  rows: Record<string, any>[],
  config: PivotConfig
): PivotMatrix {
  const colField = config.colField?.trim()
  if (!colField || !rows || rows.length === 0) {
    return {
      cells: [],
      rowHeaders: [],
      colHeaders: [],
      rowTotals: config.subtotals ? [] : undefined,
      colTotals: config.subtotals ? [] : undefined,
      grandTotal: null,
    }
  }

  const agg = (config.aggregator || 'sum').toLowerCase() as AggregatorType

  // 1. Identify distinct column values
  const seenCols = new Set<string>()
  const rawColHeaders: string[] = []
  for (const row of rows) {
    const rawVal = row[colField]
    const cv = rawVal === null || rawVal === undefined ? '(null)' : String(rawVal)
    if (!seenCols.has(cv)) {
      seenCols.add(cv)
      rawColHeaders.push(cv)
    }
  }

  let colHeaders = rawColHeaders
  let truncatedAt: number | undefined
  if (config.colLimit && config.colLimit > 0 && colHeaders.length > config.colLimit) {
    truncatedAt = config.colLimit
    colHeaders = colHeaders.slice(0, config.colLimit)
  }

  const colIdxMap = new Map<string, number>()
  colHeaders.forEach((c, idx) => colIdxMap.set(c, idx))

  // 2. Identify distinct row groups
  const hasRowFields = config.rowFields && config.rowFields.length > 0
  const rowHeaders: string[][] = []
  const seenRows = new Map<string, number>()

  if (!hasRowFields) {
    seenRows.set('__all__', 0)
    rowHeaders.push(['Total'])
  } else {
    for (const row of rows) {
      const parts = config.rowFields.map((rf) => {
        const v = row[rf]
        return v === null || v === undefined ? '(null)' : String(v)
      })
      const key = parts.join('\x1f')
      if (!seenRows.has(key)) {
        seenRows.set(key, rowHeaders.length)
        rowHeaders.push(parts)
      }
    }
  }

  const numRows = rowHeaders.length
  const numCols = colHeaders.length

  // Cells numeric tracking
  const cellNums: number[][][] = Array.from({ length: numRows }, () =>
    Array.from({ length: numCols }, () => [])
  )
  const cellCounts: number[][] = Array.from({ length: numRows }, () =>
    Array.from({ length: numCols }, () => 0)
  )

  const rowNums: number[][] = Array.from({ length: numRows }, () => [])
  const rowCounts: number[] = Array.from({ length: numRows }, () => 0)
  const colNums: number[][] = Array.from({ length: numCols }, () => [])
  const colCounts: number[] = Array.from({ length: numCols }, () => 0)
  const allNums: number[] = []
  let allCount = 0

  for (const row of rows) {
    const rawCv = row[colField]
    const cv = rawCv === null || rawCv === undefined ? '(null)' : String(rawCv)
    const cIdx = colIdxMap.get(cv)
    if (cIdx === undefined) continue // truncated

    let rIdx = 0
    if (hasRowFields) {
      const parts = config.rowFields.map((rf) => {
        const v = row[rf]
        return v === null || v === undefined ? '(null)' : String(v)
      })
      rIdx = seenRows.get(parts.join('\x1f')) ?? 0
    }

    cellCounts[rIdx][cIdx]++
    rowCounts[rIdx]++
    colCounts[cIdx]++
    allCount++

    const rawVal = row[config.valueField]
    const num = parseNumber(rawVal)
    if (num !== null) {
      cellNums[rIdx][cIdx].push(num)
      rowNums[rIdx].push(num)
      colNums[cIdx].push(num)
      allNums.push(num)
    }
  }

  // 3. Compute final cells
  const cells: (number | null)[][] = Array.from({ length: numRows }, (_, r) =>
    Array.from({ length: numCols }, (_, c) =>
      computeAgg(agg, cellNums[r][c], cellCounts[r][c])
    )
  )

  let rowTotals: (number | null)[] | undefined
  let colTotals: (number | null)[] | undefined
  let grandTotal: number | null | undefined

  if (config.subtotals) {
    rowTotals = rowNums.map((nums, r) => computeAgg(agg, nums, rowCounts[r]))
    colTotals = colNums.map((nums, c) => computeAgg(agg, nums, colCounts[c]))
    grandTotal = computeAgg(agg, allNums, allCount)
  }

  return {
    cells,
    rowHeaders,
    colHeaders,
    rowTotals,
    colTotals,
    grandTotal,
    truncatedAt,
  }
}

// Escape cell value for CSV and sanitize formula injection
export function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return ''
  let s = String(val)
  if (s.startsWith('=') || s.startsWith('+') || s.startsWith('-') || s.startsWith('@')) {
    s = `'${s}`
  }
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// RFC 4180 CSV export
export function exportPivotToCSV(
  matrix: PivotMatrix,
  rowFields?: string[]
): string {
  if (!matrix || !matrix.cells) return ''

  const lines: string[] = []
  const hasRowTotals = matrix.rowTotals !== undefined && matrix.rowTotals.length > 0
  const hasColTotals = matrix.colTotals !== undefined && matrix.colTotals.length > 0

  const numRowFields = matrix.rowHeaders.length > 0
    ? matrix.rowHeaders[0].length
    : (rowFields?.length ?? 1)

  // Header line
  const header: string[] = []
  for (let i = 0; i < numRowFields; i++) {
    header.push(rowFields?.[i] || `Row_${i + 1}`)
  }
  header.push(...matrix.colHeaders)
  if (hasRowTotals) {
    header.push('Total')
  }
  lines.push(header.map(escapeCSV).join(','))

  // Data rows
  for (let r = 0; r < matrix.cells.length; r++) {
    const row: string[] = []
    if (r < matrix.rowHeaders.length) {
      row.push(...matrix.rowHeaders[r])
    } else {
      for (let i = 0; i < numRowFields; i++) row.push('')
    }

    for (const cell of matrix.cells[r]) {
      row.push(cell === null || cell === undefined ? '' : String(cell))
    }

    if (hasRowTotals) {
      const rt = matrix.rowTotals?.[r]
      row.push(rt === null || rt === undefined ? '' : String(rt))
    }
    lines.push(row.map(escapeCSV).join(','))
  }

  // Subtotal row
  if (hasColTotals) {
    const totalRow: string[] = ['Total']
    for (let i = 1; i < numRowFields; i++) {
      totalRow.push('')
    }
    for (const ct of matrix.colTotals ?? []) {
      totalRow.push(ct === null || ct === undefined ? '' : String(ct))
    }
    if (hasRowTotals) {
      totalRow.push(matrix.grandTotal === null || matrix.grandTotal === undefined ? '' : String(matrix.grandTotal))
    }
    lines.push(totalRow.map(escapeCSV).join(','))
  }

  return lines.join('\n')
}

// Markdown table export
export function exportPivotToMarkdown(
  matrix: PivotMatrix,
  rowFields?: string[]
): string {
  if (!matrix || !matrix.cells) return ''

  const lines: string[] = []
  const hasRowTotals = matrix.rowTotals !== undefined && matrix.rowTotals.length > 0
  const hasColTotals = matrix.colTotals !== undefined && matrix.colTotals.length > 0

  const numRowFields = matrix.rowHeaders.length > 0
    ? matrix.rowHeaders[0].length
    : (rowFields?.length ?? 1)

  // Header line
  const headerParts: string[] = []
  const sepParts: string[] = []

  for (let i = 0; i < numRowFields; i++) {
    headerParts.push(rowFields?.[i] || `Row ${i + 1}`)
    sepParts.push(':---')
  }
  for (const ch of matrix.colHeaders) {
    headerParts.push(ch)
    sepParts.push('---:')
  }
  if (hasRowTotals) {
    headerParts.push('Total')
    sepParts.push('---:')
  }
  lines.push(`| ${headerParts.join(' | ')} |`)
  lines.push(`| ${sepParts.join(' | ')} |`)

  // Rows
  for (let r = 0; r < matrix.cells.length; r++) {
    const parts: string[] = []
    if (r < matrix.rowHeaders.length) {
      parts.push(...matrix.rowHeaders[r])
    } else {
      for (let i = 0; i < numRowFields; i++) parts.push('')
    }

    for (const cell of matrix.cells[r]) {
      parts.push(cell === null || cell === undefined ? '-' : String(cell))
    }

    if (hasRowTotals) {
      const rt = matrix.rowTotals?.[r]
      parts.push(rt === null || rt === undefined ? '-' : String(rt))
    }
    lines.push(`| ${parts.join(' | ')} |`)
  }

  // Total row
  if (hasColTotals) {
    const totalParts: string[] = ['**Total**']
    for (let i = 1; i < numRowFields; i++) {
      totalParts.push('')
    }
    for (const ct of matrix.colTotals ?? []) {
      totalParts.push(ct === null || ct === undefined ? '-' : `**${ct}**`)
    }
    if (hasRowTotals) {
      totalParts.push(matrix.grandTotal === null || matrix.grandTotal === undefined ? '-' : `**${matrix.grandTotal}**`)
    }
    lines.push(`| ${totalParts.join(' | ')} |`)
  }

  return lines.join('\n')
}

// Compute heatmap shading style for a numeric cell
export function computeCellHeat(
  val: number | null | undefined,
  min: number,
  max: number
): { bg: string; text?: string; intensity: number } {
  if (val === null || val === undefined || isNaN(val) || min >= max) {
    return { bg: 'transparent', intensity: 0 }
  }

  const intensity = Math.max(0, Math.min(1, (val - min) / (max - min)))
  // Soft blue/cyan gradient overlay
  const alpha = (0.05 + intensity * 0.35).toFixed(3)
  const bg = `rgba(59, 130, 246, ${alpha})`
  const text = intensity > 0.65 ? '#93c5fd' : undefined

  return { bg, text, intensity }
}

// Automatically infer sensible pivot defaults from available column metadata
export function inferPivotDefaults(
  columns: string[],
  rows?: Record<string, any>[]
): PivotConfig {
  if (!columns || columns.length === 0) {
    return {
      rowFields: [],
      colField: '',
      valueField: '',
      aggregator: 'count',
      subtotals: true,
      colLimit: 50,
    }
  }

  const sampleRow = rows && rows.length > 0 ? rows[0] : null

  const isNumeric = (col: string) => {
    if (sampleRow && sampleRow[col] !== undefined) {
      return typeof sampleRow[col] === 'number' || (!isNaN(Number(sampleRow[col])) && sampleRow[col] !== '')
    }
    return /amount|total|price|cost|qty|quantity|count|revenue|val|salary|num|score/i.test(col)
  }

  const numCols = columns.filter(isNumeric)
  const nonNumCols = columns.filter((c) => !isNumeric(c))

  let rowField = nonNumCols[0] || columns[0]
  let colField = nonNumCols[1] || (columns.length > 1 ? columns[1] : columns[0])
  let valField = numCols[0] || columns.find((c) => c !== rowField && c !== colField) || columns[0]

  if (rowField === colField && columns.length > 1) {
    colField = columns.find((c) => c !== rowField) || columns[1]
  }

  return {
    rowFields: [rowField],
    colField,
    valueField: valField,
    aggregator: numCols.length > 0 ? 'sum' : 'count',
    subtotals: true,
    colLimit: 50,
  }
}
