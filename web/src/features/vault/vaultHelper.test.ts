declare const process: any

import {
  parseVaultContainer,
  validatePassphrase,
  formatVaultEnvironment,
  getPolicySummary,
  convertConnectionToVaultItem,
  convertVaultItemToConnection,
  scrubDSN,
} from './vaultHelper.ts'

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

console.log('--- Running Vault Helper Unit Tests ---')

test('parseVaultContainer: parses valid container JSON structure', () => {
  const validJson = JSON.stringify({
    version: 1,
    kdf: 'argon2id',
    params: {
      salt: '0123456789abcdef',
      memory_kb: 65536,
      iterations: 3,
      parallelism: 2,
      key_len: 64,
    },
    nonce: 'a1b2c3d4e5f6',
    ciphertext: 'cafe1234babe5678',
    hmac: 'deadbeef99887766',
  })

  const res = parseVaultContainer(validJson)
  assert(res.valid === true, 'should be valid container')
  assert(res.container?.kdf === 'argon2id', 'kdf should be argon2id')
  assert(res.container?.ciphertext === 'cafe1234babe5678', 'ciphertext preserved')
})

test('parseVaultContainer: rejects missing fields or unsupported KDF', () => {
  const emptyRes = parseVaultContainer('')
  assert(emptyRes.valid === false, 'empty string rejected')

  const badKDF = JSON.stringify({
    version: 1,
    kdf: 'bcrypt',
    params: { salt: 'abc', memory_kb: 1024 },
    nonce: 'n',
    ciphertext: 'c',
    hmac: 'h',
  })
  const badKdfRes = parseVaultContainer(badKDF)
  assert(badKdfRes.valid === false, 'unsupported KDF rejected')
  assert((badKdfRes.error || '').includes('argon2id'), 'mentions argon2id requirement')

  const missingHMAC = JSON.stringify({
    version: 1,
    kdf: 'argon2id',
    params: { salt: 'abc', memory_kb: 1024 },
    nonce: 'n',
    ciphertext: 'c',
  })
  const missingHmacRes = parseVaultContainer(missingHMAC)
  assert(missingHmacRes.valid === false, 'missing hmac rejected')
})

test('validatePassphrase: enforces length rules', () => {
  const empty = validatePassphrase('')
  assert(empty.valid === false, 'empty rejected')

  const tooShort = validatePassphrase('short')
  assert(tooShort.valid === false, 'short rejected')

  const good = validatePassphrase('SecureVaultPassword2026!')
  assert(good.valid === true, 'strong passphrase accepted')
})

test('formatVaultEnvironment: returns correct labels and styling classes', () => {
  const prod = formatVaultEnvironment('production')
  assert(prod.label === 'Production', 'prod label')
  assert(prod.colorClass.includes('red'), 'prod red class')

  const stage = formatVaultEnvironment('staging')
  assert(stage.label === 'Staging', 'stage label')
  assert(stage.colorClass.includes('amber'), 'stage amber class')

  const dev = formatVaultEnvironment('development')
  assert(dev.label === 'Development', 'dev label')
  assert(dev.colorClass.includes('sky'), 'dev sky class')
})

test('getPolicySummary: computes active guardrail badges', () => {
  const summaries = getPolicySummary(
    { enforce_read_only: true, require_audit_log: true },
    { global_read_only_prod: true, require_audit_all_prod: true },
    'production'
  )
  assert(summaries.includes('Safe Mode Enforced'), 'has safe mode')
  assert(summaries.includes('Audit Trail Required'), 'has audit trail')

  const prodGuardrail = getPolicySummary(
    { enforce_read_only: false, require_audit_log: false },
    { global_read_only_prod: true, require_audit_all_prod: true },
    'production'
  )
  assert(prodGuardrail.includes('Prod Safe Mode Guardrail'), 'prod safe mode guardrail applied')
  assert(prodGuardrail.includes('Mandatory Prod Audit'), 'prod audit guardrail applied')
})

test('convertConnectionToVaultItem & convertVaultItemToConnection roundtrip', () => {
  const conn = {
    id: 'conn_test_1',
    label: 'Primary Postgres',
    dsn: 'postgres://user:pass@localhost:5432/db',
    readOnly: false,
    environment: 'staging' as const,
    dialect: 'postgres',
    driver: 'postgres' as const,
  }

  const vaultItem = convertConnectionToVaultItem(conn)
  assert(vaultItem.id === 'conn_test_1', 'id preserved')
  assert(vaultItem.name === 'Primary Postgres', 'name mapped from label')
  assert(vaultItem.environment === 'staging', 'environment preserved')

  const backToConn = convertVaultItemToConnection(vaultItem)
  assert(backToConn.id === 'conn_test_1', 'id back')
  assert(backToConn.label === 'Primary Postgres', 'label back')
  assert(backToConn.dsn === conn.dsn, 'dsn preserved')
})

test('scrubDSN: scrubs URI with @ in password, bare MySQL DSN, and ODBC Pwd=', () => {
  const uriWithAt = scrubDSN('postgres://user:p@ss:word!#@localhost:5432/db')
  assert(uriWithAt.scrubbed === true, 'URI with @ should be scrubbed')
  assert(uriWithAt.dsn === 'postgres://user:$DATABASE_PASSWORD@localhost:5432/db', 'URI with @ scrubbed correctly')

  const bareMysql = scrubDSN('root:SecretPass@localhost:3306/db')
  assert(bareMysql.scrubbed === true, 'bare MySQL DSN should be scrubbed')
  assert(bareMysql.dsn === 'root:$DATABASE_PASSWORD@localhost:3306/db', 'bare MySQL scrubbed correctly')

  const mysqlSlash = scrubDSN('root:SecretPass@/db')
  assert(mysqlSlash.scrubbed === true, 'MySQL DSN with /db should be scrubbed')
  assert(mysqlSlash.dsn === 'root:$DATABASE_PASSWORD@/db', 'MySQL /db scrubbed correctly')

  const odbcPwd = scrubDSN('Server=10.0.0.1;Uid=sa;Pwd=Secret123;Database=test;')
  assert(odbcPwd.scrubbed === true, 'ODBC Pwd= should be scrubbed')
  assert(odbcPwd.dsn === 'Server=10.0.0.1;Uid=sa;Pwd=$DATABASE_PASSWORD;Database=test;', 'ODBC Pwd= scrubbed correctly')

  const alreadyScrubbed = scrubDSN('postgres://user:$DB_PASS@localhost:5432/db')
  assert(alreadyScrubbed.scrubbed === false, 'already scrubbed DSN not altered')

  const secretRef = scrubDSN('postgres://user:op://vault/db/pw@localhost:5432/db')
  assert(secretRef.scrubbed === false, 'secret reference not altered')
})

console.log(`Vault Helper Tests Summary: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
