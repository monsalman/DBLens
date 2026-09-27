import {
  createInitialCanvasState,
  addTableToCanvas,
  removeTableFromCanvas,
  toggleColumnSelection,
  selectAllColumns,
  setColumnAggregate,
  setColumnAlias,
  setTableAlias,
  addJoin,
  updateJoinType,
  removeJoin,
  addFilter,
  updateFilter,
  removeFilter,
  addHaving,
  updateHaving,
  removeHaving,
  addOrderBy,
  updateOrderBy,
  removeOrderBy,
  generateClientSQL,
  validateCanvas,
} from './queryBuilderHelper.ts'

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

console.log('--- Running Query Builder Helper Unit Tests ---')

test('createInitialCanvasState: returns empty initial structure', () => {
  const state = createInitialCanvasState()
  assert(Array.isArray(state.tables) && state.tables.length === 0, 'tables must be empty array')
  assert(Array.isArray(state.joins) && state.joins.length === 0, 'joins must be empty array')
  assert(state.distinct === false, 'distinct defaults to false')
  assert(state.limit === 100, 'default limit is 100')
})

test('addTableToCanvas and removeTableFromCanvas: handles tables and cleanups', () => {
  let state = createInitialCanvasState()
  state = addTableToCanvas(state, {
    name: 'users',
    schema: 'public',
    columns: [
      { name: 'id', type: 'integer' },
      { name: 'name', type: 'varchar' },
    ],
  })

  assert(state.tables.length === 1, 'should have 1 table')
  const userTable = state.tables[0]
  assert(userTable.name === 'users', 'table name match')
  assert(userTable.columns.length === 2, 'columns converted')
  assert(userTable.columns[0].selected === false, 'selected default false')

  // Add orders table
  state = addTableToCanvas(state, {
    name: 'orders',
    schema: 'public',
    columns: [
      { name: 'id', type: 'integer' },
      { name: 'user_id', type: 'integer' },
    ],
  })
  assert(state.tables.length === 2, 'should have 2 tables')
  const orderTable = state.tables[1]

  // Add join and filter
  state = addJoin(state, userTable.id, 'id', orderTable.id, 'user_id', 'INNER')
  state = addFilter(state, { tableId: userTable.id, column: 'name', operator: '=', value: 'Alice' })
  assert(state.joins.length === 1, 'join added')
  assert((state.filters || []).length === 1, 'filter added')

  // Remove users table -> should clean up join and filter
  state = removeTableFromCanvas(state, userTable.id)
  assert(state.tables.length === 1, '1 table left')
  assert(state.joins.length === 0, 'join cleaned up')
  assert((state.filters || []).length === 0, 'filter cleaned up')
})

test('column selections and aggregates: toggle and aliases', () => {
  let state = createInitialCanvasState()
  state = addTableToCanvas(state, {
    name: 'products',
    columns: [
      { name: 'id', type: 'integer' },
      { name: 'price', type: 'numeric' },
      { name: 'title', type: 'text' },
    ],
  })
  const tId = state.tables[0].id

  // Toggle selection
  state = toggleColumnSelection(state, tId, 'price')
  assert(state.tables[0].columns.find((c) => c.name === 'price')?.selected === true, 'price selected')

  // Select all
  state = selectAllColumns(state, tId, true)
  assert(state.tables[0].columns.every((c) => c.selected), 'all columns selected')

  // Aggregate sets selected and aggregate
  state = setColumnAggregate(state, tId, 'price', 'AVG')
  assert(state.tables[0].columns.find((c) => c.name === 'price')?.aggregate === 'AVG', 'price aggregate is AVG')

  // Alias
  state = setColumnAlias(state, tId, 'price', 'average_price')
  assert(state.tables[0].columns.find((c) => c.name === 'price')?.alias === 'average_price', 'alias set')

  // Table alias
  state = setTableAlias(state, tId, 'prod')
  assert(state.tables[0].alias === 'prod', 'table alias set')
})

test('joins, havings, orderBy: add and update', () => {
  let state = createInitialCanvasState()
  state = addTableToCanvas(state, { name: 't1', columns: [{ name: 'id', type: 'int' }] })
  state = addTableToCanvas(state, { name: 't2', columns: [{ name: 't1_id', type: 'int' }] })
  const t1Id = state.tables[0].id
  const t2Id = state.tables[1].id

  // Add join
  state = addJoin(state, t1Id, 'id', t2Id, 't1_id', 'LEFT')
  const joinId = state.joins[0].id
  assert(state.joins[0].joinType === 'LEFT', 'join type is LEFT')

  // Update join type
  state = updateJoinType(state, joinId, 'FULL')
  assert(state.joins[0].joinType === 'FULL', 'join type updated to FULL')

  // Remove join
  state = removeJoin(state, joinId)
  assert(state.joins.length === 0, 'join removed')

  // Add filter and update and remove
  state = addFilter(state, { tableId: t1Id, column: 'id', operator: '=', value: '10' })
  assert((state.filters || []).length === 1, 'filter added')
  const fId = state.filters![0].id
  state = updateFilter(state, fId, { value: '20' })
  assert(state.filters![0].value === '20', 'filter value updated')
  state = removeFilter(state, fId)
  assert((state.filters || []).length === 0, 'filter removed')

  // Re-add join for duplicate check
  state = addJoin(state, t1Id, 'id', t2Id, 't1_id', 'LEFT')
  assert(state.joins.length === 1, 'join re-added')

  // Add duplicate join should be prevented
  state = addJoin(state, t1Id, 'id', t2Id, 't1_id', 'INNER')
  assert(state.joins.length === 1, 'duplicate join prevented')

  // Having
  state = addHaving(state, { tableId: t1Id, column: 'id', aggregate: 'COUNT', operator: '>', value: '10' })
  assert((state.havings || []).length === 1, 'having added')
  const hId = state.havings![0].id
  state = updateHaving(state, hId, { value: '25' })
  assert(state.havings![0].value === '25', 'having updated')
  state = removeHaving(state, hId)
  assert((state.havings || []).length === 0, 'having removed')

  // Order By
  state = addOrderBy(state, { tableId: t1Id, column: 'id', direction: 'DESC', nulls: 'LAST' })
  assert((state.orderBy || []).length === 1, 'order by added')
  const oId = state.orderBy![0].id
  state = updateOrderBy(state, oId, { direction: 'ASC' })
  assert(state.orderBy![0].direction === 'ASC', 'order by updated')
  state = removeOrderBy(state, oId)
  assert((state.orderBy || []).length === 0, 'order by removed')
})

test('generateClientSQL: produces correct SQL for postgres, mysql, sqlite', () => {
  let state = createInitialCanvasState()
  state = addTableToCanvas(state, {
    name: 'users',
    schema: 'public',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'email', type: 'varchar' },
    ],
  })
  const tId = state.tables[0].id
  state = toggleColumnSelection(state, tId, 'id', true)
  state = toggleColumnSelection(state, tId, 'email', true)
  state = setColumnAlias(state, tId, 'email', 'user_email')
  state = addFilter(state, { tableId: tId, column: 'id', operator: '>', value: '5' })

  // Postgres SQL
  const pgSql = generateClientSQL(state, 'postgres')
  assert(pgSql.includes('SELECT'), 'contains SELECT')
  assert(pgSql.includes('"users"."id"'), 'pg double quotes column')
  assert(pgSql.includes('"user_email"'), 'pg double quotes alias')
  assert(pgSql.includes('FROM "public"."users"'), 'pg qualified table')
  assert(pgSql.includes('WHERE "users"."id" > 5'), 'where clause format')
  assert(pgSql.includes('LIMIT 100'), 'default limit')

  // MySQL SQL
  const mySql = generateClientSQL(state, 'mysql')
  assert(mySql.includes('`users`.`id`'), 'mysql backticks')
  assert(mySql.includes('FROM `public`.`users`'), 'mysql qualified table')

  // Aggregates & auto-GROUP BY
  state = setColumnAggregate(state, tId, 'email', 'COUNT')
  const aggSql = generateClientSQL(state, 'postgres')
  assert(aggSql.includes('COUNT("users"."email")'), 'aggregate expression included')
  assert(aggSql.includes('GROUP BY "users"."id"'), 'auto group by non-agg column')
})

test('validateCanvas: detects errors and warnings', () => {
  // Empty
  const vEmpty = validateCanvas(createInitialCanvasState())
  assert(!vEmpty.valid, 'empty canvas is invalid')
  assert(vEmpty.errors.length > 0, 'has error for empty')

  // Table without selected cols has warning
  let state = createInitialCanvasState()
  state = addTableToCanvas(state, { name: 'users', columns: [{ name: 'id', type: 'int' }] })
  const vNoCols = validateCanvas(state)
  assert(vNoCols.valid, 'table with no cols selected is still technically valid')
  assert(vNoCols.warnings.some((w) => w.includes('SELECT *')), 'warns about defaulting to SELECT *')

  // Multi tables without joins
  state = addTableToCanvas(state, { name: 'roles', columns: [{ name: 'id', type: 'int' }] })
  const vMulti = validateCanvas(state)
  assert(vMulti.warnings.some((w) => w.includes('CROSS JOIN')), 'warns about Cartesian product')
})

console.log(`\nQuery Builder Helper Tests Summary: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
