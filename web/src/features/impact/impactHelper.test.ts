import {
  calculateImpactRisk,
  groupNodesByKind,
  getRiskBadgeClass,
  formatPlanMarkdown,
  type ImpactNode,
  type RemediationPlan,
  type ImpactGraph,
} from './impactHelper.ts'

declare const process: { exit: (code: number) => void }

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`)
  }
}

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err: any) {
    failed++
    console.error(`  ✗ ${name}: ${err.message}`)
  }
}

console.log('--- Running Impact Helper Unit Tests ---')

test('calculateImpactRisk: evaluates risk levels correctly', () => {
  // Empty
  assert(calculateImpactRisk([], []) === 'LOW', 'empty should be LOW')

  // Low/Medium: 1 view
  const singleView: ImpactNode[] = [
    { id: 'v1', kind: 'view', schema: 'public', name: 'v_users', ref_kind: 'catalog_view', detail: '', drop_behavior: 'CASCADE' },
  ]
  assert(calculateImpactRisk(singleView, []) === 'MEDIUM', 'single view should be MEDIUM')

  // High: 1 trigger
  const triggerNode: ImpactNode[] = [
    { id: 't1', kind: 'trigger', schema: 'public', name: 'trg_audit', ref_kind: 'trigger_target', detail: '', drop_behavior: 'RESTRICT' },
  ]
  assert(calculateImpactRisk(triggerNode, []) === 'HIGH', 'trigger should be HIGH')

  // High: 2 views
  const twoViews: ImpactNode[] = [
    { id: 'v1', kind: 'view', schema: 'public', name: 'v1', ref_kind: 'catalog_view', detail: '', drop_behavior: 'CASCADE' },
    { id: 'v2', kind: 'view', schema: 'public', name: 'v2', ref_kind: 'catalog_view', detail: '', drop_behavior: 'CASCADE' },
  ]
  assert(calculateImpactRisk(twoViews, []) === 'HIGH', 'two views should be HIGH')

  // Critical: FK dependency
  const fkNode: ImpactNode[] = [
    { id: 'fk1', kind: 'foreign_key', schema: 'public', name: 'fk_orders_user', ref_kind: 'catalog_fk', detail: '', drop_behavior: 'RESTRICT' },
  ]
  assert(calculateImpactRisk(fkNode, []) === 'CRITICAL', 'FK should be CRITICAL')

  // Critical: Table dependency
  const tableNode: ImpactNode[] = [
    { id: 'tbl1', kind: 'table', schema: 'public', name: 'orders', ref_kind: 'catalog_fk', detail: '', drop_behavior: 'RESTRICT' },
  ]
  assert(calculateImpactRisk(tableNode, []) === 'CRITICAL', 'table should be CRITICAL')

  // Critical: 6+ nodes
  const sixNodes: ImpactNode[] = Array.from({ length: 6 }, (_, i) => ({
    id: `node-${i}`,
    kind: 'routine',
    schema: 'public',
    name: `proc_${i}`,
    ref_kind: 'catalog_routine',
    detail: '',
    drop_behavior: 'RESTRICT',
  }))
  assert(calculateImpactRisk(sixNodes, []) === 'CRITICAL', '6+ nodes should be CRITICAL')
})

test('groupNodesByKind: partitions nodes by object type', () => {
  const nodes: ImpactNode[] = [
    { id: '1', kind: 'view', schema: 'public', name: 'v1', ref_kind: 'catalog_view', detail: '', drop_behavior: 'CASCADE' },
    { id: '2', kind: 'view', schema: 'public', name: 'v2', ref_kind: 'catalog_view', detail: '', drop_behavior: 'CASCADE' },
    { id: '3', kind: 'trigger', schema: 'public', name: 'trg1', ref_kind: 'trigger_target', detail: '', drop_behavior: 'RESTRICT' },
    { id: '4', kind: 'foreign_key', schema: 'public', name: 'fk1', ref_kind: 'catalog_fk', detail: '', drop_behavior: 'RESTRICT' },
  ]

  const grouped = groupNodesByKind(nodes)
  assert(grouped.view?.length === 2, 'expected 2 views')
  assert(grouped.trigger?.length === 1, 'expected 1 trigger')
  assert(grouped.foreign_key?.length === 1, 'expected 1 foreign key')
  assert(grouped.table === undefined, 'expected no tables')
})

test('getRiskBadgeClass: returns proper Tailwind badge classes', () => {
  assert(getRiskBadgeClass('CRITICAL').includes('text-red-400'), 'CRITICAL should be red')
  assert(getRiskBadgeClass('HIGH').includes('text-amber-400'), 'HIGH should be amber')
  assert(getRiskBadgeClass('MEDIUM').includes('text-yellow-300'), 'MEDIUM should be yellow')
  assert(getRiskBadgeClass('LOW').includes('text-emerald-400'), 'LOW should be emerald')
  assert(getRiskBadgeClass('UNKNOWN').includes('text-zinc-400'), 'UNKNOWN should fallback to zinc')
})

test('formatPlanMarkdown: renders full markdown report', () => {
  const target: ImpactNode = {
    id: 'public.customers',
    kind: 'table',
    schema: 'public',
    name: 'customers',
    ref_kind: 'target',
    detail: 'Target table',
    drop_behavior: 'RESTRICT',
  }

  const plan: RemediationPlan = {
    target,
    steps: [
      {
        order: 1,
        action: 'DROP',
        object_kind: 'trigger',
        object_name: 'trg_cust_audit',
        sql: 'DROP TRIGGER trg_cust_audit;',
        description: 'Drop trigger before table',
        irreversible: false,
      },
      {
        order: 2,
        action: 'DROP',
        object_kind: 'table',
        object_name: 'customers',
        sql: 'DROP TABLE customers;',
        description: 'Permanently drop table',
        irreversible: true,
      },
    ],
    estimated_risk: 'HIGH',
    requires_cascade: true,
    up_sql: 'BEGIN;\nDROP TRIGGER trg_cust_audit;\nDROP TABLE customers;\nCOMMIT;',
    down_sql: 'BEGIN;\n-- Recreate customers\nCOMMIT;',
  }

  const graph: ImpactGraph = {
    root: target,
    nodes: [
      {
        id: 'trg1',
        kind: 'trigger',
        schema: 'public',
        name: 'trg_cust_audit',
        ref_kind: 'trigger_target',
        detail: 'Audit trigger',
        drop_behavior: 'RESTRICT',
      },
    ],
    edges: [],
    total_dependents: 1,
    risk_score: 'HIGH',
  }

  const md = formatPlanMarkdown(plan, graph)
  assert(md.includes('# Schema Object Impact Report: `customers`'), 'markdown has report title')
  assert(md.includes('## Dependent Objects'), 'markdown has dependent objects section')
  assert(md.includes('## Safe Drop Remediation Plan'), 'markdown has safe drop section')
  assert(md.includes('⚠️ YES (Data Loss)'), 'markdown highlights irreversible step')
  assert(md.includes('### Forward Migration (UP SQL)'), 'markdown has UP SQL')
  assert(md.includes('### Rollback Script (DOWN SQL)'), 'markdown has DOWN SQL')
})

console.log(`\nImpact Helper Tests Summary: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
