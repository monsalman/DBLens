import {
  targetKey,
  annotationLabel,
  matchesKeyword,
  filterByTarget,
  groupByTable,
  sortPinnedFirst,
} from './annotationHelper.ts'
import type { Annotation } from '../../lib/api.ts'

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

const make = (over: Partial<Annotation>): Annotation => ({
  id: 'an_1',
  target_type: 'table',
  connection_id: 'c1',
  note: 'note',
  pinned: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

console.log('--- Running Annotation Helper Unit Tests ---')

test('targetKey distinguishes schema/table/column', () => {
  assert(targetKey('public', 'orders') === targetKey('public', 'orders'), 'identical targets match')
  assert(targetKey('public', 'orders') !== targetKey('public', 'orders', 'total'), 'table vs column differ')
  assert(targetKey('public', 'orders') !== targetKey('other', 'orders'), 'schema matters')
  assert(targetKey(undefined, 'orders') !== targetKey('public', 'orders'), 'empty schema is distinct')
})

test('annotationLabel renders dotted targets', () => {
  assert(annotationLabel(make({ schema: 'public', table: 'orders' })) === 'public.orders', 'table label')
  assert(
    annotationLabel(make({ schema: 'public', table: 'orders', column: 'total' })) === 'public.orders.total',
    'column label',
  )
  assert(annotationLabel(make({})) === '(connection level)', 'connection fallback')
  assert(annotationLabel(make({ table: 'orders' })) === 'orders', 'no schema')
})

test('matchesKeyword searches note, author and target', () => {
  const a = make({ table: 'orders', column: 'total', note: 'Stored in MINOR units', author: 'ada' })
  assert(matchesKeyword(a, 'minor'), 'note (case-insensitive)')
  assert(matchesKeyword(a, 'ADA'), 'author')
  assert(matchesKeyword(a, 'total'), 'column')
  assert(matchesKeyword(a, 'orders'), 'table')
  assert(matchesKeyword(a, 'c1'), 'connection')
  assert(matchesKeyword(a, '   '), 'blank keyword matches everything')
  assert(!matchesKeyword(a, 'zzz'), 'no match')
})

test('filterByTarget narrows to the exact target', () => {
  const list = [
    make({ id: 'a', schema: 'public', table: 'orders' }),
    make({ id: 'b', schema: 'public', table: 'orders', column: 'total' }),
    make({ id: 'c', schema: 'public', table: 'users' }),
  ]
  const tableOnly = filterByTarget(list, 'public', 'orders')
  assert(tableOnly.length === 1 && tableOnly[0].id === 'a', 'table target only')
  const colOnly = filterByTarget(list, 'public', 'orders', 'total')
  assert(colOnly.length === 1 && colOnly[0].id === 'b', 'column target only')
  assert(filterByTarget(list, 'public', 'nope').length === 0, 'unknown table empty')
  assert(filterByTarget(list, 'other', 'orders').length === 0, 'schema must match exactly')
})

test('groupByTable groups and sorts pinned first', () => {
  const list = [
    make({ id: 'a', schema: 'public', table: 'orders', updated_at: '2026-02-01T00:00:00Z' }),
    make({ id: 'b', schema: 'public', table: 'orders', pinned: true, updated_at: '2026-01-01T00:00:00Z' }),
    make({ id: 'c', schema: 'public', table: 'users' }),
  ]
  const groups = groupByTable(list)
  assert(groups.length === 2, 'two groups')
  assert(groups[0].label === 'public.orders', 'alphabetical group order')
  assert(groups[0].items[0].id === 'b', 'pinned first inside group')
  assert(groups[1].label === 'public.users', 'second group label')
})

test('sortPinnedFirst orders pinned then newest', () => {
  const list = [
    make({ id: 'old', updated_at: '2026-01-01T00:00:00Z' }),
    make({ id: 'new', updated_at: '2026-03-01T00:00:00Z' }),
    make({ id: 'pin', pinned: true, updated_at: '2025-01-01T00:00:00Z' }),
  ]
  const sorted = sortPinnedFirst(list)
  assert(sorted[0].id === 'pin', 'pinned first')
  assert(sorted[1].id === 'new', 'newest unpinned second')
  assert(sorted[2].id === 'old', 'oldest last')
})

console.log(`\nAnnotation Helper Tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
