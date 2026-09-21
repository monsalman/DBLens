export type DatabaseDriver = 'postgres' | 'mysql' | 'sqlite'
import type { AIAssistantConfig } from '../features/editor/aiAssistant'

// LocalStorage key for user's private profiles
const PROFILES_KEY = 'dblens-private-profiles'

export interface SSHTunnelConfig {
  enabled: boolean
  host: string
  port: number
  user: string
  auth_method: 'password' | 'key' | 'agent'
  password?: string
  private_key?: string
  passphrase?: string
}

export interface TunnelTestResult {
  success: boolean
  message: string
  latency_ms?: number
  banner?: string
}

export interface Profile {
  id: string
  label: string
  dsn: string        // full DSN with password (stored only in user's browser)
  color?: string
  readOnly?: boolean
  dialect?: string   // cached after test
  environment?: 'production' | 'staging' | 'development' | 'local'
  ssh_tunnel?: SSHTunnelConfig
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
  environment?: 'production' | 'staging' | 'development' | 'local'
  ssh_tunnel?: SSHTunnelConfig
}

export interface ForeignKeyTarget {
  table: string
  column: string
}

export interface ERDForeignKey {
  column: string
  refTable: string
  refColumn: string
  cardinality?: '1:1' | '1:N' | string
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

export interface ProcessInfo {
  id: string
  user: string
  database: string
  host: string
  time: number
  state: string
  query: string
  command?: string
}

export interface TableStorageStat {
  schema: string
  table: string
  totalBytes: number
  dataBytes: number
  indexBytes: number
  totalSize: string
  dataSize: string
  indexSize: string
  rowCount: number
  deadTuples: number
  freeBytes?: number
  remediationSql?: string
}

export interface UnusedIndexStat {
  schema: string
  table: string
  index: string
  sizeBytes: number
  size: string
  scans: number
  remediationSql?: string
}

export interface RemediationAction {
  id: string
  title: string
  description: string
  severity: 'critical' | 'warning' | 'info'
  category: 'cache' | 'bloat' | 'unused_index' | 'maintenance'
  sql: string
}

export interface HealthReport {
  cacheHitRatio: number
  databaseSizeBytes: number
  databaseSize: string
  totalTables: number
  totalIndexes: number
  deadTuples: number
  tables: TableStorageStat[]
  unusedIndexes: UnusedIndexStat[]
  recommendations: RemediationAction[]
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

  addProfile(
    dsn: string,
    label: string = '',
    color: string = '#818cf8',
    readOnly: boolean = false,
    environment?: 'production' | 'staging' | 'development' | 'local',
    ssh_tunnel?: SSHTunnelConfig
  ): Promise<ConnectionConfig> {
    return new Promise((resolve, reject) => {
      // Test connection first
      fetch('/api/connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dsn, label, ssh_tunnel }),
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
            environment: environment || (readOnly ? 'production' : 'development'),
            ssh_tunnel,
          }
          const existing = api.getProfiles()
          api.saveProfiles([...existing, profile])
          resolve(profile)
        })
        .catch(reject)
    })
  },

  updateProfile(
    id: string,
    dsn: string,
    label: string = '',
    color: string = '#818cf8',
    readOnly: boolean = false,
    environment?: 'production' | 'staging' | 'development' | 'local',
    ssh_tunnel?: SSHTunnelConfig
  ): Promise<ConnectionConfig> {
    return new Promise((resolve, reject) => {
      fetch('/api/connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dsn, label, ssh_tunnel }),
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
            environment: environment || (readOnly ? 'production' : 'development'),
            ssh_tunnel,
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

  testConnection(dsn: string, label: string = '', ssh_tunnel?: SSHTunnelConfig): Promise<TestConnectionResult> {
    return fetch('/api/connections/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dsn, label, ssh_tunnel }),
    })
      .then(r => r.json())
      .then(json => json.data ?? json)
  },

  async testSSHTunnel(config: SSHTunnelConfig): Promise<TunnelTestResult> {
    const res = await fetch('/api/tunnel/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    const json = await res.json()
    return json.data ?? json
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
  _headers(dsn: string, connId?: string, profiles?: ConnectionConfig[]): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (dsn) {
      headers['X-DBLENS-DSN'] = dsn
    }
    const allProfiles = profiles && profiles.length > 0 ? profiles : this.getProfiles()
    const match = connId
      ? allProfiles.find(p => p.id === connId)
      : allProfiles.find(p => p.dsn === dsn)
    if (match?.readOnly) {
      headers['X-DBLENS-READONLY'] = 'true'
    }
    if (match?.ssh_tunnel?.enabled) {
      headers['X-DBLENS-SSH-TUNNEL'] = JSON.stringify(match.ssh_tunnel)
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
        headers: this._headers(dsn, connId, profiles),
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
        headers: this._headers(dsn, connId, profiles),
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

  async executeQuery(
    connId: string,
    sql: string,
    profilesOrParams?: ConnectionConfig[] | Record<string, any>,
    queryParams?: Record<string, any>
  ): Promise<QueryResult> {
    const start = performance.now()
    let profiles: ConnectionConfig[] | undefined
    let params: Record<string, any> | undefined

    if (Array.isArray(profilesOrParams)) {
      profiles = profilesOrParams
      params = queryParams
    } else if (profilesOrParams && typeof profilesOrParams === 'object') {
      params = profilesOrParams
      profiles = undefined
    } else {
      params = queryParams
    }

    const dsn = this._getDSN(connId, profiles)
    try {
      const payload: { sql: string; params?: Record<string, any> } = { sql }
      if (params && Object.keys(params).length > 0) {
        payload.params = params
      }
      const res = await fetch(`/api/connections/${connId}/query`, {
        method: 'POST',
        headers: this._headers(dsn, connId, profiles),
        body: JSON.stringify(payload),
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
      headers: this._headers(dsn, connId, profiles),
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
        headers: this._headers(dsn, connId, profiles),
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
      headers: this._headers(dsn, connId, profiles),
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
    profiles?: ConnectionConfig[],
    mask?: boolean,
    maskStrategy?: string
  ): Promise<void> {
    const dsn = this._getDSN(connId, profiles)
    const queryParams: Record<string, string> = {
      table,
      schema: schema || '',
      format,
    }
    if (mask) {
      queryParams.mask = 'true'
      if (maskStrategy) {
        queryParams.mask_strategy = maskStrategy
      }
    }
    const params = new URLSearchParams(queryParams)
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

  async downloadDatabaseDump(
    connId: string,
    options: {
      schema?: string
      tables?: string[]
      includeSchema?: boolean
      includeData?: boolean
      gzip?: boolean
      database?: string
    },
    profiles?: ConnectionConfig[]
  ): Promise<void> {
    const dsn = this._getDSN(connId, profiles)
    const params = new URLSearchParams()
    if (options.schema) params.set('schema', options.schema)
    if (options.tables && options.tables.length > 0) {
      params.set('tables', options.tables.join(','))
    }
    if (options.includeSchema !== undefined) {
      params.set('includeSchema', String(options.includeSchema))
    }
    if (options.includeData !== undefined) {
      params.set('includeData', String(options.includeData))
    }
    if (options.gzip !== undefined) {
      params.set('gzip', String(options.gzip))
    }
    if (options.database) {
      params.set('database', options.database)
    }

    const headers: Record<string, string> = {}
    if (dsn) {
      headers['X-DBLENS-DSN'] = dsn
    }

    const res = await fetch(`/api/connections/${connId}/dump?${params.toString()}`, {
      headers,
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Dump failed')
    }

    const disposition = res.headers.get('Content-Disposition')
    let filename = options.gzip ? 'dblens-dump.sql.gz' : 'dblens-dump.sql'
    if (disposition) {
      const match = disposition.match(/filename="?([^";]+)"?/)
      if (match && match[1]) {
        filename = match[1]
      }
    }

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },

  async restoreDatabaseDump(
    connId: string,
    file: File,
    profiles?: ConnectionConfig[]
  ): Promise<{ total: number; executed: number; errors: string[] }> {
    const dsn = this._getDSN(connId, profiles)
    const formData = new FormData()
    formData.append('file', file)
    const headers: Record<string, string> = {}
    if (dsn) {
      headers['X-DBLENS-DSN'] = dsn
    }
    const allProfiles = profiles && profiles.length > 0 ? profiles : this.getProfiles()
    const match = allProfiles.find(p => p.id === connId)
    if (match?.readOnly) {
      headers['X-DBLENS-READONLY'] = 'true'
    }
    const res = await fetch(`/api/connections/${connId}/restore`, {
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
      throw new Error(msg || 'Restore failed')
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

  async getProcesses(
    connId: string,
    profiles?: ConnectionConfig[]
  ): Promise<ProcessInfo[]> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/processes`, {
      headers: this._headers(dsn),
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Failed to fetch processes')
    }
    const json = await res.json()
    return json.data ?? []
  },

  async killProcess(
    connId: string,
    processId: string,
    profiles?: ConnectionConfig[],
    readOnly?: boolean
  ): Promise<{ success: boolean; message: string }> {
    const dsn = this._getDSN(connId, profiles)
    const isReadOnly = readOnly ?? profiles?.find(p => p.id === connId)?.readOnly ?? false
    const headers: Record<string, string> = {
      ...(this._headers(dsn) as Record<string, string>),
    }
    if (isReadOnly) {
      headers['X-DBLENS-READONLY'] = 'true'
    }
    const res = await fetch(`/api/connections/${connId}/processes/kill`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ processId }),
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Failed to kill process')
    }
    const json = await res.json()
    return json.data ?? json
  },

  async getHealth(
    connId: string,
    profiles?: ConnectionConfig[]
  ): Promise<HealthReport> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/health`, {
      headers: this._headers(dsn),
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Failed to fetch database health report')
    }
    const json = await res.json()
    return json.data ?? json
  },

  async detectPII(
    connId: string,
    columns: string[],
    samples?: Record<string, string>,
    profiles?: ConnectionConfig[]
  ): Promise<DetectPIIResponse> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/mask/detect`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ columns, samples }),
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Failed to detect PII')
    }
    const json = await res.json()
    return json.data ?? json
  },

  async previewMask(
    connId: string,
    payload: PreviewMaskPayload,
    profiles?: ConnectionConfig[]
  ): Promise<PreviewMaskResponse> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/mask/preview`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Failed to preview masked data')
    }
    const json = await res.json()
    return json.data ?? json
  },

  async getPrivileges(
    connId: string,
    schema?: string,
    profiles?: ConnectionConfig[]
  ): Promise<PrivilegeReport> {
    const dsn = this._getDSN(connId, profiles)
    const url = schema
      ? `/api/connections/${connId}/privileges?schema=${encodeURIComponent(schema)}`
      : `/api/connections/${connId}/privileges`
    const res = await fetch(url, {
      method: 'GET',
      headers: this._headers(dsn, connId, profiles),
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Failed to get privileges')
    }
    const json = await res.json()
    return json.data ?? json
  },

  async previewPrivileges(
    connId: string,
    payload: { changes: PrivilegeChange[]; roles?: RoleInfo[] },
    profiles?: ConnectionConfig[]
  ): Promise<PrivilegePlan> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/privileges/preview`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Failed to preview privileges')
    }
    const json = await res.json()
    return json.data ?? json
  },

  async applyPrivileges(
    connId: string,
    payload: { plan?: PrivilegePlan; changes?: PrivilegeChange[]; roles?: RoleInfo[] },
    profiles?: ConnectionConfig[]
  ): Promise<{ success: boolean; executedStatements: number }> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/privileges/apply`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {}
      throw new Error(msg || 'Failed to apply privileges')
    }
    const json = await res.json()
    return json.data ?? json
  },

  async getAssistantSchema(
    connId: string,
    schema?: string,
    profiles?: ConnectionConfig[]
  ): Promise<AssistantSchemaContext> {
    const dsn = this._getDSN(connId, profiles)
    const url = schema
      ? `/api/connections/${connId}/assistant/schema?schema=${encodeURIComponent(schema)}`
      : `/api/connections/${connId}/assistant/schema`
    const r = await fetch(url, { headers: this._headers(dsn, connId, profiles) })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || `Failed to fetch assistant schema (${r.status})`)
    }
    const json = await r.json()
    return json.data ?? json
  },

  async buildAssistantPrompt(
    connId: string,
    payload: {
      op?: 'generate' | 'fix' | 'explain'
      prompt?: string
      query?: string
      error?: string
      schema?: string
    },
    profiles?: ConnectionConfig[]
  ): Promise<string> {
    const dsn = this._getDSN(connId, profiles)
    const r = await fetch(`/api/connections/${connId}/assistant/prompt`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || `Failed to build prompt (${r.status})`)
    }
    const json = await r.json()
    const data = json.data ?? json
    return data.prompt ?? ''
  },

  async generateSqlWithAI(
    connId: string,
    payload: {
      prompt: string
      schema?: string
      config?: AIAssistantConfig
    },
    profiles?: ConnectionConfig[]
  ): Promise<AssistantGenerateResponse> {
    const dsn = this._getDSN(connId, profiles)
    const r = await fetch(`/api/connections/${connId}/assistant/generate`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || `Failed to generate SQL (${r.status})`)
    }
    const json = await r.json()
    return json.data ?? json
  },

  async fixSqlWithAI(
    connId: string,
    payload: {
      query: string
      error: string
      schema?: string
      config?: AIAssistantConfig
    },
    profiles?: ConnectionConfig[]
  ): Promise<AssistantFixResponse> {
    const dsn = this._getDSN(connId, profiles)
    const r = await fetch(`/api/connections/${connId}/assistant/fix`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || `Failed to fix SQL (${r.status})`)
    }
    const json = await r.json()
    return json.data ?? json
  },

  async explainSqlWithAI(
    connId: string,
    payload: {
      query: string
      schema?: string
      config?: AIAssistantConfig
    },
    profiles?: ConnectionConfig[]
  ): Promise<AssistantExplainResponse> {
    const dsn = this._getDSN(connId, profiles)
    const r = await fetch(`/api/connections/${connId}/assistant/explain`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || `Failed to explain SQL (${r.status})`)
    }
    const json = await r.json()
    return json.data ?? json
  },

  async getWebhooks(connId: string, profiles?: ConnectionConfig[]): Promise<Webhook[]> {
    const dsn = this._getDSN(connId, profiles)
    const r = await fetch(`/api/connections/${connId}/webhooks`, {
      headers: this._headers(dsn, connId, profiles),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || `Failed to fetch webhooks (${r.status})`)
    }
    const json = await r.json()
    return json.data ?? json
  },

  async createWebhook(
    connId: string,
    data: Partial<Webhook>,
    profiles?: ConnectionConfig[]
  ): Promise<Webhook> {
    const dsn = this._getDSN(connId, profiles)
    const r = await fetch(`/api/connections/${connId}/webhooks`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || `Failed to create webhook (${r.status})`)
    }
    const json = await r.json()
    return json.data ?? json
  },

  async updateWebhook(
    connId: string,
    id: string,
    data: Partial<Webhook>,
    profiles?: ConnectionConfig[]
  ): Promise<Webhook> {
    const dsn = this._getDSN(connId, profiles)
    const r = await fetch(`/api/connections/${connId}/webhooks/${id}`, {
      method: 'PUT',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || `Failed to update webhook (${r.status})`)
    }
    const json = await r.json()
    return json.data ?? json
  },

  async deleteWebhook(
    connId: string,
    id: string,
    profiles?: ConnectionConfig[]
  ): Promise<{ success: boolean }> {
    const dsn = this._getDSN(connId, profiles)
    const r = await fetch(`/api/connections/${connId}/webhooks/${id}`, {
      method: 'DELETE',
      headers: this._headers(dsn, connId, profiles),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || `Failed to delete webhook (${r.status})`)
    }
    const json = await r.json()
    return json.data ?? json
  },

  async getWebhookDeliveries(
    connId: string,
    profiles?: ConnectionConfig[]
  ): Promise<WebhookDelivery[]> {
    const dsn = this._getDSN(connId, profiles)
    const r = await fetch(`/api/connections/${connId}/webhooks/deliveries`, {
      headers: this._headers(dsn, connId, profiles),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || `Failed to fetch deliveries (${r.status})`)
    }
    const json = await r.json()
    return json.data ?? json
  },

  async retryWebhookDelivery(
    connId: string,
    id: string,
    profiles?: ConnectionConfig[]
  ): Promise<WebhookDelivery> {
    const dsn = this._getDSN(connId, profiles)
    const r = await fetch(`/api/connections/${connId}/webhooks/deliveries/${id}/retry`, {
      method: 'POST',
      headers: this._headers(dsn, connId, profiles),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || `Failed to retry delivery (${r.status})`)
    }
    const json = await r.json()
    return json.data ?? json
  },

  async simulateWebhook(
    connId: string,
    payload: SimulateWebhookRequest,
    profiles?: ConnectionConfig[]
  ): Promise<SimulateWebhookResponse> {
    const dsn = this._getDSN(connId, profiles)
    const r = await fetch(`/api/connections/${connId}/webhooks/simulate`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || `Failed to simulate webhook (${r.status})`)
    }
    const json = await r.json()
    return json.data ?? json
  },

  async executeFederatedQuery(
    req: FederatedQueryRequest,
    profiles?: ConnectionConfig[]
  ): Promise<FederatedQueryResponse> {
    const connections: FederatedConnectionProfile[] = (req.connections || profiles || []).map((p) => ({
      id: p.id,
      dsn: p.dsn,
      label: p.label || p.id,
    }))
    const res = await fetch('/api/federation/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...req, connections }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Federated query failed (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async executeDataPipe(
    req: DataPipeRequest,
    profiles?: ConnectionConfig[]
  ): Promise<DataPipeResponse> {
    const srcDsn = req.sourceDsn || (req.sourceConnId ? this._getDSN(req.sourceConnId, profiles) : '')
    const tgtDsn = req.targetDsn || (req.targetConnId ? this._getDSN(req.targetConnId, profiles) : '')
    const payload: DataPipeRequest = {
      ...req,
      sourceDsn: srcDsn,
      targetDsn: tgtDsn,
    }
    const res = await fetch('/api/federation/pipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Data pipe execution failed (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async reconcileTables(
    req: ReconcileRequest,
    profiles?: ConnectionConfig[]
  ): Promise<ReconcileResponse> {
    const srcDsn = req.sourceDsn || (req.sourceConnId ? this._getDSN(req.sourceConnId, profiles) : '')
    const tgtDsn = req.targetDsn || (req.targetConnId ? this._getDSN(req.targetConnId, profiles) : '')
    const payload: ReconcileRequest = {
      ...req,
      sourceDsn: srcDsn,
      targetDsn: tgtDsn,
    }
    const res = await fetch('/api/federation/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Reconciliation failed (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },
}

export interface ColumnPIIInfo {
  column: string
  pii_type: string
  is_pii: boolean
}

export interface DetectPIIResponse {
  detected: Record<string, string>
  columns: ColumnPIIInfo[]
}

export interface PreviewMaskPayload {
  strategy?: string
  columns?: string[]
  rows?: Record<string, any>[]
  table?: string
  schema?: string
  limit?: number
}

export interface PreviewMaskResponse {
  strategy: string
  columns?: string[]
  rows: Record<string, any>[]
}

export interface RoleInfo {
  name: string
  isSuperuser: boolean
  canLogin: boolean
  connectionLimit: number
  inherit?: boolean
  createDb?: boolean
  createRole?: boolean
  attributes?: Record<string, any>
}

export interface TablePrivilege {
  grantee: string
  tableSchema: string
  tableName: string
  privilegeType: string
  isGrantable: boolean
}

export interface PrivilegeReport {
  dialect: string
  roles: RoleInfo[]
  tablePrivileges: TablePrivilege[]
  tables: string[]
  supportedPrivileges: string[]
}

export interface PrivilegeChange {
  role: string
  schema: string
  table: string
  privilege: string
  action: 'GRANT' | 'REVOKE'
  withGrantOption?: boolean
}

export interface SafetyWarning {
  level: 'critical' | 'warning' | 'info'
  role: string
  message: string
}

export interface PrivilegePlan {
  statements: string[]
  warnings: SafetyWarning[]
  dangerous: boolean
  affectedRoles: string[]
}

export interface CompactColumn {
  name: string
  type: string
  pk?: boolean
  nullable?: boolean
}

export interface CompactFK {
  column: string
  refTable: string
  refColumn: string
}

export interface CompactTable {
  name: string
  schema?: string
  columns: CompactColumn[]
  fks?: CompactFK[]
}

export interface AssistantSchemaContext {
  tables: CompactTable[]
  ddl: string
}

export interface AssistantGenerateResponse {
  sql: string
  raw?: string
}

export interface AssistantFixResponse {
  sql: string
  raw?: string
}

export interface AssistantExplainResponse {
  explanation: string
  raw?: string
}

export interface Webhook {
  id: string
  connection_id: string
  name: string
  url: string
  secret?: string
  events: string[]
  tables: string[]
  enabled: boolean
  headers?: Record<string, string>
  created_at?: string
}

export interface WebhookDelivery {
  id: string
  webhook_id?: string
  webhook_name?: string
  connection_id?: string
  event: string
  url: string
  request_payload: string
  response_status_code: number
  response_body: string
  latency_ms: number
  error?: string
  timestamp: string
}

export interface SimulateWebhookRequest {
  webhook_id?: string
  url?: string
  secret?: string
  event: 'INSERT' | 'UPDATE' | 'DELETE' | string
  schema?: string
  table: string
  old_record?: Record<string, any>
  new_record?: Record<string, any>
}

export interface SimulateWebhookResponse {
  delivery: WebhookDelivery
  success: boolean
  error?: string
}

// ── Multi-Connection Query Federation & Data Pipe ──

export interface FederatedConnectionProfile {
  id: string
  dsn: string
  label?: string
}

export interface FederatedTableStat {
  connId: string
  schema?: string
  table: string
  tempTable: string
  rowCount: number
  elapsedMs: number
}

export interface FederatedQueryRequest {
  query: string
  limit?: number
  connections?: FederatedConnectionProfile[]
  dsns?: Record<string, string>
}

export interface FederatedQueryResponse {
  result: QueryResult
  tableStats: FederatedTableStat[]
  rewrittenSql: string
  elapsedMs: number
}

export interface DataPipeRequest {
  sourceConnId: string
  sourceDsn?: string
  sourceSchema?: string
  sourceTable: string
  targetConnId: string
  targetDsn?: string
  targetSchema?: string
  targetTable?: string
  createTable?: boolean
  truncateTable?: boolean
  batchSize?: number
}

export interface DataPipeResponse {
  rowsMigrated: number
  elapsedMs: number
  sourceTable: string
  targetTable: string
  message: string
}

export interface ColumnReconcileDiff {
  name: string
  sourceType: string
  targetType: string
  sourceNullable: boolean
  targetNullable: boolean
  sourcePrimary: boolean
  targetPrimary: boolean
  match: boolean
  status: 'MATCH' | 'TYPE_MISMATCH' | 'MISSING_IN_TARGET' | 'MISSING_IN_SOURCE' | 'CONSTRAINT_MISMATCH' | string
}

export interface RowSampleDiff {
  rowIndex: number
  source: Record<string, any>
  target: Record<string, any>
  diffCols: string[]
}

export interface ReconcileRequest {
  sourceConnId: string
  sourceDsn?: string
  sourceSchema?: string
  sourceTable: string
  targetConnId: string
  targetDsn?: string
  targetSchema?: string
  targetTable?: string
  sampleLimit?: number
}

export interface ReconcileResponse {
  status: 'IDENTICAL' | 'SCHEMA_MISMATCH' | 'ROW_COUNT_MISMATCH' | 'DATA_MISMATCH' | string
  sourceTable: string
  targetTable: string
  sourceRowCount: number
  targetRowCount: number
  rowCountDiff: number
  sourceChecksum: string
  targetChecksum: string
  checksumMatch: boolean
  columnComparison: ColumnReconcileDiff[]
  missingInTarget: string[]
  missingInSource: string[]
  sampleCompared: number
  sampleMatched: number
  sampleMismatched: number
  sampleDiffs?: RowSampleDiff[]
  elapsedMs: number
}


