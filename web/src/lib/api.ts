export type DatabaseDriver = 'postgres' | 'mysql' | 'sqlite'
import type { AIAssistantConfig } from '../features/editor/aiAssistant'
import type { GISParseResponse, GISConvertResponse } from '../features/gis/gisHelper'
import type {
  RoutineItem,
  RoutineArg,
  TriggerItem,
  ViewItem,
  InvokeRoutineRequest,
  InvokeRoutineResponse,
  SaveRoutinePayload,
  ToggleTriggerRequest,
  RefreshViewRequest,
} from '../features/routine/routineHelper'
import type {
  ProfileReport,
  ProfileRequest,
  Suggestion as ProfileSuggestion,
  CompareResult as ProfileCompareResult,
} from '../features/profile/profileHelper'
import type {
  MaterializeRequest,
  MaterializePreview,
  MaterializeResult,
  ScratchTable,
} from '../features/materialize/materializeHelper'
import type {
  RuleSetting,
  RuleMeta,
  AnalyzeResult,
  GateRequest,
  GateResult,
} from '../features/lint/lintRules'
import type {
  ImpactGraph,
  RemediationPlan,
  RenamePlan,
  RenameRequest,
} from '../features/impact/impactHelper'
import type {
  PushdownRequest,
  PushdownResult,
} from '../features/pivot/pivotHelper'
import type {
  PlanDiffRequest,
  PlanDiffResult,
  IndexRecommendation,
} from '../features/plandiff/planDiffHelper'
import type {
  DataDiffRequest,
  DataDiffResult,
  SyncScriptRequest,
  SyncScriptResponse,
  ApplySyncRequest,
  ApplySyncResponse,
} from '../features/datadiff/dataDiffHelper'

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
    if (match?.environment) {
      headers['X-DBLENS-ENVIRONMENT'] = match.environment
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

  async parseGIS(
    connId: string,
    data: string,
    srid?: number,
    profiles?: ConnectionConfig[]
  ): Promise<GISParseResponse> {
    const dsn = connId ? this._getDSN(connId, profiles) : ''
    const url = connId ? `/api/connections/${connId}/gis/parse` : '/api/gis/parse'
    const res = await fetch(url, {
      method: 'POST',
      headers: this._headers(dsn, connId, profiles),
      body: JSON.stringify({ data, srid }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `GIS parse failed (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async convertGIS(
    connId: string,
    data: string,
    targetFormat: string,
    targetSrid?: number,
    dialect?: string,
    profiles?: ConnectionConfig[]
  ): Promise<GISConvertResponse> {
    const dsn = connId ? this._getDSN(connId, profiles) : ''
    const url = connId ? `/api/connections/${connId}/gis/convert` : '/api/gis/convert'
    const res = await fetch(url, {
      method: 'POST',
      headers: this._headers(dsn, connId, profiles),
      body: JSON.stringify({
        data,
        target_format: targetFormat,
        target_srid: targetSrid,
        dialect,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `GIS convert failed (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async getMigrations(
    connId: string,
    profiles?: ConnectionConfig[]
  ): Promise<MigrationListResponse> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/migrations`, {
      headers: this._headers(dsn, connId, profiles),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to fetch migrations (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async initMigrationTracker(
    connId: string,
    profiles?: ConnectionConfig[]
  ): Promise<{ message: string; initialized: boolean }> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/migrations/init`, {
      method: 'POST',
      headers: this._headers(dsn, connId, profiles),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to initialize migration tracker (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async generateMigration(
    connId: string,
    req: GenerateMigrationRequest,
    profiles?: ConnectionConfig[]
  ): Promise<MigrationBundle> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/migrations/generate`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to generate migration bundle (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async applyMigration(
    connId: string,
    req: ApplyMigrationRequest,
    profiles?: ConnectionConfig[]
  ): Promise<MigrationRecord> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/migrations/apply`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to apply migration (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async rollbackMigration(
    connId: string,
    version?: string,
    profiles?: ConnectionConfig[]
  ): Promise<MigrationRecord> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/migrations/rollback`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ version }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to rollback migration (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  // ── Feature-29: Stored Procedure, Function, View & Trigger Studio ──
  async getRoutines(
    connId: string,
    schema?: string,
    profiles?: ConnectionConfig[]
  ): Promise<RoutineItem[]> {
    const dsn = this._getDSN(connId, profiles)
    const schemaParam = schema ? `?schema=${encodeURIComponent(schema)}` : ''
    const res = await fetch(`/api/connections/${connId}/routines${schemaParam}`, {
      headers: this._headers(dsn, connId, profiles),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to fetch routines (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async getRoutineDetail(
    connId: string,
    schema: string,
    name: string,
    profiles?: ConnectionConfig[]
  ): Promise<RoutineItem> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/routines/${encodeURIComponent(schema)}/${encodeURIComponent(name)}`, {
      headers: this._headers(dsn, connId, profiles),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to fetch routine detail (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async invokeRoutine(
    connId: string,
    req: InvokeRoutineRequest,
    profiles?: ConnectionConfig[]
  ): Promise<InvokeRoutineResponse> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/routines/invoke`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Routine invocation failed (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async saveRoutine(
    connId: string,
    ddl: string,
    profiles?: ConnectionConfig[]
  ): Promise<{ message: string }> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/routines/save`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ddl }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to save routine (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async deleteRoutine(
    connId: string,
    schema: string,
    name: string,
    routineType?: string,
    profiles?: ConnectionConfig[]
  ): Promise<{ message: string }> {
    const dsn = this._getDSN(connId, profiles)
    const typeParam = routineType ? `?type=${encodeURIComponent(routineType)}` : ''
    const res = await fetch(`/api/connections/${connId}/routines/${encodeURIComponent(schema)}/${encodeURIComponent(name)}${typeParam}`, {
      method: 'DELETE',
      headers: this._headers(dsn, connId, profiles),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to delete routine (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async getTriggers(
    connId: string,
    schema?: string,
    table?: string,
    profiles?: ConnectionConfig[]
  ): Promise<TriggerItem[]> {
    const dsn = this._getDSN(connId, profiles)
    const params = new URLSearchParams()
    if (schema) params.set('schema', schema)
    if (table) params.set('table', table)
    const qs = params.toString() ? `?${params.toString()}` : ''
    const res = await fetch(`/api/connections/${connId}/triggers${qs}`, {
      headers: this._headers(dsn, connId, profiles),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to fetch triggers (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async toggleTrigger(
    connId: string,
    req: ToggleTriggerRequest,
    profiles?: ConnectionConfig[]
  ): Promise<{ message: string }> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/triggers/toggle`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to toggle trigger (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async deleteTrigger(
    connId: string,
    schema: string,
    name: string,
    table?: string,
    profiles?: ConnectionConfig[]
  ): Promise<{ message: string }> {
    const dsn = this._getDSN(connId, profiles)
    const tableParam = table ? `?table=${encodeURIComponent(table)}` : ''
    const res = await fetch(`/api/connections/${connId}/triggers/${encodeURIComponent(schema)}/${encodeURIComponent(name)}${tableParam}`, {
      method: 'DELETE',
      headers: this._headers(dsn, connId, profiles),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to delete trigger (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async getViews(
    connId: string,
    schema?: string,
    profiles?: ConnectionConfig[]
  ): Promise<ViewItem[]> {
    const dsn = this._getDSN(connId, profiles)
    const schemaParam = schema ? `?schema=${encodeURIComponent(schema)}` : ''
    const res = await fetch(`/api/connections/${connId}/views${schemaParam}`, {
      headers: this._headers(dsn, connId, profiles),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to fetch views (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async refreshView(
    connId: string,
    req: RefreshViewRequest,
    profiles?: ConnectionConfig[]
  ): Promise<{ message: string }> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/views/refresh`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to refresh view (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  // ── Feature-30: Cron Jobs ──
  async listCronJobs(): Promise<CronJob[]> {
    const r = await fetch('/api/cron/jobs')
    if (!r.ok) throw new Error(`Failed to fetch cron jobs (${r.status})`)
    const json = await r.json()
    return json.data ?? json
  },

  async createCronJob(job: Partial<CronJob>): Promise<CronJob> {
    const r = await fetch('/api/cron/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    })
    const json = await r.json()
    if (!r.ok) throw new Error(json.error || `Failed to create cron job (${r.status})`)
    return json.data ?? json
  },

  async updateCronJob(id: string, job: Partial<CronJob>): Promise<CronJob> {
    const r = await fetch(`/api/cron/jobs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    })
    const json = await r.json()
    if (!r.ok) throw new Error(json.error || `Failed to update cron job (${r.status})`)
    return json.data ?? json
  },

  async deleteCronJob(id: string): Promise<void> {
    const r = await fetch(`/api/cron/jobs/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(`Failed to delete cron job (${r.status})`)
  },

  async runCronJobNow(id: string): Promise<void> {
    const r = await fetch(`/api/cron/jobs/${id}/run`, { method: 'POST' })
    if (!r.ok) throw new Error(`Failed to trigger cron job (${r.status})`)
  },

  async getCronJobHistory(id: string): Promise<CronJobRun[]> {
    const r = await fetch(`/api/cron/jobs/${id}/history`)
    if (!r.ok) throw new Error(`Failed to fetch cron history (${r.status})`)
    const json = await r.json()
    return json.data ?? json
  },

  async listAuditLog(filters: {
    connId?: string
    queryType?: string
    actorIp?: string
    from?: string
    to?: string
    limit?: number
  }): Promise<AuditEntry[]> {
    const params = new URLSearchParams()
    if (filters.connId) params.set('conn_id', filters.connId)
    if (filters.queryType) params.set('query_type', filters.queryType)
    if (filters.actorIp) params.set('actor_ip', filters.actorIp)
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
    if (filters.limit) params.set('limit', String(filters.limit))
    const r = await fetch(`/api/audit/entries?${params.toString()}`)
    if (!r.ok) throw new Error(`Failed to fetch audit log (${r.status})`)
    const json = await r.json()
    return json.data ?? json
  },

  async verifyAuditChain(): Promise<AuditVerifyResult> {
    const r = await fetch('/api/audit/verify')
    if (!r.ok) throw new Error(`Failed to verify audit chain (${r.status})`)
    const json = await r.json()
    return json.data ?? json
  },

  // Feature-32: Live Feed
  async liveFeedStatus(): Promise<{ active_feeds: number }> {
    const r = await fetch('/api/live-feed/status')
    if (!r.ok) throw new Error(`Failed to get live feed status (${r.status})`)
    return r.json()
  },

  // ── Feature-33: Playbook ──────────────────────────────────────────────────
  async listPlaybookEntries(tag?: string, q?: string): Promise<PlaybookEntry[]> {
    const params = new URLSearchParams()
    if (tag) params.set('tag', tag)
    if (q) params.set('q', q)
    const r = await fetch(`/api/playbook/entries?${params}`)
    if (!r.ok) throw new Error(`Failed to list playbook (${r.status})`)
    const json = await r.json()
    return json.data ?? json
  },
  async createPlaybookEntry(entry: Partial<PlaybookEntry>): Promise<PlaybookEntry> {
    const r = await fetch('/api/playbook/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    })
    const json = await r.json()
    if (!r.ok) throw new Error(json.error || `Failed to create entry (${r.status})`)
    return json.data ?? json
  },
  async getPlaybookEntry(id: string): Promise<PlaybookEntry> {
    const r = await fetch(`/api/playbook/entries/${id}`)
    const json = await r.json()
    if (!r.ok) throw new Error(json.error || `Failed to get entry (${r.status})`)
    return json.data ?? json
  },
  async updatePlaybookEntry(id: string, entry: Partial<PlaybookEntry>): Promise<PlaybookEntry> {
    const r = await fetch(`/api/playbook/entries/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    })
    const json = await r.json()
    if (!r.ok) throw new Error(json.error || `Failed to update entry (${r.status})`)
    return json.data ?? json
  },
  async deletePlaybookEntry(id: string): Promise<void> {
    const r = await fetch(`/api/playbook/entries/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(`Failed to delete entry (${r.status})`)
  },
  async getPlaybookShareUri(id: string): Promise<string> {
    const r = await fetch(`/api/playbook/entries/${id}/share`)
    const json = await r.json()
    if (!r.ok) throw new Error(json.error || `Failed to get share URI (${r.status})`)
    return (json.data ?? json).uri
  },
  async importPlaybook(entries: Partial<PlaybookEntry>[]): Promise<{ imported: number }> {
    const r = await fetch('/api/playbook/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    })
    const json = await r.json()
    if (!r.ok) throw new Error(json.error || `Failed to import (${r.status})`)
    return json.data ?? json
  },

  // ── Feature-34: Table Annotations & Collaborative Notes ─────────────────
  async listAnnotations(filters?: { conn?: string; schema?: string; table?: string; q?: string }): Promise<Annotation[]> {
    const params = new URLSearchParams()
    if (filters?.conn) params.set('conn', filters.conn)
    if (filters?.schema) params.set('schema', filters.schema)
    if (filters?.table) params.set('table', filters.table)
    if (filters?.q) params.set('q', filters.q)
    const r = await fetch(`/api/annotations?${params}`)
    if (!r.ok) throw new Error(`Failed to list annotations (${r.status})`)
    const json = await r.json()
    return json.data ?? json
  },
  async createAnnotation(annotation: Partial<Annotation>): Promise<Annotation> {
    const r = await fetch('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(annotation),
    })
    const json = await r.json()
    if (!r.ok) throw new Error(json.error || `Failed to create annotation (${r.status})`)
    return json.data ?? json
  },
  async updateAnnotation(id: string, patch: Partial<Annotation>): Promise<Annotation> {
    const r = await fetch(`/api/annotations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const json = await r.json()
    if (!r.ok) throw new Error(json.error || `Failed to update annotation (${r.status})`)
    return json.data ?? json
  },
  async deleteAnnotation(id: string): Promise<void> {
    const r = await fetch(`/api/annotations/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(`Failed to delete annotation (${r.status})`)
  },
  annotationExportUrl(): string {
    return '/api/annotations/export.md'
  },

  // ── Feature-35: Connection Health Dashboard ──────────────────────────────
  async getConnectionHealth(): Promise<HealthPayload> {
    const r = await fetch('/api/health/connections')
    if (!r.ok) throw new Error(`Failed to load connection health (${r.status})`)
    const json = await r.json()
    return json.data ?? json
  },

  /** SSE endpoint for live health pushes (EventSource sends no headers, and the
   *  server-side monitor needs no DSN: it probes the pool the server already holds). */
  healthStreamUrl(): string {
    return '/api/health/stream'
  },

  // ── Feature-36: Column Data Profiling & Quality Studio ──
  async profileTable(
    connId: string,
    dsn: string,
    req: ProfileRequest,
    profiles?: ConnectionConfig[]
  ): Promise<ProfileReport> {
    const res = await fetch(`/api/connections/${connId}/profile`, {
      method: 'POST',
      headers: this._headers(dsn, connId, profiles),
      body: JSON.stringify(req),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to profile table (${res.status})`)
    return json.data ?? json
  },

  async profileSuggest(
    connId: string,
    dsn: string,
    target: ProfileRequest | ProfileReport,
    profiles?: ConnectionConfig[]
  ): Promise<ProfileSuggestion[]> {
    const res = await fetch(`/api/connections/${connId}/profile/suggest`, {
      method: 'POST',
      headers: this._headers(dsn, connId, profiles),
      body: JSON.stringify(target),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to generate suggestions (${res.status})`)
    return json.data ?? json
  },

  async profileCompare(
    connId: string,
    dsn: string,
    req: {
      baseTable: string
      targetTable: string
      baseSchema?: string
      targetSchema?: string
      baseReport?: ProfileReport
      targetReport?: ProfileReport
    },
    profiles?: ConnectionConfig[]
  ): Promise<ProfileCompareResult> {
    const res = await fetch(`/api/connections/${connId}/profile/compare`, {
      method: 'POST',
      headers: this._headers(dsn, connId, profiles),
      body: JSON.stringify(req),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to compare profiles (${res.status})`)
    return json.data ?? json
  },

  async exportProfileMarkdown(
    connId: string,
    dsn: string,
    table: string,
    schema?: string,
    report?: ProfileReport,
    profiles?: ConnectionConfig[]
  ): Promise<string> {
    let url = `/api/connections/${connId}/profile/export.md?table=${encodeURIComponent(table)}`
    if (schema) url += `&schema=${encodeURIComponent(schema)}`
    const opts: RequestInit = {
      method: report ? 'POST' : 'GET',
      headers: this._headers(dsn, connId, profiles),
    }
    if (report) {
      opts.body = JSON.stringify(report)
    }
    const res = await fetch(url, opts)
    if (!res.ok) throw new Error(`Failed to export markdown (${res.status})`)
    return await res.text()
  },

  async materializePreview(
    connId: string,
    req: MaterializeRequest,
    profiles?: ConnectionConfig[]
  ): Promise<MaterializePreview> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/materialize/preview`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to preview materialization (${res.status})`)
    return json.data ?? json
  },

  async materializeExecute(
    connId: string,
    req: MaterializeRequest,
    profiles?: ConnectionConfig[]
  ): Promise<MaterializeResult> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/materialize`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to execute materialization (${res.status})`)
    return json.data ?? json
  },

  async getScratchTables(
    connId: string,
    profiles?: ConnectionConfig[]
  ): Promise<ScratchTable[]> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/materialize/scratch`, {
      headers: this._headers(dsn, connId, profiles),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to fetch scratch tables (${res.status})`)
    return json.data ?? json ?? []
  },

  async deleteScratchTable(
    connId: string,
    schema: string,
    table: string,
    profiles?: ConnectionConfig[]
  ): Promise<{ success: boolean; message: string }> {
    const dsn = this._getDSN(connId, profiles)
    const path = schema
      ? `/api/connections/${connId}/materialize/scratch/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`
      : `/api/connections/${connId}/materialize/scratch/${encodeURIComponent(table)}`
    const res = await fetch(path, {
      method: 'DELETE',
      headers: this._headers(dsn, connId, profiles),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to delete scratch table (${res.status})`)
    return json
  },

  async promoteScratchTable(
    connId: string,
    schema: string,
    table: string,
    profiles?: ConnectionConfig[]
  ): Promise<{ migrationSql: string; message: string }> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/materialize/scratch/promote`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ schema, table }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to promote scratch table (${res.status})`)
    return json.data ?? json
  },

  async expireScratchTables(
    connId: string,
    profiles?: ConnectionConfig[]
  ): Promise<{ dropped: number; message: string }> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/materialize/scratch/expire`, {
      method: 'POST',
      headers: this._headers(dsn, connId, profiles),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to expire scratch tables (${res.status})`)
    return json.data ?? json
  },

  // ── Feature-38: In-Editor SQL Static Analyzer & Quality Gate ─────────
  async analyzeSql(
    connId: string,
    payload: {
      sql: string
      dialect?: string
      schema?: string
      known_tables?: string[]
      known_cols?: Record<string, string[]>
      rule_config?: Record<string, RuleSetting>
    },
    profiles?: ConnectionConfig[]
  ): Promise<AnalyzeResult> {
    const dsn = this._getDSN(connId, profiles)
    const endpoint = connId && connId !== 'none'
      ? `/api/connections/${connId}/analyze`
      : '/api/analyze'
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to analyze SQL (${res.status})`)
    return json.data ?? json
  },

  async getLintRules(): Promise<RuleMeta[]> {
    const res = await fetch('/api/analyze/rules')
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to fetch analyzer rules (${res.status})`)
    return json.data ?? json
  },

  async updateLintRules(rules: Record<string, RuleSetting>): Promise<RuleMeta[]> {
    const res = await fetch('/api/analyze/rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rules),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to update analyzer rules (${res.status})`)
    return json.data ?? json
  },

  async evaluateQualityGate(
    connId: string,
    payload: GateRequest,
    profiles?: ConnectionConfig[]
  ): Promise<GateResult> {
    const dsn = this._getDSN(connId, profiles)
    const endpoint = connId && connId !== 'none'
      ? `/api/connections/${connId}/analyze/gate`
      : '/api/analyze/gate'
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Quality gate request failed (${res.status})`)
    return json.data ?? json
  },

  // ── Feature-40: Schema Object Impact Analyzer & Safe-Drop Planner ────
  async getImpact(
    connId: string,
    params: {
      schema?: string
      object: string
      object_type?: string
      column?: string
      depth?: number
    },
    profiles?: ConnectionConfig[]
  ): Promise<ImpactGraph> {
    const dsn = this._getDSN(connId, profiles)
    const sp = new URLSearchParams()
    if (params.schema) sp.set('schema', params.schema)
    if (params.object) sp.set('object', params.object)
    if (params.object_type) sp.set('object_type', params.object_type)
    if (params.column) sp.set('column', params.column)
    if (params.depth) sp.set('depth', String(params.depth))

    const res = await fetch(`/api/connections/${connId}/impact?${sp.toString()}`, {
      method: 'GET',
      headers: this._headers(dsn, connId, profiles),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to analyze impact (${res.status})`)
    return json.data ?? json
  },

  async createImpactPlan(
    connId: string,
    payload: {
      schema?: string
      object: string
      object_type?: string
      column?: string
      depth?: number
      cascade?: boolean
      graph?: ImpactGraph
    },
    profiles?: ConnectionConfig[]
  ): Promise<RemediationPlan> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/impact/plan`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to create remediation plan (${res.status})`)
    return json.data ?? json
  },

  async createImpactRename(
    connId: string,
    payload: RenameRequest,
    profiles?: ConnectionConfig[]
  ): Promise<RenamePlan> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/impact/rename`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Failed to generate rename plan (${res.status})`)
    return json.data ?? json
  },

  async exportImpactMD(
    connId: string,
    params: {
      schema?: string
      object: string
      object_type?: string
      column?: string
      cascade?: boolean
      depth?: number
      graph?: ImpactGraph
    },
    profiles?: ConnectionConfig[]
  ): Promise<string> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/impact/export.md`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(err || `Failed to export impact report (${res.status})`)
    }
    return await res.text()
  },

  async pivotPushdown(
    connId: string | undefined,
    req: PushdownRequest,
    profiles?: ConnectionConfig[]
  ): Promise<PushdownResult> {
    const dsn = connId ? this._getDSN(connId, profiles) : ''
    const endpoint = connId
      ? `/api/connections/${connId}/pivot/pushdown`
      : '/api/pivot/pushdown'
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: this._headers(dsn, connId, profiles),
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Pushdown request failed (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async pivotRun(
    connId: string,
    req: PushdownRequest,
    profiles?: ConnectionConfig[]
  ): Promise<any> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/pivot/run`, {
      method: 'POST',
      headers: this._headers(dsn, connId, profiles),
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Server query failed (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async comparePlanDiff(
    connId: string,
    req: PlanDiffRequest,
    profiles?: ConnectionConfig[]
  ): Promise<PlanDiffResult> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/plandiff/compare`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Plan diff comparison failed (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async advisePlanDiff(
    connId: string,
    req: Partial<PlanDiffRequest>,
    profiles?: ConnectionConfig[]
  ): Promise<IndexRecommendation[]> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/plandiff/advise`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to fetch index advice (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async applyPlanIndex(
    connId: string,
    ddl: string,
    profiles?: ConnectionConfig[]
  ): Promise<{ success: boolean; message: string; ddl: string }> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/plandiff/apply-index`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ddl }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to apply index (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async exportPlanDiffMd(
    connId: string,
    diff: PlanDiffResult,
    profiles?: ConnectionConfig[]
  ): Promise<string> {
    const dsn = this._getDSN(connId, profiles)
    const res = await fetch(`/api/connections/${connId}/plandiff/export.md`, {
      method: 'POST',
      headers: {
        ...(this._headers(dsn, connId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(diff),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(err || `Failed to export plan diff report (${res.status})`)
    }
    return await res.text()
  },

  async compareDataDiff(
    req: DataDiffRequest,
    profiles?: ConnectionConfig[]
  ): Promise<DataDiffResult> {
    const srcDSN = this._getDSN(req.sourceConnId, profiles)
    const res = await fetch('/api/datadiff/compare', {
      method: 'POST',
      headers: {
        ...(this._headers(srcDSN, req.sourceConnId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Data diff comparison failed (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async generateDataDiffSync(
    req: SyncScriptRequest,
    profiles?: ConnectionConfig[]
  ): Promise<SyncScriptResponse> {
    const tgtDSN = this._getDSN(req.targetConnId || req.sourceConnId || '', profiles)
    const res = await fetch('/api/datadiff/generate-sync', {
      method: 'POST',
      headers: {
        ...(this._headers(tgtDSN, req.targetConnId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Sync script generation failed (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async applyDataDiffSync(
    req: ApplySyncRequest,
    profiles?: ConnectionConfig[]
  ): Promise<ApplySyncResponse> {
    const tgtDSN = this._getDSN(req.targetConnId, profiles)
    const res = await fetch('/api/datadiff/apply-sync', {
      method: 'POST',
      headers: {
        ...(this._headers(tgtDSN, req.targetConnId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Applying sync failed (${res.status})`)
    }
    const json = await res.json()
    return json.data ?? json
  },

  async exportDataDiffSQL(
    req: SyncScriptRequest,
    profiles?: ConnectionConfig[]
  ): Promise<string> {
    const tgtDSN = this._getDSN(req.targetConnId || req.sourceConnId || '', profiles)
    const res = await fetch('/api/datadiff/export.sql', {
      method: 'POST',
      headers: {
        ...(this._headers(tgtDSN, req.targetConnId, profiles) as Record<string, string>),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      throw new Error(err || `Exporting SQL failed (${res.status})`)
    }
    return await res.text()
  },
}

export type MigrationFormat = 'goose' | 'golang-migrate' | 'flyway' | 'dbmate' | 'prisma'

export interface MigrationRecord {
  id: number
  version: string
  name: string
  appliedAt: string
  checksum: string
  executionTimeMs: number
  upSql: string
  downSql: string
}

export interface MigrationFile {
  fileName: string
  content: string
}

export interface MigrationBundle {
  format: MigrationFormat
  version: string
  name: string
  checksum: string
  files: MigrationFile[]
  fileMap: Record<string, string>
}

export interface MigrationListResponse {
  initialized: boolean
  dialect: string
  migrations: MigrationRecord[]
}

export interface GenerateMigrationRequest {
  name: string
  upSql: string
  downSql?: string
  format: string
  version?: string
}

export interface ApplyMigrationRequest {
  version?: string
  name: string
  upSql: string
  downSql?: string
  checksum?: string
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
  has_secret?: boolean
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

export type {
  RoutineItem,
  RoutineArg,
  TriggerItem,
  ViewItem,
  InvokeRoutineRequest,
  InvokeRoutineResponse,
  SaveRoutinePayload,
  ToggleTriggerRequest,
  RefreshViewRequest,
}

// ── Feature-30: Cron Job types ──
export interface CronAlertRule {
  condition: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | ''
  threshold: number
  webhook_url: string
  message: string
}

export interface CronJobRun {
  run_at: string
  duration_ms: number
  status: 'ok' | 'error' | 'alert'
  output: string
  error?: string
}

export interface CronJob {
  id: string
  name: string
  conn_id: string
  sql: string
  interval_sec: number
  enabled: boolean
  alert_rule: CronAlertRule
  dsn?: string
  last_run: string
  last_status: string
  last_error: string
  run_history: CronJobRun[]
}

// ── Feature-31: Audit Log ──────────────────────────────────────────────────

export interface AuditEntry {
  id: string
  timestamp: string
  actor_ip: string
  user_agent: string
  conn_id: string
  db_name: string
  schema: string
  query_type: string
  query_text: string
  rows_affected: number
  duration_ms: number
  error: string
  prev_hash: string
  hash: string
}

export interface AuditVerifyResult {
  ok: boolean
  tampered_lines: number[]
}

// ── Feature-33: Playbook types ────────────────────────────────────────────

export interface PlaybookVersionSnapshot {
  version: number
  query_snapshot: string
  updated_at: string
}

export interface PlaybookParameter {
  name: string
  type?: string
  default?: string
}

export interface PlaybookEntry {
  id: string
  slug: string
  title: string
  description?: string
  tags: string[]
  dialect?: string
  query: string
  parameters?: PlaybookParameter[]
  author?: string
  created_at: string
  updated_at: string
  version_history: PlaybookVersionSnapshot[]
}

// ── Feature-34: Table Annotation types ────────────────────────────────────

export type AnnotationTargetType = 'table' | 'column' | 'connection'

export interface Annotation {
  id: string
  target_type: AnnotationTargetType
  connection_id: string
  schema?: string
  table?: string
  column?: string
  note: string
  author?: string
  pinned: boolean
  created_at: string
  updated_at: string
}

// ── Feature-35: Connection Health types ────────────────────────────────────

export type HealthStatus = 'green' | 'yellow' | 'red' | 'unknown'

export interface HealthSample {
  at: string
  ms: number
  ok: boolean
}

export interface ConnectionHealth {
  connection_id: string
  label?: string
  status: HealthStatus
  last_ping_ms: number
  avg_ping_ms_1m: number
  max_ping_ms_5m: number
  consecutive_failures: number
  samples: HealthSample[]
  last_checked_at: string
  total_checks: number
  success_count: number
}

export interface HealthSummary {
  healthy: number
  degraded: number
  down: number
  unknown: number
  total: number
  total_checks: number
  success_count: number
  success_rate: number
}

export interface HealthPayload {
  connections: ConnectionHealth[]
  summary: HealthSummary
}

export type {
  MaterializeMode,
  MaterializeRequest,
  MaterializePreview,
  MaterializeResult,
  ScratchTable,
} from '../features/materialize/materializeHelper'

export type {
  LintSeverity,
  QuickFix,
  LintDiagnostic,
  RuleSetting,
  RuleMeta,
  AnalyzeResult,
  GateRequest,
  GateResult,
} from '../features/lint/lintRules'

export type {
  PlanDiffRequest,
  PlanDiffResult,
  IndexRecommendation,
  AlignedNode,
  PlanDiffSummary,
} from '../features/plandiff/planDiffHelper'

export type {
  DataDiffRequest,
  RowDiffItem,
  DataDiffSummary,
  DataDiffResult,
  SyncConflictStrategy,
  SyncScriptRequest,
  SyncScriptResponse,
  ApplySyncRequest,
  ApplySyncResponse,
  RowStatus,
} from '../features/datadiff/dataDiffHelper'



