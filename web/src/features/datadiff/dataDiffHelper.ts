export type RowStatus = 'added' | 'deleted' | 'modified' | 'identical'
export type SyncConflictStrategy = 'source_wins' | 'target_wins' | 'insert_missing_only'

export interface DataDiffRequest {
  sourceConnId: string
  sourceDsn?: string
  sourceSchema?: string
  sourceTable: string
  targetConnId: string
  targetDsn?: string
  targetSchema?: string
  targetTable: string
  columns?: string[]
  primaryKeys?: string[]
  whereClause?: string
  pageSize?: number
  offset?: number
  filterStatus?: string
}

export interface RowDiffItem {
  pkValues: Record<string, any>
  status: RowStatus
  sourceValues?: Record<string, any>
  targetValues?: Record<string, any>
  changedColumns?: string[]
  sourceHash?: string
  targetHash?: string
}

export interface DataDiffSummary {
  totalSourceRows: number
  totalTargetRows: number
  addedCount: number
  deletedCount: number
  modifiedCount: number
  identicalCount: number
  durationMs: number
}

export interface DataDiffResult {
  sourceTable: string
  targetTable: string
  sourceSchema?: string
  targetSchema?: string
  primaryKeys: string[]
  comparedColumns: string[]
  summary: DataDiffSummary
  rows: RowDiffItem[]
  sourceDialect?: string
  targetDialect?: string
}

export interface SyncScriptRequest {
  sourceConnId?: string
  sourceDsn?: string
  sourceSchema?: string
  sourceTable?: string
  sourceDialect?: string
  targetConnId?: string
  targetDsn?: string
  targetSchema?: string
  targetTable?: string
  strategy: SyncConflictStrategy
  primaryKeys: string[]
  columns: string[]
  rows: RowDiffItem[]
  deleteExcess?: boolean
  targetDialect?: string
}

export interface SyncScriptResponse {
  sql: string
  statements: string[]
  insertCount: number
  updateCount: number
  deleteCount: number
  strategy: SyncConflictStrategy
  targetDialect: string
}

export interface ApplySyncRequest {
  targetConnId: string
  targetDsn?: string
  targetSchema?: string
  targetTable?: string
  statements: string[]
  sql?: string
  readOnly?: boolean
  confirmed?: boolean
}

export interface ApplySyncResponse {
  success: boolean
  statementsExecuted: number
  affectedRows: number
  durationMs: number
  message: string
}

export function formatRowStatus(status: RowStatus | string): {
  label: string
  badgeClass: string
} {
  switch (status) {
    case 'added':
      return {
        label: '+ Added',
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
      }
    case 'deleted':
      return {
        label: '- Deleted',
        badgeClass: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
      }
    case 'modified':
      return {
        label: '~ Modified',
        badgeClass: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
      }
    case 'identical':
    default:
      return {
        label: '= Identical',
        badgeClass: 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20',
      }
  }
}

export function formatCellVal(val: any): string {
  if (val === null || val === undefined) {
    return 'NULL'
  }
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val)
    } catch {
      return String(val)
    }
  }
  if (typeof val === 'boolean') {
    return val ? 'true' : 'false'
  }
  return String(val)
}

export function getRowDiffCounts(rows: RowDiffItem[]): {
  added: number
  deleted: number
  modified: number
  identical: number
  total: number
} {
  let added = 0
  let deleted = 0
  let modified = 0
  let identical = 0

  for (const r of rows) {
    if (r.status === 'added') added++
    else if (r.status === 'deleted') deleted++
    else if (r.status === 'modified') modified++
    else if (r.status === 'identical') identical++
  }

  return {
    added,
    deleted,
    modified,
    identical,
    total: rows.length,
  }
}

export function isCellChanged(col: string, changedColumns?: string[]): boolean {
  if (!changedColumns || changedColumns.length === 0) return false
  return changedColumns.includes(col)
}

export function getRowKey(row: RowDiffItem, pks: string[]): string {
  const parts = pks.map((k) => `${k}=${formatCellVal(row.pkValues?.[k])}`)
  return parts.length > 0 ? parts.join(';') : JSON.stringify(row.pkValues || {})
}

export function filterDiffRows(
  rows: RowDiffItem[],
  filter: 'all' | 'added' | 'deleted' | 'modified' | 'identical',
  searchTerm?: string
): RowDiffItem[] {
  let filtered = rows
  if (filter !== 'all') {
    filtered = filtered.filter((r) => r.status === filter)
  }

  const term = searchTerm?.trim().toLowerCase()
  if (!term) {
    return filtered
  }

  return filtered.filter((row) => {
    // Check PK values
    for (const v of Object.values(row.pkValues || {})) {
      if (String(v).toLowerCase().includes(term)) return true
    }
    // Check Source values
    for (const v of Object.values(row.sourceValues || {})) {
      if (formatCellVal(v).toLowerCase().includes(term)) return true
    }
    // Check Target values
    for (const v of Object.values(row.targetValues || {})) {
      if (formatCellVal(v).toLowerCase().includes(term)) return true
    }
    return false
  })
}

export function generateCLICommand(
  req: Partial<DataDiffRequest>,
  strategy: SyncConflictStrategy = 'source_wins',
  deleteExcess = false
): string {
  const parts: string[] = ['dblens diff data']

  const srcRef = req.sourceSchema
    ? `${req.sourceConnId || 'src'}:${req.sourceSchema}.${req.sourceTable || 'table'}`
    : `${req.sourceConnId || 'src'}:${req.sourceTable || 'table'}`
  parts.push(`--source "${srcRef}"`)

  const tgtRef = req.targetSchema
    ? `${req.targetConnId || 'tgt'}:${req.targetSchema}.${req.targetTable || 'table'}`
    : `${req.targetConnId || 'tgt'}:${req.targetTable || 'table'}`
  parts.push(`--target "${tgtRef}"`)

  if (req.primaryKeys && req.primaryKeys.length > 0) {
    parts.push(`--pks "${req.primaryKeys.join(',')}"`)
  }

  if (req.columns && req.columns.length > 0) {
    parts.push(`--cols "${req.columns.join(',')}"`)
  }

  if (req.whereClause) {
    parts.push(`--where "${req.whereClause}"`)
  }

  parts.push(`--strategy ${strategy}`)

  if (deleteExcess) {
    parts.push('--delete-excess')
  }

  return parts.join(' ')
}
