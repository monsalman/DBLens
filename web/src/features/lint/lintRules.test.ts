import {
  applyQuickFix,
  formatDiagnosticSummary,
  getSeverityStyle,
  fastClientCheck,
  type QuickFix,
  type AnalysisSummary,
} from './lintRules.ts'

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

console.log('--- Running SQL Lint Rules Unit Tests ---')

// 1. applyQuickFix
test('applyQuickFix: replaces slice accurately', () => {
  const sql = 'SELECT * FROM users'
  const fix: QuickFix = {
    title: 'Replace with explicit columns',
    replacement: 'id, email',
    start_offset: 7,
    end_offset: 8,
  }
  const result = applyQuickFix(sql, fix)
  assert(result === 'SELECT id, email FROM users', `Expected 'SELECT id, email FROM users', got '${result}'`)
})

test('applyQuickFix: appends text at end', () => {
  const sql = 'UPDATE users SET active = false'
  const fix: QuickFix = {
    title: 'Add WHERE clause',
    replacement: ' WHERE 1 = 0',
    start_offset: sql.length,
    end_offset: sql.length,
  }
  const result = applyQuickFix(sql, fix)
  assert(result === 'UPDATE users SET active = false WHERE 1 = 0', `Unexpected result: ${result}`)
})

// 2. formatDiagnosticSummary
test('formatDiagnosticSummary: formats counts into clean labels', () => {
  const empty: AnalysisSummary = { errors: 0, warnings: 0, info: 0, total: 0 }
  assert(formatDiagnosticSummary(empty) === 'No issues detected', 'Should be empty string label')

  const errorsOnly: AnalysisSummary = { errors: 1, warnings: 0, info: 0, total: 1 }
  assert(formatDiagnosticSummary(errorsOnly) === '1 error', 'Should be 1 error')

  const mixed: AnalysisSummary = { errors: 2, warnings: 3, info: 1, total: 6 }
  assert(formatDiagnosticSummary(mixed) === '2 errors, 3 warnings, 1 info', 'Should be mixed label')
})

// 3. getSeverityStyle
test('getSeverityStyle: returns correct palettes for error/warning/info', () => {
  const errStyle = getSeverityStyle('error')
  assert(errStyle.label === 'Error', 'Label should be Error')
  assert(errStyle.text.includes('red'), 'Text should contain red')

  const warnStyle = getSeverityStyle('warning')
  assert(warnStyle.label === 'Warning', 'Label should be Warning')
  assert(warnStyle.text.includes('amber'), 'Text should contain amber')

  const infoStyle = getSeverityStyle('info')
  assert(infoStyle.label === 'Info', 'Label should be Info')
  assert(infoStyle.text.includes('sky'), 'Text should contain sky')
})

// 4. fastClientCheck
test('fastClientCheck: flags unconstrained DELETE as error', () => {
  const diags = fastClientCheck('DELETE FROM accounts')
  assert(diags.length > 0, 'Should find diagnostic')
  assert(diags[0].rule_id === 'update-delete-without-where', 'Rule should match')
  assert(diags[0].severity === 'error', 'Severity should be error')
})

test('fastClientCheck: flags SELECT * as warning', () => {
  const diags = fastClientCheck('SELECT * FROM orders')
  assert(diags.some((d) => d.rule_id === 'select-star'), 'Should find select-star')
})

test('fastClientCheck: flags leading wildcard in LIKE', () => {
  const diags = fastClientCheck("SELECT id FROM users WHERE email LIKE '%@acme.com'")
  assert(diags.some((d) => d.rule_id === 'leading-wildcard-like'), 'Should find leading wildcard')
})

console.log(`\nLint Rules Tests Summary: ${passed} passed, ${failed} failed\n`)
if (failed > 0) {
  process.exit(1)
}
