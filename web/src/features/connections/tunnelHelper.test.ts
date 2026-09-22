import {
  defaultTunnelConfig,
  validateTunnelConfig,
  formatTunnelStatus,
  hasSSHTunnel,
  maskTunnelConfig,
} from './tunnelHelper.ts'
import type { SSHTunnelConfig, TunnelTestResult, ConnectionConfig } from '../../lib/api.ts'

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

console.log('--- Running SSH Tunnel Helper Unit Tests ---')

test('defaultTunnelConfig returns clean disabled initial config', () => {
  const cfg = defaultTunnelConfig()
  assert(cfg.enabled === false, 'should default to disabled')
  assert(cfg.port === 22, 'should default to port 22')
  assert(cfg.auth_method === 'key', 'should default to key auth')
  assert(cfg.host === '', 'host should be empty')
  assert(cfg.user === '', 'user should be empty')
})

test('validateTunnelConfig allows disabled tunnel even if fields are empty', () => {
  const res = validateTunnelConfig({ enabled: false })
  assert(res.valid === true, 'should be valid when disabled')
  assert(res.errors.length === 0, 'should have 0 errors')
})

test('validateTunnelConfig enforces host, user, port and credentials when enabled', () => {
  const emptyRes = validateTunnelConfig({ enabled: true })
  assert(emptyRes.valid === false, 'should be invalid without host/user')
  assert(emptyRes.errors.some(e => e.includes('host')), 'should require host')
  assert(emptyRes.errors.some(e => e.includes('username')), 'should require user')

  const invalidPort = validateTunnelConfig({
    enabled: true,
    host: 'bastion.net',
    user: 'ubuntu',
    port: 70000,
    auth_method: 'agent',
  })
  assert(invalidPort.valid === false, 'should reject port > 65535')

  const missingKey = validateTunnelConfig({
    enabled: true,
    host: 'bastion.net',
    user: 'ubuntu',
    auth_method: 'key',
    private_key: '',
  })
  assert(missingKey.valid === false, 'should require private key')

  const missingPass = validateTunnelConfig({
    enabled: true,
    host: 'bastion.net',
    user: 'ubuntu',
    auth_method: 'password',
    password: '',
  })
  assert(missingPass.valid === false, 'should require password')

  const validAgent = validateTunnelConfig({
    enabled: true,
    host: 'bastion.net',
    port: 2222,
    user: 'ubuntu',
    auth_method: 'agent',
  })
  assert(validAgent.valid === true, 'valid agent should pass validation')
})

test('formatTunnelStatus formats latency and server banner', () => {
  const successRes: TunnelTestResult = {
    success: true,
    message: 'Handshake complete',
    latency_ms: 24,
    banner: 'SSH-2.0-OpenSSH_9.0',
  }
  const str = formatTunnelStatus(successRes)
  assert(str.includes('24ms latency'), 'should include latency')
  assert(str.includes('SSH-2.0-OpenSSH_9.0'), 'should include banner')

  const failRes: TunnelTestResult = {
    success: false,
    message: 'Authentication failed',
  }
  assert(formatTunnelStatus(failRes) === 'Authentication failed', 'should return error message')
})

test('hasSSHTunnel detects enabled tunnel on connection', () => {
  const c1: ConnectionConfig = {
    id: 'c1',
    label: 'Direct DB',
    dsn: 'postgres://localhost:5432/db',
  }
  assert(hasSSHTunnel(c1) === false, 'should return false for direct connection')

  const c2: ConnectionConfig = {
    id: 'c2',
    label: 'Tunneled DB',
    dsn: 'postgres://internal:5432/db',
    ssh_tunnel: {
      enabled: true,
      host: 'bastion.corp',
      port: 22,
      user: 'admin',
      auth_method: 'key',
    },
  }
  assert(hasSSHTunnel(c2) === true, 'should return true for tunneled connection')

  const c3: ConnectionConfig = {
    id: 'c3',
    label: 'Disabled Tunnel DB',
    dsn: 'postgres://internal:5432/db',
    ssh_tunnel: {
      enabled: false,
      host: 'bastion.corp',
      port: 22,
      user: 'admin',
      auth_method: 'key',
    },
  }
  assert(hasSSHTunnel(c3) === false, 'should return false when enabled is false')
})

test('maskTunnelConfig masks secrets', () => {
  const cfg: SSHTunnelConfig = {
    enabled: true,
    host: 'jump.host',
    port: 22,
    user: 'deploy',
    auth_method: 'key',
    password: 'supersecretpass',
    private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...',
    passphrase: 'keypassphrase',
  }
  const masked = maskTunnelConfig(cfg)
  assert(masked.password === '••••••••', 'password should be masked')
  assert(masked.private_key === '•••• [KEY CONFIGURED] ••••', 'private_key should be masked')
  assert(masked.passphrase === '••••••••', 'passphrase should be masked')
  assert(masked.host === 'jump.host', 'host should remain untouched')
})

console.log(`\nTunnel Helper Tests: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
