import type { QueryResult } from '../../lib/api'

export interface ParsedTableRef {
  raw: string
  connId: string
  schema?: string
  table: string
}

const reConnTable = /\[([a-zA-Z0-9_-]+)\]\.([a-zA-Z0-9_`"']+)(?:\.([a-zA-Z0-9_`"']+))?/g

/**
 * Extracts bracketed connection table references from a federated SQL query.
 * e.g. [conn1].users or [conn2].public.orders
 */
export function extractFederatedReferences(sql: string): ParsedTableRef[] {
  const refs: ParsedTableRef[] = []
  const seen = new Set<string>()
  const regex = new RegExp(reConnTable.source, 'g')

  let match: RegExpExecArray | null
  while ((match = regex.exec(sql)) !== null) {
    const raw = match[0]
    const connId = match[1]
    const p1 = match[2].replace(/[`"']/g, '')
    const p2 = match[3] ? match[3].replace(/[`"']/g, '') : undefined

    const schema = p2 ? p1 : undefined
    const table = p2 ? p2 : p1
    const key = `${connId}:${schema || ''}:${table}`

    if (!seen.has(key)) {
      seen.add(key)
      refs.push({
        raw,
        connId,
        schema,
        table,
      })
    }
  }

  return refs
}

/**
 * Generates an initial federated join query template between two tables.
 */
export function generateFederatedJoinSnippet(
  conn1: string,
  table1: string,
  conn2: string,
  table2: string,
  joinCol1 = 'id',
  joinCol2 = 'user_id'
): string {
  const c1 = conn1 || 'conn1'
  const t1 = table1 || 'users'
  const c2 = conn2 || 'conn2'
  const t2 = table2 || 'orders'

  return `-- Cross-Database Federated Join
SELECT
  a.*,
  b.*
FROM [${c1}].${t1} a
JOIN [${c2}].${t2} b ON a.${joinCol1} = b.${joinCol2}
LIMIT 100;`
}

export interface ReconcileStatusInfo {
  label: string
  badgeClass: string
  description: string
}

/**
 * Maps reconciliation status codes to UI badge styling and friendly text.
 */
export function formatReconcileStatus(status: string): ReconcileStatusInfo {
  switch (status) {
  case 'IDENTICAL':
    return {
      label: 'Identical Match',
      badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      description: 'Schemas, row counts, and data checksums match exactly across both connections.',
    }
  case 'SCHEMA_MISMATCH':
    return {
      label: 'Schema Mismatch',
      badgeClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
      description: 'Column names, data types, or nullability constraints differ between tables.',
    }
  case 'ROW_COUNT_MISMATCH':
    return {
      label: 'Row Count Mismatch',
      badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      description: 'Schemas match, but total table row counts are different.',
    }
  case 'DATA_MISMATCH':
    return {
      label: 'Data Sample Mismatch',
      badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
      description: 'Schemas and row counts align, but sample row contents or checksums differ.',
    }
  default:
    return {
      label: status || 'Unknown',
      badgeClass: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
      description: 'Status not determined.',
    }
  }
}

/**
 * Validates parameters for cross-database data migration stream.
 */
export function validateDataPipeForm(data: {
  sourceConnId?: string
  sourceTable?: string
  targetConnId?: string
  targetTable?: string
  batchSize?: number
}): { valid: boolean; error?: string } {
  if (!data.sourceConnId) {
    return { valid: false, error: 'Source connection is required' }
  }
  if (!data.sourceTable || !data.sourceTable.trim()) {
    return { valid: false, error: 'Source table name is required' }
  }
  if (!data.targetConnId) {
    return { valid: false, error: 'Target connection is required' }
  }
  if (!data.targetTable || !data.targetTable.trim()) {
    return { valid: false, error: 'Target table name is required' }
  }
  if (
    data.sourceConnId === data.targetConnId &&
    data.sourceTable.trim() === data.targetTable.trim()
  ) {
    return { valid: false, error: 'Source and target cannot be the identical connection and table name' }
  }
  if (data.batchSize !== undefined && (data.batchSize < 1 || data.batchSize > 10000)) {
    return { valid: false, error: 'Batch size must be between 1 and 10,000' }
  }
  return { valid: true }
}

/**
 * Converts QueryResult to downloadable CSV string.
 */
export function exportFederatedQueryResultToCSV(result: QueryResult): string {
  if (!result || !result.columns || result.columns.length === 0) {
    return ''
  }

  const escapeCSV = (val: any): string => {
    if (val === null || val === undefined) return ''
    const str = String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const header = result.columns.map(escapeCSV).join(',')
  const rows = (result.rows || []).map((row) =>
    result.columns.map((_, i) => escapeCSV(row[i])).join(',')
  )

  return [header, ...rows].join('\n')
}
