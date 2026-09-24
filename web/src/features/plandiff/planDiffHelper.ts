import type { ExplainResult } from '../../lib/api'

export interface AlignedNode {
  id: string
  operation: string
  relation?: string
  costBefore: number
  costAfter: number
  costDeltaPct: number
  timeBeforeMs: number
  timeAfterMs: number
  timeDeltaPct: number
  rowsBefore: number
  rowsAfter: number
  rowsDeltaPct: number
  bottleneckSeverity: 'low' | 'medium' | 'high' | 'critical'
  filterBefore?: string
  filterAfter?: string
  indexBefore?: string
  indexAfter?: string
  children?: AlignedNode[]
}

export interface IndexRecommendation {
  table: string
  columns: string[]
  indexType: 'btree' | 'gin' | 'hash' | string
  reason: string
  estimatedCostSavingsPct: number
  ddl: string
  rollbackDdl: string
}

export interface PlanDiffSummary {
  baselineTotalCost: number
  candidateTotalCost: number
  costDeltaPct: number
  baselineTimeMs: number
  candidateTimeMs: number
  timeDeltaPct: number
  bottleneckCount: number
  recommendationsCount: number
}

export interface PlanDiffResult {
  baselinePlan?: ExplainResult | null
  candidatePlan?: ExplainResult | null
  alignedTree?: AlignedNode | null
  summary: PlanDiffSummary
  recommendations?: IndexRecommendation[]
  dialect: string
}

export interface PlanDiffRequest {
  baselineSql?: string
  candidateSql?: string
  baselinePlan?: ExplainResult | null
  candidatePlan?: ExplainResult | null
  dialect?: string
  schema?: string
  readOnly?: boolean
}

export function calculateDeltaPct(before: number, after: number): number {
  if (before === 0) {
    if (after === 0) return 0
    return 100
  }
  if (after === 0) {
    return -100
  }
  const pct = ((after - before) / before) * 100
  return Math.round(pct * 10) / 10
}

/**
 * Returns color classes for deltas.
 * For cost/time, negative delta is improvement (emerald) and positive is regression (rose).
 */
export function getDeltaBadgeClass(deltaPct: number, invert = false): string {
  const isBetter = invert ? deltaPct > 0 : deltaPct < 0
  const isWorse = invert ? deltaPct < 0 : deltaPct > 0

  if (isBetter) {
    return 'text-emerald-400 bg-emerald-950/40 border border-emerald-800/40'
  }
  if (isWorse) {
    return 'text-rose-400 bg-rose-950/40 border border-rose-800/40'
  }
  return 'text-zinc-400 bg-zinc-800/40 border border-zinc-700/40'
}

export function getSeverityBadgeClass(severity: string): string {
  switch (severity?.toLowerCase()) {
    case 'critical':
      return 'text-rose-400 bg-rose-950/60 border border-rose-700/60'
    case 'high':
      return 'text-amber-400 bg-amber-950/60 border border-amber-700/60'
    case 'medium':
      return 'text-yellow-400 bg-yellow-950/60 border border-yellow-700/60'
    case 'low':
    default:
      return 'text-emerald-400 bg-emerald-950/60 border border-emerald-700/60'
  }
}

export function flattenAlignedTree(
  node: AlignedNode | null | undefined,
  depth = 0
): Array<AlignedNode & { depth: number }> {
  if (!node) return []
  const current = [{ ...node, depth }]
  const children = (node.children || []).flatMap((child) => flattenAlignedTree(child, depth + 1))
  return [...current, ...children]
}

export function formatPlanDiffMarkdown(diff: PlanDiffResult): string {
  const lines: string[] = []
  lines.push('# Execution Plan Diff Report\n')

  lines.push('## Executive Summary\n')
  lines.push('| Metric | Baseline | Candidate | Delta |')
  lines.push('| :--- | :--- | :--- | :--- |')

  const costDeltaStr = `${diff.summary.costDeltaPct > 0 ? '+' : ''}${diff.summary.costDeltaPct.toFixed(1)}%`
  const costOutcome = diff.summary.costDeltaPct < 0 ? ' (Improved)' : diff.summary.costDeltaPct > 0 ? ' (Regressed)' : ''
  lines.push(`| **Total Cost** | \`${diff.summary.baselineTotalCost.toFixed(2)}\` | \`${diff.summary.candidateTotalCost.toFixed(2)}\` | **${costDeltaStr}${costOutcome}** |`)

  const timeDeltaStr = `${diff.summary.timeDeltaPct > 0 ? '+' : ''}${diff.summary.timeDeltaPct.toFixed(1)}%`
  const timeOutcome = diff.summary.timeDeltaPct < 0 ? ' (Improved)' : diff.summary.timeDeltaPct > 0 ? ' (Regressed)' : ''
  lines.push(`| **Execution Time** | \`${diff.summary.baselineTimeMs.toFixed(2)} ms\` | \`${diff.summary.candidateTimeMs.toFixed(2)} ms\` | **${timeDeltaStr}${timeOutcome}** |`)

  lines.push(`| **Bottlenecks Detected** | - | - | \`${diff.summary.bottleneckCount}\` |`)
  lines.push(`| **Index Recommendations** | - | - | \`${diff.summary.recommendationsCount}\` |\n`)

  lines.push('## Plan Tree Comparison\n')
  lines.push('| Operation | Relation | Cost (Before -> After) | Cost Delta | Time (Before -> After) | Severity |')
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |')

  const flatNodes = flattenAlignedTree(diff.alignedTree)
  for (const n of flatNodes) {
    const indent = '&nbsp;&nbsp;'.repeat(n.depth)
    const op = `${indent}${n.operation}`
    const rel = n.relation || '-'
    const cost = `${n.costBefore.toFixed(1)} -> ${n.costAfter.toFixed(1)}`
    const costD = `${n.costDeltaPct > 0 ? '+' : ''}${n.costDeltaPct.toFixed(1)}%`
    const time = `${n.timeBeforeMs.toFixed(2)}ms -> ${n.timeAfterMs.toFixed(2)}ms`
    const sev = n.bottleneckSeverity.toUpperCase()
    lines.push(`| ${op} | ${rel} | ${cost} | ${costD} | ${time} | ${sev} |`)
  }
  lines.push('')

  if (diff.recommendations && diff.recommendations.length > 0) {
    lines.push('## Smart Index Recommendations\n')
    diff.recommendations.forEach((rec, idx) => {
      lines.push(`### ${idx + 1}. Index on \`${rec.table}\` (${rec.columns.join(', ')})\n`)
      lines.push(`- **Table:** \`${rec.table}\``)
      lines.push(`- **Columns:** \`${rec.columns.join(', ')}\``)
      lines.push(`- **Index Type:** \`${rec.indexType}\``)
      lines.push(`- **Estimated Cost Savings:** \`${rec.estimatedCostSavingsPct.toFixed(1)}%\``)
      lines.push(`- **Reason:** ${rec.reason}\n`)
      lines.push('```sql')
      lines.push('-- Apply Index')
      lines.push(rec.ddl)
      lines.push('')
      lines.push('-- Rollback')
      lines.push(rec.rollbackDdl)
      lines.push('```\n')
    })
  } else {
    lines.push('## Smart Index Recommendations\n')
    lines.push('*No index bottlenecks identified.*\n')
  }

  return lines.join('\n')
}
