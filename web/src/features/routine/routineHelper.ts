export interface RoutineArg {
  name: string
  type: string
  mode: string // 'IN' | 'OUT' | 'INOUT' | 'VARIADIC'
  ordinalPosition: number
  defaultValue?: string
}

export interface RoutineItem {
  schema: string
  name: string
  routineType: string // 'PROCEDURE' | 'FUNCTION'
  language?: string
  returnType?: string
  arguments: RoutineArg[]
  definition?: string
  comment?: string
}

export interface TriggerItem {
  schema: string
  name: string
  tableSchema: string
  tableName: string
  timing: string // 'BEFORE' | 'AFTER' | 'INSTEAD OF'
  event: string // 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE'
  statement: string
  enabled: boolean
  orientation: string // 'ROW' | 'STATEMENT'
}

export interface ViewItem {
  schema: string
  name: string
  definition: string
  isMaterialized: boolean
  checkOption?: string
  isUpdatable?: string
  owner?: string
}

export interface InvokeRoutineRequest {
  schema: string
  name: string
  routineType: string
  parameters: any[]
}

export interface InvokeRoutineResponse {
  columns: string[]
  rows: any[][]
  durationMs: number
  affectedRows: number
  message?: string
}

export interface SaveRoutinePayload {
  ddl: string
}

export interface ToggleTriggerRequest {
  schema: string
  table: string
  name: string
  enabled: boolean
}

export interface RefreshViewRequest {
  schema: string
  name: string
  concurrently?: boolean
}

/**
 * Filter routines by keyword search and procedure/function type.
 */
export function filterRoutines(
  routines: RoutineItem[],
  search: string,
  typeFilter: 'ALL' | 'PROCEDURE' | 'FUNCTION' = 'ALL'
): RoutineItem[] {
  const query = search.trim().toLowerCase()
  return routines.filter((r) => {
    if (typeFilter !== 'ALL' && r.routineType.toUpperCase() !== typeFilter) {
      return false
    }
    if (!query) return true
    return (
      r.name.toLowerCase().includes(query) ||
      r.schema.toLowerCase().includes(query) ||
      (r.language && r.language.toLowerCase().includes(query)) ||
      (r.returnType && r.returnType.toLowerCase().includes(query)) ||
      (r.comment && r.comment.toLowerCase().includes(query))
    )
  })
}

/**
 * Filter triggers by keyword and table name.
 */
export function filterTriggers(
  triggers: TriggerItem[],
  search: string,
  tableFilter: string = 'ALL'
): TriggerItem[] {
  const query = search.trim().toLowerCase()
  return triggers.filter((t) => {
    if (tableFilter !== 'ALL' && t.tableName.toLowerCase() !== tableFilter.toLowerCase()) {
      return false
    }
    if (!query) return true
    return (
      t.name.toLowerCase().includes(query) ||
      t.tableName.toLowerCase().includes(query) ||
      t.event.toLowerCase().includes(query) ||
      t.timing.toLowerCase().includes(query) ||
      t.statement.toLowerCase().includes(query)
    )
  })
}

/**
 * Filter views by search query and materialized status.
 */
export function filterViews(
  views: ViewItem[],
  search: string,
  matOnly: boolean = false
): ViewItem[] {
  const query = search.trim().toLowerCase()
  return views.filter((v) => {
    if (matOnly && !v.isMaterialized) {
      return false
    }
    if (!query) return true
    return (
      v.name.toLowerCase().includes(query) ||
      v.schema.toLowerCase().includes(query) ||
      (v.definition && v.definition.toLowerCase().includes(query))
    )
  })
}

/**
 * Format signature representation of a routine.
 * e.g. public.calculate_discount(IN price numeric, IN pct int) -> numeric
 */
export function formatRoutineSignature(r: RoutineItem): string {
  const prefix = r.schema ? `${r.schema}.${r.name}` : r.name
  const args = (r.arguments || []).map((arg) => {
    const mode = arg.mode && arg.mode !== 'IN' ? `${arg.mode} ` : ''
    const name = arg.name ? `${arg.name} ` : ''
    const def = arg.defaultValue ? ` DEFAULT ${arg.defaultValue}` : ''
    return `${mode}${name}${arg.type}${def}`.trim()
  })
  const argsList = args.length > 0 ? args.join(', ') : ''
  const ret = r.routineType.toUpperCase() === 'FUNCTION' && r.returnType ? ` -> ${r.returnType}` : ''
  return `${prefix}(${argsList})${ret}`
}

/**
 * Parse raw input strings to typed invocation parameters based on RoutineArg definitions.
 */
export function parseParamValues(
  rawInputs: Record<string, string>,
  args: RoutineArg[]
): any[] {
  return args.map((arg, idx) => {
    const key = arg.name || `param_${idx + 1}`
    const raw = rawInputs[key] ?? ''
    const val = raw.trim()

    if (val === '' || val.toUpperCase() === 'NULL') {
      return null
    }

    const lowerType = (arg.type || '').toLowerCase()

    // Boolean
    if (lowerType.includes('bool')) {
      if (val.toLowerCase() === 'true' || val === '1') return true
      if (val.toLowerCase() === 'false' || val === '0') return false
      return Boolean(val)
    }

    // Integers / Floats
    if (
      lowerType.includes('int') ||
      lowerType.includes('serial') ||
      lowerType.includes('numeric') ||
      lowerType.includes('decimal') ||
      lowerType.includes('real') ||
      lowerType.includes('double') ||
      lowerType.includes('float')
    ) {
      const num = Number(val)
      if (!isNaN(num)) return num
    }

    // JSON objects / arrays
    if (lowerType.includes('json') || lowerType.includes('jsonb')) {
      try {
        return JSON.parse(val)
      } catch {
        return val
      }
    }

    return val
  })
}

/**
 * Group triggers by their target table.
 */
export function groupTriggersByTable(triggers: TriggerItem[]): Record<string, TriggerItem[]> {
  const grouped: Record<string, TriggerItem[]> = {}
  for (const t of triggers) {
    const tbl = t.tableName || 'other'
    if (!grouped[tbl]) {
      grouped[tbl] = []
    }
    grouped[tbl].push(t)
  }
  return grouped
}

/**
 * Generate DDL template for a new routine.
 */
export function generateRoutineTemplate(
  dialect: string,
  type: 'PROCEDURE' | 'FUNCTION',
  name: string = 'new_routine',
  schema: string = 'public'
): string {
  const d = dialect.toLowerCase()
  const qualName = d === 'mysql' ? `\`${schema}\`.\`${name}\`` : `"${schema}"."${name}"`

  if (d.includes('mysql')) {
    if (type === 'PROCEDURE') {
      return `DELIMITER //

CREATE PROCEDURE ${qualName}(IN p_id INT, OUT p_status VARCHAR(50))
BEGIN
    SELECT 'Active' INTO p_status;
END //

DELIMITER ;`
    }
    return `DELIMITER //

CREATE FUNCTION ${qualName}(p_val INT)
RETURNS INT
DETERMINISTIC
BEGIN
    RETURN p_val * 2;
END //

DELIMITER ;`
  }

  // PostgreSQL default
  if (type === 'PROCEDURE') {
    return `CREATE OR REPLACE PROCEDURE ${qualName}(
    p_id integer,
    p_status text
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Routine procedure logic here
    UPDATE users SET status = p_status WHERE id = p_id;
END;
$$;`
  }

  return `CREATE OR REPLACE FUNCTION ${qualName}(
    p_a integer,
    p_b integer
)
RETURNS integer
LANGUAGE plpgsql
AS $$
BEGIN
    -- Routine function logic here
    RETURN p_a + p_b;
END;
$$;`
}

/**
 * Generate DDL template for a new view.
 */
export function generateViewTemplate(
  dialect: string,
  name: string = 'v_new_view',
  schema: string = 'public',
  isMaterialized: boolean = false
): string {
  const d = dialect.toLowerCase()
  const qualName = d === 'mysql' ? `\`${schema}\`.\`${name}\`` : `"${schema}"."${name}"`

  if (isMaterialized && !d.includes('mysql') && !d.includes('sqlite')) {
    return `CREATE MATERIALIZED VIEW ${qualName} AS
SELECT
    id,
    created_at
FROM records
WITH DATA;`
  }

  return `CREATE OR REPLACE VIEW ${qualName} AS
SELECT
    id,
    created_at
FROM records;`
}

/**
 * Get CSS badge classes for trigger firing timing.
 */
export function getTimingBadgeClass(timing: string): string {
  const t = timing.toUpperCase()
  switch (t) {
    case 'BEFORE':
      return 'bg-amber-500/10 text-amber-500 border-amber-500/20'
    case 'AFTER':
      return 'bg-blue-500/10 text-blue-500 border-blue-500/20'
    case 'INSTEAD OF':
      return 'bg-purple-500/10 text-purple-500 border-purple-500/20'
    default:
      return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
  }
}

/**
 * Get CSS badge classes for trigger events.
 */
export function getEventBadgeClass(event: string): string {
  const e = event.toUpperCase()
  if (e.includes('INSERT')) {
    return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
  }
  if (e.includes('UPDATE')) {
    return 'bg-amber-500/10 text-amber-500 border-amber-500/20'
  }
  if (e.includes('DELETE')) {
    return 'bg-red-500/10 text-red-500 border-red-500/20'
  }
  if (e.includes('TRUNCATE')) {
    return 'bg-rose-500/10 text-rose-500 border-rose-500/20'
  }
  return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
}
