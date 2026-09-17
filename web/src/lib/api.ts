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

export interface TableForeignKey {
  name?: string
  column: string
  refTable: string
  refColumn: string
  onUpdate?: string
  onDelete?: string
}

export interface IndexMeta {
  name: string
  columns: string[]
  isUnique: boolean
  isPrimary: boolean
  type?: string
}

export interface TableDetailResponse {
  name?: string
  schema?: string
  dialect?: string
  columns: ColumnMeta[]
  fks?: TableForeignKey[]
  indexes?: IndexMeta[]
  ddl?: string
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

export interface RenameColumnSpec {
  from: string
  to: string
}

export interface AlterColumnSpec {
  name: string
  type?: string
  nullable?: boolean
  default?: string | null
  dropDefault?: boolean
}

export interface AlterTablePayload {
  schema?: string
  table?: string
  addedColumns?: ColumnMeta[]
  droppedColumns?: string[]
  renamedColumns?: RenameColumnSpec[]
  alteredColumns?: AlterColumnSpec[]
  addedIndexes?: IndexMeta[]
  droppedIndexes?: string[]
  addedForeignKeys?: TableForeignKey[]
  droppedForeignKeys?: string[]
  statements?: string[]
  sql?: string
}

export interface AlterTablePreviewResponse {
  table: string
  schema?: string
  dialect: string
  statements: string[]
  sql: string
}

export interface AlterTableApplyResponse {
  table: string
  schema?: string
  statementsExecuted: number
  elapsedMs: number
  statements: string[]
  message: string
}

export type DiffStatus = 'ADDED' | 'REMOVED' | 'MODIFIED' | 'IDENTICAL'

export interface ColumnDiff {
  name: string
  status: DiffStatus
  sourceType?: string
  targetType?: string
  sourceNullable?: boolean
  targetNullable?: boolean
  sourceDefault?: string | null
  targetDefault?: string | null
  sourcePrimary?: boolean
  targetPrimary?: boolean
  changes?: string[]
}

export interface IndexDiff {
  name: string
  status: DiffStatus
  columns: string[]
  isUnique: boolean
  type?: string
}

export interface FKDiff {
  name: string
  status: DiffStatus
  column: string
  refTable: string
  refColumn: string
  onUpdate?: string
  onDelete?: string
}

export interface TableDiff {
  name: string
  schema?: string
  status: DiffStatus
  columns: ColumnDiff[]
  indexes: IndexDiff[]
  foreignKeys: FKDiff[]
  migrationSql: string[]
  sql?: string
}

export interface SchemaDiffResult {
  sourceSchema: string
  targetSchema: string
  sourceDialect?: string
  targetDialect: string
  totalTables: number
  addedCount: number
  removedCount: number
  modifiedCount: number
  identicalCount: number
  tables: TableDiff[]
  migrationSql: string[]
  sql: string
}

export interface DiffEndpointSpec {
  connId?: string
  schema?: string
  table?: string
  dsn?: string
}

export interface SchemaDiffRequest {
  source: DiffEndpointSpec
  target: DiffEndpointSpec
  targetDsn?: string
  sourceDsn?: string
}

export interface SchemaDiffApplyRequest {
  statements: string[]
  targetDsn?: string
  readOnly?: boolean
}

export interface SchemaDiffApplyResponse {
  statementsExecuted: number
  elapsedMs: number
  statements: string[]
  message: string
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

export interface PlanNode {
  nodeType: string
  relationName?: string
  schema?: string
  alias?: string
  indexName?: string
  cost?: number
  startupCost?: number
  totalCost?: number
  rows?: number
  planRows?: number
  planWidth?: number
  actualTime?: number
  actualStartupTime?: number
  actualTotalTime?: number
  actualRows?: number
  actualLoops?: number
  filter?: string
  indexCond?: string
  hashCond?: string
  joinType?: string
  isExpensive?: boolean
  warnings?: string[]
  children?: PlanNode[]
  extra?: Record<string, any>
}

export interface ExplainSummary {
  totalCost?: number
  planningTime?: number
  executionTime?: number
}

export interface ExplainResult {
  dialect: 'postgres' | 'mysql' | 'sqlite' | string
  root: PlanNode
  summary: ExplainSummary
  raw: string
  format: 'json' | 'text'
  error?: string
}

export interface ExplainOptions {
  analyze?: boolean
  schema?: string
  database?: string
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
    const allProfiles = profiles && profiles.length > 0 ? profiles : api.getProfiles()
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
  ): Promise<TableDetailResponse> {
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

  async getTableDDL(
    connId: string,
    table: string,
    schema?: string,
    profiles?: ConnectionConfig[]
  ): Promise<{ table: string; schema?: string; dialect?: string; ddl: string }> {
    const dsn = this._getDSN(connId, profiles)
    const schemaParam = schema ? `?schema=${encodeURIComponent(schema)}` : ''
    const r = await fetch(
      `/api/connections/${connId}/tables/${encodeURIComponent(table)}/ddl${schemaParam}`,
      { headers: this._headers(dsn) }
    )
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to generate DDL')
    }
    const json = await r.json()
    return json.data ?? json
  },

  async alterTablePreview(
    connId: string,
    table: string,
    payload: AlterTablePayload,
    schema?: string,
    profiles?: ConnectionConfig[]
  ): Promise<AlterTablePreviewResponse> {
    const dsn = this._getDSN(connId, profiles)
    const schemaParam = schema ? `?schema=${encodeURIComponent(schema)}` : ''
    const r = await fetch(
      `/api/connections/${connId}/tables/${encodeURIComponent(table)}/alter-preview${schemaParam}`,
      {
        method: 'POST',
        headers: this._headers(dsn),
        body: JSON.stringify(payload),
      }
    )
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to generate alter table preview')
    }
    const json = await r.json()
    return json.data ?? json
  },

  async alterTableApply(
    connId: string,
    table: string,
    payload: AlterTablePayload,
    schema?: string,
    profiles?: ConnectionConfig[]
  ): Promise<AlterTableApplyResponse> {
    const dsn = this._getDSN(connId, profiles)
    const schemaParam = schema ? `?schema=${encodeURIComponent(schema)}` : ''
    const r = await fetch(
      `/api/connections/${connId}/tables/${encodeURIComponent(table)}/alter${schemaParam}`,
      {
        method: 'POST',
        headers: this._headers(dsn),
        body: JSON.stringify(payload),
      }
    )
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to apply alter table changes')
    }
    const json = await r.json()
    return json.data ?? json
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

  async explainQuery(
    connId: string,
    queryOrDb: string,
    queryOrOpts?: string | ExplainOptions,
    maybeOpts?: ExplainOptions,
    profiles?: ConnectionConfig[]
  ): Promise<ExplainResult> {
    const dsn = this._getDSN(connId, profiles)
    let sql: string
    let dbName: string | undefined
    let options: ExplainOptions | undefined

    if (typeof queryOrOpts === 'string') {
      dbName = queryOrDb
      sql = queryOrOpts
      options = maybeOpts
    } else {
      sql = queryOrDb
      options = queryOrOpts
      dbName = options?.database
    }

    const endpoint = dbName
      ? `/api/connections/${connId}/databases/${encodeURIComponent(dbName)}/explain`
      : `/api/connections/${connId}/explain`

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: this._headers(dsn),
        body: JSON.stringify({
          sql,
          analyze: options?.analyze ?? true,
          schema: options?.schema,
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        let errMsg = text
        try {
          const parsed = JSON.parse(text)
          if (parsed.error) errMsg = parsed.error
        } catch {}
        return {
          dialect: 'sqlite',
          root: { nodeType: 'ERROR' },
          summary: {},
          raw: errMsg,
          format: 'text',
          error: errMsg || 'Explain failed',
        }
      }

      const json = await res.json()
      const data = json.data ?? json
      return data
    } catch (err: any) {
      return {
        dialect: 'sqlite',
        root: { nodeType: 'ERROR' },
        summary: {},
        raw: err?.message || 'Network error',
        format: 'text',
        error: err?.message || 'Failed to explain query',
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

  async batchInsert(
    connId: string,
    schema: string,
    table: string,
    rows: Record<string, any>[],
    profiles?: ConnectionConfig[]
  ): Promise<{ affectedRows: number; generatedSQL?: string }> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/batch-insert`, {
      method: 'POST',
      headers: this._headers(dsn),
      body: JSON.stringify({ schema, table, rows }),
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

  async exportTableBlob(
    connId: string,
    schema: string,
    table: string,
    format: 'csv' | 'json' | 'sql',
    profiles?: ConnectionConfig[]
  ): Promise<void> {
    const dsn = this._getDSN(connId, profiles)
    const params = new URLSearchParams({
      table,
      schema: schema || '',
      format,
    })
    const headers: Record<string, string> = {}
    if (dsn) {
      headers['X-DBLENS-DSN'] = dsn
    }
    const res = await fetch(`/api/connections/${connId}/export?${params.toString()}`, {
      headers,
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Export failed')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${table}_export.${format}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },

  async importCSV(
    connId: string,
    schema: string,
    table: string,
    file: File,
    profiles?: ConnectionConfig[]
  ): Promise<{ affectedRows: number; message: string }> {
    const dsn = this._getDSN(connId, profiles)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('table', table)
    if (schema) {
      formData.append('schema', schema)
    }
    const headers: Record<string, string> = {}
    if (dsn) {
      headers['X-DBLENS-DSN'] = dsn
    }
    const res = await fetch(`/api/connections/${connId}/import/csv`, {
      method: 'POST',
      headers,
      body: formData,
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Import CSV failed')
    }
    const json = await res.json()
    return json.data ?? json
  },

  async importSQL(
    connId: string,
    file: File,
    profiles?: ConnectionConfig[]
  ): Promise<{ statementsExecuted: number; affectedRows: number; message: string }> {
    const dsn = this._getDSN(connId, profiles)
    const formData = new FormData()
    formData.append('file', file)
    const headers: Record<string, string> = {}
    if (dsn) {
      headers['X-DBLENS-DSN'] = dsn
    }
    const res = await fetch(`/api/connections/${connId}/import/sql`, {
      method: 'POST',
      headers,
      body: formData,
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Import SQL failed')
    }
    const json = await res.json()
    return json.data ?? json
  },

  async compareSchema(
    connId: string,
    req: SchemaDiffRequest,
    profiles?: ConnectionConfig[]
  ): Promise<SchemaDiffResult> {
    const srcDsn = req.sourceDsn || req.source.dsn || this._getDSN(req.source.connId || connId, profiles)
    const tgtDsn = req.targetDsn || req.target.dsn || (req.target.connId ? this._getDSN(req.target.connId, profiles) : srcDsn)
    const payload: SchemaDiffRequest = {
      ...req,
      sourceDsn: srcDsn,
      targetDsn: tgtDsn,
    }
    const headers = this._headers(srcDsn)
    const res = await fetch(`/api/connections/${connId}/diff`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Schema comparison failed')
    }
    const json = await res.json()
    return json.data ?? json
  },

  async applySchemaDiff(
    connId: string,
    req: SchemaDiffApplyRequest,
    profiles?: ConnectionConfig[],
    readOnly?: boolean
  ): Promise<SchemaDiffApplyResponse> {
    const dsn = req.targetDsn || this._getDSN(connId, profiles)
    const isReadOnly = readOnly ?? req.readOnly ?? profiles?.find(p => p.id === connId)?.readOnly ?? false
    const headers: Record<string, string> = {
      ...(this._headers(dsn) as Record<string, string>),
    }
    if (isReadOnly) {
      headers['X-DBLENS-READONLY'] = 'true'
    }
    const res = await fetch(`/api/connections/${connId}/diff/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...req, readOnly: isReadOnly }),
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Apply migration failed')
    }
    const json = await res.json()
    return json.data ?? json
  },
}
