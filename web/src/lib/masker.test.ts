import { detectPIIType, isLuhnValid, maskValue, maskRecord } from './masker.ts'

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

console.log('--- Running Masker & PII Detection Unit Tests ---')

test('isLuhnValid accepts valid card numbers', () => {
  assert(isLuhnValid('4532015112830366'), 'Visa 16 digits')
  assert(isLuhnValid('4532 0151 1283 0366'), 'Visa with spaces')
  assert(isLuhnValid('378282246310005'), 'Amex 15 digits')
})

test('isLuhnValid rejects invalid card numbers', () => {
  assert(!isLuhnValid('4532015112830367'), 'Checksum invalid')
  assert(!isLuhnValid('1234'), 'Too short')
  assert(!isLuhnValid(''), 'Empty')
})

test('detectPIIType detects PII by column and value', () => {
  assert(detectPIIType('email') === 'email', 'email col')
  assert(detectPIIType('notes', 'alice@domain.com') === 'email', 'email val')
  assert(detectPIIType('phone') === 'phone', 'phone col')
  assert(detectPIIType('contact', '+1 (555) 234-5678') === 'phone', 'phone val')
  assert(detectPIIType('credit_card') === 'card', 'card col')
  assert(detectPIIType('raw', '4532015112830366') === 'card', 'card val')
  assert(detectPIIType('ssn') === 'ssn', 'ssn col')
  assert(detectPIIType('id_num', '123-45-6789') === 'ssn', 'ssn val')
  assert(detectPIIType('ip_address') === 'ip', 'ip col')
  assert(detectPIIType('host', '192.168.1.1') === 'ip', 'ip val')
  assert(detectPIIType('first_name') === 'name', 'name col')
  assert(detectPIIType('table_name') === '', 'technical table_name not pii')
  assert(detectPIIType('id', '123') === '', 'id not pii')
})

test('maskValue: redact strategy', () => {
  const res = maskValue('email', 'alice@domain.com', 'redact')
  assert(res === '[REDACTED]', `expected [REDACTED], got ${res}`)
})

test('maskValue: partial strategy', () => {
  const email = maskValue('email', 'john.doe@example.com', 'partial')
  assert(email.startsWith('j***@') && email.endsWith('@example.com'), `partial email: ${email}`)

  const card = maskValue('card', '4532015112830366', 'partial')
  assert(card.includes('••••') && card.endsWith('0366'), `partial card: ${card}`)

  const ssn = maskValue('ssn', '123-45-6789', 'partial')
  assert(ssn === '•••-••-6789', `partial ssn: ${ssn}`)

  const pass = maskValue('password', 'secret', 'partial')
  assert(pass === '••••••••', `partial pass: ${pass}`)
})

test('maskValue: hash strategy', () => {
  const h1 = maskValue('email', 'alice@domain.com', 'hash')
  assert(typeof h1 === 'string' && h1.startsWith('hash_'), `hash email: ${h1}`)
  const h2 = maskValue('email', 'alice@domain.com', 'hash')
  assert(h1 === h2, 'deterministic hash')
})

test('maskValue: faker strategy', () => {
  const f1 = maskValue('email', 'alice@domain.com', 'faker')
  assert(typeof f1 === 'string' && f1.includes('@'), `faker email: ${f1}`)
  const f2 = maskValue('email', 'alice@domain.com', 'faker')
  assert(f1 === f2, 'deterministic faker stability')

  const card = maskValue('card', '4532015112830366', 'faker')
  assert(isLuhnValid(card), `faker card passes Luhn check: ${card}`)
})

test('maskRecord masks only PII columns', () => {
  const cols = ['id', 'email', 'name', 'created_at']
  const record = ['42', 'test@example.com', 'Bob Smith', '2026-01-01']
  const masked = maskRecord(cols, record, 'redact')
  assert(masked[0] === '42', 'id untouched')
  assert(masked[1] === '[REDACTED]', 'email redacted')
  assert(masked[2] === '[REDACTED]', 'name redacted')
  assert(masked[3] === '2026-01-01', 'created_at untouched')
})

console.log(`\nMasker Tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
