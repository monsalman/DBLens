import {
  buildLintCliCommand,
  buildSchemaDiffCliCommand,
  buildDataDiffCliCommand,
  buildSeedCliCommand,
  buildProfileCliCommand,
  buildQueryCliCommand,
} from './cliHelper.ts'

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

console.log('--- Running CLI Helper Unit Tests ---')

test('buildLintCliCommand: defaults and custom flags', () => {
  const defaultCmd = buildLintCliCommand()
  assert(defaultCmd === 'dblens lint', `expected "dblens lint", got: ${defaultCmd}`)

  const customCmd = buildLintCliCommand({
    dialect: 'mysql',
    failOn: 'warning',
    format: 'github',
    schema: 'public',
    rules: ['select-star', 'require-where'],
    files: ['schema.sql', 'migrations/01.sql'],
  })
  assert(customCmd.includes('--dialect mysql'), 'dialect flag')
  assert(customCmd.includes('--fail-on warning'), 'fail-on flag')
  assert(customCmd.includes('--format github'), 'format flag')
  assert(customCmd.includes('--schema public'), 'schema flag')
  assert(customCmd.includes('--rules select-star,require-where'), 'rules flag')
  assert(customCmd.includes('schema.sql migrations/01.sql'), 'files appended')
})

test('buildSchemaDiffCliCommand: generates correct schema diff command', () => {
  const cmd = buildSchemaDiffCliCommand({
    source: 'postgres://localhost:5432/db1',
    target: 'postgres://localhost:5432/db2',
    format: 'sql',
    failOnDrift: false,
    sourceSchema: 'public',
    targetSchema: 'staging',
  })
  assert(cmd.startsWith('dblens diff schema'), 'starts with diff schema')
  assert(cmd.includes('--source postgres://localhost:5432/db1'), 'source flag')
  assert(cmd.includes('--target postgres://localhost:5432/db2'), 'target flag')
  assert(cmd.includes('--format sql'), 'format flag')
  assert(cmd.includes('--fail-on-drift=false'), 'fail-on-drift flag')
  assert(cmd.includes('--source-schema public'), 'source-schema flag')
  assert(cmd.includes('--target-schema staging'), 'target-schema flag')
})

test('buildDataDiffCliCommand: generates correct data diff command', () => {
  const cmd = buildDataDiffCliCommand({
    source: 'sqlite:///tmp/db1.sqlite',
    target: 'sqlite:///tmp/db2.sqlite',
    table: 'users',
    primaryKeys: ['id', 'org_id'],
    schema: 'main',
    assertSynced: true,
    out: 'sync.sql',
    format: 'json',
  })
  assert(cmd.startsWith('dblens diff data'), 'starts with diff data')
  assert(cmd.includes('--source sqlite:///tmp/db1.sqlite'), 'source flag')
  assert(cmd.includes('--target sqlite:///tmp/db2.sqlite'), 'target flag')
  assert(cmd.includes('--table users'), 'table flag')
  assert(cmd.includes('--schema main'), 'schema flag')
  assert(cmd.includes('--pk id,org_id'), 'pk flag')
  assert(cmd.includes('--out sync.sql'), 'out flag')
  assert(cmd.includes('--format json'), 'format flag')
})

test('buildSeedCliCommand: generates correct seed command', () => {
  const cmd = buildSeedCliCommand({
    conn: 'postgres://user:pass@localhost:5432/mydb',
    schema: 'public',
    tables: ['users', 'orders'],
    rows: 100,
    format: 'json',
    out: 'fixtures.json',
    seed: 42,
  })
  assert(cmd.startsWith('dblens seed'), 'starts with seed')
  assert(cmd.includes('--conn postgres://user:pass@localhost:5432/mydb'), 'conn flag')
  assert(cmd.includes('--schema public'), 'schema flag')
  assert(cmd.includes('--tables users,orders'), 'tables flag')
  assert(cmd.includes('--rows 100'), 'rows flag')
  assert(cmd.includes('--format json'), 'format flag')
  assert(cmd.includes('--out fixtures.json'), 'out flag')
  assert(cmd.includes('--seed 42'), 'seed flag')
})

test('buildProfileCliCommand: generates correct profile command', () => {
  const cmd = buildProfileCliCommand({
    conn: 'sqlite:///tmp/test.db',
    table: 'customers',
    schema: 'main',
    assertNoNulls: ['email', 'uuid'],
    assertUnique: ['uuid'],
    format: 'md',
    out: 'report.md',
  })
  assert(cmd.startsWith('dblens profile'), 'starts with profile')
  assert(cmd.includes('--conn sqlite:///tmp/test.db'), 'conn flag')
  assert(cmd.includes('--table customers'), 'table flag')
  assert(cmd.includes('--schema main'), 'schema flag')
  assert(cmd.includes('--assert-no-nulls email,uuid'), 'assert-no-nulls flag')
  assert(cmd.includes('--assert-unique uuid'), 'assert-unique flag')
  assert(cmd.includes('--format md'), 'format flag')
  assert(cmd.includes('--out report.md'), 'out flag')
})

test('buildQueryCliCommand: generates correct query command and escapes SQL', () => {
  const cmd = buildQueryCliCommand({
    conn: 'sqlite:///tmp/test.db',
    query: 'SELECT id, name FROM users WHERE role = "admin"',
    format: 'csv',
  })
  assert(cmd.startsWith('dblens query'), 'starts with query')
  assert(cmd.includes('--conn sqlite:///tmp/test.db'), 'conn flag')
  assert(cmd.includes('--query "SELECT id, name FROM users WHERE role = \\"admin\\""'), 'query escaped')
  assert(cmd.includes('--format csv'), 'format flag')
})

console.log(`\nCLI Helper Tests: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  throw new Error(`CLI helper tests failed with ${failed} failures`)
}
