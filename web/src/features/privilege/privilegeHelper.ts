import type { RoleInfo, PrivilegeChange, PrivilegeReport } from '../../lib/api'

export function buildGrantKey(role: string, table: string, privilege: string): string {
  return `${role.trim()}::${table.trim()}::${privilege.trim().toUpperCase()}`
}

export function parseGrantKey(key: string): { role: string; schema: string; table: string; privilege: string } {
  const [role, rawTable, privilege] = key.split('::')
  let schema = ''
  let table = rawTable || ''
  if (rawTable && rawTable.includes('.')) {
    const parts = rawTable.split('.')
    schema = parts[0]
    table = parts.slice(1).join('.')
  }
  return { role: role || '', schema, table, privilege: privilege || '' }
}

export function buildInitialGrantSet(report: PrivilegeReport): Set<string> {
  const set = new Set<string>()
  if (!report || !report.tablePrivileges) return set

  for (const tp of report.tablePrivileges) {
    const role = tp.grantee
    const tbl = tp.tableSchema ? `${tp.tableSchema}.${tp.tableName}` : tp.tableName
    set.add(buildGrantKey(role, tbl, tp.privilegeType))
    // Also add unqualified if matches report.tables
    set.add(buildGrantKey(role, tp.tableName, tp.privilegeType))
  }
  return set
}

export function computeStagedChanges(
  currentGrants: Set<string>,
  workingGrants: Set<string>,
  roles: RoleInfo[],
  tables: string[],
  supportedPrivileges: string[]
): PrivilegeChange[] {
  const changes: PrivilegeChange[] = []
  const checkedKeys = new Set<string>()

  for (const role of roles) {
    for (const table of tables) {
      for (const priv of supportedPrivileges) {
        const key = buildGrantKey(role.name, table, priv)
        checkedKeys.add(key)

        const wasGranted = currentGrants.has(key)
        const isGranted = workingGrants.has(key)

        if (!wasGranted && isGranted) {
          const parsed = parseGrantKey(key)
          changes.push({
            role: parsed.role,
            schema: parsed.schema,
            table: parsed.table,
            privilege: parsed.privilege,
            action: 'GRANT',
          })
        } else if (wasGranted && !isGranted) {
          const parsed = parseGrantKey(key)
          changes.push({
            role: parsed.role,
            schema: parsed.schema,
            table: parsed.table,
            privilege: parsed.privilege,
            action: 'REVOKE',
          })
        }
      }
    }
  }

  return changes
}

export function isDangerousChange(change: PrivilegeChange, roles: RoleInfo[]): boolean {
  if (change.action !== 'REVOKE') return false

  const r = roles.find((role) => role.name.toLowerCase() === change.role.toLowerCase())
  if (r && r.isSuperuser) return true

  const adminNames = ['postgres', 'root', 'admin', 'administrator', 'sqlite_admin']
  if (adminNames.includes(change.role.toLowerCase())) return true

  if (change.privilege.toUpperCase() === 'ALL' || change.privilege.toUpperCase() === 'ALL PRIVILEGES') {
    return true
  }

  return false
}

export function filterRoles(roles: RoleInfo[], search: string): RoleInfo[] {
  const q = search.trim().toLowerCase()
  if (!q) return roles
  return roles.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      (r.isSuperuser && 'superuser'.includes(q)) ||
      (r.canLogin && 'login'.includes(q))
  )
}

export function filterTables(tables: string[], search: string): string[] {
  const q = search.trim().toLowerCase()
  if (!q) return tables
  return tables.filter((t) => t.toLowerCase().includes(q))
}
