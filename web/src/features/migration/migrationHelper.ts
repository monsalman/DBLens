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

export interface FormatMeta {
  id: MigrationFormat
  name: string
  extension: string
  filePattern: string
  description: string
  multiFile: boolean
}

export const MIGRATION_FORMATS: FormatMeta[] = [
  {
    id: 'goose',
    name: 'Goose',
    extension: '.sql',
    filePattern: '{version}_{name}.sql',
    description: 'Single reversible file with -- +goose Up and Down annotations',
    multiFile: false,
  },
  {
    id: 'golang-migrate',
    name: 'Golang-Migrate',
    extension: '.sql',
    filePattern: '{version}_{name}.up.sql / .down.sql',
    description: 'Paired separate Up and Down migration files',
    multiFile: true,
  },
  {
    id: 'flyway',
    name: 'Flyway',
    extension: '.sql',
    filePattern: 'V{version}__{name}.sql / U{version}__{name}.sql',
    description: 'Versioned V and Undo U migration files for Flyway pipelines',
    multiFile: true,
  },
  {
    id: 'dbmate',
    name: 'DB-Mate',
    extension: '.sql',
    filePattern: '{version}_{name}.sql',
    description: 'Single file with -- migrate:up and -- migrate:down markers',
    multiFile: false,
  },
  {
    id: 'prisma',
    name: 'Prisma',
    extension: '.sql',
    filePattern: 'migration.sql',
    description: 'Prisma Migrate evolution script in migration.sql',
    multiFile: false,
  },
]

/**
 * Sanitizes migration name to filesystem and tool-safe slug.
 */
export function sanitizeMigrationSlug(name: string): string {
  const cleaned = (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'migration'
}

/**
 * Generates 14-character UTC timestamp version YYYYMMDDHHMMSS.
 */
export function formatTimestampVersion(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  )
}

/**
 * Validates basic migration inputs before submission.
 */
export function validateMigrationInput(
  name: string,
  upSql: string
): { valid: boolean; error?: string } {
  if (!name || !name.trim()) {
    return { valid: false, error: 'Migration name is required' }
  }
  if (!upSql || !upSql.trim()) {
    return { valid: false, error: 'Migration Up SQL is required' }
  }
  return { valid: true }
}

/**
 * Generates client-side file bundle for instant preview and offline export.
 */
export function formatMigrationFiles(
  version: string,
  name: string,
  upSql: string,
  downSql: string,
  format: MigrationFormat
): MigrationFile[] {
  const slug = sanitizeMigrationSlug(name)
  const ver = (version || '').trim() || formatTimestampVersion()
  const up = (upSql || '').trim()
  const down = (downSql || '').trim()

  switch (format) {
    case 'golang-migrate':
      return [
        { fileName: `${ver}_${slug}.up.sql`, content: up + '\n' },
        { fileName: `${ver}_${slug}.down.sql`, content: down + '\n' },
      ]

    case 'goose':
      return [
        {
          fileName: `${ver}_${slug}.sql`,
          content: `-- +goose Up\n${up}\n\n-- +goose Down\n${down}\n`,
        },
      ]

    case 'flyway':
      return [
        { fileName: `V${ver}__${slug}.sql`, content: up + '\n' },
        { fileName: `U${ver}__${slug}.sql`, content: down + '\n' },
      ]

    case 'dbmate':
      return [
        {
          fileName: `${ver}_${slug}.sql`,
          content: `-- migrate:up\n${up}\n\n-- migrate:down\n${down}\n`,
        },
      ]

    case 'prisma':
      return [
        {
          fileName: 'migration.sql',
          content: `-- Migration: ${ver}_${slug}\n${up}\n`,
        },
      ]

    default:
      return [
        {
          fileName: `${ver}_${slug}.sql`,
          content: `${up}\n`,
        },
      ]
  }
}

/**
 * Filter applied migrations by search query.
 */
export function filterMigrations(migrations: MigrationRecord[], search: string): MigrationRecord[] {
  if (!search || !search.trim()) return migrations
  const q = search.toLowerCase().trim()
  return migrations.filter(
    (m) =>
      m.version.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.checksum.toLowerCase().includes(q) ||
      m.upSql.toLowerCase().includes(q) ||
      m.downSql.toLowerCase().includes(q)
  )
}

/**
 * Formats execution duration into human readable string.
 */
export function formatExecutionDuration(ms: number): string {
  if (ms <= 0) return '< 1ms'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * Aggregates summary statistics for applied migrations.
 */
export function calculateMigrationStats(migrations: MigrationRecord[]): {
  total: number
  latestVersion: string | null
  totalExecutionTimeMs: number
} {
  if (!migrations || migrations.length === 0) {
    return {
      total: 0,
      latestVersion: null,
      totalExecutionTimeMs: 0,
    }
  }

  const latest = migrations[migrations.length - 1]
  const totalMs = migrations.reduce((acc, m) => acc + (m.executionTimeMs || 0), 0)

  return {
    total: migrations.length,
    latestVersion: latest.version,
    totalExecutionTimeMs: totalMs,
  }
}
