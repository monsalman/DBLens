export type DatabaseDriver = 'postgres' | 'mysql' | 'sqlite'

export interface ConnectionConfig {
  id: string
  label?: string
  name?: string
  driver?: DatabaseDriver
  color?: string
  readOnly?: boolean
  dialect?: string
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
  foreignKeyTarget?: {
    table: string
    column: string
  }
  defaultValue?: string
  default?: string | null
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

export const api = {
  // Profiles (persistent)
  async getProfiles(): Promise<ConnectionConfig[]> {
    const res = await fetch('/api/profiles')
    if (!res.ok) throw new Error('Failed to load profiles')
    const json = await res.json()
    return json.data ?? []
  },

  async addProfile(dsn: string, label: string = '', color: string = '#3b82f6', readOnly: boolean = false): Promise<ConnectionConfig> {
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dsn, label, color, readOnly }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to add connection: ${text}`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async removeProfile(id: string): Promise<void> {
    const res = await fetch(`/api/profiles/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to remove profile')
  },

  // Active Connections
  async getConnections(): Promise<ConnectionConfig[]> {
    const res = await fetch('/api/connections')
    if (!res.ok) throw new Error('Failed to list connections')
    const json = await res.json()
    return json.data ?? []
  },

  async pingConnection(connId: string): Promise<boolean> {
    const res = await fetch(`/api/connections/${connId}/ping`)
    return res.ok
  },

  // Schema Inspection
  async getSchemas(connId: string): Promise<string[]> {
    const res = await fetch(`/api/connections/${connId}/schemas`)
    if (!res.ok) throw new Error('Failed to get schemas')
    const json = await res.json()
    return json.data ?? []
  },

  async getTables(connId: string, schema: string = 'public'): Promise<TableMeta[]> {
    const res = await fetch(`/api/connections/${connId}/tables?schema=${encodeURIComponent(schema)}`)
    if (!res.ok) throw new Error('Failed to get tables')
    const json = await res.json()
    return json.data ?? []
  },

  async getTableDetails(connId: string, table: string, schema: string = 'public'): Promise<{columns: ColumnMeta[]; fks?: any[]; indexes?: string[]}> {
    const res = await fetch(`/api/connections/${connId}/tables/${encodeURIComponent(table)}?schema=${encodeURIComponent(schema)}`)
    if (!res.ok) throw new Error('Failed to get table details')
    const json = await res.json()
    return json.data ?? {}
  },

  async getSchema(connId: string, schemaName?: string): Promise<SchemaMeta> {
    const schemas = await this.getSchemas(connId)
    const targetSchema = schemaName || schemas[0] || 'public'
    const tables = await this.getTables(connId, targetSchema)
    return {
      schemas,
      currentSchema: targetSchema,
      tables,
    }
  },

  async queryTableData(
    connId: string,
    tableName: string,
    opts: { schema?: string; limit?: number; offset?: number; orderBy?: string; orderDir?: string; filters?: Array<{column: string; operator: string; value: string}> } = {}
  ): Promise<{rows: Record<string, any>[]; columns: string[]; totalCount?: number; affectedRows?: number}> {
    const res = await fetch(`/api/connections/${connId}/tables/${encodeURIComponent(tableName)}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  async executeQuery(connId: string, sql: string): Promise<QueryResult> {
    const start = performance.now()
    const res = await fetch(`/api/connections/${connId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  },

  async mutateRow(connId: string, payload: { schema?: string; table: string; data?: Record<string, any>; where?: Record<string, any>; type: 'INSERT' | 'UPDATE' | 'DELETE' }): Promise<{affectedRows: number; generatedSQL: string}> {
    const res = await fetch(`/api/connections/${connId}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text)
    }
    const json = await res.json()
    return json.data ?? {}
  },
}

