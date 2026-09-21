import {
  extractFederatedReferences,
  generateFederatedJoinSnippet,
  formatReconcileStatus,
  validateDataPipeForm,
  exportFederatedQueryResultToCSV,
} from './federationHelper.ts'
import type { QueryResult } from '../../lib/api.ts'

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

console.log('--- Running Federation & Cross-DB Helper Unit Tests ---')

// 1. extractFederatedReferences
test('extractFederatedReferences: single table reference', () => {
  const sql = 'SELECT * FROM [conn1].users LIMIT 10;'
  const refs = extractFederatedReferences(sql)
  assert(refs.length === 1, 'Should extract 1 reference')
  assert(refs[0].connId === 'conn1', 'connId should be conn1')
  assert(refs[0].table === 'users', 'table should be users')
  assert(refs[0].schema === undefined, 'schema should be undefined')
})

test('extractFederatedReferences: schema-qualified and joins', () => {
  const sql = `
    SELECT u.name, o.amount
    FROM [pg-prod].public.users u
    JOIN [mysql-analytics].reporting.orders o ON u.id = o.user_id
    WHERE u.active = true
  `
  const refs = extractFederatedReferences(sql)
  assert(refs.length === 2, 'Should extract 2 references')
  assert(refs[0].connId === 'pg-prod', 'First connId should be pg-prod')
  assert(refs[0].schema === 'public', 'First schema should be public')
  assert(refs[0].table === 'users', 'First table should be users')

  assert(refs[1].connId === 'mysql-analytics', 'Second connId should be mysql-analytics')
  assert(refs[1].schema === 'reporting', 'Second schema should be reporting')
  assert(refs[1].table === 'orders', 'Second table should be orders')
})

test('extractFederatedReferences: deduplicates identical references', () => {
  const sql = `
    SELECT a.id, b.id FROM [c1].users a JOIN [c1].users b ON a.mgr = b.id
  `
  const refs = extractFederatedReferences(sql)
  assert(refs.length === 1, 'Should deduplicate identical references')
})

// 2. generateFederatedJoinSnippet
test('generateFederatedJoinSnippet: generates clean template', () => {
  const snippet = generateFederatedJoinSnippet('pg1', 'users', 'mysql2', 'orders', 'id', 'user_id')
  assert(snippet.includes('[pg1].users'), 'Should include first conn table')
  assert(snippet.includes('[mysql2].orders'), 'Should include second conn table')
  assert(snippet.includes('a.id = b.user_id'), 'Should include join condition')
})

// 3. formatReconcileStatus
test('formatReconcileStatus: status badges', () => {
  const s1 = formatReconcileStatus('IDENTICAL')
  assert(s1.label === 'Identical Match', 'Should have correct label')
  assert(s1.badgeClass.includes('emerald'), 'Should be emerald')

  const s2 = formatReconcileStatus('SCHEMA_MISMATCH')
  assert(s2.label === 'Schema Mismatch', 'Should have correct label')
  assert(s2.badgeClass.includes('rose'), 'Should be rose')

  const s3 = formatReconcileStatus('ROW_COUNT_MISMATCH')
  assert(s3.label === 'Row Count Mismatch', 'Should have correct label')
  assert(s3.badgeClass.includes('amber'), 'Should be amber')

  const s4 = formatReconcileStatus('DATA_MISMATCH')
  assert(s4.label === 'Data Sample Mismatch', 'Should have correct label')
})

// 4. validateDataPipeForm
test('validateDataPipeForm: validates inputs', () => {
  assert(!validateDataPipeForm({}).valid, 'Empty form invalid')
  assert(
    !validateDataPipeForm({ sourceConnId: 'c1', sourceTable: 't1', targetConnId: 'c1', targetTable: 't1' }).valid,
    'Identical source and target invalid'
  )
  assert(
    validateDataPipeForm({
      sourceConnId: 'c1',
      sourceTable: 't1',
      targetConnId: 'c2',
      targetTable: 't1_clone',
      batchSize: 500,
    }).valid,
    'Valid form passes'
  )
  assert(
    !validateDataPipeForm({
      sourceConnId: 'c1',
      sourceTable: 't1',
      targetConnId: 'c2',
      targetTable: 't2',
      batchSize: -10,
    }).valid,
    'Negative batch size invalid'
  )
})

// 5. exportFederatedQueryResultToCSV
test('exportFederatedQueryResultToCSV: exports properly formatted CSV', () => {
  const qr: QueryResult = {
    columns: ['id', 'name', 'notes'],
    rows: [
      [1, 'Alice', 'Hello, World'],
      [2, 'Bob "The Builder"', 'Line 1\nLine 2'],
    ],
    durationMs: 12,
    affectedRows: 2,
  }
  const csv = exportFederatedQueryResultToCSV(qr)
  assert(csv.startsWith('id,name,notes'), 'CSV should have header')
  assert(csv.includes('"Hello, World"'), 'Commas must be quoted')
  assert(csv.includes('"Bob ""The Builder"""'), 'Quotes must be escaped')
})

console.log(`\nFederation Helper Tests: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
