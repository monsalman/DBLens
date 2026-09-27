export interface DataDictionary {
  connectionId: string
  dialect: string
  database?: string
  generatedAt: string
  schemas: DictionarySchema[]
  summary: DictionarySummary
}

export interface DictionarySchema {
  name: string
  tables: DictionaryTable[]
  tableCount: number
  columnCount: number
}

export interface DictionaryTable {
  name: string
  schema: string
  type: string // "table" or "view"
  comment: string
  rowCount: number
  sizeBytes: number
  sizeFormatted: string
  columns: DictionaryColumn[]
  indexes: DictionaryIndex[]
  foreignKeys: DictionaryForeignKey[]
  piiCount: number
}

export interface DictionaryColumn {
  name: string
  type: string
  dataType: string
  isNullable: boolean
  isPrimary: boolean
  isForeignKey: boolean
  default: string | null
  comment: string
  piiType?: string
  ordinal: number
}

export interface DictionaryIndex {
  name: string
  columns: string[]
  isUnique: boolean
  isPrimary: boolean
  type: string
}

export interface DictionaryForeignKey {
  name?: string
  column: string
  refTable: string
  refColumn: string
  onUpdate?: string
  onDelete?: string
}

export interface DictionarySummary {
  totalSchemas: number
  totalTables: number
  totalViews: number
  totalColumns: number
  totalIndexes: number
  totalForeignKeys: number
  totalPIIColumns: number
  documentedColumns: number
  documentationCoverage: number
}

export interface CommentUpdateRequest {
  schema: string
  table: string
  column?: string
  comment: string
  syncToDB: boolean
}

export interface PiiBadgeConfig {
  label: string
  color: string
  bg: string
  border: string
  description: string
}

export function getPiiBadgeInfo(piiType: string): PiiBadgeConfig {
  const normalized = (piiType || '').toLowerCase().trim()
  switch (normalized) {
    case 'email':
      return {
        label: 'EMAIL',
        color: 'text-rose-500 dark:text-rose-400',
        bg: 'bg-rose-50 dark:bg-rose-950/40',
        border: 'border-rose-200 dark:border-rose-800',
        description: 'Electronic Mail Address (GDPR/CCPA Identifiable)',
      }
    case 'card':
    case 'credit_card':
      return {
        label: 'PCI-CARD',
        color: 'text-red-600 dark:text-red-400',
        bg: 'bg-red-50 dark:bg-red-950/50',
        border: 'border-red-300 dark:border-red-800',
        description: 'Payment Card / PAN Number (PCI-DSS Strict Scope)',
      }
    case 'phone':
      return {
        label: 'PHONE',
        color: 'text-amber-600 dark:text-amber-400',
        bg: 'bg-amber-50 dark:bg-amber-950/40',
        border: 'border-amber-200 dark:border-amber-800',
        description: 'Telephone / Mobile Contact Number',
      }
    case 'ssn':
      return {
        label: 'SSN/ID',
        color: 'text-purple-600 dark:text-purple-400',
        bg: 'bg-purple-50 dark:bg-purple-950/40',
        border: 'border-purple-200 dark:border-purple-800',
        description: 'Government National Identifier / Social Security Number',
      }
    case 'password':
      return {
        label: 'CREDENTIAL',
        color: 'text-orange-600 dark:text-orange-400',
        bg: 'bg-orange-50 dark:bg-orange-950/40',
        border: 'border-orange-200 dark:border-orange-800',
        description: 'Sensitive Authentication Secret / Hash',
      }
    case 'name':
      return {
        label: 'NAME',
        color: 'text-blue-600 dark:text-blue-400',
        bg: 'bg-blue-50 dark:bg-blue-950/40',
        border: 'border-blue-200 dark:border-blue-800',
        description: 'Full or Given Personal Name',
      }
    case 'address':
      return {
        label: 'ADDRESS',
        color: 'text-emerald-600 dark:text-emerald-400',
        bg: 'bg-emerald-50 dark:bg-emerald-950/40',
        border: 'border-emerald-200 dark:border-emerald-800',
        description: 'Physical Residential / Mailing Address',
      }
    case 'ip':
      return {
        label: 'IP-ADDR',
        color: 'text-cyan-600 dark:text-cyan-400',
        bg: 'bg-cyan-50 dark:bg-cyan-950/40',
        border: 'border-cyan-200 dark:border-cyan-800',
        description: 'Network IP Address / Host Location',
      }
    default:
      return {
        label: normalized ? normalized.toUpperCase() : 'PII',
        color: 'text-pink-600 dark:text-pink-400',
        bg: 'bg-pink-50 dark:bg-pink-950/40',
        border: 'border-pink-200 dark:border-pink-800',
        description: 'Classified Personally Identifiable Information',
      }
  }
}

export function filterDictionary(
  dict: DataDictionary,
  schemaFilter: string,
  searchQuery: string,
  piiOnly: boolean
): DictionarySchema[] {
  if (!dict || !dict.schemas) return []

  const q = (searchQuery || '').toLowerCase().trim()
  const activeSchema = (schemaFilter || '').trim().toLowerCase()

  return dict.schemas
    .filter((s) => !activeSchema || s.name.toLowerCase() === activeSchema)
    .map((s) => {
      const filteredTables = s.tables.filter((t) => {
        if (piiOnly && t.piiCount === 0) return false

        if (!q) return true

        const matchesTableName = t.name.toLowerCase().includes(q)
        const matchesSchemaName = s.name.toLowerCase().includes(q)
        const matchesComment = (t.comment || '').toLowerCase().includes(q)
        const matchesColumns = t.columns.some((c) => {
          return (
            c.name.toLowerCase().includes(q) ||
            c.type.toLowerCase().includes(q) ||
            (c.comment || '').toLowerCase().includes(q) ||
            (c.piiType || '').toLowerCase().includes(q)
          )
        })

        return matchesTableName || matchesSchemaName || matchesComment || matchesColumns
      })

      return {
        ...s,
        tables: filteredTables,
        tableCount: filteredTables.length,
      }
    })
    .filter((s) => s.tables.length > 0)
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const unit = 1024
  if (bytes < unit) return `${bytes} B`
  const exp = Math.floor(Math.log(bytes) / Math.log(unit))
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  const val = (bytes / Math.pow(unit, exp)).toFixed(1)
  return `${val} ${units[exp - 1] || 'B'}`
}

export function formatCoverage(coverage: number): string {
  if (coverage == null || isNaN(coverage)) return '0.0%'
  return `${coverage.toFixed(1)}%`
}

export function generateClientMarkdown(dict: DataDictionary): string {
  if (!dict) return ''
  const lines: string[] = []

  lines.push(`# Data Dictionary: ${dict.connectionId}`)
  lines.push('')
  lines.push(`> **Generated:** ${dict.generatedAt} | **Dialect:** ${dict.dialect.toUpperCase()}`)
  lines.push(`> **Compliance Audit Scope:** SOC 2 Type II / HIPAA Security Rule / GDPR Art. 30`)
  lines.push('')
  lines.push('## Executive Summary')
  lines.push('')
  lines.push('| Metric | Value |')
  lines.push('|---|---|')
  lines.push(`| **Total Schemas** | ${dict.summary.totalSchemas} |`)
  lines.push(`| **Total Tables** | ${dict.summary.totalTables} |`)
  lines.push(`| **Total Views** | ${dict.summary.totalViews} |`)
  lines.push(`| **Total Columns** | ${dict.summary.totalColumns} |`)
  lines.push(`| **Documented Columns** | ${dict.summary.documentedColumns} |`)
  lines.push(`| **Documentation Coverage** | ${formatCoverage(dict.summary.documentationCoverage)} |`)
  lines.push(`| **PII Classifications** | ${dict.summary.totalPIIColumns} |`)
  lines.push('')

  for (const s of dict.schemas) {
    lines.push(`## Schema: \`${s.name}\``)
    lines.push('')

    for (const t of s.tables) {
      lines.push(`### Table: \`${t.name}\``)
      lines.push('')
      if (t.comment) {
        lines.push(`${t.comment}`)
        lines.push('')
      }
      lines.push(`- **Type:** \`${t.type}\``)
      lines.push(`- **Estimated Rows:** ${t.rowCount}`)
      lines.push(`- **Storage Size:** ${t.sizeFormatted || formatBytes(t.sizeBytes)}`)
      if (t.piiCount > 0) {
        lines.push(`- **PII Fields:** ${t.piiCount} detected`)
      }
      lines.push('')

      lines.push('| Column | Type | Nullable | Primary | Default | PII Classification | Description |')
      lines.push('|---|---|---|---|---|---|---|')

      for (const c of t.columns) {
        const nullable = c.isNullable ? 'YES' : 'NO'
        let pk = ''
        if (c.isPrimary) pk = '✓ PK'
        if (c.isForeignKey) pk = pk ? `${pk} / FK` : 'FK'
        const def = c.default ? `\`${c.default}\`` : '-'
        const pii = c.piiType ? `🛡️ \`${c.piiType}\`` : '-'
        const desc = (c.comment || '-').replace(/\r/g, '').replace(/\n/g, ' ').replace(/\|/g, '\\|')
        lines.push(`| \`${c.name}\` | \`${c.type}\` | ${nullable} | ${pk || '-'} | ${def} | ${pii} | ${desc} |`)
      }
      lines.push('')

      if (t.indexes && t.indexes.length > 0) {
        lines.push('#### Indexes')
        lines.push('')
        lines.push('| Index Name | Columns | Unique | Type |')
        lines.push('|---|---|---|---|')
        for (const idx of t.indexes) {
          lines.push(`| \`${idx.name}\` | ${idx.columns.join(', ')} | ${idx.isUnique ? 'YES' : 'NO'} | ${idx.type || 'BTREE'} |`)
        }
        lines.push('')
      }

      if (t.foreignKeys && t.foreignKeys.length > 0) {
        lines.push('#### Foreign Keys')
        lines.push('')
        lines.push('| Column | References | On Update | On Delete |')
        lines.push('|---|---|---|---|')
        for (const fk of t.foreignKeys) {
          lines.push(`| \`${fk.column}\` | \`${fk.refTable}(${fk.refColumn})\` | ${fk.onUpdate || '-'} | ${fk.onDelete || '-'} |`)
        }
        lines.push('')
      }
      lines.push('---')
      lines.push('')
    }
  }

  return lines.join('\n')
}

export function generateClientOpenAPI(dict: DataDictionary): string {
  if (!dict) return '{}'

  const schemas: Record<string, any> = {}

  for (const s of dict.schemas) {
    for (const t of s.tables) {
      const schemaKey = s.name && !['public', 'main', 'default'].includes(s.name.toLowerCase())
        ? `${s.name}_${t.name}`
        : t.name

      const properties: Record<string, any> = {}
      const required: string[] = []

      for (const c of t.columns) {
        const prop: Record<string, any> = {}
        const tLower = (c.type + ' ' + (c.dataType || '')).toLowerCase()

        if (c.piiType === 'email') {
          prop.type = 'string'
          prop.format = 'email'
        } else if (tLower.includes('bool')) {
          prop.type = 'boolean'
        } else if (tLower.includes('int8') || tLower.includes('bigint')) {
          prop.type = 'integer'
          prop.format = 'int64'
        } else if (tLower.includes('int') || tLower.includes('serial')) {
          prop.type = 'integer'
          prop.format = 'int32'
        } else if (tLower.includes('float') || tLower.includes('double') || tLower.includes('real')) {
          prop.type = 'number'
          prop.format = 'double'
        } else if (tLower.includes('decimal') || tLower.includes('numeric')) {
          prop.type = 'number'
          prop.format = 'float'
        } else if (tLower.includes('date') && !tLower.includes('time')) {
          prop.type = 'string'
          prop.format = 'date'
        } else if (tLower.includes('time')) {
          prop.type = 'string'
          prop.format = 'date-time'
        } else if (tLower.includes('uuid')) {
          prop.type = 'string'
          prop.format = 'uuid'
        } else if (tLower.includes('json')) {
          prop.type = 'object'
        } else {
          prop.type = 'string'
        }

        if (c.isNullable) {
          prop.nullable = true
        }

        const descParts: string[] = []
        if (c.piiType) descParts.push(`[PII: ${c.piiType}]`)
        if (c.comment) descParts.push(c.comment)
        if (descParts.length > 0) {
          prop.description = descParts.join(' ')
        }

        if (c.default) {
          prop.default = c.default
        }

        properties[c.name] = prop

        if (!c.isNullable && !c.default) {
          required.push(c.name)
        }
      }

      const tableSchema: Record<string, any> = {
        type: 'object',
        properties,
      }
      if (t.comment) {
        tableSchema.description = t.comment
      }
      if (required.length > 0) {
        tableSchema.required = required
      }

      schemas[schemaKey] = tableSchema
    }
  }

  const doc = {
    openapi: '3.0.3',
    info: {
      title: `Data Dictionary - ${dict.connectionId}`,
      version: '1.0.0',
      description: 'Auto-generated OpenAPI 3.0 schema definitions from DBLens living data dictionary',
    },
    paths: {},
    components: {
      schemas,
    },
  }

  return JSON.stringify(doc, null, 2)
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  if (typeof window === 'undefined' || !window.Blob) return
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
