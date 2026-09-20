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
  } catch (err: any) {
    failed++
    console.error(`  ✗ ${name}: ${err.message}`)
  }
}

console.log('--- Running Database Dump & Restore Client Unit Tests ---')

function buildDumpQueryParams(options: {
  schema?: string
  tables?: string[]
  includeSchema?: boolean
  includeData?: boolean
  gzip?: boolean
  database?: string
}): URLSearchParams {
  const params = new URLSearchParams()
  if (options.schema) params.set('schema', options.schema)
  if (options.tables && options.tables.length > 0) {
    params.set('tables', options.tables.join(','))
  }
  if (options.includeSchema !== undefined) {
    params.set('includeSchema', String(options.includeSchema))
  }
  if (options.includeData !== undefined) {
    params.set('includeData', String(options.includeData))
  }
  if (options.gzip !== undefined) {
    params.set('gzip', String(options.gzip))
  }
  if (options.database) {
    params.set('database', options.database)
  }
  return params
}

function isValidDumpFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return lower.endsWith('.sql') || lower.endsWith('.sql.gz')
}

test('buildDumpQueryParams: serializes options correctly', () => {
  const params = buildDumpQueryParams({
    schema: 'public',
    tables: ['users', 'orders'],
    includeSchema: true,
    includeData: false,
    gzip: true,
    database: 'production_db',
  })

  assert(params.get('schema') === 'public', 'schema matches')
  assert(params.get('tables') === 'users,orders', 'tables comma separated')
  assert(params.get('includeSchema') === 'true', 'includeSchema matches')
  assert(params.get('includeData') === 'false', 'includeData matches')
  assert(params.get('gzip') === 'true', 'gzip matches')
  assert(params.get('database') === 'production_db', 'database matches')
})

test('isValidDumpFile: accepts .sql and .sql.gz', () => {
  assert(isValidDumpFile('backup.sql'), '.sql valid')
  assert(isValidDumpFile('backup.SQL'), '.SQL valid')
  assert(isValidDumpFile('backup.sql.gz'), '.sql.gz valid')
  assert(isValidDumpFile('backup.SQL.GZ'), '.SQL.GZ valid')
  assert(!isValidDumpFile('backup.csv'), '.csv invalid')
  assert(!isValidDumpFile('backup.tar'), '.tar invalid')
  assert(!isValidDumpFile('backup.txt'), '.txt invalid')
})

console.log(`\nDump Client Tests Summary: ${passed} passed, ${failed} failed\n`)
if (failed > 0) {
  process.exit(1)
}
