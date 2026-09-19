export interface StagedChange {
  key: string // `${rowKey}:${col}`
  row: Record<string, any>
  col: string
  oldVal: any
  newVal: any
  where: Record<string, any>
}

/**
 * Format a JavaScript value into an escaped SQL literal.
 */
export function formatSqlValue(val: any): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL'
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
  const str = String(val)
  return `'${str.replace(/'/g, "''")}'`
}

/**
 * Escape an SQL identifier (column/table/schema) based on dialect.
 */
export function escapeIdentifier(name: string, dialect: string = 'postgres'): string {
  if (dialect === 'mysql') {
    return `\`${name.replace(/`/g, '``')}\``
  }
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Generate formatted SQL UPDATE statements from staged changes.
 */
export function generateStagedSQL(
  changes: StagedChange[] | Record<string, StagedChange>,
  table: string,
  schema?: string,
  dialect: string = 'postgres'
): string {
  const changeList: StagedChange[] = Array.isArray(changes)
    ? changes
    : Object.values(changes)

  if (changeList.length === 0) return ''

  const escapedTable = escapeIdentifier(table, dialect)
  const fullTable =
    schema && schema !== 'public' && dialect !== 'sqlite'
      ? `${escapeIdentifier(schema, dialect)}.${escapedTable}`
      : escapedTable

  return changeList
    .map((change) => {
      const col = escapeIdentifier(change.col, dialect)
      const val = formatSqlValue(change.newVal)

      const whereClauses = Object.entries(change.where).map(([pkCol, pkVal]) => {
        const pk = escapeIdentifier(pkCol, dialect)
        if (pkVal === null || pkVal === undefined) {
          return `${pk} IS NULL`
        }
        return `${pk} = ${formatSqlValue(pkVal)}`
      })

      const whereStr = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : ''
      return `UPDATE ${fullTable} SET ${col} = ${val}${whereStr};`
    })
    .join('\n')
}
