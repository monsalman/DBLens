import {
  quoteIdentifier,
  quoteTableRef,
  cleanQuery,
  generateClientDDL,
  validateMaterializeForm,
  formatExpiryRemaining,
  type MaterializeRequest,
} from './materializeHelper.ts'

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
  } catch (err: unknown) {
    failed++
    const message = err instanceof Error ? err.message : String(err)
    console.error(`  ✗ ${name}: ${message}`)
  }
}

console.log('--- Running Materialize Helper Unit Tests ---')

test('quoteIdentifier quotes according to dialect', () => {
  assert(quoteIdentifier('users', 'postgres') === '"users"', 'pg quotes with double quotes')
  assert(quoteIdentifier('users', 'sqlite') === '"users"', 'sqlite quotes with double quotes')
  assert(quoteIdentifier('users', 'mysql') === '`users`', 'mysql quotes with backticks')
  assert(quoteIdentifier('my"table', 'postgres') === '"my""table"', 'pg escapes double quotes')
  assert(quoteIdentifier('my`table', 'mysql') === '`my``table`', 'mysql escapes backticks')
})

test('quoteTableRef handles schemas and tables', () => {
  assert(quoteTableRef('public', 'users', 'postgres') === '"public"."users"', 'pg schema table')
  assert(quoteTableRef('', 'users', 'postgres') === '"users"', 'pg table only')
  assert(quoteTableRef('main', 'users', 'sqlite') === '"users"', 'sqlite drops schema')
  assert(quoteTableRef('mydb', 'users', 'mysql') === '`mydb`.`users`', 'mysql schema table')
})

test('cleanQuery strips trailing semicolon and whitespace', () => {
  assert(cleanQuery('SELECT * FROM users;') === 'SELECT * FROM users', 'strip semicolon')
  assert(cleanQuery('  SELECT 1; ; \n') === 'SELECT 1', 'strip multiple semicolons')
})

test('generateClientDDL generates valid DDL for all modes', () => {
  const req: MaterializeRequest = {
    targetTable: 'summary_stats',
    sourceQuery: 'SELECT department, COUNT(*) FROM employees GROUP BY department',
    mode: 'create',
  }

  // Create mode
  const ddlCreate = generateClientDDL('postgres', req)
  assert(ddlCreate.startsWith('CREATE TABLE "summary_stats" AS'), 'create ddl')

  // Replace mode
  const ddlReplace = generateClientDDL('postgres', { ...req, mode: 'replace' })
  assert(ddlReplace.includes('DROP TABLE IF EXISTS "summary_stats";'), 'replace drop table')
  assert(ddlReplace.includes('CREATE TABLE "summary_stats" AS'), 'replace create table')

  // Append mode
  const ddlAppend = generateClientDDL('mysql', {
    ...req,
    mode: 'append',
    columns: ['dept', 'total'],
  })
  assert(
    ddlAppend.startsWith('INSERT INTO `summary_stats` (`dept`, `total`)'),
    'append with columns'
  )

  // Temp mode
  const ddlTempPg = generateClientDDL('postgres', { ...req, mode: 'temp' })
  assert(ddlTempPg.startsWith('CREATE TEMP TABLE "summary_stats" AS'), 'temp pg')

  const ddlTempMy = generateClientDDL('mysql', { ...req, mode: 'temp' })
  assert(ddlTempMy.startsWith('CREATE TEMPORARY TABLE `summary_stats` AS'), 'temp mysql')

  // View mode
  const ddlViewPg = generateClientDDL('postgres', { ...req, mode: 'view' })
  assert(ddlViewPg.startsWith('CREATE OR REPLACE VIEW "summary_stats" AS'), 'view pg')

  // Materialized view
  const ddlMvPg = generateClientDDL('postgres', { ...req, mode: 'materialized_view' })
  assert(ddlMvPg.startsWith('CREATE MATERIALIZED VIEW "summary_stats" AS'), 'materialized view pg')

  let threw = false
  try {
    generateClientDDL('sqlite', { ...req, mode: 'materialized_view' })
  } catch {
    threw = true
  }
  assert(threw, 'materialized view in sqlite throws error')
})

test('validateMaterializeForm checks target table and production safe mode', () => {
  const invalidName = validateMaterializeForm({
    targetTable: '123_invalid',
    sourceQuery: 'SELECT 1',
    mode: 'create',
  })
  assert(!invalidName.valid && !!invalidName.errors.targetTable, 'rejects invalid table identifier')

  const emptyQuery = validateMaterializeForm({
    targetTable: 'valid_table',
    sourceQuery: '',
    mode: 'create',
  })
  assert(!emptyQuery.valid && !!emptyQuery.errors.sourceQuery, 'rejects empty query')

  const prodReplaceBlocked = validateMaterializeForm(
    {
      targetTable: 'valid_table',
      sourceQuery: 'SELECT 1',
      mode: 'replace',
      overrideProduction: false,
    },
    true
  )
  assert(
    !prodReplaceBlocked.valid && !!prodReplaceBlocked.errors.overrideProduction,
    'blocks unconfirmed production replace'
  )

  const prodReplaceAllowed = validateMaterializeForm(
    {
      targetTable: 'valid_table',
      sourceQuery: 'SELECT 1',
      mode: 'replace',
      overrideProduction: true,
    },
    true
  )
  assert(prodReplaceAllowed.valid, 'allows confirmed production replace')
})

test('formatExpiryRemaining computes remaining time correctly', () => {
  const permanent = formatExpiryRemaining('')
  assert(permanent.label === 'Permanent' && !permanent.isExpired, 'empty is permanent')

  const futureDate = new Date(Date.now() + 45 * 60 * 1000).toISOString()
  const remaining = formatExpiryRemaining(futureDate)
  assert(!remaining.isExpired && remaining.label.includes('45m left'), '45m remaining')

  const pastDate = new Date(Date.now() - 10000).toISOString()
  const expired = formatExpiryRemaining(pastDate)
  assert(expired.isExpired && expired.label === 'Expired', 'past is expired')
})

console.log(`\nMaterialize Helper Tests Summary: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
