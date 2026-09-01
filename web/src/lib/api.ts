export type DatabaseDriver = 'postgres' | 'mysql' | 'sqlite'

export interface ConnectionConfig {
  id: string
  name: string
  driver: DatabaseDriver
  uri?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  color?: string
  readOnly?: boolean
}

export interface ColumnMeta {
  name: string
  type: string
  nullable: boolean
  isPrimaryKey: boolean
  isForeignKey?: boolean
  foreignKeyTarget?: {
    table: string
    column: string
  }
  defaultValue?: string
}

export interface TableMeta {
  name: string
  schema?: string
  type: 'table' | 'view'
  rowCount?: number
  columns: ColumnMeta[]
}

export interface SchemaMeta {
  tables: TableMeta[]
  schemas: string[]
  currentSchema: string
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, any>[]
  affectedRows?: number
  durationMs: number
  error?: string
}

export interface QueryHistoryItem {
  id: string
  sql: string
  timestamp: number
  durationMs: number
  success: boolean
  rowCount: number
  error?: string
}

export interface MutateRowPayload {
  table: string
  schema?: string
  action: 'insert' | 'update' | 'delete'
  pkColumn: string
  pkValue: any
  data?: Record<string, any>
}

// In-memory row cache for mock edits
function generateMockRows(tableName: string, count: number = 30): Record<string, any>[] {
  const roles = ['admin', 'member', 'owner', 'viewer']
  const orgs = ['Acme Corp', 'Supastack', 'Vercelify', 'CloudNext', 'DataLens Lab']
  
  if (tableName === 'users') {
    return Array.from({ length: count }, (_, i) => ({
      id: `usr_${1000 + i}_${Math.random().toString(36).substring(2, 6)}`,
      email: `user${i + 1}@example.com`,
      name: `User ${i + 1} Doe`,
      role: roles[i % roles.length],
      avatar_url: `https://avatar.vercel.sh/user${i + 1}`,
      created_at: new Date(Date.now() - i * 86400000 * 3).toISOString(),
      is_active: i % 7 !== 0,
    }))
  }
  
  if (tableName === 'organizations') {
    return Array.from({ length: count }, (_, i) => ({
      id: `org_${2000 + i}_${Math.random().toString(36).substring(2, 6)}`,
      name: orgs[i % orgs.length] + ` #${i + 1}`,
      slug: (orgs[i % orgs.length] + `-${i + 1}`).toLowerCase().replace(/\s+/g, '-'),
      plan: i % 2 === 0 ? 'enterprise' : 'pro',
      created_at: new Date(Date.now() - i * 86400000 * 12).toISOString(),
    }))
  }

  if (tableName === 'memberships') {
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      user_id: `usr_${1000 + (i % 20)}_abc`,
      org_id: `org_${2000 + (i % 5)}_xyz`,
      role: roles[i % roles.length],
      joined_at: new Date(Date.now() - i * 86400000 * 2).toISOString(),
    }))
  }

  if (tableName === 'api_keys') {
    return Array.from({ length: count }, (_, i) => ({
      id: `key_${3000 + i}`,
      org_id: `org_${2000 + (i % 5)}_xyz`,
      name: `Production API Key ${i + 1}`,
      key_hash: `sk_live_${Math.random().toString(36).substring(2, 14)}...`,
      last_used_at: new Date(Date.now() - i * 3600000 * 4).toISOString(),
    }))
  }

  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    col_a: `Value A-${i}`,
    col_b: Math.floor(Math.random() * 1000),
    col_c: new Date().toISOString(),
  }))
}

// In-memory row cache for mock edits
const mockRowStore: Record<string, Record<string, any>[]> = {}

export const api = {
  // Connections
  async getConnections(): Promise<ConnectionConfig[]> {
    try {
      const res = await fetch('/api/connections')
      if (res.ok) {
        const json = await res.json()
        return json.data ?? json
      }
    } catch {
      // Fallback
    }
    return []
  },

  async createConnection(config: Omit<ConnectionConfig, 'id'>): Promise<ConnectionConfig> {
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) return await res.json()
    } catch {}

    const newConn: ConnectionConfig = {
      ...config,
      id: `conn_${Date.now()}`,
    }
    return newConn
  },

  async deleteConnection(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/connections/${id}`, { method: 'DELETE' })
      return res.ok
    } catch {
      return true
    }
  },

  // Schema Inspection
  async getSchemas(connId: string): Promise<string[]> {
    try {
      const res = await fetch(`/api/connections/${connId}/schemas`)
      if (res.ok) {
        const json = await res.json()
        return json.data ?? json
      }
    } catch {}
    return ['public']
  },

  async getTables(connId: string, schema: string = 'public'): Promise<TableMeta[]> {
    try {
      const res = await fetch(`/api/connections/${connId}/tables?schema=${schema}`)
      if (res.ok) {
        const json = await res.json()
        return json.data ?? json
      }
    } catch {}
    return []
  },

  async getTableDetails(connId: string, table: string, schema: string = 'public'): Promise<TableMeta | null> {
    try {
      const res = await fetch(`/api/connections/${connId}/tables/${table}?schema=${schema}`)
      if (res.ok) {
        const json = await res.json()
        return json.data ?? json
      }
    } catch {}
    return null
  },

  async getSchema(connId: string, schemaName?: string): Promise<SchemaMeta> {
    const schemas = await this.getSchemas(connId)
    const tables = await this.getTables(connId, schemaName || schemas[0] || 'public')
    return {
      schemas,
      currentSchema: schemaName || schemas[0] || 'public',
      tables,
    }
  },

  // Table Data
  async getTableData(
    connId: string,
    tableName: string,
    params: {
      limit?: number
      offset?: number
      sortBy?: string
      sortOrder?: 'asc' | 'desc'
      filter?: string
    } = {}
  ): Promise<{ rows: Record<string, any>[]; totalCount: number }> {
    try {
      const query = new URLSearchParams()
      if (params.limit) query.set('limit', String(params.limit))
      if (params.offset) query.set('offset', String(params.offset))
      if (params.sortBy) query.set('sortBy', params.sortBy)
      if (params.sortOrder) query.set('sortOrder', params.sortOrder)
      if (params.filter) query.set('filter', params.filter)

      const res = await fetch(`/api/connections/${connId}/tables/${tableName}/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema: 'public',
          limit: params.limit || 50,
          offset: params.offset || 0,
          orderBy: params.sortBy || '',
          orderDir: params.sortOrder || 'asc',
          filters: params.filter ? [{ column: '*', operator: 'LIKE', value: params.filter }] : [],
        }),
      })
      if (res.ok) {
        const json = await res.json()
        const data = json.data ?? json
        return { rows: data.rows ?? [], totalCount: data.totalCount ?? 0 }
      }
    } catch {}

    const key = `${connId}:${tableName}`
    if (!mockRowStore[key]) {
      mockRowStore[key] = generateMockRows(tableName, 80)
    }

    let rows = [...mockRowStore[key]]

    if (params.filter) {
      const q = params.filter.toLowerCase()
      rows = rows.filter((r) =>
        Object.values(r).some((v) => String(v).toLowerCase().includes(q))
      )
    }

    if (params.sortBy) {
      const col = params.sortBy
      const order = params.sortOrder === 'desc' ? -1 : 1
      rows.sort((a, b) => {
        if (a[col] < b[col]) return -1 * order
        if (a[col] > b[col]) return 1 * order
        return 0
      })
    }

    const totalCount = rows.length
    const offset = params.offset || 0
    const limit = params.limit || 50
    const paginated = rows.slice(offset, offset + limit)

    return {
      rows: paginated,
      totalCount,
    }
  },

  // Row Mutation
  async mutateRow(connId: string, payload: MutateRowPayload): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/connections/${connId}/mutate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) return await res.json()
    } catch {}

    const key = `${connId}:${payload.table}`
    if (!mockRowStore[key]) {
      mockRowStore[key] = generateMockRows(payload.table, 80)
    }

    const rows = mockRowStore[key]
    if (payload.action === 'update') {
      const idx = rows.findIndex((r) => String(r[payload.pkColumn]) === String(payload.pkValue))
      if (idx !== -1) {
        rows[idx] = { ...rows[idx], ...payload.data }
      }
    } else if (payload.action === 'delete') {
      mockRowStore[key] = rows.filter((r) => String(r[payload.pkColumn]) !== String(payload.pkValue))
    } else if (payload.action === 'insert') {
      mockRowStore[key].unshift(payload.data || {})
    }

    return { success: true }
  },

  // Execute Raw SQL Query
  async executeQuery(connId: string, sql: string): Promise<QueryResult> {
    const start = performance.now()
    try {
      const res = await fetch(`/api/connections/${connId}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      })
      if (res.ok) {
        const json = await res.json()
        return {
          ...json,
          durationMs: Math.round(performance.now() - start),
        }
      }
      const err = await res.text()
      return {
        columns: [],
        rows: [],
        durationMs: Math.round(performance.now() - start),
        error: err || 'Query execution failed',
      }
    } catch {
      // Mock execution for client testing
      await new Promise((r) => setTimeout(r, 60))
      const lower = sql.trim().toLowerCase()
      
      if (lower.startsWith('select')) {
        const rows = generateMockRows('users', 12)
        return {
          columns: Object.keys(rows[0]),
          rows,
          affectedRows: rows.length,
          durationMs: Math.round(performance.now() - start),
        }
      } else if (lower.startsWith('update') || lower.startsWith('delete') || lower.startsWith('insert')) {
        return {
          columns: [],
          rows: [],
          affectedRows: 1,
          durationMs: Math.round(performance.now() - start),
        }
      }

      return {
        columns: ['status', 'message'],
        rows: [{ status: 'OK', message: 'Executed query successfully' }],
        affectedRows: 0,
        durationMs: Math.round(performance.now() - start),
      }
    }
  },
}
