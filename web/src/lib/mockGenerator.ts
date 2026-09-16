import type { ColumnMeta } from './api'

const FIRST_NAMES = ['Liam', 'Emma', 'Noah', 'Olivia', 'James', 'Sophia', 'Aiden', 'Isabella', 'Lucas', 'Mia']
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Lee']
const CITIES = ['New York', 'San Francisco', 'Austin', 'Seattle', 'Chicago', 'Boston', 'Denver', 'Miami']
const COUNTRIES = ['US', 'CA', 'GB', 'DE', 'FR', 'JP', 'AU', 'BR']
const COMPANIES = ['Acme Corp', 'Globex', 'Initech', 'Umbrella Corp', 'Stark Ind', 'Wayne Ent', 'Cyberdyne']
const JOBS = ['Software Engineer', 'Product Manager', 'Designer', 'Analyst', 'DevOps Engineer', 'Data Scientist']
const STATUSES = ['active', 'pending', 'inactive', 'completed']
const STREETS = ['Main St', 'Oak Ave', 'Maple Dr', 'Broadway', 'Park Blvd', 'Cedar Ln', 'Elm Way']

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randFloat(min: number, max: number): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(2))
}

function recentSQLTimestamp(): string {
  const ms = Date.now() - Math.floor(Math.random() * 60 * 24 * 60 * 60 * 1000)
  const d = new Date(ms)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** Returns the inferred mock rule label for UI display. */
export function inferMockRule(col: ColumnMeta): string {
  const n = col.name.toLowerCase()
  const t = (col.dataType ?? col.type ?? '').toLowerCase()

  // Auto-increment PK detection
  if (col.isPrimary || col.isPrimaryKey) {
    const def = (col.default ?? col.defaultValue ?? '').toLowerCase()
    const isIntType = /int|serial|bigint|smallint/.test(t)
    const isAutoInc = /nextval|identity|autoincrement|auto_increment|serial/.test(def)
    if (isIntType || isAutoInc) return 'Auto Increment (Skipped)'
    // UUID PK
    if (/uuid|char|text|varchar/.test(t)) return 'UUID (Generated)'
  }

  if (/uuid/.test(n) || /uuid/.test(t)) return 'UUID (Generated)'
  if (/email/.test(n)) return 'Email'
  if (/first.?name|fname/.test(n)) return 'First Name'
  if (/last.?name|lname|surname/.test(n)) return 'Last Name'
  if (/full.?name|^name$/.test(n)) return 'Full Name'
  if (/phone|mobile|tel/.test(n)) return 'Phone'
  if (/address|street/.test(n)) return 'Address'
  if (/city/.test(n)) return 'City'
  if (/country/.test(n)) return 'Country'
  if (/company|org(anization)?/.test(n)) return 'Company'
  if (/job|title|role/.test(n)) return 'Job Title'
  if (/status/.test(n)) return 'Status'
  if (/price|amount|total|cost/.test(n)) return 'Price'
  if (/quantity|qty|count|age/.test(n)) return 'Integer'
  if (/created.?at|updated.?at|timestamp|deleted.?at/.test(n)) return 'Timestamp'
  if (/date$/.test(n)) return 'Timestamp'

  // Type-based fallbacks
  if (/bool/.test(t)) return 'Boolean'
  if (/int/.test(t)) return 'Integer'
  if (/float|double|decimal|numeric|real/.test(t)) return 'Float'
  if (/json|jsonb/.test(t)) return 'JSON'
  if (/text|char|varchar|string/.test(t)) return 'Text'

  return 'Text'
}

function isAutoIncrementPK(col: ColumnMeta): boolean {
  if (!(col.isPrimary || col.isPrimaryKey)) return false
  const t = (col.dataType ?? col.type ?? '').toLowerCase()
  const def = (col.default ?? col.defaultValue ?? '').toLowerCase()
  const isIntType = /int|serial|bigint|smallint/.test(t)
  const isAutoInc = /nextval|identity|autoincrement|auto_increment|serial/.test(def)
  return isIntType || isAutoInc
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function generateValue(col: ColumnMeta, customRule?: string): any {
  const rule = customRule ?? inferMockRule(col)

  if (rule === 'Auto Increment (Skipped)') return undefined

  switch (rule) {
    case 'UUID (Generated)':
      return generateUUID()
    case 'Email': {
      const fn = pick(FIRST_NAMES).toLowerCase()
      const ln = pick(LAST_NAMES).toLowerCase()
      return `${fn.toLowerCase()}.${ln.toLowerCase()}${Math.floor(100 + Math.random() * 9000)}@example.com`
    }
    case 'First Name':
      return pick(FIRST_NAMES)
    case 'Last Name':
      return pick(LAST_NAMES)
    case 'Full Name':
      return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`
    case 'Phone':
      return `+1-555-${String(randInt(1000, 9999))}`
    case 'Address':
      return `${randInt(100, 9999)} ${pick(STREETS)}`
    case 'City':
      return pick(CITIES)
    case 'Country':
      return pick(COUNTRIES)
    case 'Company':
      return pick(COMPANIES)
    case 'Job Title':
      return pick(JOBS)
    case 'Status':
      return pick(STATUSES)
    case 'Price':
      return randFloat(5, 999)
    case 'Integer':
      return randInt(1, 1000)
    case 'Float':
      return randFloat(0, 9999)
    case 'Boolean':
      return Math.random() > 0.5
    case 'Timestamp':
      return recentSQLTimestamp()
    case 'JSON':
      return '{}'
    case 'Text':
    default: {
      const t = (col.dataType ?? col.type ?? '').toLowerCase()
      if (/bool/.test(t)) return Math.random() > 0.5
      if (/int/.test(t)) return randInt(1, 1000)
      if (/float|double|decimal|numeric|real/.test(t)) return randFloat(0, 9999)
      if (/json/.test(t)) return '{}'
      return `sample_${col.name}_${randInt(1, 9999)}`
    }
  }
}

/**
 * Generates mock rows for a given set of columns.
 * Auto-increment PKs are skipped (omitted from the row) so DB generates them.
 * customRules: map of colName -> rule label override.
 */
export function generateMockRows(
  columns: ColumnMeta[],
  count: number,
  customRules?: Record<string, string>,
  skipCols?: Set<string>
): Record<string, any>[] {
  const rows: Record<string, any>[] = []
  for (let i = 0; i < count; i++) {
    const row: Record<string, any> = {}
    for (const col of columns) {
      if (skipCols?.has(col.name)) continue
      if (isAutoIncrementPK(col)) continue
      const rule = customRules?.[col.name]
      const val = generateValue(col, rule)
      if (val !== undefined) {
        row[col.name] = val
      }
    }
    rows.push(row)
  }
  return rows
}
