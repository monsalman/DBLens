/**
 * Safe Mode & Environment Guardrails Helper
 */

export interface DestructiveCheckResult {
  isDestructive: boolean
  reason?: string
}

/**
 * Checks whether a SQL query is destructive:
 * - DROP TABLE / DATABASE / VIEW / SCHEMA
 * - TRUNCATE
 * - DELETE FROM without WHERE
 * - UPDATE without WHERE
 */
export function isDestructiveQuery(sql: string): DestructiveCheckResult {
  if (!sql) return { isDestructive: false }

  // Strip block comments and line comments
  const clean = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim()

  if (!clean) return { isDestructive: false }

  // 1. DROP TABLE, DATABASE, VIEW, SCHEMA
  const dropMatch = clean.match(/\bDROP\s+(TABLE|DATABASE|VIEW|SCHEMA)\b/i)
  if (dropMatch) {
    return {
      isDestructive: true,
      reason: `DROP ${dropMatch[1].toUpperCase()} permanently deletes database structures and data.`,
    }
  }

  // 2. TRUNCATE
  if (/\bTRUNCATE\b/i.test(clean)) {
    return {
      isDestructive: true,
      reason: 'TRUNCATE removes all rows from the specified table immediately.',
    }
  }

  // 3. DELETE FROM without WHERE
  if (/\bDELETE\s+FROM\b/i.test(clean) && !/\bWHERE\b/i.test(clean)) {
    return {
      isDestructive: true,
      reason: 'DELETE without a WHERE clause will delete ALL rows in the table.',
    }
  }

  // 4. UPDATE without WHERE
  if (/\bUPDATE\b/i.test(clean) && !/\bWHERE\b/i.test(clean)) {
    return {
      isDestructive: true,
      reason: 'UPDATE without a WHERE clause will modify ALL rows in the table.',
    }
  }

  return { isDestructive: false }
}

/**
 * Checks whether a SQL statement is non-SELECT (mutation/DDL)
 */
export function isNonSelectQuery(sql: string): boolean {
  if (!sql) return false
  const clean = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim()

  if (!clean) return false
  const firstWord = clean.split(/\s+/)[0]?.toUpperCase()
  const mutationKeywords = [
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'ALTER',
    'TRUNCATE',
    'CREATE',
    'REPLACE',
    'MERGE',
    'GRANT',
    'REVOKE',
  ]
  if (mutationKeywords.includes(firstWord)) return true

  if (firstWord === 'WITH') {
    const upper = clean.toUpperCase()
    return (
      upper.includes('INSERT INTO') ||
      upper.includes('UPDATE ') ||
      upper.includes('DELETE FROM')
    )
  }

  return false
}
