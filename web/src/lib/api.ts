export type DatabaseDriver = 'postgres' | 'mysql' | 'sqlite'

// LocalStorage key for user's private profiles
const PROFILES_KEY = 'dblens-private-profiles'

export interface Profile {
  id: string
  label: string
  dsn: string        // full DSN with password (stored only in user's browser)
  color?: string
  readOnly?: boolean
  dialect?: string   // cached after test
}

export interface ConnectionConfig {
  id: string
  label: string
  dsn: string
  color?: string
  readOnly?: boolean
  dialect?: string
  name?: string
  driver?: DatabaseDriver
}

export interface ForeignKeyTarget {
  table: string
  column: string
}

export interface ERDForeignKey {
  column: string
  refTable: string
  refColumn: string
}

export interface ColumnMeta {
  name: string
  type: string
  dataType?: string
  nullable?: boolean
  isNullable?: boolean
  isPrimaryKey?: boolean
  isPrimary?: boolean
  isForeignKey?: boolean
  foreignKeyTarget?: ForeignKeyTarget
  defaultValue?: string
  default?: string | null
}

export interface ERDTable {
  name: string
  schema: string
  columns: ColumnMeta[]
  fks: ERDForeignKey[]
}

export interface TableMeta {
  name: string
  schema?: string
  type?: 'table' | 'view'
  rowCount?: number
  columns?: ColumnMeta[]
}

export interface SchemaMeta {
  tables: TableMeta[]
  schemas: string[]
  currentSchema: string
}

export interface QueryResult {
  columns: string[]
  rows: any[]
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
  action?: 'insert' | 'update' | 'delete'
  pkColumn?: string
  pkValue?: any
  data?: Record<string, any>
  where?: Record<string, any>
  type?: 'INSERT' | 'UPDATE' | 'DELETE'
}

export interface TestConnectionResult {
  success: boolean
  message: string
  dialect?: string
}

// ── Private Profile CRUD (localStorage) & Queries with X-DBLENS-DSN header ──

export const api = {
  getProfiles(): ConnectionConfig[] {
    try {
      const raw = localStorage.getItem(PROFILES_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  },

  saveProfiles(profiles: ConnectionConfig[]): void {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
  },

  addProfile(dsn: string, label: string = '', color: string = '#818cf8', readOnly: boolean = false): Promise<ConnectionConfig> {
    return new Promise((resolve, reject) => {
      // Test connection first
      fetch('/api/connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dsn, label }),
      })
        .then(r => r.json())
        .then(json => {
          const result = json.data ?? json
          if (!result.success) {
            reject(new Error(result.message || 'Connection failed'))
            return
          }
          const profile: ConnectionConfig = {
            id: `local_${Date.now()}`,
            label: label || `${result.dialect || 'db'} DB`,
            dsn,
            color,
            readOnly,
            dialect: result.dialect,
            driver: result.dialect as DatabaseDriver,
          }
          const existing = api.getProfiles()
          api.saveProfiles([...existing, profile])
          resolve(profile)
        })
        .catch(reject)
    })
  },

  updateProfile(id: string, dsn: string, label: string = '', color: string = '#818cf8', readOnly: boolean = false): Promise<ConnectionConfig> {
    return new Promise((resolve, reject) => {
      fetch('/api/connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dsn, label }),
      })
        .then(r => r.json())
        .then(json => {
          const result = json.data ?? json
          if (!result.success) {
            reject(new Error(result.message || 'Connection failed'))
            return
          }
          const profiles = api.getProfiles()
          const updated: ConnectionConfig = {
            id,
            label: label || `${result.dialect || 'db'} DB`,
            dsn,
            color,
            readOnly,
            dialect: result.dialect,
            driver: result.dialect as DatabaseDriver,
          }
          api.saveProfiles(profiles.map(p => (p.id === id ? updated : p)))
          resolve(updated)
        })
        .catch(reject)
    })
  },

  removeProfile(id: string): void {
    const profiles = api.getProfiles().filter(p => p.id !== id)
    api.saveProfiles(profiles)
  },

  testConnection(dsn: string, label: string = ''): Promise<TestConnectionResult> {
    return fetch('/api/connections/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dsn, label }),
    })
      .then(r => r.json())
      .then(json => json.data ?? json)
  },

  // Global profiles from server env DBLENS_CONNECTIONS
  async getGlobalProfiles(): Promise<ConnectionConfig[]> {
    try {
      const r = await fetch('/api/profiles/global')
      const json = await r.json()
      return (json.data ?? []).map((p: any) => ({
        ...p,
        label: p.label || p.name || p.id,
        dsn: '',
      }))
    } catch {
      return []
    }
  },

  // Active Connections backward compatibility
  getConnections(): ConnectionConfig[] {
    return this.getProfiles()
  },

  async pingConnection(connId: string, profiles?: ConnectionConfig[]): Promise<boolean> {
    const dsn = this._getDSN(connId, profiles)
    try {
      const res = await fetch(`/api/connections/${connId}/databases`, {
        headers: this._headers(dsn),
      })
      return res.ok
    } catch {
      return false
    }
  },

  // ── Database Queries — all pass DSN via X-DBLENS-DSN header ──
  _headers(dsn: string): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (dsn) {
      headers['X-DBLENS-DSN'] = dsn
    }
    return headers
  },

  _getDSN(connId: string, profiles?: ConnectionConfig[]): string {
    const allProfiles = profiles ?? api.getProfiles()
    return allProfiles.find(p => p.id === connId)?.dsn ?? ''
  },

  async getDatabases(connId: string, profiles?: ConnectionConfig[]): Promise<string[]> {
    const dsn = this._getDSN(connId, profiles)
    try {
      const res = await fetch(`/api/connections/${connId}/databases`, {
        headers: this._headers(dsn),
      })
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? json ?? []
    } catch {
      return []
    }
  },

  async selectDatabase(connId: string, database: string, profiles?: ConnectionConfig[]): Promise<void> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/databases/select`, {
      method: 'POST',
      headers: this._headers(dsn),
      body: JSON.stringify({ database }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to select database: ${text}`)
    }
  },

  async getSchemas(connId: string, profiles?: ConnectionConfig[]): Promise<string[]> {
    const dsn = this._getDSN(connId, profiles)
    try {
      const r = await fetch(`/api/connections/${connId}/schemas`, { headers: this._headers(dsn) })
      if (!r.ok) return ['public']
      const json = await r.json()
      return json.data ?? json ?? ['public']
    } catch {
      return ['public']
    }
  },

  async getTables(connId: string, schema: string = 'public', profiles?: ConnectionConfig[]): Promise<TableMeta[]> {
    const dsn = this._getDSN(connId, profiles)
    try {
      const r = await fetch(`/api/connections/${connId}/tables?schema=${encodeURIComponent(schema)}`, {
        headers: this._headers(dsn),
      })
      if (!r.ok) return []
      const json = await r.json()
      return json.data ?? json ?? []
    } catch {
      return []
    }
  },

  async getTableDetails(
    connId: string,
    table: string,
    schema: string = 'public',
    profiles?: ConnectionConfig[]
  ): Promise<{ columns: ColumnMeta[]; fks?: any[]; indexes?: string[] }> {
    const dsn = this._getDSN(connId, profiles)
    try {
      const r = await fetch(
        `/api/connections/${connId}/tables/${encodeURIComponent(table)}?schema=${encodeURIComponent(schema)}`,
        { headers: this._headers(dsn) }
      )
      if (!r.ok) return { columns: [] }
      const json = await r.json()
      return json.data ?? json ?? { columns: [] }
    } catch {
      return { columns: [] }
    }
  },

  async getSchema(connId: string, schemaName?: string, profiles?: ConnectionConfig[]): Promise<SchemaMeta> {
    const schemas = await this.getSchemas(connId, profiles)
    const targetSchema = schemaName || schemas[0] || 'public'
    const tables = await this.getTables(connId, targetSchema, profiles)
    return {
      schemas,
      currentSchema: targetSchema,
      tables,
    }
  },

  async queryTableData(
    connId: string,
    tableName: string,
    opts: {
      schema?: string
      limit?: number
      offset?: number
      orderBy?: string
      orderDir?: string
      filters?: Array<{ column: string; operator: string; value: string }>
    } = {},
    profiles?: ConnectionConfig[]
  ): Promise<{ rows: Record<string, any>[]; columns: string[]; totalCount?: number; affectedRows?: number }> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/tables/${encodeURIComponent(tableName)}/data`, {
      method: 'POST',
      headers: this._headers(dsn),
      body: JSON.stringify(opts),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to query table data: ${text}`)
    }
    const json = await res.json()
    const raw = json.data ?? json
    if (raw && Array.isArray(raw.columns) && Array.isArray(raw.rows)) {
      const isArrayOfArrays = raw.rows.length > 0 && Array.isArray(raw.rows[0])
      if (isArrayOfArrays) {
        const objectRows = raw.rows.map((rowArr: any[]) => {
          const rowObj: Record<string, any> = {}
          raw.columns.forEach((col: string, idx: number) => {
            rowObj[col] = rowArr[idx]
          })
          return rowObj
        })
        return {
          rows: objectRows,
          columns: raw.columns,
          totalCount: raw.affectedRows ?? objectRows.length,
          affectedRows: raw.affectedRows,
        }
      }
      return {
        rows: raw.rows,
        columns: raw.columns,
        totalCount: raw.affectedRows ?? raw.rows.length,
        affectedRows: raw.affectedRows,
      }
    }
    return raw ?? { rows: [], columns: [] }
  },

  async executeQuery(connId: string, sql: string, profiles?: ConnectionConfig[]): Promise<QueryResult> {
    const start = performance.now()
    const dsn = this._getDSN(connId, profiles)
    try {
      const res = await fetch(`/api/connections/${connId}/query`, {
        method: 'POST',
        headers: this._headers(dsn),
        body: JSON.stringify({ sql }),
      })
      if (!res.ok) {
        const text = await res.text()
        return {
          columns: [],
          rows: [],
          durationMs: Math.round(performance.now() - start),
          error: text || 'Query failed',
        }
      }
      const json = await res.json()
      const data = json.data ?? json
      const rawRows = data?.rows ?? []
      const cols = data?.columns ?? []
      const isArrayOfArrays = rawRows.length > 0 && Array.isArray(rawRows[0])
      const rows = isArrayOfArrays
        ? rawRows.map((rowArr: any[]) => {
            const rowObj: Record<string, any> = {}
            cols.forEach((c: string, i: number) => {
              rowObj[c] = rowArr[i]
            })
            return rowObj
          })
        : rawRows

      return {
        columns: cols,
        rows,
        affectedRows: data?.affectedRows ?? 0,
        durationMs: data?.elapsed ?? Math.round(performance.now() - start),
      }
    } catch (err: any) {
      return {
        columns: [],
        rows: [],
        durationMs: Math.round(performance.now() - start),
        error: err?.message || 'Query failed',
      }
    }
  },

  async mutateRow(
    connId: string,
    payload: MutateRowPayload,
    profiles?: ConnectionConfig[]
  ): Promise<{ affectedRows: number; generatedSQL?: string }> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/mutate`, {
      method: 'POST',
      headers: this._headers(dsn),
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg)
    }
    const json = await res.json()
    return json.data ?? json ?? { affectedRows: 0 }
  },

  async getERDData(connId: string, profiles?: ConnectionConfig[]): Promise<ERDTable[]> {
    const dsn = this._getDSN(connId, profiles)
    try {
      const res = await fetch(`/api/connections/${connId}/erd`, {
        headers: this._headers(dsn),
      })
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? json ?? []
    } catch {
      return []
    }
  },
}
