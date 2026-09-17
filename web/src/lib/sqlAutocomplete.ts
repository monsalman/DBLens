import {
  sql,
  PostgreSQL,
  MySQL,
  SQLite,
  StandardSQL,
  type SQLDialect,
  type SQLNamespace,
} from '@codemirror/lang-sql'
import {
  autocompletion,
  CompletionContext,
  type CompletionResult,
  type Completion,
  startCompletion,
  snippetCompletion,
} from '@codemirror/autocomplete'
import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { ERDTable } from './api'

export function getSqlDialect(dialectName?: string): SQLDialect {
  if (!dialectName) return StandardSQL
  const d = dialectName.toLowerCase()
  if (d.includes('postgres')) return PostgreSQL
  if (d.includes('mysql') || d.includes('mariadb')) return MySQL
  if (d.includes('sqlite')) return SQLite
  return StandardSQL
}

export function buildSqlSchema(
  erdTables: ERDTable[] | undefined,
  defaultSchema: string = 'public'
): SQLNamespace {
  if (!erdTables || erdTables.length === 0) return {}

  const schemaObj: Record<string, any> = {}
  const tablesBySchema: Record<string, ERDTable[]> = {}

  for (const table of erdTables) {
    if (!table || !table.name) continue
    const s = table.schema || defaultSchema || 'public'
    if (!tablesBySchema[s]) tablesBySchema[s] = []
    tablesBySchema[s].push(table)
  }

  const buildColumnCompletions = (table: ERDTable): Completion[] => {
    return (table.columns || [])
      .filter((col) => col && typeof col.name === 'string' && col.name.length > 0)
      .map((col) => {
        const isPk = Boolean(col.isPrimaryKey || col.isPrimary)
        const isFk = Boolean(col.isForeignKey || col.foreignKeyTarget)
        const badge = isPk ? ' (PK)' : isFk ? ' (FK)' : ''
        const detail = `${col.type || 'column'}${badge}`
        const info = `${table.name}.${col.name}: ${col.type || 'unknown'}${
          isPk ? ' [Primary Key]' : ''
        }${isFk ? ' [Foreign Key]' : ''}${col.nullable === false ? ' NOT NULL' : ''}`

        return {
          label: col.name,
          type: 'property',
          detail,
          info,
        }
      })
  }

  for (const [schemaName, tables] of Object.entries(tablesBySchema)) {
    const schemaChildren: Record<string, any> = {}

    for (const table of tables) {
      const colCompletions = buildColumnCompletions(table)
      const tableCompletion: Completion = {
        label: table.name,
        type: 'class',
        detail: `${table.columns?.length || 0} cols`,
        info: `${schemaName}.${table.name} (${table.columns?.length || 0} columns)`,
      }

      schemaChildren[table.name] = {
        self: tableCompletion,
        children: colCompletions,
      }

      // Allow top-level table completion without schema prefix
      if (schemaName === defaultSchema || !schemaObj[table.name]) {
        schemaObj[table.name] = {
          self: tableCompletion,
          children: colCompletions,
        }
      }
    }

    schemaObj[schemaName] = {
      self: {
        label: schemaName,
        type: 'namespace',
        detail: 'schema',
        info: `Schema ${schemaName}`,
      },
      children: schemaChildren,
    }
  }

  return schemaObj as SQLNamespace
}

export function extractReferencedTables(query: string): {
  referencedTables: Set<string>
  aliasToTable: Map<string, string>
} {
  const referencedTables = new Set<string>()
  const aliasToTable = new Map<string, string>()

  const clean = query
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')

  const fromJoinRegex = /\b(?:FROM|JOIN)\s+([a-zA-Z0-9_$.\-"`\[\]]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_]+))?/gi
  let match: RegExpExecArray | null
  while ((match = fromJoinRegex.exec(clean)) !== null) {
    const rawTable = match[1].replace(/["`\[\]]/g, '')
    const alias = match[2]
    const tableName = rawTable.includes('.') ? rawTable.split('.').pop() : rawTable
    if (tableName) referencedTables.add(tableName.toLowerCase())
    if (alias) {
      const aliasLower = alias.toLowerCase()
      const keywords = new Set([
        'where',
        'join',
        'left',
        'right',
        'inner',
        'outer',
        'cross',
        'on',
        'group',
        'order',
        'limit',
        'having',
        'union',
        'set',
        'using',
      ])
      if (!keywords.has(aliasLower) && tableName) {
        aliasToTable.set(aliasLower, tableName.toLowerCase())
      }
    }
  }

  const updateRegex = /\bUPDATE\s+([a-zA-Z0-9_$.\-"`\[\]]+)/gi
  while ((match = updateRegex.exec(clean)) !== null) {
    const rawTable = match[1].replace(/["`\[\]]/g, '')
    const tableName = rawTable.includes('.') ? rawTable.split('.').pop() : rawTable
    if (tableName) referencedTables.add(tableName.toLowerCase())
  }

  const insertRegex = /\bINSERT\s+INTO\s+([a-zA-Z0-9_$.\-"`\[\]]+)/gi
  while ((match = insertRegex.exec(clean)) !== null) {
    const rawTable = match[1].replace(/["`\[\]]/g, '')
    const tableName = rawTable.includes('.') ? rawTable.split('.').pop() : rawTable
    if (tableName) referencedTables.add(tableName.toLowerCase())
  }

  return { referencedTables, aliasToTable }
}

export function getPrecedingClause(text: string): string | null {
  const lastSemi = text.lastIndexOf(';')
  const recent = (lastSemi >= 0 ? text.slice(lastSemi + 1) : text).slice(-2000)
  const matches = recent.match(
    /\b(SELECT|FROM|JOIN|INTO|TABLE|WHERE|ORDER\s+BY|GROUP\s+BY|HAVING|ON|SET|VALUES|LIMIT)\b/gi
  )
  if (!matches || matches.length === 0) return null
  return matches[matches.length - 1].toUpperCase().replace(/\s+/g, ' ')
}

const COMMON_SQL_FUNCTIONS: Completion[] = [
  snippetCompletion('COUNT(${*})', {
    label: 'COUNT',
    type: 'function',
    detail: 'COUNT(expr)',
    info: 'Count rows or values',
  }),
  snippetCompletion('COUNT(DISTINCT ${col})', {
    label: 'COUNT DISTINCT',
    type: 'function',
    detail: 'COUNT(DISTINCT expr)',
    info: 'Count distinct non-null values',
  }),
  snippetCompletion('COALESCE(${val1}, ${val2})', {
    label: 'COALESCE',
    type: 'function',
    detail: 'COALESCE(val1, val2, ...)',
    info: 'Return first non-null expression',
  }),
  snippetCompletion('NOW()', {
    label: 'NOW',
    type: 'function',
    detail: 'NOW()',
    info: 'Current date and time timestamp',
  }),
  snippetCompletion('CURRENT_TIMESTAMP', {
    label: 'CURRENT_TIMESTAMP',
    type: 'function',
    detail: 'CURRENT_TIMESTAMP',
    info: 'Current timestamp',
  }),
  snippetCompletion('CASE WHEN ${cond} THEN ${res} ELSE ${fallback} END', {
    label: 'CASE WHEN',
    type: 'function',
    detail: 'CASE WHEN ... THEN ... ELSE ... END',
    info: 'Conditional expression block',
  }),
  snippetCompletion("DATE_TRUNC('${part}', ${source})", {
    label: 'DATE_TRUNC',
    type: 'function',
    detail: "DATE_TRUNC('day', timestamp)",
    info: 'Truncate timestamp to specified precision',
  }),
  snippetCompletion('SUM(${col})', {
    label: 'SUM',
    type: 'function',
    detail: 'SUM(expr)',
    info: 'Calculate sum of values',
  }),
  snippetCompletion('AVG(${col})', {
    label: 'AVG',
    type: 'function',
    detail: 'AVG(expr)',
    info: 'Calculate average of values',
  }),
  snippetCompletion('MIN(${col})', {
    label: 'MIN',
    type: 'function',
    detail: 'MIN(expr)',
    info: 'Find minimum value',
  }),
  snippetCompletion('MAX(${col})', {
    label: 'MAX',
    type: 'function',
    detail: 'MAX(expr)',
    info: 'Find maximum value',
  }),
  snippetCompletion('CONCAT(${str1}, ${str2})', {
    label: 'CONCAT',
    type: 'function',
    detail: 'CONCAT(s1, s2, ...)',
    info: 'Concatenate multiple strings',
  }),
  snippetCompletion('LOWER(${str})', {
    label: 'LOWER',
    type: 'function',
    detail: 'LOWER(string)',
    info: 'Convert string to lowercase',
  }),
  snippetCompletion('UPPER(${str})', {
    label: 'UPPER',
    type: 'function',
    detail: 'UPPER(string)',
    info: 'Convert string to uppercase',
  }),
  snippetCompletion('ROUND(${num}, ${decimals})', {
    label: 'ROUND',
    type: 'function',
    detail: 'ROUND(numeric, decimals)',
    info: 'Round numeric value',
  }),
  snippetCompletion('NULLIF(${expr1}, ${expr2})', {
    label: 'NULLIF',
    type: 'function',
    detail: 'NULLIF(expr1, expr2)',
    info: 'Return null if expr1 equals expr2',
  }),
]

export function createSqlContextCompletion(erdTables: ERDTable[] | undefined) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w$]*/)
    if (!word) return null
    if (word.from === word.to && !context.explicit) return null

    // If dot access (e.g. users. or u.), let @codemirror/lang-sql schemaCompletionSource handle it
    if (word.from > 0 && context.state.sliceDoc(word.from - 1, word.from) === '.') {
      return null
    }

    const docLen = context.state.doc.length
    const docText =
      docLen <= 50000
        ? context.state.sliceDoc(0)
        : context.state.sliceDoc(
            Math.max(0, context.pos - 25000),
            Math.min(docLen, context.pos + 25000)
          )
    const { referencedTables } = extractReferencedTables(docText)

    const textBefore = context.state.sliceDoc(
      Math.max(0, word.from - 5000),
      word.from
    )
    const clause = getPrecedingClause(textBefore)

    const isTableClause = Boolean(clause && ['FROM', 'JOIN', 'INTO', 'TABLE'].includes(clause))
    const isColumnClause = Boolean(
      clause && ['SELECT', 'WHERE', 'ORDER BY', 'GROUP BY', 'HAVING', 'ON', 'SET'].includes(clause)
    )

    const tableBoost = isTableClause ? 4 : 0
    const colBaseBoost = isColumnClause ? 3 : 0
    const funcBoost = isColumnClause ? 2 : 0

    const options: Completion[] = []

    if (erdTables && erdTables.length > 0) {
      for (const table of erdTables) {
        if (!table || !table.name) continue
        const isRef = referencedTables.has(table.name.toLowerCase())

        // Table completion option
        options.push({
          label: table.name,
          type: 'class',
          detail: `${table.columns?.length || 0} cols`,
          info: `${table.schema ? `${table.schema}.` : ''}${table.name} (${table.columns?.length || 0} columns)`,
          boost: tableBoost + (isRef ? 1 : 0),
        })

        // Column completion options
        const colBoost = colBaseBoost + (isRef ? 3 : 0)
        for (const col of table.columns || []) {
          const isPk = Boolean(col.isPrimaryKey || col.isPrimary)
          const isFk = Boolean(col.isForeignKey || col.foreignKeyTarget)
          const badge = isPk ? ' (PK)' : isFk ? ' (FK)' : ''

          options.push({
            label: col.name,
            type: 'property',
            detail: `${col.type || 'column'}${badge} • ${table.name}`,
            info: `${table.name}.${col.name}: ${col.type || 'unknown'}${isPk ? ' [Primary Key]' : ''}${
              isFk ? ' [Foreign Key]' : ''
            }`,
            boost: colBoost,
          })
        }
      }
    }

    // Add common SQL functions/snippets with appropriate boost
    for (const fn of COMMON_SQL_FUNCTIONS) {
      options.push({
        ...fn,
        boost: funcBoost,
      })
    }

    return {
      from: word.from,
      options,
      validFor: /^[\w$]*$/,
    }
  }
}

export function createSqlExtension(
  dialectName: string | undefined,
  erdTables: ERDTable[] | undefined,
  defaultSchema: string = 'public'
): Extension[] {
  const dialect = getSqlDialect(dialectName)
  const schema = buildSqlSchema(erdTables, defaultSchema)
  const contextualSource = createSqlContextCompletion(erdTables)

  // ponytail: standard autocomplete configuration; add fuzzy server-side dictionary when catalogs exceed 10k items.
  return [
    sql({
      dialect,
      schema,
      defaultSchema,
      upperCaseKeywords: true,
    }),
    dialect.language.data.of({
      autocomplete: contextualSource,
    }),
    autocompletion({
      activateOnTyping: true,
      maxRenderedOptions: 50,
    }),
    Prec.highest(
      keymap.of([
        {
          key: 'Mod-Space',
          run: startCompletion,
        },
        {
          key: 'Ctrl-Space',
          run: startCompletion,
        },
      ])
    ),
  ]
}
