import type {
  CanvasColumn,
  CanvasTable,
  CanvasJoin,
  CanvasFilter,
  CanvasHaving,
  CanvasOrderBy,
  QueryCanvasState,
  TableMeta,
  ERDTable,
} from '../../lib/api'

export const SUPPORTED_JOIN_TYPES = ['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'] as const
export const SUPPORTED_AGGREGATES = [
  'NONE',
  'COUNT',
  'COUNT_DISTINCT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
] as const
export const SUPPORTED_OPERATORS = [
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'LIKE',
  'ILIKE',
  'IN',
  'NOT IN',
  'IS NULL',
  'IS NOT NULL',
  'BETWEEN',
] as const

export function createInitialCanvasState(): QueryCanvasState {
  return {
    tables: [],
    joins: [],
    filters: [],
    havings: [],
    orderBy: [],
    distinct: false,
    limit: 100,
    offset: 0,
  }
}

/**
 * Add a table to the canvas state.
 */
export function addTableToCanvas(
  state: QueryCanvasState,
  table: TableMeta | ERDTable,
  position?: { x: number; y: number }
): QueryCanvasState {
  const existingWithSameName = state.tables.filter((t) => t.name === table.name)
  const id = `${table.name}_${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const alias = existingWithSameName.length > 0 ? `${table.name}_${existingWithSameName.length + 1}` : table.name

  const columns: CanvasColumn[] = (table.columns || []).map((col) => ({
    name: col.name,
    type: col.type,
    selected: false,
    alias: '',
    aggregate: '',
  }))

  const pos = position || {
    x: 60 + (state.tables.length % 3) * 320,
    y: 60 + Math.floor(state.tables.length / 3) * 340,
  }

  const newTable: CanvasTable = {
    id,
    name: table.name,
    schema: table.schema,
    alias,
    position: pos,
    columns,
  }

  return {
    ...state,
    tables: [...state.tables, newTable],
  }
}

/**
 * Remove a table and clean up attached joins, filters, havings, order-by clauses.
 */
export function removeTableFromCanvas(
  state: QueryCanvasState,
  tableId: string
): QueryCanvasState {
  return {
    ...state,
    tables: state.tables.filter((t) => t.id !== tableId),
    joins: state.joins.filter(
      (j) => j.sourceTableId !== tableId && j.targetTableId !== tableId
    ),
    filters: (state.filters || []).filter((f) => f.tableId !== tableId),
    havings: (state.havings || []).filter((h) => h.tableId !== tableId),
    orderBy: (state.orderBy || []).filter((o) => o.tableId !== tableId),
  }
}

/**
 * Toggle selection of a specific column.
 */
export function toggleColumnSelection(
  state: QueryCanvasState,
  tableId: string,
  columnName: string,
  forcedSelected?: boolean
): QueryCanvasState {
  return {
    ...state,
    tables: state.tables.map((t) => {
      if (t.id !== tableId) return t
      return {
        ...t,
        columns: t.columns.map((c) => {
          if (c.name !== columnName) return c
          return {
            ...c,
            selected: forcedSelected !== undefined ? forcedSelected : !c.selected,
          }
        }),
      }
    }),
  }
}

/**
 * Select or deselect all columns in a table.
 */
export function selectAllColumns(
  state: QueryCanvasState,
  tableId: string,
  selected: boolean
): QueryCanvasState {
  return {
    ...state,
    tables: state.tables.map((t) => {
      if (t.id !== tableId) return t
      return {
        ...t,
        columns: t.columns.map((c) => ({
          ...c,
          selected,
        })),
      }
    }),
  }
}

/**
 * Set aggregate function for a column.
 */
export function setColumnAggregate(
  state: QueryCanvasState,
  tableId: string,
  columnName: string,
  aggregate: string
): QueryCanvasState {
  const normAgg = aggregate === 'NONE' ? '' : aggregate
  return {
    ...state,
    tables: state.tables.map((t) => {
      if (t.id !== tableId) return t
      return {
        ...t,
        columns: t.columns.map((c) => {
          if (c.name !== columnName) return c
          return {
            ...c,
            aggregate: normAgg,
            selected: true, // auto select if aggregate applied
          }
        }),
      }
    }),
  }
}

/**
 * Set alias for a column.
 */
export function setColumnAlias(
  state: QueryCanvasState,
  tableId: string,
  columnName: string,
  alias: string
): QueryCanvasState {
  return {
    ...state,
    tables: state.tables.map((t) => {
      if (t.id !== tableId) return t
      return {
        ...t,
        columns: t.columns.map((c) => {
          if (c.name !== columnName) return c
          return { ...c, alias }
        }),
      }
    }),
  }
}

/**
 * Set table alias.
 */
export function setTableAlias(
  state: QueryCanvasState,
  tableId: string,
  alias: string
): QueryCanvasState {
  return {
    ...state,
    tables: state.tables.map((t) => (t.id === tableId ? { ...t, alias } : t)),
  }
}

/**
 * Update table coordinates.
 */
export function updateTablePosition(
  state: QueryCanvasState,
  tableId: string,
  position: { x: number; y: number }
): QueryCanvasState {
  return {
    ...state,
    tables: state.tables.map((t) => (t.id === tableId ? { ...t, position } : t)),
  }
}

/**
 * Add join between two table columns.
 */
export function addJoin(
  state: QueryCanvasState,
  sourceTableId: string,
  sourceColumn: string,
  targetTableId: string,
  targetColumn: string,
  joinType: string = 'INNER'
): QueryCanvasState {
  // Prevent self join on exact same column or exact duplicate join
  const exists = state.joins.some(
    (j) =>
      (j.sourceTableId === sourceTableId &&
        j.sourceColumn === sourceColumn &&
        j.targetTableId === targetTableId &&
        j.targetColumn === targetColumn) ||
      (j.sourceTableId === targetTableId &&
        j.sourceColumn === targetColumn &&
        j.targetTableId === sourceTableId &&
        j.targetColumn === sourceColumn)
  )
  if (exists) return state

  const newJoin: CanvasJoin = {
    id: `join_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    sourceTableId,
    sourceColumn,
    targetTableId,
    targetColumn,
    joinType,
  }

  return {
    ...state,
    joins: [...state.joins, newJoin],
  }
}

/**
 * Cycle or update join type.
 */
export function updateJoinType(
  state: QueryCanvasState,
  joinId: string,
  newType: string
): QueryCanvasState {
  return {
    ...state,
    joins: state.joins.map((j) => (j.id === joinId ? { ...j, joinType: newType } : j)),
  }
}

/**
 * Remove join.
 */
export function removeJoin(
  state: QueryCanvasState,
  joinId: string
): QueryCanvasState {
  return {
    ...state,
    joins: state.joins.filter((j) => j.id !== joinId),
  }
}

/**
 * Filter management.
 */
export function addFilter(
  state: QueryCanvasState,
  filter: Omit<CanvasFilter, 'id'> & { id?: string }
): QueryCanvasState {
  const newFilter: CanvasFilter = {
    id: filter.id || `filter_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    tableId: filter.tableId,
    column: filter.column,
    operator: filter.operator || '=',
    value: filter.value || '',
    value2: filter.value2 || '',
    logic: filter.logic || 'AND',
  }
  return {
    ...state,
    filters: [...(state.filters || []), newFilter],
  }
}

export function updateFilter(
  state: QueryCanvasState,
  filterId: string,
  partial: Partial<CanvasFilter>
): QueryCanvasState {
  return {
    ...state,
    filters: (state.filters || []).map((f) => (f.id === filterId ? { ...f, ...partial } : f)),
  }
}

export function removeFilter(
  state: QueryCanvasState,
  filterId: string
): QueryCanvasState {
  return {
    ...state,
    filters: (state.filters || []).filter((f) => f.id !== filterId),
  }
}

/**
 * Having clause management.
 */
export function addHaving(
  state: QueryCanvasState,
  having: Omit<CanvasHaving, 'id'> & { id?: string }
): QueryCanvasState {
  const newHaving: CanvasHaving = {
    id: having.id || `having_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    aggregate: having.aggregate || 'COUNT',
    tableId: having.tableId,
    column: having.column,
    operator: having.operator || '>',
    value: having.value || '0',
    logic: having.logic || 'AND',
  }
  return {
    ...state,
    havings: [...(state.havings || []), newHaving],
  }
}

export function updateHaving(
  state: QueryCanvasState,
  havingId: string,
  partial: Partial<CanvasHaving>
): QueryCanvasState {
  return {
    ...state,
    havings: (state.havings || []).map((h) => (h.id === havingId ? { ...h, ...partial } : h)),
  }
}

export function removeHaving(
  state: QueryCanvasState,
  havingId: string
): QueryCanvasState {
  return {
    ...state,
    havings: (state.havings || []).filter((h) => h.id !== havingId),
  }
}

/**
 * OrderBy clause management.
 */
export function addOrderBy(
  state: QueryCanvasState,
  orderBy: Omit<CanvasOrderBy, 'id'> & { id?: string }
): QueryCanvasState {
  const newOrder: CanvasOrderBy = {
    id: orderBy.id || `order_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    tableId: orderBy.tableId,
    column: orderBy.column,
    direction: orderBy.direction || 'ASC',
    nulls: orderBy.nulls || '',
  }
  return {
    ...state,
    orderBy: [...(state.orderBy || []), newOrder],
  }
}

export function updateOrderBy(
  state: QueryCanvasState,
  orderById: string,
  partial: Partial<CanvasOrderBy>
): QueryCanvasState {
  return {
    ...state,
    orderBy: (state.orderBy || []).map((o) => (o.id === orderById ? { ...o, ...partial } : o)),
  }
}

export function removeOrderBy(
  state: QueryCanvasState,
  orderById: string
): QueryCanvasState {
  return {
    ...state,
    orderBy: (state.orderBy || []).filter((o) => o.id !== orderById),
  }
}

// ── Dialect identifier escaping ──
function quoteIdent(ident: string, dialect: string): string {
  const clean = ident.replace(/["`]/g, '')
  if (dialect === 'mysql') {
    return `\`${clean}\``
  }
  return `"${clean}"`
}

function quoteTableRef(schema: string | undefined, table: string, dialect: string): string {
  if (schema && schema.trim() !== '' && schema !== 'main') {
    return `${quoteIdent(schema, dialect)}.${quoteIdent(table, dialect)}`
  }
  return quoteIdent(table, dialect)
}

function formatLiteralVal(val: string): string {
  const trimmed = val.trim()
  if (trimmed.toLowerCase() === 'null') return 'NULL'
  if (trimmed.toLowerCase() === 'true' || trimmed.toLowerCase() === 'false') return trimmed.toUpperCase()
  if (!isNaN(Number(trimmed)) && trimmed !== '') return trimmed
  return `'${trimmed.replace(/'/g, "''")}'`
}

/**
 * Generate client-side instant SQL preview.
 */
export function generateClientSQL(
  state: QueryCanvasState,
  dialectName: string = 'postgres'
): string {
  if (!state.tables || state.tables.length === 0) {
    return '-- Drag or select tables to begin building your visual query'
  }

  const dialect = dialectName.toLowerCase().includes('mysql')
    ? 'mysql'
    : dialectName.toLowerCase().includes('sqlite')
    ? 'sqlite'
    : 'postgres'

  const tableAliasMap = new Map<string, string>()
  const aliasCounts = new Map<string, number>()

  for (const t of state.tables) {
    let a = (t.alias || t.name).trim()
    if (!a) a = 't'
    const count = (aliasCounts.get(a) || 0) + 1
    aliasCounts.set(a, count)
    if (count > 1) {
      a = `${a}_${count}`
    }
    tableAliasMap.set(t.id, a)
  }

  // 1. SELECT columns
  const selectItems: string[] = []
  const nonAggCols: string[] = []
  let hasAgg = false

  for (const t of state.tables) {
    const alias = tableAliasMap.get(t.id) || t.name
    for (const c of t.columns) {
      if (!c.selected) continue
      const colRef = `${quoteIdent(alias, dialect)}.${quoteIdent(c.name, dialect)}`
      const agg = (c.aggregate || '').toUpperCase()

      let expr = colRef
      if (agg && agg !== 'NONE') {
        hasAgg = true
        if (agg === 'COUNT_DISTINCT') {
          expr = `COUNT(DISTINCT ${colRef})`
        } else {
          expr = `${agg}(${colRef})`
        }
      } else {
        nonAggCols.push(colRef)
      }

      if (c.alias && c.alias.trim()) {
        expr += ` AS ${quoteIdent(c.alias.trim(), dialect)}`
      }
      selectItems.push(expr)
    }
  }

  if (selectItems.length === 0) {
    for (const t of state.tables) {
      const alias = tableAliasMap.get(t.id) || t.name
      selectItems.push(`${quoteIdent(alias, dialect)}.*`)
    }
  }

  let sql = 'SELECT'
  if (state.distinct) {
    sql += ' DISTINCT'
  }
  sql += `\n  ${selectItems.join(',\n  ')}`

  // 2. FROM & JOINS
  const targetIds = new Set(state.joins.map((j) => j.targetTableId))
  const rootTable = state.tables.find((t) => !targetIds.has(t.id)) || state.tables[0]
  const rootAlias = tableAliasMap.get(rootTable.id) || rootTable.name

  sql += `\nFROM ${quoteTableRef(rootTable.schema, rootTable.name, dialect)}`
  if (rootAlias !== rootTable.name) {
    sql += ` AS ${quoteIdent(rootAlias, dialect)}`
  }

  const joinedIds = new Set<string>([rootTable.id])

  for (const j of state.joins) {
    const tgtTable = state.tables.find((t) => t.id === j.targetTableId)
    if (!tgtTable) continue
    const tgtAlias = tableAliasMap.get(tgtTable.id) || tgtTable.name
    const srcAlias = tableAliasMap.get(j.sourceTableId) || 't'

    const jt = (j.joinType || 'INNER').toUpperCase()
    const joinKeyword =
      jt === 'LEFT'
        ? 'LEFT JOIN'
        : jt === 'RIGHT'
        ? 'RIGHT JOIN'
        : jt === 'FULL'
        ? 'FULL OUTER JOIN'
        : jt === 'CROSS'
        ? 'CROSS JOIN'
        : 'INNER JOIN'

    if (joinKeyword === 'CROSS JOIN') {
      sql += `\nCROSS JOIN ${quoteTableRef(tgtTable.schema, tgtTable.name, dialect)}`
      if (tgtAlias !== tgtTable.name) {
        sql += ` AS ${quoteIdent(tgtAlias, dialect)}`
      }
    } else {
      sql += `\n${joinKeyword} ${quoteTableRef(tgtTable.schema, tgtTable.name, dialect)}`
      if (tgtAlias !== tgtTable.name) {
        sql += ` AS ${quoteIdent(tgtAlias, dialect)}`
      }
      sql += ` ON ${quoteIdent(srcAlias, dialect)}.${quoteIdent(j.sourceColumn, dialect)} = ${quoteIdent(tgtAlias, dialect)}.${quoteIdent(j.targetColumn, dialect)}`
    }
    joinedIds.add(tgtTable.id)
  }

  // Handle disconnected tables
  for (const t of state.tables) {
    if (!joinedIds.has(t.id)) {
      const alias = tableAliasMap.get(t.id) || t.name
      sql += `\nCROSS JOIN ${quoteTableRef(t.schema, t.name, dialect)}`
      if (alias !== t.name) {
        sql += ` AS ${quoteIdent(alias, dialect)}`
      }
      joinedIds.add(t.id)
    }
  }

  // 3. WHERE filters
  if (state.filters && state.filters.length > 0) {
    sql += '\nWHERE '
    state.filters.forEach((f, i) => {
      const alias = tableAliasMap.get(f.tableId) || 't'
      const colRef = `${quoteIdent(alias, dialect)}.${quoteIdent(f.column, dialect)}`
      const op = (f.operator || '=').toUpperCase()

      let cond = ''
      if (op === 'IS NULL' || op === 'IS NOT NULL') {
        cond = `${colRef} ${op}`
      } else if (op === 'BETWEEN') {
        cond = `${colRef} BETWEEN ${formatLiteralVal(f.value)} AND ${formatLiteralVal(f.value2 || '')}`
      } else if (op === 'IN' || op === 'NOT IN') {
        const items = f.value
          .replace(/[()]/g, '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map(formatLiteralVal)
        cond = `${colRef} ${op} (${items.length ? items.join(', ') : 'NULL'})`
      } else if (op === 'ILIKE' && dialect !== 'postgres') {
        cond = `LOWER(${colRef}) LIKE LOWER(${formatLiteralVal(f.value)})`
      } else {
        cond = `${colRef} ${op} ${formatLiteralVal(f.value)}`
      }

      if (i === 0) {
        sql += cond
      } else {
        const logic = (f.logic || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
        sql += `\n  ${logic} ${cond}`
      }
    })
  }

  // 4. GROUP BY
  const groupByCols: string[] = []
  if (hasAgg && nonAggCols.length > 0) {
    groupByCols.push(...nonAggCols)
  }
  if (state.groupBy && state.groupBy.length > 0) {
    for (const g of state.groupBy) {
      if (!groupByCols.includes(g)) groupByCols.push(g)
    }
  }
  if (groupByCols.length > 0) {
    sql += `\nGROUP BY ${groupByCols.join(', ')}`
  }

  // 5. HAVING
  if (state.havings && state.havings.length > 0) {
    sql += '\nHAVING '
    state.havings.forEach((h, i) => {
      const alias = tableAliasMap.get(h.tableId) || 't'
      const colRef = `${quoteIdent(alias, dialect)}.${quoteIdent(h.column, dialect)}`
      const expr = `${h.aggregate.toUpperCase()}(${colRef})`
      const cond = `${expr} ${h.operator} ${formatLiteralVal(h.value)}`

      if (i === 0) {
        sql += cond
      } else {
        const logic = (h.logic || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
        sql += `\n  ${logic} ${cond}`
      }
    })
  }

  // 6. ORDER BY
  if (state.orderBy && state.orderBy.length > 0) {
    const orderItems = state.orderBy.map((o) => {
      const alias = tableAliasMap.get(o.tableId) || 't'
      const colRef = `${quoteIdent(alias, dialect)}.${quoteIdent(o.column, dialect)}`
      const dir = (o.direction || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
      let item = `${colRef} ${dir}`
      if (o.nulls && o.nulls.toUpperCase() === 'FIRST') {
        item += ' NULLS FIRST'
      } else if (o.nulls && o.nulls.toUpperCase() === 'LAST') {
        item += ' NULLS LAST'
      }
      return item
    })
    sql += `\nORDER BY ${orderItems.join(', ')}`
  }

  // 7. LIMIT / OFFSET
  if (state.limit !== undefined && state.limit >= 0) {
    sql += `\nLIMIT ${state.limit}`
  }
  if (state.offset !== undefined && state.offset > 0) {
    if (state.limit === undefined || state.limit < 0) {
      sql += '\nLIMIT -1'
    }
    sql += ` OFFSET ${state.offset}`
  }

  sql += ';'
  return sql
}

/**
 * Validate visual query state before execution.
 */
export function validateCanvas(state: QueryCanvasState): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  if (!state.tables || state.tables.length === 0) {
    errors.push('No tables added to canvas.')
    return { valid: false, errors, warnings }
  }

  const tableIds = new Set(state.tables.map((t) => t.id))

  // Joins validation
  for (const j of state.joins) {
    if (!tableIds.has(j.sourceTableId)) {
      errors.push(`Join source table '${j.sourceTableId}' does not exist on canvas.`)
    }
    if (!tableIds.has(j.targetTableId)) {
      errors.push(`Join target table '${j.targetTableId}' does not exist on canvas.`)
    }
  }

  if (state.tables.length > 1 && state.joins.length === 0) {
    warnings.push('Multiple tables present without joins will result in a Cartesian product (CROSS JOIN).')
  }

  // Selected columns check
  const totalSelectedCols = state.tables.reduce(
    (acc, t) => acc + t.columns.filter((c) => c.selected).length,
    0
  )
  if (totalSelectedCols === 0) {
    warnings.push('No columns explicitly selected; defaulting to SELECT *.')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
