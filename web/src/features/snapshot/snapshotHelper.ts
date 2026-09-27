export interface ColumnNode {
  name: string
  type: string
  dataType?: string
  isNullable: boolean
  isPrimary: boolean
  defaultValue?: string | null
  comment?: string
}

export interface IndexNode {
  name: string
  columns: string[]
  isUnique: boolean
  isPrimary?: boolean
  type?: string
}

export interface ForeignKeyNode {
  name?: string
  column: string
  refTable: string
  refColumn: string
  onUpdate?: string
  onDelete?: string
}

export interface TriggerNode {
  name: string
  table?: string
  events?: string[]
  timing?: string
  definition?: string
}

export interface RoutineNode {
  name: string
  schema?: string
  type: string
  returnType?: string
  definition?: string
}

export interface TableNode {
  name: string
  schema?: string
  type?: string
  columns: ColumnNode[]
  indexes?: IndexNode[]
  foreignKeys?: ForeignKeyNode[]
  triggers?: TriggerNode[]
  ddl?: string
  checksum?: string
}

export interface SchemaNode {
  name: string
  tables: TableNode[]
  views?: TableNode[]
  routines?: RoutineNode[]
}

export interface SnapshotMetadata {
  capturedBy?: string
  host?: string
  gitCommit?: string
  environment?: string
  tags?: string[]
}

export interface SchemaSnapshot {
  id: string
  connId: string
  label: string
  description?: string
  dialect: string
  database?: string
  createdAt: string
  checksum: string
  tablesCount: number
  viewsCount: number
  routinesCount: number
  tag?: string
  schemas: SchemaNode[]
  metadata?: SnapshotMetadata
}

export interface ColumnDrift {
  columnName: string
  oldColumn: ColumnNode
  newColumn: ColumnNode
  changes: string[]
}

export interface TableDrift {
  tableName: string
  schema?: string
  addedColumns?: ColumnNode[]
  droppedColumns?: ColumnNode[]
  alteredColumns?: ColumnDrift[]
  addedIndexes?: IndexNode[]
  droppedIndexes?: IndexNode[]
  addedForeignKeys?: ForeignKeyNode[]
  droppedForeignKeys?: ForeignKeyNode[]
}

export interface DiffSummary {
  addedTables: number
  droppedTables: number
  alteredTables: number
  addedColumns: number
  droppedColumns: number
  alteredColumns: number
  addedIndexes: number
  droppedIndexes: number
  addedForeignKeys: number
  droppedForeignKeys: number
}

export interface SnapshotDiff {
  baseSnapshotId?: string
  targetSnapshotId?: string
  baseLabel?: string
  targetLabel?: string
  dialect: string
  totalDrifts: number
  addedTables: TableNode[]
  droppedTables: TableNode[]
  alteredTables: TableDrift[]
  summary: DiffSummary
}

export interface RollbackPlan {
  baseSnapshotId: string
  targetSnapshotId: string
  dialect: string
  upSql: string
  downSql: string
  warnings: string[]
  destructive: boolean
}

export interface CaptureSnapshotRequest {
  label: string
  tag?: string
  description?: string
  schema?: string
}

export interface DiffSnapshotsRequest {
  baseId: string
  targetId?: string
  live?: boolean
  schema?: string
}

export interface RollbackPlanRequest {
  baseId?: string
  targetId?: string
  diff?: SnapshotDiff
}

export function sortSnapshotsChronological(
  snapshots: SchemaSnapshot[],
  ascending: boolean = false
): SchemaSnapshot[] {
  return [...snapshots].sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime()
    const timeB = new Date(b.createdAt).getTime()
    return ascending ? timeA - timeB : timeB - timeA
  })
}

export function formatSnapshotDate(isoStr: string): string {
  try {
    const d = new Date(isoStr)
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return isoStr
  }
}

export function formatRelativeTime(dateStr: string): string {
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime()
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDays = Math.floor(diffHr / 24)
    return `${diffDays}d ago`
  } catch {
    return 'recently'
  }
}

export function getTagBadgeStyle(tag?: string): {
  label: string
  bg: string
  text: string
  border: string
} {
  const norm = (tag || 'manual').toLowerCase()
  switch (norm) {
    case 'pre-migration':
      return {
        label: 'Pre-Migration',
        bg: 'bg-amber-500/10 dark:bg-amber-500/20',
        text: 'text-amber-700 dark:text-amber-400',
        border: 'border-amber-500/30',
      }
    case 'auto':
      return {
        label: 'Auto',
        bg: 'bg-sky-500/10 dark:bg-sky-500/20',
        text: 'text-sky-700 dark:text-sky-400',
        border: 'border-sky-500/30',
      }
    case 'baseline':
      return {
        label: 'Baseline',
        bg: 'bg-purple-500/10 dark:bg-purple-500/20',
        text: 'text-purple-700 dark:text-purple-400',
        border: 'border-purple-500/30',
      }
    case 'live':
      return {
        label: 'Live DB',
        bg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
        text: 'text-emerald-700 dark:text-emerald-400',
        border: 'border-emerald-500/30',
      }
    default:
      return {
        label: 'Manual',
        bg: 'bg-neutral-500/10 dark:bg-neutral-500/20',
        text: 'text-neutral-700 dark:text-neutral-300',
        border: 'border-neutral-500/30',
      }
  }
}

export function formatDriftSummary(summary?: DiffSummary): string {
  if (!summary) return 'No drifts detected'
  const parts: string[] = []
  if (summary.addedTables > 0) parts.push(`+${summary.addedTables} table(s)`)
  if (summary.droppedTables > 0) parts.push(`-${summary.droppedTables} table(s)`)
  if (summary.alteredTables > 0) parts.push(`~${summary.alteredTables} altered table(s)`)
  if (summary.addedColumns > 0) parts.push(`+${summary.addedColumns} column(s)`)
  if (summary.droppedColumns > 0) parts.push(`-${summary.droppedColumns} column(s)`)
  if (summary.alteredColumns > 0) parts.push(`~${summary.alteredColumns} col mod(s)`)
  if (summary.addedIndexes > 0) parts.push(`+${summary.addedIndexes} index(es)`)
  if (summary.droppedIndexes > 0) parts.push(`-${summary.droppedIndexes} index(es)`)

  if (parts.length === 0) return 'Schemas are structurally identical'
  return parts.join(', ')
}

export function getDeltaBadgeClass(
  count: number,
  type: 'added' | 'dropped' | 'altered'
): string {
  if (count <= 0) return 'text-[var(--muted)] opacity-50'
  switch (type) {
    case 'added':
      return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 font-medium'
    case 'dropped':
      return 'text-rose-600 dark:text-rose-400 bg-rose-500/10 font-medium'
    case 'altered':
      return 'text-amber-600 dark:text-amber-400 bg-amber-500/10 font-medium'
  }
}

export function filterSnapshots(
  snapshots: SchemaSnapshot[],
  query: string,
  tagFilter?: string
): SchemaSnapshot[] {
  const q = query.trim().toLowerCase()
  const tag = tagFilter?.trim().toLowerCase()

  return snapshots.filter((s) => {
    if (tag && tag !== 'all') {
      const sTag = (s.tag || 'manual').toLowerCase()
      if (sTag !== tag) return false
    }

    if (!q) return true
    return (
      s.id.toLowerCase().includes(q) ||
      s.label.toLowerCase().includes(q) ||
      (s.description && s.description.toLowerCase().includes(q)) ||
      s.checksum.toLowerCase().includes(q)
    )
  })
}

export function calculateSnapshotStats(snapshots: SchemaSnapshot[]): {
  total: number
  latestChecksum: string
  avgTables: number
  tagsCount: Record<string, number>
} {
  if (snapshots.length === 0) {
    return {
      total: 0,
      latestChecksum: 'None',
      avgTables: 0,
      tagsCount: {},
    }
  }

  const sorted = sortSnapshotsChronological(snapshots, false)
  let sumTables = 0
  const tagsCount: Record<string, number> = {}

  for (const s of sorted) {
    sumTables += s.tablesCount || 0
    const tag = (s.tag || 'manual').toLowerCase()
    tagsCount[tag] = (tagsCount[tag] || 0) + 1
  }

  return {
    total: snapshots.length,
    latestChecksum: sorted[0].checksum.slice(0, 8),
    avgTables: Math.round(sumTables / snapshots.length),
    tagsCount,
  }
}

export function buildCliSnapshotCommand(
  action: 'capture' | 'diff' | 'rollback',
  params: {
    connId: string
    label?: string
    tag?: string
    baseId?: string
    targetId?: string
    live?: boolean
    direction?: 'up' | 'down'
  }
): string {
  switch (action) {
    case 'capture': {
      const parts = ['dblens snapshot capture', `--conn-id="${params.connId}"`]
      if (params.label) parts.push(`--label="${params.label}"`)
      if (params.tag) parts.push(`--tag="${params.tag}"`)
      return parts.join(' ')
    }
    case 'diff': {
      const parts = [
        'dblens diff snapshot',
        `--conn-id="${params.connId}"`,
        `--base="${params.baseId || 'base_id'}"`,
      ]
      if (params.live) {
        parts.push('--live')
      } else if (params.targetId) {
        parts.push(`--target="${params.targetId}"`)
      }
      return parts.join(' ')
    }
    case 'rollback': {
      return `dblens snapshot rollback --conn-id="${params.connId}" --base="${params.baseId || 'base_id'}" --target="${params.targetId || 'target_id'}" --direction=${params.direction || 'down'}`
    }
  }
}
