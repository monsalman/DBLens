import {
  extractQueryVariables,
  DBA_MAINTENANCE_SNIPPETS,
} from './sqlVariableParser.ts'

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

console.log('--- Running sqlVariableParser Unit Tests ---')

// 1. Colon parameter syntax :param
test('extractQueryVariables: parses standard :param syntax', () => {
  const sql = 'SELECT * FROM users WHERE status = :status AND min_age >= :age'
  const vars = extractQueryVariables(sql)
  assert(vars.length === 2, `expected 2 variables, got ${vars.length}`)
  assert(vars[0].name === 'status' && vars[0].syntax === ':status', 'first param should be status')
  assert(vars[1].name === 'age' && vars[1].syntax === ':age', 'second param should be age')
})

// 2. Double brace parameter syntax {{param}}
test('extractQueryVariables: parses double-brace {{ param }} syntax', () => {
  const sql = 'SELECT * FROM {{ table_name }} WHERE id = {{target_id}}'
  const vars = extractQueryVariables(sql)
  assert(vars.length === 2, `expected 2 variables, got ${vars.length}`)
  assert(vars[0].name === 'table_name', 'first param should be table_name')
  assert(vars[1].name === 'target_id', 'second param should be target_id')
})

// 3. Mixed syntax and deduplication
test('extractQueryVariables: deduplicates repeated variable names', () => {
  const sql = 'SELECT * FROM items WHERE (name = :keyword OR description = :keyword) AND cat = {{cat}}'
  const vars = extractQueryVariables(sql)
  assert(vars.length === 2, `expected 2 unique variables, got ${vars.length}`)
  assert(vars[0].name === 'keyword', 'keyword should be first')
  assert(vars[1].name === 'cat', 'cat should be second')
})

// 4. Postgres cast exclusion
test('extractQueryVariables: ignores postgres type casts (::type)', () => {
  const sql = 'SELECT id::int, created_at::date FROM logs WHERE status = :status AND level = :level::text'
  const vars = extractQueryVariables(sql)
  assert(vars.length === 2, `expected 2 variables, got ${vars.length}`)
  assert(vars[0].name === 'status', 'first param should be status')
  assert(vars[1].name === 'level', 'second param should be level')
  assert(!vars.some(v => v.name === 'int' || v.name === 'date' || v.name === 'text'), 'casts must not be extracted')
})

// 5. String literal preservation
test('extractQueryVariables: ignores :param inside single quotes', () => {
  const sql = "SELECT 'hello :not_a_param' AS label, 'it''s :also_not' AS esc, :real_param FROM t"
  const vars = extractQueryVariables(sql)
  assert(vars.length === 1, `expected 1 variable, got ${vars.length}`)
  assert(vars[0].name === 'real_param', `expected real_param, got ${vars[0]?.name}`)
})

// 6. Comments exclusion
test('extractQueryVariables: ignores variables in line and block comments', () => {
  const sql = `-- Filter by :ignored_line_var
/* Block comment with :ignored_block_var and {{ignored_brace}} */
SELECT * FROM users WHERE active = :is_active`
  const vars = extractQueryVariables(sql)
  assert(vars.length === 1, `expected 1 variable, got ${vars.length}`)
  assert(vars[0].name === 'is_active', `expected is_active, got ${vars[0]?.name}`)
})

// 7. Snippet catalog validation
test('DBA_MAINTENANCE_SNIPPETS: contains snippets for postgres, mysql, sqlite', () => {
  const dialects = new Set(DBA_MAINTENANCE_SNIPPETS.map(s => s.dialect))
  assert(dialects.has('postgres'), 'must have postgres snippets')
  assert(dialects.has('mysql'), 'must have mysql snippets')
  assert(dialects.has('sqlite'), 'must have sqlite snippets')
  assert(dialects.has('all'), 'must have cross-db snippets')

  for (const s of DBA_MAINTENANCE_SNIPPETS) {
    assert(Boolean(s.title), `snippet ${s.id} missing title`)
    assert(Boolean(s.sql), `snippet ${s.id} missing sql`)
    assert(Boolean(s.category), `snippet ${s.id} missing category`)
    if (s.defaultParams) {
      const extracted = extractQueryVariables(s.sql)
      for (const paramName of Object.keys(s.defaultParams)) {
        assert(
          extracted.some(v => v.name === paramName),
          `snippet ${s.id} has default param '${paramName}' that is not in SQL template`
        )
      }
    }
  }
})

// 8. Escaped backtick and double quote identifiers
test('extractQueryVariables: ignores :param inside identifiers with escaped backticks and quotes', () => {
  const sql = 'SELECT `col``with:fake_param` AS res, "col""with:fake_param2" AS res2, :real_param FROM `my``table`'
  const vars = extractQueryVariables(sql)
  assert(vars.length === 1, `expected 1 variable, got ${vars.length}`)
  assert(vars[0].name === 'real_param', `expected real_param, got ${vars[0]?.name}`)
})

console.log(`\nResult: ${passed} passed, ${failed} failed.`)
if (failed > 0) {
  process.exit(1)
}
