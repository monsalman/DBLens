export interface QueryVariable {
  name: string
  syntax: string
}

/**
 * Extracts unique query parameter variables from SQL.
 * Supports:
 * - :param (e.g. :status, :min_id)
 * - {{param}} or {{ param }} (e.g. {{ status }})
 * Strictly ignores:
 * - Postgres cast syntax (::int, ::text, etc.)
 * - Single-quoted string literals ('not a :param')
 * - Line comments (-- :ignored)
 * - Block comments (/* :ignored *\/)
 */
export function extractQueryVariables(sql: string): QueryVariable[] {
  if (!sql) return []

  const variables: QueryVariable[] = []
  const seen = new Set<string>()
  const n = sql.length
  let i = 0

  while (i < n) {
    const c = sql[i]

    // Single-quoted string literal: '...'
    if (c === "'") {
      i++
      while (i < n) {
        if (sql[i] === "'") {
          i++
          if (i < n && sql[i] === "'") {
            // Escaped quote ''
            i++
          } else {
            break
          }
        } else if (sql[i] === '\\') {
          i += 2
        } else {
          i++
        }
      }
      continue
    }

    // Double-quoted identifier: "..."
    if (c === '"') {
      i++
      while (i < n) {
        if (sql[i] === '"') {
          i++
          if (i < n && sql[i] === '"') {
            i++
          } else {
            break
          }
        } else {
          i++
        }
      }
      continue
    }

    // Backticks: `...`
    if (c === '`') {
      i++
      while (i < n) {
        if (sql[i] === '`') {
          i++
          if (i < n && sql[i] === '`') {
            i++
          } else {
            break
          }
        } else {
          i++
        }
      }
      continue
    }

    // Line comment: -- ...
    if (c === '-' && i + 1 < n && sql[i + 1] === '-') {
      i += 2
      while (i < n && sql[i] !== '\n') {
        i++
      }
      continue
    }

    // Block comment: /* ... */
    if (c === '/' && i + 1 < n && sql[i + 1] === '*') {
      i += 2
      while (i < n) {
        if (sql[i] === '*' && i + 1 < n && sql[i + 1] === '/') {
          i += 2
          break
        }
        i++
      }
      continue
    }

    // Double-brace syntax: {{var}} or {{ var }}
    if (c === '{' && i + 1 < n && sql[i + 1] === '{') {
      const closeIdx = sql.indexOf('}}', i + 2)
      if (closeIdx !== -1) {
        const rawInner = sql.slice(i + 2, closeIdx)
        const name = rawInner.trim()
        if (/^[a-zA-Z_]\w*$/.test(name)) {
          const syntax = sql.slice(i, closeIdx + 2)
          if (!seen.has(name)) {
            seen.add(name)
            variables.push({ name, syntax })
          }
          i = closeIdx + 2
          continue
        }
      }
    }

    // Named parameter: :param
    if (c === ':') {
      // Ignore Postgres type cast (::type) or multiple colons
      if ((i > 0 && sql[i - 1] === ':') || (i + 1 < n && sql[i + 1] === ':')) {
        i++
        continue
      }

      // Check if start of identifier [a-zA-Z_]
      if (i + 1 < n && /^[a-zA-Z_]/.test(sql[i + 1])) {
        const start = i + 1
        let end = start
        while (end < n && /^\w/.test(sql[end])) {
          end++
        }
        const name = sql.slice(start, end)
        const syntax = sql.slice(i, end)
        if (!seen.has(name)) {
          seen.add(name)
          variables.push({ name, syntax })
        }
        i = end
        continue
      }

      i++
      continue
    }

    i++
  }

  return variables
}

export interface SqlSnippet {
  id: string
  title: string
  description: string
  dialect: 'postgres' | 'mysql' | 'sqlite' | 'all'
  category: 'Performance' | 'Maintenance' | 'Diagnostics' | 'Templates'
  sql: string
  defaultParams?: Record<string, any>
}

export const DBA_MAINTENANCE_SNIPPETS: SqlSnippet[] = [
  // PostgreSQL Snippets
  {
    id: 'pg-slow-queries',
    title: 'Find Slow Running Queries',
    description: 'List active non-idle queries exceeding threshold seconds',
    dialect: 'postgres',
    category: 'Performance',
    sql: `-- Find Slow Running Queries
SELECT
  pid,
  now() - query_start AS duration,
  state,
  usename AS user_name,
  query
FROM pg_stat_activity
WHERE state != 'idle'
  AND (now() - query_start) > (:min_duration_seconds || ' seconds')::interval
ORDER BY duration DESC;`,
    defaultParams: {
      min_duration_seconds: 5,
    },
  },
  {
    id: 'pg-table-bloat',
    title: 'Check Table Bloat & Dead Tuples',
    description: 'Inspect dead tuple counts and bloat ratio across schema tables',
    dialect: 'postgres',
    category: 'Maintenance',
    sql: `-- Check Table Bloat & Dead Tuples
SELECT
  schemaname,
  relname AS table_name,
  n_dead_tup AS dead_tuples,
  n_live_tup AS live_tuples,
  round(100.0 * n_dead_tup / nullif(n_dead_tup + n_live_tup, 0), 2) AS dead_ratio_pct,
  last_vacuum,
  last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname = :schema_name
  AND n_dead_tup >= :min_dead_tuples
ORDER BY dead_ratio_pct DESC;`,
    defaultParams: {
      schema_name: 'public',
      min_dead_tuples: 100,
    },
  },
  {
    id: 'pg-unused-indexes',
    title: 'Find Unused Indexes',
    description: 'Locate indexes with few or no index scans consuming disk space',
    dialect: 'postgres',
    category: 'Diagnostics',
    sql: `-- Find Unused Indexes
SELECT
  schemaname,
  relname AS table_name,
  indexrelname AS index_name,
  idx_scan AS scan_count,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = :schema_name
  AND idx_scan <= :max_scans
ORDER BY idx_scan ASC;`,
    defaultParams: {
      schema_name: 'public',
      max_scans: 10,
    },
  },
  {
    id: 'pg-blocking-locks',
    title: 'Detect Blocking Locks',
    description: 'Find active transactions waiting on locks held by other sessions',
    dialect: 'postgres',
    category: 'Performance',
    sql: `-- Detect Blocking Locks
SELECT
  blocked_locks.pid AS blocked_pid,
  blocking_locks.pid AS blocking_pid,
  blocked_activity.usename AS blocked_user,
  blocking_activity.usename AS blocking_user,
  blocked_activity.query AS blocked_statement,
  blocking_activity.query AS current_statement_in_blocking_process
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks
  ON blocking_locks.locktype = blocked_locks.locktype
  AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
  AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
  AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;`,
  },
  {
    id: 'pg-filter-date-status',
    title: 'Filter by Date & Status',
    description: 'Generic parameterized lookup template with date boundary and limit',
    dialect: 'postgres',
    category: 'Templates',
    sql: `-- Filter by Date & Status
SELECT *
FROM {{ table_name }}
WHERE created_at >= :start_date
  AND status = :status
ORDER BY id DESC
LIMIT :limit_rows;`,
    defaultParams: {
      table_name: 'users',
      start_date: '2025-01-01',
      status: 'active',
      limit_rows: 50,
    },
  },

  // MySQL Snippets
  {
    id: 'mysql-slow-queries',
    title: 'Find Long Running Queries',
    description: 'Inspect active running threads exceeding duration threshold',
    dialect: 'mysql',
    category: 'Performance',
    sql: `-- Find Long Running Queries
SELECT
  id,
  user,
  host,
  db,
  command,
  time AS duration_seconds,
  state,
  info AS query
FROM information_schema.processlist
WHERE command != 'Sleep'
  AND time >= :min_seconds
ORDER BY time DESC;`,
    defaultParams: {
      min_seconds: 5,
    },
  },
  {
    id: 'mysql-table-sizes',
    title: 'Table Sizes & Row Counts',
    description: 'Calculate disk space consumption by data and indexes',
    dialect: 'mysql',
    category: 'Maintenance',
    sql: `-- Table Sizes & Row Counts
SELECT
  table_schema,
  table_name,
  round(((data_length + index_length) / 1024 / 1024), 2) AS total_size_mb,
  round((data_length / 1024 / 1024), 2) AS data_size_mb,
  round((index_length / 1024 / 1024), 2) AS index_size_mb,
  table_rows
FROM information_schema.tables
WHERE table_schema = :db_name
  AND table_rows >= :min_rows
ORDER BY (data_length + index_length) DESC;`,
    defaultParams: {
      db_name: 'mysql',
      min_rows: 0,
    },
  },
  {
    id: 'mysql-user-activity',
    title: 'User Activity Lookup',
    description: 'Parameterized search by user identifier and minimum timestamp',
    dialect: 'mysql',
    category: 'Templates',
    sql: `-- User Activity Lookup
SELECT *
FROM {{ table_name }}
WHERE user_id = :user_id
  AND created_at >= :since_date
ORDER BY id DESC
LIMIT :limit_count;`,
    defaultParams: {
      table_name: 'user_logs',
      user_id: 1,
      since_date: '2025-01-01',
      limit_count: 50,
    },
  },
  {
    id: 'mysql-unused-indexes',
    title: 'Low-Usage Indexes',
    description: 'Check index read count from performance schema',
    dialect: 'mysql',
    category: 'Diagnostics',
    sql: `-- Low-Usage Indexes
SELECT
  object_schema,
  object_name AS table_name,
  index_name,
  count_star AS total_usage,
  count_read AS read_usage
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE object_schema = :db_name
  AND count_star <= :max_usage
ORDER BY count_star ASC;`,
    defaultParams: {
      db_name: 'mydb',
      max_usage: 5,
    },
  },

  // SQLite Snippets
  {
    id: 'sqlite-table-schema',
    title: 'Table Schema & SQL Lookup',
    description: 'Retrieve DDL definition and properties for a specific table',
    dialect: 'sqlite',
    category: 'Diagnostics',
    sql: `-- Table Schema & SQL Lookup
SELECT
  type,
  name,
  tbl_name,
  sql
FROM sqlite_master
WHERE type = 'table'
  AND name = :table_name;`,
    defaultParams: {
      table_name: 'users',
    },
  },
  {
    id: 'sqlite-filter-status',
    title: 'Filter by Status & Minimum ID',
    description: 'Lookup rows with parameterized criteria in SQLite',
    dialect: 'sqlite',
    category: 'Templates',
    sql: `-- Filter by Status & Minimum ID
SELECT *
FROM {{ table_name }}
WHERE status = :status
  AND id >= :min_id
ORDER BY id DESC
LIMIT :limit_rows;`,
    defaultParams: {
      table_name: 'users',
      status: 'active',
      min_id: 1,
      limit_rows: 25,
    },
  },
  {
    id: 'sqlite-index-list',
    title: 'List Table Indexes',
    description: 'Query pragma index metadata for table',
    dialect: 'sqlite',
    category: 'Diagnostics',
    sql: `-- List Table Indexes
SELECT *
FROM pragma_index_list(:table_name);`,
    defaultParams: {
      table_name: 'users',
    },
  },
  {
    id: 'sqlite-integrity-check',
    title: 'Database Integrity Check',
    description: 'Verify database file structure and b-tree integrity',
    dialect: 'sqlite',
    category: 'Maintenance',
    sql: `PRAGMA integrity_check;`,
  },

  // Common cross-database templates
  {
    id: 'all-date-pagination',
    title: 'Date Range & Pagination',
    description: 'Generic range filter with page size and offset',
    dialect: 'all',
    category: 'Templates',
    sql: `-- Date Range & Pagination
SELECT *
FROM {{ table_name }}
WHERE created_at BETWEEN :start_date AND :end_date
LIMIT :page_size OFFSET :offset_val;`,
    defaultParams: {
      table_name: 'events',
      start_date: '2025-01-01',
      end_date: '2025-12-31',
      page_size: 50,
      offset_val: 0,
    },
  },
]
