export interface ImpactNode {
  id: string
  kind: 'table' | 'column' | 'view' | 'routine' | 'trigger' | 'foreign_key' | 'index' | string
  schema: string
  name: string
  table_name?: string
  column_name?: string
  ref_kind: 'catalog_fk' | 'catalog_view' | 'catalog_routine' | 'trigger_target' | 'textual_reference' | 'target' | string
  detail: string
  drop_behavior: string
}

export interface ImpactEdge {
  source: string
  target: string
  relationship: string
}

export interface ImpactGraph {
  root: ImpactNode
  nodes: ImpactNode[]
  edges: ImpactEdge[]
  total_dependents: number
  risk_score: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string
}

export interface PlanStep {
  order: number
  action: 'DROP' | 'ALTER' | 'CREATE' | string
  object_kind: string
  object_name: string
  sql: string
  description: string
  irreversible: boolean
}

export interface RemediationPlan {
  target: ImpactNode
  steps: PlanStep[]
  estimated_risk: string
  requires_cascade: boolean
  up_sql: string
  down_sql: string
}

export interface RenameRequest {
  schema?: string
  object: string
  object_type?: string
  column?: string
  new_name: string
}

export interface RenamePlan {
  target: ImpactNode
  new_name: string
  steps: PlanStep[]
  up_sql: string
  down_sql: string
}

/**
 * Calculates risk score based on the kinds of dependent objects and graph topology.
 */
export function calculateImpactRisk(
  nodes: ImpactNode[] = [],
  _edges: ImpactEdge[] = []
): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (!nodes || nodes.length === 0) {
    return 'LOW'
  }

  let hasFK = false
  let hasTrigger = false
  let viewCount = 0
  let tableCount = 0

  for (const n of nodes) {
    if (n.kind === 'foreign_key') hasFK = true
    if (n.kind === 'trigger') hasTrigger = true
    if (n.kind === 'view') viewCount++
    if (n.kind === 'table') tableCount++
  }

  if (tableCount > 0 || hasFK || viewCount >= 4 || nodes.length >= 6) {
    return 'CRITICAL'
  }
  if (hasTrigger || viewCount >= 2 || nodes.length >= 3) {
    return 'HIGH'
  }
  if (nodes.length >= 1) {
    return 'MEDIUM'
  }
  return 'LOW'
}

/**
 * Groups impact nodes by their kind attribute.
 */
export function groupNodesByKind(nodes: ImpactNode[] = []): Record<string, ImpactNode[]> {
  const grouped: Record<string, ImpactNode[]> = {}
  for (const node of nodes) {
    const k = node.kind || 'other'
    if (!grouped[k]) {
      grouped[k] = []
    }
    grouped[k].push(node)
  }
  return grouped
}

/**
 * Returns Tailwind CSS badge classes corresponding to risk score.
 */
export function getRiskBadgeClass(risk: string): string {
  switch (risk?.toUpperCase()) {
    case 'CRITICAL':
      return 'bg-red-500/15 text-red-400 border-red-500/30'
    case 'HIGH':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    case 'MEDIUM':
      return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30'
    case 'LOW':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    default:
      return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'
  }
}

/**
 * Formats a RemediationPlan into markdown format.
 */
export function formatPlanMarkdown(plan: RemediationPlan, graph?: ImpactGraph): string {
  if (!plan) return '# Remediation Plan\n\nNo plan available.\n'

  const lines: string[] = []
  const targetName = plan.target?.name || graph?.root?.name || 'Object'
  const targetKind = plan.target?.kind || graph?.root?.kind || 'table'
  const risk = plan.estimated_risk || graph?.risk_score || 'LOW'

  lines.push(`# Schema Object Impact Report: \`${targetName}\``)
  lines.push('')
  lines.push(`- **Target Kind:** \`${targetKind}\``)
  if (plan.target?.schema) {
    lines.push(`- **Schema:** \`${plan.target.schema}\``)
  }
  lines.push(`- **Estimated Risk:** \`${risk}\``)
  lines.push(`- **Requires Cascade:** \`${plan.requires_cascade}\``)
  lines.push(`- **Execution Steps:** \`${plan.steps?.length || 0}\``)
  lines.push('')

  if (graph?.nodes && graph.nodes.length > 0) {
    lines.push('## Dependent Objects')
    lines.push('')
    lines.push('| Kind | Name | Schema | Dependency Type | Drop Behavior | Detail |')
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |')
    for (const n of graph.nodes) {
      lines.push(`| \`${n.kind}\` | \`${n.name}\` | \`${n.schema}\` | \`${n.ref_kind}\` | \`${n.drop_behavior}\` | ${n.detail || ''} |`)
    }
    lines.push('')
  }

  if (plan.steps && plan.steps.length > 0) {
    lines.push('## Safe Drop Remediation Plan')
    lines.push('')
    lines.push('| Step | Action | Object Kind | Object Name | Irreversible | Description |')
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |')
    for (const s of plan.steps) {
      const irrev = s.irreversible ? '⚠️ YES (Data Loss)' : 'No'
      lines.push(`| ${s.order} | \`${s.action}\` | \`${s.object_kind}\` | \`${s.object_name}\` | ${irrev} | ${s.description} |`)
    }
    lines.push('')
  }

  if (plan.up_sql) {
    lines.push('### Forward Migration (UP SQL)')
    lines.push('')
    lines.push('```sql')
    lines.push(plan.up_sql)
    lines.push('```')
    lines.push('')
  }

  if (plan.down_sql) {
    lines.push('### Rollback Script (DOWN SQL)')
    lines.push('')
    lines.push('```sql')
    lines.push(plan.down_sql)
    lines.push('```')
    lines.push('')
  }

  return lines.join('\n')
}
