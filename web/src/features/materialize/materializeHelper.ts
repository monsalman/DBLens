export type MaterializeMode =
  | 'create'
  | 'replace'
  | 'append'
  | 'temp'
  | 'view'
  | 'materialized_view'

export interface MaterializeRequest {
  sourceConnId?: string
  sourceDsn?: string
  targetConnId?: string
  targetDsn?: string
  sourceQuery: string
  targetSchema?: string
  targetTable: string
  mode: MaterializeMode
  columns?: string[]
  estimatedRows?: number
  ttlMinutes?: number
  overrideProduction?: boolean
  isProduction?: boolean
}

export interface MaterializePreview {
  ddl: string
  mode: MaterializeMode
  targetTable: string
  targetSchema?: string
  dialect: string
  estimatedRows: number
  isSameConn: boolean
  warnings?: string[]
}

export interface MaterializeResult {
  success: boolean
  rowsAffected: number
  elapsedMs: number
  targetTable: string
  targetSchema?: string
  mode: MaterializeMode
  message: string
  scratch?: ScratchTable
}

export interface ScratchTable {
  connId: string
  schema?: string
  table: string
  query: string
  rowCount: number
  createdAt: string
  expiresAt: string
  isTemporary: boolean
}

export interface ModeConfig {
  id: MaterializeMode
  label: string
  shortDesc: string
  requiresPg?: boolean
  isDestructive?: boolean
  supportsTTL?: boolean
}

export const MATERIALIZE_MODES: ModeConfig[] = [
  {
    id: 'create',
    label: 'New Table',
    shortDesc: 'Create new persistent table from query results (CTAS)',
  },
  {
    id: 'replace',
    label: 'Replace Table',
    shortDesc: 'Drop existing table and replace with query results',
    isDestructive: true,
  },
  {
    id: 'append',
    label: 'Append to Table',
    shortDesc: 'Insert query rows into existing table schema',
  },
  {
    id: 'temp',
    label: 'Temp Scratchpad',
    shortDesc: 'Ephemeral scratch table with automatic expiry TTL',
    supportsTTL: true,
  },
  {
    id: 'view',
    label: 'Create View',
    shortDesc: 'Saved virtual view definition (zero storage)',
  },
  {
    id: 'materialized_view',
    label: 'Materialized View',
    shortDesc: 'Persisted query cache with refresh capability (PostgreSQL only)',
    requiresPg: true,
  },
]

export function quoteIdentifier(name: string, dialect = 'postgres'): string {
  const d = dialect.toLowerCase()
  if (d.includes('mysql') || d.includes('mariadb')) {
    return `\`${name.replace(/`/g, '``')}\``
  }
  return `"${name.replace(/"/g, '""')}"`
}

export function quoteTableRef(schema: string | undefined, table: string, dialect = 'postgres'): string {
  const d = dialect.toLowerCase()
  const cleanTable = table.trim()
  const cleanSchema = (schema || '').trim()

  if (!cleanSchema || d.includes('sqlite')) {
    return quoteIdentifier(cleanTable, d)
  }
  return `${quoteIdentifier(cleanSchema, d)}.${quoteIdentifier(cleanTable, d)}`
}

export function cleanQuery(query: string): string {
  return query.trim().replace(/(;\s*)+$/, '').trim()
}

export function generateClientDDL(dialect: string, req: MaterializeRequest): string {
  const d = dialect.toLowerCase()
  const targetRef = quoteTableRef(req.targetSchema, req.targetTable, d)
  const q = cleanQuery(req.sourceQuery)

  switch (req.mode) {
    case 'create':
      return `CREATE TABLE ${targetRef} AS ${q};`

    case 'replace':
      return `DROP TABLE IF EXISTS ${targetRef};\nCREATE TABLE ${targetRef} AS ${q};`

    case 'append':
      if (req.columns && req.columns.length > 0) {
        const cols = req.columns.map((c) => quoteIdentifier(c.trim(), d)).join(', ')
        return `INSERT INTO ${targetRef} (${cols}) ${q};`
      }
      return `INSERT INTO ${targetRef} ${q};`

    case 'temp':
      if (d.includes('mysql') || d.includes('mariadb')) {
        return `CREATE TEMPORARY TABLE ${targetRef} AS ${q};`
      }
      return `CREATE TEMP TABLE ${targetRef} AS ${q};`

    case 'view':
      if (d.includes('postgres') || d.includes('mysql') || d.includes('mariadb')) {
        return `CREATE OR REPLACE VIEW ${targetRef} AS ${q};`
      }
      return `DROP VIEW IF EXISTS ${targetRef};\nCREATE VIEW ${targetRef} AS ${q};`

    case 'materialized_view':
      if (!d.includes('postgres')) {
        throw new Error('Materialized views are only supported in PostgreSQL')
      }
      return `CREATE MATERIALIZED VIEW ${targetRef} AS ${q};`

    default:
      return `CREATE TABLE ${targetRef} AS ${q};`
  }
}

export function validateMaterializeForm(
  req: Partial<MaterializeRequest>,
  isProduction = false
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}

  if (!req.targetTable?.trim()) {
    errors.targetTable = 'Target table name is required'
  } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(req.targetTable.trim())) {
    errors.targetTable = 'Table name must be alphanumeric with underscores'
  }

  if (!req.sourceQuery?.trim()) {
    errors.sourceQuery = 'Source query is required'
  }

  if (req.mode === 'replace' && isProduction && !req.overrideProduction) {
    errors.overrideProduction = 'Explicit confirmation required to replace tables in production'
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}

export function formatExpiryRemaining(expiresAt: string): { label: string; isExpired: boolean; minutes: number } {
  if (!expiresAt) {
    return { label: 'Permanent', isExpired: false, minutes: Infinity }
  }
  const exp = new Date(expiresAt).getTime()
  if (isNaN(exp) || exp === 0) {
    return { label: 'Permanent', isExpired: false, minutes: Infinity }
  }

  const diffMs = exp - Date.now()
  if (diffMs <= 0) {
    return { label: 'Expired', isExpired: true, minutes: 0 }
  }

  const mins = Math.ceil(diffMs / (1000 * 60))
  if (mins < 60) {
    return { label: `${mins}m left`, isExpired: false, minutes: mins }
  }
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  return { label: `${hours}h ${remMins}m left`, isExpired: false, minutes: mins }
}
