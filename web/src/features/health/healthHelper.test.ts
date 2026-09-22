import {
  sparklinePoints,
  latencySeries,
  uptimePct,
  statusStroke,
  statusLabel,
  maskDsn,
  findHealth,
} from './healthHelper.ts'
import type { ConnectionHealth } from '../../lib/api.ts'

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

// ── sparklinePoints ────────────────────────────────────────────────────────

test('sparklinePoints: empty series renders no points', () => {
  assert(sparklinePoints([], 100, 20) === '', 'expected empty string')
})

test('sparklinePoints: min/max map to the padded edges', () => {
  const pts = sparklinePoints([0, 10], 100, 20).split(' ')
  assert(pts.length === 2, `expected 2 points, got ${pts.length}`)
  assert(pts[0] === '0,18', `expected min on the bottom pad, got ${pts[0]}`)
  assert(pts[1] === '100,2', `expected max on the top pad, got ${pts[1]}`)
})

test('sparklinePoints: a flat series stays centred', () => {
  const ys = sparklinePoints([5, 5, 5], 100, 20).split(' ').map(p => p.split(',')[1])
  assert(ys.join('|') === '10|10|10', `expected a centred flat line, got ${ys.join('|')}`)
})

test('sparklinePoints: a single sample is centred with no x step', () => {
  assert(sparklinePoints([7], 100, 20) === '0,10', 'expected the midpoint')
})

test('sparklinePoints: the middle sample lands mid-box', () => {
  const pts = sparklinePoints([0, 5, 10], 100, 24).split(' ')
  assert(pts[1] === '50,12', `expected 50,12, got ${pts[1]}`)
})

// ── latencySeries / uptimePct ──────────────────────────────────────────────

const conn = {
  total_checks: 8,
  success_count: 6,
  samples: [{ at: '', ms: 12, ok: true }, { at: '', ms: 0, ok: false }, { at: '', ms: 30, ok: true }],
} as unknown as ConnectionHealth

test('latencySeries: failures plot at 0 and successes keep their ms', () => {
  assert(JSON.stringify(latencySeries(conn)) === '[12,0,30]', `got ${JSON.stringify(latencySeries(conn))}`)
})

test('uptimePct: success/total as a percentage', () => {
  assert(uptimePct(conn) === 75, `expected 75, got ${uptimePct(conn)}`)
})

test('uptimePct: guards against zero checks', () => {
  const empty = { total_checks: 0, success_count: 0, samples: [] } as unknown as ConnectionHealth
  assert(uptimePct(empty) === 0, 'expected 0 with no checks')
})

test('uptimePct: all-success reports 100', () => {
  const all = { total_checks: 3, success_count: 3, samples: [] } as unknown as ConnectionHealth
  assert(uptimePct(all) === 100, 'expected 100')
})

// ── status helpers ─────────────────────────────────────────────────────────

test('statusStroke: one colour per status with a grey fallback', () => {
  assert(statusStroke('green') === '#10b981', 'green stroke')
  assert(statusStroke('yellow') === '#f59e0b', 'yellow stroke')
  assert(statusStroke('red') === '#ef4444', 'red stroke')
  assert(statusStroke('unknown') === '#71717a', 'unknown stroke')
  assert(statusStroke('weird' as any) === '#71717a', 'unrecognised status falls back to grey')
})

test('statusLabel: human labels per status', () => {
  assert(statusLabel('green') === 'Healthy', 'green label')
  assert(statusLabel('yellow') === 'Degraded', 'yellow label')
  assert(statusLabel('red') === 'Down', 'red label')
  assert(statusLabel('unknown') === 'Unknown', 'unknown label')
})

// ── maskDsn (must mirror the Go driver.MaskDSN) ────────────────────────────

test('maskDsn: hides the password and keeps query params', () => {
  assert(
    maskDsn('postgres://user:secret@host:5432/db') === 'postgres://user:***@host:5432/db',
    'basic password mask',
  )
  assert(
    maskDsn('postgres://user:secret@host:5432/db?sslmode=require') ===
      'postgres://user:***@host:5432/db?sslmode=require',
    'query string preserved',
  )
  assert(maskDsn('user:secret@tcp(localhost:3306)/db') === 'user:***@tcp(localhost:3306)/db', 'no scheme')
})

test('maskDsn: leaves credential-free DSNs alone', () => {
  assert(maskDsn('/tmp/local.db') === '/tmp/local.db', 'sqlite path untouched')
  assert(maskDsn('host-without-userinfo') === 'host-without-userinfo', 'no @ untouched')
  assert(maskDsn('postgres://host:5432/db') === 'postgres://host:5432/db', 'no userinfo colon untouched')
})

// ── findHealth ─────────────────────────────────────────────────────────────

const healthConns = [
  { connection_id: 'global_1', label: 'Shared DB 1', status: 'green' },
  { connection_id: 'conn_abc', label: 'postgres://user:***@host:5432/db', status: 'yellow' },
]

test('findHealth: server-seeded global_* ids match directly', () => {
  assert(findHealth({ id: 'global_1' }, healthConns)?.status === 'green', 'global match')
})

test('findHealth: browser-local profiles match on the masked DSN label', () => {
  const local = { id: 'local_123', dsn: 'postgres://user:secret@host:5432/db' }
  assert(findHealth(local, healthConns)?.status === 'yellow', 'masked-DSN fallback match')
})

test('findHealth: unmatched profiles report no health', () => {
  const other = { id: 'local_999', dsn: 'postgres://u:p@other:5432/x' }
  assert(findHealth(other, healthConns) === undefined, 'expected undefined')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
