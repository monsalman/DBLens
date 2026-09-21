import {
  filterRoutines,
  filterTriggers,
  filterViews,
  formatRoutineSignature,
  parseParamValues,
  groupTriggersByTable,
  generateRoutineTemplate,
  generateViewTemplate,
  getTimingBadgeClass,
  getEventBadgeClass,
  type RoutineItem,
  type TriggerItem,
  type ViewItem,
} from './routineHelper.ts'

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

console.log('--- Running Routine Helper Unit Tests ---')

// 1. filterRoutines
test('filterRoutines: filters by keyword and routineType', () => {
  const routines: RoutineItem[] = [
    {
      schema: 'public',
      name: 'calculate_tax',
      routineType: 'FUNCTION',
      language: 'plpgsql',
      returnType: 'numeric',
      arguments: [],
    },
    {
      schema: 'public',
      name: 'process_orders',
      routineType: 'PROCEDURE',
      language: 'plpgsql',
      arguments: [],
    },
    {
      schema: 'analytics',
      name: 'calculate_churn',
      routineType: 'FUNCTION',
      language: 'sql',
      returnType: 'float',
      arguments: [],
    },
  ]

  assert(filterRoutines(routines, 'tax').length === 1, 'Search tax matches 1')
  assert(filterRoutines(routines, 'calculate').length === 2, 'Search calculate matches 2')
  assert(filterRoutines(routines, '', 'PROCEDURE').length === 1, 'Filter by PROCEDURE returns 1')
  assert(filterRoutines(routines, '', 'FUNCTION').length === 2, 'Filter by FUNCTION returns 2')
  assert(filterRoutines(routines, 'tax', 'PROCEDURE').length === 0, 'No procedure matches tax')
})

// 2. filterTriggers
test('filterTriggers: filters by search and table', () => {
  const triggers: TriggerItem[] = [
    {
      schema: 'public',
      name: 'trg_users_audit',
      tableSchema: 'public',
      tableName: 'users',
      timing: 'AFTER',
      event: 'UPDATE',
      statement: 'INSERT INTO audit ...',
      enabled: true,
      orientation: 'ROW',
    },
    {
      schema: 'public',
      name: 'trg_orders_check',
      tableSchema: 'public',
      tableName: 'orders',
      timing: 'BEFORE',
      event: 'INSERT',
      statement: 'IF NEW.total < 0 ...',
      enabled: true,
      orientation: 'ROW',
    },
  ]

  assert(filterTriggers(triggers, 'audit').length === 1, 'Search audit returns 1')
  assert(filterTriggers(triggers, '', 'users').length === 1, 'Filter by table users returns 1')
  assert(filterTriggers(triggers, '', 'orders').length === 1, 'Filter by table orders returns 1')
  assert(filterTriggers(triggers, '', 'products').length === 0, 'Filter by products returns 0')
})

// 3. filterViews
test('filterViews: filters by keyword and materialized flag', () => {
  const views: ViewItem[] = [
    {
      schema: 'public',
      name: 'v_active_users',
      definition: 'SELECT * FROM users WHERE active = true',
      isMaterialized: false,
    },
    {
      schema: 'public',
      name: 'mv_monthly_sales',
      definition: 'SELECT month, sum(total) FROM orders GROUP BY 1',
      isMaterialized: true,
    },
  ]

  assert(filterViews(views, 'active').length === 1, 'Search active returns 1 view')
  assert(filterViews(views, '', true).length === 1, 'Filter materialized only returns 1')
  assert(filterViews(views, '', false).length === 2, 'Filter all returns 2')
})

// 4. formatRoutineSignature
test('formatRoutineSignature: constructs formatted signature', () => {
  const func: RoutineItem = {
    schema: 'public',
    name: 'calc_discount',
    routineType: 'FUNCTION',
    returnType: 'numeric',
    arguments: [
      { name: 'price', type: 'numeric', mode: 'IN', ordinalPosition: 1 },
      { name: 'pct', type: 'integer', mode: 'IN', ordinalPosition: 2, defaultValue: '10' },
      { name: 'res', type: 'text', mode: 'OUT', ordinalPosition: 3 },
    ],
  }

  const sig = formatRoutineSignature(func)
  assert(
    sig === 'public.calc_discount(price numeric, pct integer DEFAULT 10, OUT res text) -> numeric',
    `Expected signature, got: ${sig}`
  )
})

// 5. parseParamValues
test('parseParamValues: converts raw string inputs to appropriate types', () => {
  const args = [
    { name: 'id', type: 'integer', mode: 'IN', ordinalPosition: 1 },
    { name: 'is_active', type: 'boolean', mode: 'IN', ordinalPosition: 2 },
    { name: 'metadata', type: 'jsonb', mode: 'IN', ordinalPosition: 3 },
    { name: 'empty_val', type: 'text', mode: 'IN', ordinalPosition: 4 },
  ]

  const rawInputs = {
    id: '42',
    is_active: 'true',
    metadata: '{"role":"admin"}',
    empty_val: '',
  }

  const parsed = parseParamValues(rawInputs, args)
  assert(parsed[0] === 42, 'id should be parsed as number 42')
  assert(parsed[1] === true, 'is_active should be parsed as boolean true')
  assert(typeof parsed[2] === 'object' && parsed[2].role === 'admin', 'metadata should be parsed JSON')
  assert(parsed[3] === null, 'empty input should be parsed as null')
})

// 6. groupTriggersByTable
test('groupTriggersByTable: aggregates triggers under table names', () => {
  const triggers: TriggerItem[] = [
    {
      schema: 'public',
      name: 't1',
      tableSchema: 'public',
      tableName: 'users',
      timing: 'AFTER',
      event: 'INSERT',
      statement: '',
      enabled: true,
      orientation: 'ROW',
    },
    {
      schema: 'public',
      name: 't2',
      tableSchema: 'public',
      tableName: 'users',
      timing: 'AFTER',
      event: 'UPDATE',
      statement: '',
      enabled: true,
      orientation: 'ROW',
    },
    {
      schema: 'public',
      name: 't3',
      tableSchema: 'public',
      tableName: 'orders',
      timing: 'BEFORE',
      event: 'INSERT',
      statement: '',
      enabled: true,
      orientation: 'ROW',
    },
  ]

  const grouped = groupTriggersByTable(triggers)
  assert(grouped['users'].length === 2, 'Users has 2 triggers')
  assert(grouped['orders'].length === 1, 'Orders has 1 trigger')
})

// 7. generateRoutineTemplate & generateViewTemplate
test('generate templates: creates valid SQL scaffolds', () => {
  const pgProc = generateRoutineTemplate('postgres', 'PROCEDURE', 'my_proc', 'public')
  assert(pgProc.includes('CREATE OR REPLACE PROCEDURE "public"."my_proc"'), 'Postgres procedure DDL scaffold')

  const myFunc = generateRoutineTemplate('mysql', 'FUNCTION', 'my_func', 'mydb')
  assert(myFunc.includes('CREATE FUNCTION `mydb`.`my_func`'), 'MySQL function DDL scaffold')

  const matView = generateViewTemplate('postgres', 'sales_mv', 'public', true)
  assert(matView.includes('CREATE MATERIALIZED VIEW "public"."sales_mv"'), 'Materialized view DDL scaffold')
})

// 8. Badges helper
test('getTimingBadgeClass & getEventBadgeClass: returns styling strings', () => {
  assert(getTimingBadgeClass('BEFORE').includes('amber'), 'BEFORE has amber class')
  assert(getTimingBadgeClass('AFTER').includes('blue'), 'AFTER has blue class')
  assert(getEventBadgeClass('INSERT').includes('emerald'), 'INSERT has emerald class')
  assert(getEventBadgeClass('DELETE').includes('red'), 'DELETE has red class')
})

console.log(`\nRoutine Helper Tests: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
