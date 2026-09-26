/**
 * CLI Helper functions for DBLens Headless CLI Engine & CI/CD Gate
 * Generates equivalent dblens terminal commands for lint, diff, seed, profile, and query.
 */

function escapeArg(arg: string): string {
  if (!arg) return "''"
  if (/^[a-zA-Z0-9_\-.,:/@=]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, "'\\''")}'`
}

export interface LintCliOptions {
  dialect?: string
  failOn?: 'error' | 'warning' | 'info'
  format?: 'text' | 'json' | 'junit' | 'github'
  schema?: string
  rules?: string[]
  files?: string[]
}

export function buildLintCliCommand(opts: LintCliOptions = {}): string {
  const parts: string[] = ['dblens', 'lint']
  if (opts.dialect && opts.dialect !== 'postgres') {
    parts.push(`--dialect ${escapeArg(opts.dialect)}`)
  }
  if (opts.failOn && opts.failOn !== 'error') {
    parts.push(`--fail-on ${escapeArg(opts.failOn)}`)
  }
  if (opts.format && opts.format !== 'text') {
    parts.push(`--format ${escapeArg(opts.format)}`)
  }
  if (opts.schema) {
    parts.push(`--schema ${escapeArg(opts.schema)}`)
  }
  if (opts.rules && opts.rules.length > 0) {
    parts.push(`--rules ${escapeArg(opts.rules.join(','))}`)
  }
  if (opts.files && opts.files.length > 0) {
    parts.push(opts.files.map(escapeArg).join(' '))
  }
  return parts.join(' ')
}

export interface SchemaDiffCliOptions {
  source: string
  target: string
  format?: 'text' | 'json' | 'sql'
  failOnDrift?: boolean
  sourceSchema?: string
  targetSchema?: string
}

export function buildSchemaDiffCliCommand(opts: SchemaDiffCliOptions): string {
  const parts: string[] = ['dblens', 'diff', 'schema']
  parts.push(`--source ${escapeArg(opts.source)}`)
  parts.push(`--target ${escapeArg(opts.target)}`)
  if (opts.format && opts.format !== 'text') {
    parts.push(`--format ${escapeArg(opts.format)}`)
  }
  if (opts.failOnDrift === false) {
    parts.push('--fail-on-drift=false')
  }
  if (opts.sourceSchema) {
    parts.push(`--source-schema ${escapeArg(opts.sourceSchema)}`)
  }
  if (opts.targetSchema) {
    parts.push(`--target-schema ${escapeArg(opts.targetSchema)}`)
  }
  return parts.join(' ')
}

export interface DataDiffCliOptions {
  source: string
  target: string
  table: string
  schema?: string
  primaryKeys?: string[]
  assertSynced?: boolean
  out?: string
  format?: 'text' | 'json'
}

export function buildDataDiffCliCommand(opts: DataDiffCliOptions): string {
  const parts: string[] = ['dblens', 'diff', 'data']
  parts.push(`--source ${escapeArg(opts.source)}`)
  parts.push(`--target ${escapeArg(opts.target)}`)
  parts.push(`--table ${escapeArg(opts.table)}`)
  if (opts.schema) {
    parts.push(`--schema ${escapeArg(opts.schema)}`)
  }
  if (opts.primaryKeys && opts.primaryKeys.length > 0) {
    parts.push(`--pk ${escapeArg(opts.primaryKeys.join(','))}`)
  }
  if (opts.assertSynced === false) {
    parts.push('--assert-synced=false')
  }
  if (opts.out) {
    parts.push(`--out ${escapeArg(opts.out)}`)
  }
  if (opts.format && opts.format !== 'text') {
    parts.push(`--format ${escapeArg(opts.format)}`)
  }
  return parts.join(' ')
}

export interface SeedCliOptions {
  conn: string
  schema?: string
  tables?: string[]
  rows?: number
  format?: 'direct' | 'sql' | 'json'
  out?: string
  seed?: number
}

export function buildSeedCliCommand(opts: SeedCliOptions): string {
  const parts: string[] = ['dblens', 'seed']
  parts.push(`--conn ${escapeArg(opts.conn)}`)
  if (opts.schema) {
    parts.push(`--schema ${escapeArg(opts.schema)}`)
  }
  if (opts.tables && opts.tables.length > 0) {
    parts.push(`--tables ${escapeArg(opts.tables.join(','))}`)
  }
  if (opts.rows !== undefined && opts.rows !== 25) {
    parts.push(`--rows ${opts.rows}`)
  }
  if (opts.format && opts.format !== 'direct') {
    parts.push(`--format ${escapeArg(opts.format)}`)
  }
  if (opts.out) {
    parts.push(`--out ${escapeArg(opts.out)}`)
  }
  if (opts.seed !== undefined && opts.seed !== 0) {
    parts.push(`--seed ${opts.seed}`)
  }
  return parts.join(' ')
}

export interface ProfileCliOptions {
  conn: string
  table: string
  schema?: string
  assertNoNulls?: string[]
  assertUnique?: string[]
  format?: 'text' | 'json' | 'md'
  out?: string
}

export function buildProfileCliCommand(opts: ProfileCliOptions): string {
  const parts: string[] = ['dblens', 'profile']
  parts.push(`--conn ${escapeArg(opts.conn)}`)
  parts.push(`--table ${escapeArg(opts.table)}`)
  if (opts.schema) {
    parts.push(`--schema ${escapeArg(opts.schema)}`)
  }
  if (opts.assertNoNulls && opts.assertNoNulls.length > 0) {
    parts.push(`--assert-no-nulls ${escapeArg(opts.assertNoNulls.join(','))}`)
  }
  if (opts.assertUnique && opts.assertUnique.length > 0) {
    parts.push(`--assert-unique ${escapeArg(opts.assertUnique.join(','))}`)
  }
  if (opts.format && opts.format !== 'text') {
    parts.push(`--format ${escapeArg(opts.format)}`)
  }
  if (opts.out) {
    parts.push(`--out ${escapeArg(opts.out)}`)
  }
  return parts.join(' ')
}

export interface QueryCliOptions {
  conn: string
  query: string
  format?: 'table' | 'json' | 'csv'
}

export function buildQueryCliCommand(opts: QueryCliOptions): string {
  const parts: string[] = ['dblens', 'query']
  parts.push(`--conn ${escapeArg(opts.conn)}`)
  parts.push(`--query ${escapeArg(opts.query)}`)
  if (opts.format && opts.format !== 'table') {
    parts.push(`--format ${escapeArg(opts.format)}`)
  }
  return parts.join(' ')
}

/**
 * Copies a CLI command to the clipboard safely.
 */
export async function copyCliCommand(cmd: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(cmd)
      return true
    }
  } catch (err) {
    console.warn('Clipboard write failed, falling back:', err)
  }
  // Fallback for older browsers / insecure contexts
  try {
    const textarea = document.createElement('textarea')
    textarea.value = cmd
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    return success
  } catch {
    return false
  }
}
