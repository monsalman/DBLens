export type ChartType = 'bar' | 'line' | 'area' | 'donut' | 'kpi'
export type AggregationType = 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max'

export interface ColorTheme {
  id: string
  name: string
  primary: string
  accent: string
  bgGrad: string
  palette: string[]
}

export const THEMES: Record<string, ColorTheme> = {
  emerald: {
    id: 'emerald',
    name: 'Emerald',
    primary: '#10b981',
    accent: '#34d399',
    bgGrad: 'rgba(16, 185, 129, 0.3)',
    palette: ['#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#84cc16', '#14b8a6'],
  },
  indigo: {
    id: 'indigo',
    name: 'Indigo',
    primary: '#6366f1',
    accent: '#818cf8',
    bgGrad: 'rgba(99, 102, 241, 0.3)',
    palette: ['#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#a855f7', '#14b8a6'],
  },
  cyan: {
    id: 'cyan',
    name: 'Cyan',
    primary: '#06b6d4',
    accent: '#22d3ee',
    bgGrad: 'rgba(6, 182, 212, 0.3)',
    palette: ['#06b6d4', '#3b82f6', '#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#14b8a6'],
  },
  amber: {
    id: 'amber',
    name: 'Amber',
    primary: '#f59e0b',
    accent: '#fbbf24',
    bgGrad: 'rgba(245, 158, 11, 0.3)',
    palette: ['#f59e0b', '#f97316', '#ef4444', '#8b5cf6', '#3b82f6', '#10b981', '#06b6d4', '#e11d48'],
  },
  violet: {
    id: 'violet',
    name: 'Violet',
    primary: '#8b5cf6',
    accent: '#a78bfa',
    bgGrad: 'rgba(139, 92, 246, 0.3)',
    palette: ['#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#d946ef'],
  },
  rose: {
    id: 'rose',
    name: 'Rose',
    primary: '#f43f5e',
    accent: '#fb7185',
    bgGrad: 'rgba(244, 63, 94, 0.3)',
    palette: ['#f43f5e', '#fb7185', '#ec4899', '#a855f7', '#6366f1', '#06b6d4', '#10b981', '#f59e0b'],
  },
}

export interface AggregatedItem {
  label: string
  value: number
  count: number
  percent?: number
}

export interface AggregationResult {
  items: AggregatedItem[]
  total: number
  min: number
  max: number
  avg: number
  count: number
}

export interface TooltipState {
  x: number
  y: number
  label: string
  value: number
  formattedValue: string
  percent?: string
  color?: string
}

export function getRowVal(row: any, col: string, colIndex: number): any {
  if (row === null || row === undefined) return undefined
  if (typeof row === 'object' && !Array.isArray(row)) {
    if (col in row) return row[col]
  }
  if (Array.isArray(row) && colIndex >= 0 && colIndex < row.length) {
    return row[colIndex]
  }
  return (row as any)[col]
}

export function parseNumeric(val: any): number | null {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number') return Number.isFinite(val) ? val : null
  if (typeof val === 'boolean') return null
  const str = String(val).trim()
  if (str === '') return null
  const num = Number(str)
  return Number.isFinite(num) ? num : null
}

export function detectColumns(
  columns: string[],
  rows: any[]
): {
  defaultX: string
  defaultY: string
  numericCols: string[]
} {
  if (!columns || columns.length === 0) {
    return { defaultX: '', defaultY: '', numericCols: [] }
  }

  const numericCols: string[] = []
  const textOrDateCols: string[] = []
  const sampleRows = (rows || []).slice(0, 50)

  columns.forEach((col, idx) => {
    let numericCount = 0
    let validCount = 0

    for (const row of sampleRows) {
      const val = getRowVal(row, col, idx)
      if (val !== null && val !== undefined && val !== '') {
        validCount++
        if (parseNumeric(val) !== null) {
          numericCount++
        }
      }
    }

    if (validCount > 0 && numericCount / validCount >= 0.6) {
      numericCols.push(col)
    } else {
      textOrDateCols.push(col)
    }
  })

  const defaultX = textOrDateCols[0] || columns[0]
  let defaultY = numericCols.find((c) => c !== defaultX) || numericCols[0]
  if (!defaultY) {
    defaultY = columns.length > 1 ? columns[1] : columns[0]
  }

  return { defaultX, defaultY, numericCols }
}

export function aggregateData(
  rows: any[],
  columns: string[],
  xCol: string,
  yCol: string,
  agg: AggregationType
): AggregationResult {
  if (!rows || rows.length === 0 || !xCol || !yCol) {
    return { items: [], total: 0, min: 0, max: 0, avg: 0, count: 0 }
  }

  const xIdx = columns.indexOf(xCol)
  const yIdx = columns.indexOf(yCol)

  if (agg === 'none') {
    const items: AggregatedItem[] = []
    let total = 0
    let min = Infinity
    let max = -Infinity

    const sliceRows = rows.slice(0, 200)

    sliceRows.forEach((row, i) => {
      const rawX = getRowVal(row, xCol, xIdx)
      const rawY = getRowVal(row, yCol, yIdx)
      const label = rawX !== null && rawX !== undefined ? String(rawX) : `Row ${i + 1}`
      const numY = parseNumeric(rawY) ?? 0

      total += numY
      if (numY < min) min = numY
      if (numY > max) max = numY

      items.push({
        label,
        value: numY,
        count: 1,
      })
    })

    const count = items.length
    const avg = count > 0 ? total / count : 0
    const finalMin = min === Infinity ? 0 : min
    const finalMax = max === -Infinity ? 0 : max

    if (total > 0) {
      items.forEach((item) => {
        item.percent = Math.max(0, (item.value / total) * 100)
      })
    }

    return {
      items,
      total: Math.round(total * 100) / 100,
      min: finalMin,
      max: finalMax,
      avg: Math.round(avg * 100) / 100,
      count,
    }
  }

  // Aggregated mode (Sum, Avg, Count, Min, Max)
  const groupMap = new Map<string, { sum: number; count: number; min: number; max: number; values: number[] }>()

  rows.forEach((row) => {
    const rawX = getRowVal(row, xCol, xIdx)
    const rawY = getRowVal(row, yCol, yIdx)
    const key = rawX !== null && rawX !== undefined && String(rawX).trim() !== '' ? String(rawX) : '(null)'
    const numY = parseNumeric(rawY)

    if (!groupMap.has(key)) {
      groupMap.set(key, { sum: 0, count: 0, min: Infinity, max: -Infinity, values: [] })
    }

    const group = groupMap.get(key)!
    group.count++
    if (numY !== null) {
      group.sum += numY
      if (numY < group.min) group.min = numY
      if (numY > group.max) group.max = numY
      group.values.push(numY)
    }
  })

  const items: AggregatedItem[] = []
  let totalSum = 0
  let overallMin = Infinity
  let overallMax = -Infinity

  groupMap.forEach((group, label) => {
    let finalVal = 0
    switch (agg) {
      case 'sum':
        finalVal = group.sum
        break
      case 'avg':
        finalVal = group.values.length > 0 ? group.sum / group.values.length : 0
        break
      case 'count':
        finalVal = group.count
        break
      case 'min':
        finalVal = group.min === Infinity ? 0 : group.min
        break
      case 'max':
        finalVal = group.max === -Infinity ? 0 : group.max
        break
    }

    finalVal = Math.round(finalVal * 100) / 100
    totalSum += finalVal
    if (finalVal < overallMin) overallMin = finalVal
    if (finalVal > overallMax) overallMax = finalVal

    items.push({
      label,
      value: finalVal,
      count: group.count,
    })
  })

  const totalCount = items.length
  const avg = totalCount > 0 ? totalSum / totalCount : 0
  const finalMin = overallMin === Infinity ? 0 : overallMin
  const finalMax = overallMax === -Infinity ? 0 : overallMax

  if (totalSum > 0) {
    items.forEach((item) => {
      item.percent = Math.max(0, (item.value / totalSum) * 100)
    })
  }

  return {
    items,
    total: Math.round(totalSum * 100) / 100,
    min: finalMin,
    max: finalMax,
    avg: Math.round(avg * 100) / 100,
    count: totalCount,
  }
}

export function formatValue(val: number): string {
  if (val === null || val === undefined || isNaN(val)) return '0'
  const abs = Math.abs(val)
  if (abs >= 1_000_000_000) {
    return `${(val / 1_000_000_000).toFixed(1)}B`
  }
  if (abs >= 1_000_000) {
    return `${(val / 1_000_000).toFixed(1)}M`
  }
  if (abs >= 1_000) {
    return `${(val / 1_000).toFixed(1)}k`
  }
  if (Number.isInteger(val)) {
    return val.toLocaleString()
  }
  return val.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function calculateTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    return [min]
  }
  const ticks: number[] = []
  const step = (max - min) / (count - 1)
  for (let i = 0; i < count; i++) {
    ticks.push(min + i * step)
  }
  return ticks
}

export function describeArc(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number
): string {
  if (endAngle - startAngle >= 2 * Math.PI - 0.0001) {
    const midAngle = startAngle + Math.PI
    return `${describeArc(cx, cy, rOuter, rInner, startAngle, midAngle)} ${describeArc(
      cx,
      cy,
      rOuter,
      rInner,
      midAngle,
      endAngle
    )}`
  }

  const sAngle = startAngle - Math.PI / 2
  const eAngle = endAngle - Math.PI / 2

  const x1 = cx + rOuter * Math.cos(sAngle)
  const y1 = cy + rOuter * Math.sin(sAngle)
  const x2 = cx + rOuter * Math.cos(eAngle)
  const y2 = cy + rOuter * Math.sin(eAngle)
  const x3 = cx + rInner * Math.cos(eAngle)
  const y3 = cy + rInner * Math.sin(eAngle)
  const x4 = cx + rInner * Math.cos(sAngle)
  const y4 = cy + rInner * Math.sin(sAngle)

  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0

  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ')
}

export function truncate(str: string, len: number): string {
  if (!str) return ''
  return str.length > len ? str.slice(0, len - 1) + '…' : str
}
