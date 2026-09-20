import {
  buildGrantKey,
  parseGrantKey,
  buildInitialGrantSet,
  computeStagedChanges,
  isDangerousChange,
  filterRoles,
  filterTables,
} from './privilegeHelper.ts'
import type { RoleInfo, PrivilegeReport, PrivilegeChange } from '../../lib/api.ts'

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

console.log('--- Running Privilege Manager Helper Unit Tests ---')

test('buildGrantKey and parseGrantKey', () => {
  const key = buildGrantKey('readonly_user', 'public.users', 'SELECT')
  assert(key === 'readonly_user::public.users::SELECT', `unexpected key: ${key}`)

  const parsed = parseGrantKey(key)
  assert(parsed.role === 'readonly_user', 'role mismatch')
  assert(parsed.schema === 'public', 'schema mismatch')
  assert(parsed.table === 'users', 'table mismatch')
  assert(parsed.privilege === 'SELECT', 'privilege mismatch')

  const parsedNoSchema = parseGrantKey('admin::orders::INSERT')
  assert(parsedNoSchema.schema === '', 'expected empty schema')
  assert(parsedNoSchema.table === 'orders', 'expected table orders')
})

test('buildInitialGrantSet constructs set from report', () => {
  const report: PrivilegeReport = {
    dialect: 'postgres',
    roles: [{ name: 'reporter', isSuperuser: false, canLogin: true, connectionLimit: -1 }],
    tablePrivileges: [
      {
        grantee: 'reporter',
        tableSchema: 'public',
        tableName: 'analytics',
        privilegeType: 'SELECT',
        isGrantable: false,
      },
    ],
    tables: ['public.analytics'],
    supportedPrivileges: ['SELECT', 'INSERT'],
  }

  const set = buildInitialGrantSet(report)
  assert(set.has('reporter::public.analytics::SELECT'), 'missing qualified grant')
  assert(set.has('reporter::analytics::SELECT'), 'missing unqualified grant')
  assert(!set.has('reporter::public.analytics::INSERT'), 'unexpected insert grant')
})

test('computeStagedChanges detects grants and revokes', () => {
  const roles: RoleInfo[] = [{ name: 'dev', isSuperuser: false, canLogin: true, connectionLimit: -1 }]
  const tables = ['public.logs']
  const supported = ['SELECT', 'INSERT', 'DELETE']

  const current = new Set<string>()
  current.add('dev::public.logs::SELECT')

  const working = new Set<string>()
  // dev loses SELECT, gains INSERT
  working.add('dev::public.logs::INSERT')

  const changes = computeStagedChanges(current, working, roles, tables, supported)
  assert(changes.length === 2, `expected 2 changes, got ${changes.length}`)

  const revoke = changes.find((c) => c.action === 'REVOKE')
  assert(Boolean(revoke), 'expected REVOKE action')
  assert(revoke?.privilege === 'SELECT', 'expected REVOKE SELECT')

  const grant = changes.find((c) => c.action === 'GRANT')
  assert(Boolean(grant), 'expected GRANT action')
  assert(grant?.privilege === 'INSERT', 'expected GRANT INSERT')
})

test('isDangerousChange flags dangerous revokes', () => {
  const roles: RoleInfo[] = [
    { name: 'postgres', isSuperuser: true, canLogin: true, connectionLimit: -1 },
    { name: 'app_user', isSuperuser: false, canLogin: true, connectionLimit: -1 },
  ]

  const safeGrant: PrivilegeChange = {
    role: 'postgres',
    schema: 'public',
    table: 'users',
    privilege: 'SELECT',
    action: 'GRANT',
  }
  assert(!isDangerousChange(safeGrant, roles), 'grant should not be dangerous')

  const safeRevoke: PrivilegeChange = {
    role: 'app_user',
    schema: 'public',
    table: 'users',
    privilege: 'SELECT',
    action: 'REVOKE',
  }
  assert(!isDangerousChange(safeRevoke, roles), 'revoking regular user should not be dangerous')

  const dangerousRevoke: PrivilegeChange = {
    role: 'postgres',
    schema: 'public',
    table: 'users',
    privilege: 'SELECT',
    action: 'REVOKE',
  }
  assert(isDangerousChange(dangerousRevoke, roles), 'revoking superuser should be flagged dangerous')

  const dangerousAll: PrivilegeChange = {
    role: 'app_user',
    schema: 'public',
    table: 'users',
    privilege: 'ALL',
    action: 'REVOKE',
  }
  assert(isDangerousChange(dangerousAll, roles), 'revoking ALL should be dangerous')
})

test('filterRoles and filterTables filter queries', () => {
  const roles: RoleInfo[] = [
    { name: 'admin_user', isSuperuser: true, canLogin: true, connectionLimit: -1 },
    { name: 'reader', isSuperuser: false, canLogin: true, connectionLimit: 10 },
  ]
  assert(filterRoles(roles, 'admin').length === 1, 'expected 1 match for admin')
  assert(filterRoles(roles, 'superuser').length === 1, 'expected 1 match for superuser')
  assert(filterRoles(roles, 'nonexistent').length === 0, 'expected 0 matches')

  const tables = ['public.users', 'public.orders', 'auth.tokens']
  assert(filterTables(tables, 'user').length === 1, 'expected 1 match for user')
  assert(filterTables(tables, 'public').length === 2, 'expected 2 matches for public')
})

console.log(`\nPrivilege Helper Tests: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
