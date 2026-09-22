import {
  parseJsonSafely,
  parseJsonPath,
  formatJsonPath,
  generateDialectSqlPath,
  getValueByPath,
  setValueByPath,
} from './jsonPathHelper.ts'

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

console.log('--- Running jsonPathHelper Unit Tests ---')

// 1. parseJsonSafely
test('parseJsonSafely: detects valid JSON object string', () => {
  const res = parseJsonSafely('{"name":"Alice","age":30}')
  assert(res.isJson === true, 'should be marked as json')
  assert(res.parsed.name === 'Alice', 'should parse name')
  assert(res.parsed.age === 30, 'should parse age')
})

test('parseJsonSafely: detects valid JSON array string', () => {
  const res = parseJsonSafely('[1, 2, "three"]')
  assert(res.isJson === true, 'should be marked as json')
  assert(Array.isArray(res.parsed), 'should be array')
  assert(res.parsed.length === 3, 'array length 3')
})

test('parseJsonSafely: detects raw objects and arrays', () => {
  const obj = { foo: 'bar' }
  const resObj = parseJsonSafely(obj)
  assert(resObj.isJson === true, 'raw object should be json')
  assert(resObj.parsed === obj, 'parsed is same object')

  const arr = ['a', 'b']
  const resArr = parseJsonSafely(arr)
  assert(resArr.isJson === true, 'raw array should be json')
  assert(resArr.parsed === arr, 'parsed is same array')
})

test('parseJsonSafely: rejects primitives and invalid JSON strings', () => {
  assert(parseJsonSafely(null).isJson === false, 'null is not json')
  assert(parseJsonSafely(undefined).isJson === false, 'undefined is not json')
  assert(parseJsonSafely(123).isJson === false, 'number is not json')
  assert(parseJsonSafely(true).isJson === false, 'boolean is not json')
  assert(parseJsonSafely('just a regular string').isJson === false, 'plain string is not json')
  
  const invalid = parseJsonSafely('{"unclosed":')
  assert(invalid.isJson === false, 'invalid json syntax returns false')
  assert(!!invalid.error, 'invalid json returns error message')
})

// 2. parseJsonPath & formatJsonPath
test('parseJsonPath: correctly parses root and nested segments', () => {
  assert(parseJsonPath('$').length === 0, '$ has 0 segments')
  assert(parseJsonPath('').length === 0, 'empty has 0 segments')

  const segs1 = parseJsonPath('$.user.profile.emails[0]')
  assert(segs1.length === 4, '4 segments')
  assert(segs1[0] === 'user', 'seg 0 is user')
  assert(segs1[1] === 'profile', 'seg 1 is profile')
  assert(segs1[2] === 'emails', 'seg 2 is emails')
  assert(segs1[3] === 0, 'seg 3 is number 0')

  const segs2 = parseJsonPath('$[0].name')
  assert(segs2.length === 2, '2 segments')
  assert(segs2[0] === 0, 'seg 0 is 0')
  assert(segs2[1] === 'name', 'seg 1 is name')
})

test('formatJsonPath: formats segments to standardized JSONPath', () => {
  assert(formatJsonPath([]) === '$', 'empty segments format to $')
  assert(formatJsonPath(['user', 'profile', 'emails', 0]) === '$.user.profile.emails[0]', 'formats nested path')
  assert(formatJsonPath([0, 'name']) === '$[0].name', 'formats array index at start')
})

// 3. generateDialectSqlPath across PostgreSQL, MySQL, SQLite
test('generateDialectSqlPath: PostgreSQL path generation with quoting', () => {
  // Nested keys + array index
  const pg1 = generateDialectSqlPath('postgres', 'payload', '$.user.profile.emails[0]')
  assert(pg1 === "\"payload\"->'user'->'profile'->'emails'->>0", `PostgreSQL nested path: ${pg1}`)

  // Single key
  const pg2 = generateDialectSqlPath('postgres', 'payload', '$.user')
  assert(pg2 === "\"payload\"->>'user'", `PostgreSQL single key: ${pg2}`)

  // Root
  const pgRoot = generateDialectSqlPath('postgres', 'payload', '$')
  assert(pgRoot === '"payload"', `PostgreSQL root: ${pgRoot}`)

  // Quoting with double quotes in column name
  const pgEscapeCol = generateDialectSqlPath('postgres', 'pay"load', '$.key')
  assert(pgEscapeCol === '"pay""load"->>\'key\'', `PostgreSQL escaped column name: ${pgEscapeCol}`)
})

test('generateDialectSqlPath: MySQL path generation with quoting and escaping', () => {
  const my1 = generateDialectSqlPath('mysql', 'payload', '$.user.profile.emails[0]')
  assert(my1 === "`payload`->>'$.user.profile.emails[0]'", `MySQL nested path: ${my1}`)

  const myRoot = generateDialectSqlPath('mysql', 'payload', '$')
  assert(myRoot === "`payload`->>'S'".replace('S', '$'), `MySQL root: ${myRoot}`)

  // Escapes backslashes and single quotes in path
  const myEsc = generateDialectSqlPath('mysql', 'pay`load', "$.foo['bar\\'baz']")
  assert(myEsc.includes('`pay``load`'), `MySQL escaped backtick column: ${myEsc}`)
  assert(myEsc.includes("''"), `MySQL escaped single quote in path: ${myEsc}`)
})

test('generateDialectSqlPath: SQLite path generation with quoting and escaping', () => {
  const sq1 = generateDialectSqlPath('sqlite', 'payload', '$.user.profile.emails[0]')
  assert(sq1 === "json_extract(\"payload\", '$.user.profile.emails[0]')", `SQLite nested path: ${sq1}`)

  const sqRoot = generateDialectSqlPath('sqlite', 'payload', '$')
  assert(sqRoot === "json_extract(\"payload\", '$')", `SQLite root: ${sqRoot}`)

  // Escapes backslashes and single quotes in path
  const sqEsc = generateDialectSqlPath('sqlite', 'payload', "$.foo['bar\\'baz']")
  assert(sqEsc.includes("''"), `SQLite escaped single quote in path: ${sqEsc}`)
})

// 4. getValueByPath & setValueByPath
test('getValueByPath and setValueByPath: get and update nested document', () => {
  const doc = {
    user: {
      profile: {
        emails: ['first@example.com', 'second@example.com'],
      },
    },
  }

  assert(getValueByPath(doc, '$.user.profile.emails[0]') === 'first@example.com', 'retrieves initial value')

  const updated = setValueByPath(doc, '$.user.profile.emails[0]', 'updated@example.com')
  assert(getValueByPath(updated, '$.user.profile.emails[0]') === 'updated@example.com', 'retrieves updated value')
  assert(getValueByPath(doc, '$.user.profile.emails[0]') === 'first@example.com', 'original doc immutable')
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
