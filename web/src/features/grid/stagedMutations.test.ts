import {
  generateStagedSQL,
  formatSqlValue,
  escapeIdentifier,
  type StagedChange,
} from './stagedMutations.ts'
import {
  isDestructiveQuery,
  isNonSelectQuery,
} from '../../lib/safeMode.ts'

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

console.log('--- Running stagedMutations & safeMode Unit Tests ---')

// 1. isDestructiveQuery: DROP TABLE / DATABASE / VIEW / SCHEMA
test('isDestructiveQuery: identifies DROP TABLE', () => {
  const res = isDestructiveQuery('DROP TABLE users CASCADE;')
  assert(res.isDestructive === true, 'DROP TABLE should be destructive')
  assert(!!res.reason && res.reason.includes('DROP TABLE'), 'Reason should mention DROP TABLE')
})

test('isDestructiveQuery: identifies DROP DATABASE', () => {
  const res = isDestructiveQuery('DROP DATABASE prod_db;')
  assert(res.isDestructive === true, 'DROP DATABASE should be destructive')
})

test('isDestructiveQuery: identifies DROP VIEW and DROP SCHEMA', () => {
  assert(isDestructiveQuery('DROP VIEW user_summary;').isDestructive === true, 'DROP VIEW should be destructive')
  assert(isDestructiveQuery('DROP SCHEMA analytics CASCADE;').isDestructive === true, 'DROP SCHEMA should be destructive')
})

// 2. isDestructiveQuery: TRUNCATE
test('isDestructiveQuery: identifies TRUNCATE', () => {
  const res = isDestructiveQuery('TRUNCATE TABLE audit_logs;')
  assert(res.isDestructive === true, 'TRUNCATE should be destructive')
})

// 3. isDestructiveQuery: DELETE FROM without WHERE vs with WHERE
test('isDestructiveQuery: identifies DELETE without WHERE as destructive', () => {
  const res = isDestructiveQuery('DELETE FROM orders;')
  assert(res.isDestructive === true, 'DELETE without WHERE should be destructive')
})

test('isDestructiveQuery: allows DELETE with WHERE', () => {
  const res = isDestructiveQuery('DELETE FROM orders WHERE id = 100;')
  assert(res.isDestructive === false, 'DELETE with WHERE should not be marked destructive')
})

// 4. isDestructiveQuery: UPDATE without WHERE vs with WHERE
test('isDestructiveQuery: identifies UPDATE without WHERE as destructive', () => {
  const res = isDestructiveQuery('UPDATE users SET role = \'admin\';')
  assert(res.isDestructive === true, 'UPDATE without WHERE should be destructive')
})

test('isDestructiveQuery: allows UPDATE with WHERE', () => {
  const res = isDestructiveQuery('UPDATE users SET role = \'admin\' WHERE id = 1;')
  assert(res.isDestructive === false, 'UPDATE with WHERE should not be marked destructive')
})

test('isDestructiveQuery: catches UPDATE/DELETE without WHERE even if string literal contains WHERE', () => {
  const resUpdate = isDestructiveQuery("UPDATE users SET status = 'WHERE is my mind';")
  assert(resUpdate.isDestructive === true, 'UPDATE without actual WHERE should be destructive despite string literal')

  const resDelete = isDestructiveQuery("DELETE FROM logs; -- notes with WHERE inside 'WHERE'")
  assert(resDelete.isDestructive === true, 'DELETE without actual WHERE should be destructive')

  const resSafe = isDestructiveQuery("UPDATE users SET status = 'WHERE is my mind' WHERE id = 10;")
  assert(resSafe.isDestructive === false, 'UPDATE with actual WHERE clause should not be destructive')
})

// 5. isDestructiveQuery: SELECT queries and comments
test('isDestructiveQuery: safe SELECT with comments', () => {
  const res = isDestructiveQuery('/* drop table in comment */ SELECT * FROM users;')
  assert(res.isDestructive === false, 'Commented drop should not trigger destructive check')
})

// 6. isNonSelectQuery
test('isNonSelectQuery: correctly flags DDL/DML', () => {
  assert(isNonSelectQuery('SELECT * FROM users') === false, 'SELECT should be false')
  assert(isNonSelectQuery('INSERT INTO users (name) VALUES (\'bob\')') === true, 'INSERT should be true')
  assert(isNonSelectQuery('UPDATE users SET name = \'bob\' WHERE id = 1') === true, 'UPDATE should be true')
  assert(isNonSelectQuery('DELETE FROM users WHERE id = 1') === true, 'DELETE should be true')
  assert(isNonSelectQuery('ALTER TABLE users ADD COLUMN age INT') === true, 'ALTER should be true')
  assert(isNonSelectQuery('CREATE TABLE foo (id INT)') === true, 'CREATE should be true')
})

// 7. formatSqlValue
test('formatSqlValue: handles primitives and escaping', () => {
  assert(formatSqlValue(null) === 'NULL', 'null should be NULL')
  assert(formatSqlValue(undefined) === 'NULL', 'undefined should be NULL')
  assert(formatSqlValue(42) === '42', 'number should be string number')
  assert(formatSqlValue(true) === 'TRUE', 'boolean true should be TRUE')
  assert(formatSqlValue(false) === 'FALSE', 'boolean false should be FALSE')
  assert(formatSqlValue('hello') === '\'hello\'', 'string should be quoted')
  assert(formatSqlValue("O'Reilly") === '\'O\'\'Reilly\'', 'single quotes should be escaped')
  // MySQL escaping
  assert(formatSqlValue("C:\\path\\O'Reilly", 'mysql') === "'C:\\\\path\\\\O''Reilly'", 'mysql escapes backslashes')
})

// 8. escapeIdentifier
test('escapeIdentifier: quotes according to dialect', () => {
  assert(escapeIdentifier('users', 'postgres') === '"users"', 'postgres uses double quotes')
  assert(escapeIdentifier('users', 'mysql') === '`users`', 'mysql uses backticks')
})

// 9. generateStagedSQL
test('generateStagedSQL: produces correct UPDATE statement for single column', () => {
  const changes: StagedChange[] = [
    {
      key: '1:email',
      row: { id: 1, email: 'alice@example.com' },
      col: 'email',
      oldVal: 'alice@example.com',
      newVal: 'alice.new@example.com',
      where: { id: 1 },
    },
  ]
  const sql = generateStagedSQL(changes, 'users')
  assert(
    sql === `UPDATE "users" SET "email" = 'alice.new@example.com' WHERE "id" = 1;`,
    `unexpected SQL output: ${sql}`
  )
})

test('generateStagedSQL: handles schema prefix and mysql dialect', () => {
  const changes: StagedChange[] = [
    {
      key: '1:status',
      row: { id: 1 },
      col: 'status',
      oldVal: 'pending',
      newVal: 'active',
      where: { id: 1 },
    },
  ]
  const pgSql = generateStagedSQL(changes, 'users', 'auth', 'postgres')
  assert(
    pgSql === `UPDATE "auth"."users" SET "status" = 'active' WHERE "id" = 1;`,
    `unexpected postgres schema SQL: ${pgSql}`
  )

  const mysqlSql = generateStagedSQL(changes, 'users', undefined, 'mysql')
  assert(
    mysqlSql === 'UPDATE `users` SET `status` = \'active\' WHERE `id` = 1;',
    `unexpected mysql SQL: ${mysqlSql}`
  )
})

test('generateStagedSQL: handles composite primary key and null values', () => {
  const changes: StagedChange[] = [
    {
      key: '10_20:note',
      row: { org_id: 10, user_id: 20 },
      col: 'note',
      oldVal: 'old note',
      newVal: null,
      where: { org_id: 10, user_id: 20 },
    },
  ]
  const sql = generateStagedSQL(changes, 'memberships')
  assert(
    sql === `UPDATE "memberships" SET "note" = NULL WHERE "org_id" = 10 AND "user_id" = 20;`,
    `unexpected composite PK SQL: ${sql}`
  )
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
} else {
  console.log('All stagedMutations and safeMode tests passed!')
}
