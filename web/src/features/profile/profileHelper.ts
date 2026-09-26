export interface ValueFreq {
  value: string
  count: number
  percentage: number
}

export interface Bucket {
  min: number
  max: number
  count: number
}

export interface ColumnProfile {
  columnName: string
  dataType: string
  totalRows: number
  nullCount: number
  nullPercentage: number
  distinctCount: number
  uniquenessRatio: number
  emptyCount: number
  minVal?: number
  maxVal?: number
  avgVal?: number
  stdDev?: number
  topValues: ValueFreq[]
  histogram?: Bucket[]
  piiType?: string
  qualityFlags: string[]
}

export interface Suggestion {
  columnName?: string
  type: 'constraint' | 'index' | 'warning' | 'cleanup' | string
  severity: 'high' | 'medium' | 'low' | 'info' | string
  title: string
  description: string
  remediation?: string
}

export interface ColumnDiff {
  columnName: string
  baseNullPct: number
  targetNullPct: number
  nullPctDiff: number
  baseDistinctCount: number
  targetDistinct: number
  distinctDiff: number
  status: 'changed' | 'added' | 'removed' | 'identical' | string
  notes: string[]
}

export interface CompareResult {
  baseTable: string
  targetTable: string
  baseRows: number
  targetRows: number
  rowDiff: number
  columnDiffs: ColumnDiff[]
  summary: string
}

export interface ProfileReport {
  schema: string
  table: string
  dialect: string
  totalRows: number
  columns: ColumnProfile[]
  suggestions: Suggestion[]
  qualityScore: number
  generatedAt: string
}

export interface ProfileRequest {
  schema?: string
  table: string
  columns?: string[]
  sampleRows?: number
}

export function formatPercentage(val: number, decimals = 1): string {
  if (isNaN(val) || !isFinite(val)) return '0.0%'
  return `${val.toFixed(decimals)}%`
}

export function formatNumber(val: number): string {
  if (isNaN(val) || !isFinite(val)) return '0'
  return new Intl.NumberFormat().format(val)
}

export function formatMetricVal(val?: number): string {
  if (val === undefined || val === null || isNaN(val)) return '-'
  if (Number.isInteger(val)) return val.toLocaleString()
  return val.toFixed(2)
}

export function formatBytes(b: number): string {
  if (b <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(1024))
  const idx = Math.min(i, units.length - 1)
  return `${(b / Math.pow(1024, idx)).toFixed(1)} ${units[idx]}`
}

export function qualityBadgeColor(score: number): {
  bg: string
  text: string
  border: string
  label: string
} {
  if (score >= 90) {
    return {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/30',
      label: 'Excellent',
    }
  }
  if (score >= 75) {
    return {
      bg: 'bg-blue-500/10',
      text: 'text-blue-400',
      border: 'border-blue-500/30',
      label: 'Good',
    }
  }
  if (score >= 50) {
    return {
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/30',
      label: 'Fair',
    }
  }
  return {
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    border: 'border-rose-500/30',
    label: 'Needs Attention',
  }
}

export function flagBadgeStyle(flag: string): {
  bg: string
  text: string
  border: string
  label: string
} {
  switch (flag) {
    case 'high_nulls':
      return {
        bg: 'bg-rose-500/15',
        text: 'text-rose-400',
        border: 'border-rose-500/30',
        label: 'High Nulls',
      }
    case 'constant':
      return {
        bg: 'bg-amber-500/15',
        text: 'text-amber-400',
        border: 'border-amber-500/30',
        label: 'Constant',
      }
    case 'unique_candidate':
      return {
        bg: 'bg-emerald-500/15',
        text: 'text-emerald-400',
        border: 'border-emerald-500/30',
        label: 'Unique Candidate',
      }
    case 'empty_strings':
      return {
        bg: 'bg-orange-500/15',
        text: 'text-orange-400',
        border: 'border-orange-500/30',
        label: 'Empty Strings',
      }
    case 'low_cardinality':
      return {
        bg: 'bg-indigo-500/15',
        text: 'text-indigo-400',
        border: 'border-indigo-500/30',
        label: 'Low Cardinality',
      }
    case 'potential_pii':
      return {
        bg: 'bg-purple-500/15',
        text: 'text-purple-400',
        border: 'border-purple-500/30',
        label: 'PII Detected',
      }
    default:
      return {
        bg: 'bg-zinc-500/15',
        text: 'text-zinc-400',
        border: 'border-zinc-500/30',
        label: flag,
      }
  }
}

export function calculateQualityScoreClient(columns: ColumnProfile[]): number {
  if (!columns || columns.length === 0) return 100

  let score = 100
  const penaltyPerCol = 40 / columns.length

  for (const col of columns) {
    let colPenalty = 0
    if (col.nullPercentage > 50) {
      colPenalty += 0.6
    } else if (col.nullPercentage > 20) {
      colPenalty += 0.3
    }
    if (col.emptyCount > 0 && col.nullCount > 0) {
      colPenalty += 0.3
    }
    for (const f of col.qualityFlags) {
      if (f === 'constant') colPenalty += 0.5
      if (f === 'potential_pii') colPenalty += 0.2
    }
    colPenalty = Math.min(colPenalty, 1)
    score -= colPenalty * penaltyPerCol
  }

  score = Math.max(0, score)
  return Math.round(score * 10) / 10
}

export function generateMarkdownReport(report: ProfileReport): string {
  if (!report) return ''
  const tbl = report.schema ? `${report.schema}.${report.table}` : report.table
  const lines: string[] = []

  lines.push(`# Data Profile Report: ${tbl}\n`)
  lines.push(`- **Table**: \`${tbl}\``)
  lines.push(`- **Dialect**: ${report.dialect}`)
  lines.push(`- **Total Rows**: ${formatNumber(report.totalRows)}`)
  lines.push(`- **Columns Profiled**: ${report.columns.length}`)
  lines.push(`- **Quality Score**: ${report.qualityScore.toFixed(1)} / 100`)
  lines.push(`- **Generated At**: ${report.generatedAt}\n`)

  lines.push('## Column Overview\n')
  lines.push('| Column | Type | Null Count | Null % | Distinct | Uniqueness | PII | Flags |')
  lines.push('|---|---|---|---|---|---|---|---|')

  for (const col of report.columns) {
    const pii = col.piiType ? col.piiType.toUpperCase() : '-'
    const flags = col.qualityFlags.length > 0 ? col.qualityFlags.join(', ') : '-'
    lines.push(
      `| \`${col.columnName}\` | ${col.dataType} | ${formatNumber(col.nullCount)} | ${formatPercentage(col.nullPercentage)} | ${formatNumber(col.distinctCount)} | ${formatPercentage(col.uniquenessRatio * 100)} | ${pii} | ${flags} |`
    )
  }
  lines.push('')

  lines.push('## Column Metrics & Top Values\n')
  for (const col of report.columns) {
    lines.push(`### Column \`${col.columnName}\` (${col.dataType})\n`)
    lines.push(`- **Nulls**: ${formatNumber(col.nullCount)} (${formatPercentage(col.nullPercentage)})`)
    lines.push(`- **Distinct**: ${formatNumber(col.distinctCount)} (${formatPercentage(col.uniquenessRatio * 100)} unique)`)
    if (col.emptyCount > 0) {
      lines.push(`- **Empty Strings**: ${formatNumber(col.emptyCount)}`)
    }
    if (col.minVal !== undefined && col.maxVal !== undefined) {
      const avg = col.avgVal !== undefined ? col.avgVal.toFixed(2) : '-'
      lines.push(`- **Range**: min=${col.minVal}, max=${col.maxVal}, avg=${avg}`)
    }
    if (col.piiType) {
      lines.push(`- **PII Category**: \`${col.piiType}\``)
    }
    if (col.topValues && col.topValues.length > 0) {
      lines.push('\n**Top Frequent Values**:')
      for (const tv of col.topValues) {
        lines.push(`  - \`${tv.value}\`: ${formatNumber(tv.count)} (${formatPercentage(tv.percentage)})`)
      }
    }
    lines.push('')
  }

  if (report.suggestions && report.suggestions.length > 0) {
    lines.push(`## Quality Suggestions (${report.suggestions.length})\n`)
    for (const s of report.suggestions) {
      lines.push(`### [${s.severity.toUpperCase()}] ${s.title}\n`)
      lines.push(`${s.description}\n`)
      if (s.remediation) {
        lines.push('```sql')
        lines.push(s.remediation)
        lines.push('```\n')
      }
    }
  }

  return lines.join('\n')
}
