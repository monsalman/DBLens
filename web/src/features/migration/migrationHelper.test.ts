import {
  sanitizeMigrationSlug,
  formatTimestampVersion,
  validateMigrationInput,
  formatMigrationFiles,
  filterMigrations,
  formatExecutionDuration,
  calculateMigrationStats,
  type MigrationRecord,
} from './migrationHelper.ts'

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

console.log('--- Running Migration Helper Unit Tests ---')

// 1. sanitizeMigrationSlug
test('sanitizeMigrationSlug: cleans special characters and spaces', () => {
  assert(sanitizeMigrationSlug('Create Users Table') === 'create_users_table', 'Should replace spaces')
  assert(sanitizeMigrationSlug('Add-index_on_email!') === 'add_index_on_email', 'Should strip punctuation')
  assert(sanitizeMigrationSlug('   ') === 'migration', 'Empty should fallback to migration')
  assert(sanitizeMigrationSlug('___multiple___underscores___') === 'multiple_underscores', 'Trim extra underscores')
})

// 2. formatTimestampVersion
test('formatTimestampVersion: outputs 14 digit UTC timestamp', () => {
  const d = new Date(Date.UTC(2026, 8, 22, 14, 30, 45))
  const v = formatTimestampVersion(d)
  assert(v === '20260922143045', `Expected 20260922143045, got ${v}`)
})

// 3. validateMigrationInput
test('validateMigrationInput: requires name and upSql', () => {
  assert(!validateMigrationInput('', 'SELECT 1;').valid, 'Empty name invalid')
  assert(!validateMigrationInput('create_table', '').valid, 'Empty upSql invalid')
  assert(validateMigrationInput('create_table', 'SELECT 1;').valid, 'Valid input passes')
})

// 4. formatMigrationFiles
test('formatMigrationFiles: generates correct files for all formats', () => {
  const up = 'CREATE TABLE t (id INT);'
  const down = 'DROP TABLE t;'
  const ver = '20260922000001'
  const name = 'init_t'

  // Goose
  const goose = formatMigrationFiles(ver, name, up, down, 'goose')
  assert(goose.length === 1, 'Goose should have 1 file')
  assert(goose[0].fileName === '20260922000001_init_t.sql', 'Goose filename matches')
  assert(goose[0].content.includes('-- +goose Up') && goose[0].content.includes('-- +goose Down'), 'Goose directives present')

  // Golang-Migrate
  const gm = formatMigrationFiles(ver, name, up, down, 'golang-migrate')
  assert(gm.length === 2, 'Golang-migrate should have 2 files')
  assert(gm[0].fileName === '20260922000001_init_t.up.sql', 'Up filename matches')
  assert(gm[1].fileName === '20260922000001_init_t.down.sql', 'Down filename matches')

  // Flyway
  const flyway = formatMigrationFiles(ver, name, up, down, 'flyway')
  assert(flyway.length === 2, 'Flyway should have 2 files')
  assert(flyway[0].fileName === 'V20260922000001__init_t.sql', 'Flyway V filename matches')
  assert(flyway[1].fileName === 'U20260922000001__init_t.sql', 'Flyway U filename matches')

  // DB-Mate
  const dbmate = formatMigrationFiles(ver, name, up, down, 'dbmate')
  assert(dbmate.length === 1, 'DB-Mate should have 1 file')
  assert(dbmate[0].content.includes('-- migrate:up') && dbmate[0].content.includes('-- migrate:down'), 'Dbmate directives present')

  // Prisma
  const prisma = formatMigrationFiles(ver, name, up, down, 'prisma')
  assert(prisma.length === 1, 'Prisma should have 1 file')
  assert(prisma[0].fileName === 'migration.sql', 'Prisma filename is migration.sql')
})

// 5. filterMigrations
test('filterMigrations: filters records by keyword search', () => {
  const records: MigrationRecord[] = [
    {
      id: 1,
      version: '20260922000001',
      name: 'create_users',
      appliedAt: '2026-09-22T00:00:00Z',
      checksum: 'abc111',
      executionTimeMs: 15,
      upSql: 'CREATE TABLE users (id INT);',
      downSql: 'DROP TABLE users;',
    },
    {
      id: 2,
      version: '20260922000002',
      name: 'add_orders',
      appliedAt: '2026-09-22T00:01:00Z',
      checksum: 'def222',
      executionTimeMs: 45,
      upSql: 'CREATE TABLE orders (id INT);',
      downSql: 'DROP TABLE orders;',
    },
  ]

  assert(filterMigrations(records, '').length === 2, 'Empty filter returns all')
  assert(filterMigrations(records, 'orders').length === 1, 'Filters by name')
  assert(filterMigrations(records, '000001').length === 1, 'Filters by version')
  assert(filterMigrations(records, 'def222').length === 1, 'Filters by checksum')
  assert(filterMigrations(records, 'nonexistent').length === 0, 'No matches returns empty')
})

// 6. formatExecutionDuration
test('formatExecutionDuration: formats durations correctly', () => {
  assert(formatExecutionDuration(0) === '< 1ms', '0ms formats < 1ms')
  assert(formatExecutionDuration(12) === '12ms', '12ms formats 12ms')
  assert(formatExecutionDuration(1500) === '1.50s', '1500ms formats 1.50s')
})

// 7. calculateMigrationStats
test('calculateMigrationStats: calculates total, latest version, duration', () => {
  const records: MigrationRecord[] = [
    {
      id: 1,
      version: '20260922000001',
      name: 'm1',
      appliedAt: '',
      checksum: '',
      executionTimeMs: 10,
      upSql: '',
      downSql: '',
    },
    {
      id: 2,
      version: '20260922000002',
      name: 'm2',
      appliedAt: '',
      checksum: '',
      executionTimeMs: 25,
      upSql: '',
      downSql: '',
    },
  ]

  const stats = calculateMigrationStats(records)
  assert(stats.total === 2, 'Total should be 2')
  assert(stats.latestVersion === '20260922000002', 'Latest version should match last record')
  assert(stats.totalExecutionTimeMs === 35, 'Total time should be 35ms')

  const emptyStats = calculateMigrationStats([])
  assert(emptyStats.total === 0 && emptyStats.latestVersion === null, 'Empty list handled')
})

console.log(`\nMigration Helper Tests: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
