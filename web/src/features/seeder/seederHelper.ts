export type GeneratorType =
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'uuid'
  | 'phone'
  | 'address'
  | 'city'
  | 'country'
  | 'postal_code'
  | 'timestamp'
  | 'date'
  | 'integer'
  | 'sequence'
  | 'decimal'
  | 'boolean'
  | 'enum'
  | 'text'
  | 'paragraph'
  | 'json'
  | 'fk'
  | 'custom'

export interface GeneratorConfig {
  type: GeneratorType
  min?: number
  max?: number
  decimals?: number
  options?: string[]
  prefix?: string
  truePct?: number
}

export interface ColumnPlan {
  name: string
  dataType: string
  isPrimary: boolean
  isForeignKey: boolean
  refTable?: string
  refColumn?: string
  generator: GeneratorType
  config: GeneratorConfig
}

export interface TableSeedPlan {
  table: string
  rowCount: number
  level: number
  pkColumn?: string
  dependencies: string[]
  columns: ColumnPlan[]
  sampleRows: Record<string, any>[]
  selfFks?: Array<{ column: string; refTable: string; refColumn: string }>
  deferredFks?: Array<{ column: string; refTable: string; refColumn: string }>
}

export interface SeedPlan {
  seed: number
  schema: string
  tables: TableSeedPlan[]
  dagOrder: string[]
  cyclesDetected: boolean
  cycleEdges?: Array<{ column: string; refTable: string; refColumn: string }>
  totalRows: number
}

export interface SeedProgress {
  table: string
  rowsInserted: number
  totalRows: number
  percentage: number
  rowsPerSec: number
  status: 'planning' | 'seeding' | 'updating_fks' | 'completed' | 'failed'
  error?: string
}

export interface SeedResult {
  totalInserted: number
  tablesInserted: Record<string, number>
  durationMs: number
  errors?: string[]
}

export interface SeederOptions {
  schema: string
  tables?: string[]
  rowCount?: Record<string, number>
  defaultRowCount?: number
  seed?: number
  customGenerators?: Record<string, Record<string, GeneratorConfig>>
  batchSize?: number
  cascade?: boolean
}

export const GENERATOR_PRESETS: Array<{ type: GeneratorType; label: string; description: string }> = [
  { type: 'sequence', label: 'Sequence / Auto-inc', description: 'Monotonic incremental integer (1, 2, 3...)' },
  { type: 'uuid', label: 'UUID v4', description: 'Deterministic RFC 4122 v4 UUID' },
  { type: 'name', label: 'Full Name', description: 'First and last name combination' },
  { type: 'first_name', label: 'First Name', description: 'Given name' },
  { type: 'last_name', label: 'Last Name', description: 'Surname / Family name' },
  { type: 'email', label: 'Email Address', description: 'Synthetic email with common domains' },
  { type: 'phone', label: 'Phone Number', description: 'Formatted telephone number' },
  { type: 'address', label: 'Street Address', description: 'Street address with city' },
  { type: 'city', label: 'City', description: 'World city name' },
  { type: 'country', label: 'Country', description: 'Country name' },
  { type: 'postal_code', label: 'Postal Code', description: '5-digit postal code' },
  { type: 'timestamp', label: 'Timestamp', description: 'ISO 8601 UTC timestamp' },
  { type: 'date', label: 'Date', description: 'YYYY-MM-DD date string' },
  { type: 'integer', label: 'Integer Range', description: 'Bounded pseudo-random integer' },
  { type: 'decimal', label: 'Decimal / Price', description: 'Float formatted with decimal precision' },
  { type: 'boolean', label: 'Boolean', description: 'True / False boolean flag' },
  { type: 'enum', label: 'Enum / Status', description: 'Pick from specified choices' },
  { type: 'text', label: 'Short Text', description: 'Short phrase or title' },
  { type: 'paragraph', label: 'Paragraph', description: 'Multi-sentence description' },
  { type: 'json', label: 'JSON Document', description: 'Synthetic structured JSON payload' },
  { type: 'fk', label: 'Foreign Key Ref', description: 'Sampled from parent table primary key pool' },
  { type: 'custom', label: 'Custom Prefix', description: 'Custom prefixed string (e.g. usr_123)' },
]

/**
 * Calculates hierarchy levels for DAG tables based on their dependencies.
 */
export function computeDAGLevels(tables: TableSeedPlan[]): Map<string, number> {
  const levelMap = new Map<string, number>()
  const safeTables = tables || []
  const tableMap = new Map<string, TableSeedPlan>()
  for (const t of safeTables) {
    tableMap.set(t.table, t)
  }

  function getLevel(tableName: string, visited: Set<string>): number {
    if (levelMap.has(tableName)) return levelMap.get(tableName)!
    if (visited.has(tableName)) return 0 // break circular
    visited.add(tableName)

    const t = tableMap.get(tableName)
    if (!t || !t.dependencies || t.dependencies.length === 0) {
      levelMap.set(tableName, 0)
      return 0
    }

    let maxLvl = -1
    for (const dep of t.dependencies) {
      const depLvl = getLevel(dep, new Set(visited))
      if (depLvl > maxLvl) maxLvl = depLvl
    }
    const lvl = maxLvl + 1
    levelMap.set(tableName, lvl)
    return lvl
  }

  for (const t of safeTables) {
    getLevel(t.table, new Set())
  }
  return levelMap
}

/**
 * Calculates row estimates and estimated execution duration.
 */
export function calculateRowEstimates(
  tables: TableSeedPlan[],
  defaultCount: number = 20
): { totalRows: number; estimatedDurationSec: number } {
  let totalRows = 0
  const safeTables = tables || []
  for (const t of safeTables) {
    totalRows += t.rowCount || defaultCount
  }
  // Rough benchmark: ~1,500 rows per second batch insertion
  const estimatedDurationSec = Math.max(0.5, Number((totalRows / 1500).toFixed(1)))
  return { totalRows, estimatedDurationSec }
}

/**
 * Formats a number with thousands separators.
 */
export function formatNumber(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return '0'
  return n.toLocaleString('en-US')
}

/**
 * Formats duration in milliseconds to human readable format.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = (ms / 1000).toFixed(1)
  return `${sec}s`
}

/**
 * Formats throughput rate.
 */
export function formatSpeed(rowsPerSec: number): string {
  if (rowsPerSec <= 0) return '0 rows/s'
  return `${Math.round(rowsPerSec).toLocaleString('en-US')} rows/s`
}

/**
 * Formats status badges for execution.
 */
export function formatStatusBadge(status: string): { label: string; badgeClass: string } {
  switch (status) {
    case 'planning':
      return { label: 'Resolving DAG', badgeClass: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' }
    case 'seeding':
      return { label: 'Seeding Tables', badgeClass: 'bg-blue-500/10 text-blue-400 border-blue-500/20' }
    case 'updating_fks':
      return { label: 'Updating FK References', badgeClass: 'bg-purple-500/10 text-purple-400 border-purple-500/20' }
    case 'completed':
      return { label: 'Completed', badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' }
    case 'failed':
      return { label: 'Failed', badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/20' }
    default:
      return { label: 'Ready', badgeClass: 'bg-zinc-800 text-zinc-400 border-zinc-700' }
  }
}

/**
 * Validates seeder form parameters before plan generation or execution.
 */
export function validateSeederForm(
  tables: string[],
  defaultCount: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (tables.length === 0) {
    errors.push('At least one table must be selected for seeding.')
  }
  if (defaultCount <= 0) {
    errors.push('Row count must be greater than 0.')
  }
  if (defaultCount > 100000) {
    errors.push('Maximum recommended row count per table is 100,000.')
  }
  return { valid: errors.length === 0, errors }
}
