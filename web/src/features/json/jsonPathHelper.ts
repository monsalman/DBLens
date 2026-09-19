export type PathSegment = string | number

/**
 * Detect if val is an object/array or a valid JSON string representing an object/array.
 * Ignores primitives like numbers, booleans, or plain non-JSON strings.
 */
export function parseJsonSafely(val: any): { isJson: boolean; parsed: any; error?: string } {
  if (val === null || val === undefined) {
    return { isJson: false, parsed: null }
  }

  if (typeof val === 'object') {
    return { isJson: true, parsed: val }
  }

  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (typeof parsed === 'object' && parsed !== null) {
          return { isJson: true, parsed }
        }
      } catch (err: any) {
        return { isJson: false, parsed: null, error: err?.message || 'Invalid JSON syntax' }
      }
    }
  }

  return { isJson: false, parsed: null }
}

/**
 * Parses a JSONPath string into individual segments (keys and array indices).
 * Supports e.g. '$.user.profile.emails[0]', '$[0].name', 'items.count'.
 */
export function parseJsonPath(jsonPath: string): PathSegment[] {
  if (!jsonPath || typeof jsonPath !== 'string') return []
  const trimmed = jsonPath.trim()
  if (trimmed === '' || trimmed === '$') return []

  // Remove leading '$' or '$.'
  const pathStr = trimmed.startsWith('$') ? trimmed.slice(1) : trimmed
  const cleanStr = pathStr.startsWith('.') ? pathStr.slice(1) : pathStr
  if (!cleanStr) return []

  const segments: PathSegment[] = []
  const regex = /(?:^|\.)([a-zA-Z0-9_$-]+)|\[(\d+)\]|\[['"]([^'"]+)['"]\]/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(cleanStr)) !== null) {
    if (match[1] !== undefined) {
      segments.push(match[1])
    } else if (match[2] !== undefined) {
      segments.push(parseInt(match[2], 10))
    } else if (match[3] !== undefined) {
      segments.push(match[3])
    }
  }

  return segments
}

/**
 * Formats segments back to standardized JSONPath (e.g. $.user.profile.emails[0]).
 */
export function formatJsonPath(segments: PathSegment[]): string {
  if (!segments || segments.length === 0) return '$'
  let res = '$'
  for (const seg of segments) {
    if (typeof seg === 'number') {
      res += `[${seg}]`
    } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(seg)) {
      res += `.${seg}`
    } else {
      res += `["${seg.replace(/"/g, '\\"')}"]`
    }
  }
  return res
}

/**
 * Generates dialect-specific SQL path extraction expression:
 * - PostgreSQL: column->'user'->'profile'->'emails'->>0
 * - MySQL: column->>'$.user.profile.emails[0]'
 * - SQLite: json_extract(column, '$.user.profile.emails[0]')
 */
export function generateDialectSqlPath(
  dialect: string = 'postgres',
  columnName: string,
  jsonPath: string
): string {
  const normDialect = (dialect || 'postgres').toLowerCase()
  const segments = parseJsonPath(jsonPath)
  const normalizedPath = formatJsonPath(segments)

  if (normDialect.includes('sqlite')) {
    return `json_extract(${columnName}, '${normalizedPath}')`
  }

  if (normDialect.includes('mysql') || normDialect.includes('mariadb')) {
    return `${columnName}->>'${normalizedPath}'`
  }

  // Default: PostgreSQL
  if (segments.length === 0) {
    return columnName
  }

  let result = columnName
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const isLast = i === segments.length - 1
    const op = isLast ? '->>' : '->'
    if (typeof seg === 'number') {
      result += `${op}${seg}`
    } else {
      const escapedKey = seg.replace(/'/g, "''")
      result += `${op}'${escapedKey}'`
    }
  }
  return result
}

/**
 * Retrieve value at path from JSON data.
 */
export function getValueByPath(data: any, jsonPath: string): any {
  const segments = parseJsonPath(jsonPath)
  let current = data
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined
    current = current[seg]
  }
  return current
}

/**
 * Immutably set value at path in JSON data.
 */
export function setValueByPath(data: any, jsonPath: string, newValue: any): any {
  const segments = parseJsonPath(jsonPath)
  if (segments.length === 0) {
    return newValue
  }

  const root = Array.isArray(data)
    ? [...data]
    : typeof data === 'object' && data !== null
      ? { ...data }
      : {}

  let current: any = root
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    const nextSeg = segments[i + 1]
    const nextVal = current[seg]

    if (typeof nextSeg === 'number') {
      current[seg] = Array.isArray(nextVal) ? [...nextVal] : []
    } else {
      current[seg] =
        typeof nextVal === 'object' && nextVal !== null && !Array.isArray(nextVal)
          ? { ...nextVal }
          : {}
    }
    current = current[seg]
  }

  const lastSeg = segments[segments.length - 1]
  current[lastSeg] = newValue
  return root
}
