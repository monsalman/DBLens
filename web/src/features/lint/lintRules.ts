export type LintSeverity = 'error' | 'warning' | 'info'

export interface QuickFix {
  title: string
  replacement: string
  start_offset: number
  end_offset: number
}

export interface LintDiagnostic {
  rule_id: string
  message: string
  severity: LintSeverity
  line: number
  col: number
  start_offset: number
  end_offset: number
  quick_fix?: QuickFix
}

export interface RuleSetting {
  enabled: boolean
  severity?: LintSeverity
}

export interface RuleMeta {
  id: string
  name: string
  description: string
  category: 'safety' | 'performance' | 'correctness' | 'style' | string
  default_severity: LintSeverity
  enabled: boolean
  severity: LintSeverity
}

export interface AnalysisSummary {
  errors: number
  warnings: number
  info: number
  total: number
}

export interface AnalyzeResult {
  diagnostics: LintDiagnostic[]
  summary: AnalysisSummary
}

export interface GateRequest {
  sql: string
  dialect?: string
  schema?: string
  known_tables?: string[]
  known_cols?: Record<string, string[]>
  rule_config?: Record<string, RuleSetting>
  fail_on_severity?: LintSeverity
  max_allowed?: number
}

export interface GateResult {
  passed: boolean
  reason: string
  summary: AnalysisSummary
  diagnostics: LintDiagnostic[]
}

/**
 * Apply a quick fix to the SQL string at specified byte offsets.
 */
export function applyQuickFix(sql: string, fix: QuickFix): string {
  if (fix.start_offset < 0 || fix.end_offset < fix.start_offset || fix.start_offset > sql.length) {
    return sql
  }
  return sql.slice(0, fix.start_offset) + fix.replacement + sql.slice(fix.end_offset)
}

/**
 * Format summary counts into human-readable label.
 */
export function formatDiagnosticSummary(summary: AnalysisSummary): string {
  if (!summary || summary.total === 0) {
    return 'No issues detected'
  }

  const parts: string[] = []
  if (summary.errors > 0) {
    parts.push(`${summary.errors} ${summary.errors === 1 ? 'error' : 'errors'}`)
  }
  if (summary.warnings > 0) {
    parts.push(`${summary.warnings} ${summary.warnings === 1 ? 'warning' : 'warnings'}`)
  }
  if (summary.info > 0) {
    parts.push(`${summary.info} info`)
  }
  return parts.join(', ')
}

/**
 * UI visual styling attributes for each severity level.
 */
export function getSeverityStyle(severity: LintSeverity) {
  switch (severity) {
    case 'error':
      return {
        badge: 'bg-red-500/15 text-red-400 border-red-500/30',
        text: 'text-red-400',
        bg: 'bg-red-500/10',
        border: 'border-red-500/40',
        iconName: 'AlertCircle',
        label: 'Error',
      }
    case 'warning':
      return {
        badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        text: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/40',
        iconName: 'AlertTriangle',
        label: 'Warning',
      }
    case 'info':
    default:
      return {
        badge: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
        text: 'text-sky-400',
        bg: 'bg-sky-500/10',
        border: 'border-sky-500/40',
        iconName: 'Info',
        label: 'Info',
      }
  }
}

/**
 * Fast client-side pre-analyzer for instant offline validation when needed.
 */
export function fastClientCheck(sql: string): LintDiagnostic[] {
  const diags: LintDiagnostic[] = []
  const trimmed = sql.trim()
  if (!trimmed) return diags

  // 1. UPDATE or DELETE without WHERE check
  const upper = trimmed.toUpperCase()
  if (upper.startsWith('UPDATE') || upper.startsWith('DELETE')) {
    if (!/\bWHERE\b/i.test(trimmed)) {
      diags.push({
        rule_id: 'update-delete-without-where',
        message: 'UPDATE or DELETE without a WHERE clause will modify or delete all rows.',
        severity: 'error',
        line: 1,
        col: 1,
        start_offset: 0,
        end_offset: Math.min(6, trimmed.length),
        quick_fix: {
          title: 'Add WHERE 1=0 safeguard',
          replacement: trimmed.endsWith(';')
            ? trimmed.slice(0, -1) + ' WHERE 1 = 0;'
            : trimmed + ' WHERE 1 = 0',
          start_offset: 0,
          end_offset: trimmed.length,
        },
      })
    }
  }

  // 2. SELECT * check
  const selectStarMatch = /\bSELECT\s+\*/i.exec(sql)
  if (selectStarMatch && !/\bEXISTS\s*\(\s*SELECT\s+\*/i.test(sql)) {
    const start = selectStarMatch.index + selectStarMatch[0].length - 1
    diags.push({
      rule_id: 'select-star',
      message: "Avoid 'SELECT *'. Explicit columns improve performance and maintainability.",
      severity: 'warning',
      line: 1,
      col: start + 1,
      start_offset: start,
      end_offset: start + 1,
      quick_fix: {
        title: 'Specify column list',
        replacement: 'id, name',
        start_offset: start,
        end_offset: start + 1,
      },
    })
  }

  // 3. Leading wildcard LIKE '%...'
  const likeMatch = /\b(?:LIKE|ILIKE)\s+'([%_][^']*)'/i.exec(sql)
  if (likeMatch) {
    const fullMatch = likeMatch[0]
    const stringVal = likeMatch[1]
    const stringOffset = sql.indexOf(fullMatch) + fullMatch.indexOf(`'${stringVal}'`)
    diags.push({
      rule_id: 'leading-wildcard-like',
      message: `LIKE pattern '${stringVal}' begins with a wildcard, disabling B-tree index scan.`,
      severity: 'warning',
      line: 1,
      col: stringOffset + 1,
      start_offset: stringOffset,
      end_offset: stringOffset + stringVal.length + 2,
      quick_fix: {
        title: 'Remove leading wildcard',
        replacement: `'${stringVal.replace(/^[%_]+/, '')}'`,
        start_offset: stringOffset,
        end_offset: stringOffset + stringVal.length + 2,
      },
    })
  }

  return diags
}
