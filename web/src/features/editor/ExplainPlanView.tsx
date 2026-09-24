import React, { useState, useMemo } from 'react'
import {
  ListTree,
  FileCode,
  BarChart3,
  AlertTriangle,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  Clock,
  Coins,
  Layers,
  Search,
  Database,
  ArrowUpDown,
  Filter,
  Info,
  Maximize2,
  Minimize2,
  X,
  Zap,
  GitCompare,
} from 'lucide-react'
import type { ExplainResult, PlanNode } from '../../lib/api'

interface Props {
  plan: ExplainResult | null
  isExplaining?: boolean
  onClose?: () => void
  onComparePlan?: () => void
}

// Tree node augmented with unique ID and depth
interface AugmentedNode extends PlanNode {
  _id: string
  _depth: number
  _children: AugmentedNode[]
}

function augmentTree(node: PlanNode, prefix = 'node', depth = 0): AugmentedNode {
  if (depth > 50) {
    return {
      ...node,
      _id: prefix,
      _depth: depth,
      _children: [],
    }
  }
  const children = (node.children || []).map((child, idx) =>
    augmentTree(child, `${prefix}-${idx}`, depth + 1)
  )
  return {
    ...node,
    _id: prefix,
    _depth: depth,
    _children: children,
  }
}

function collectAllNodeIds(node: AugmentedNode): string[] {
  const ids = [node._id]
  for (const child of node._children) {
    ids.push(...collectAllNodeIds(child))
  }
  return ids
}

function collectAllBottlenecks(node: AugmentedNode): { node: AugmentedNode; warning: string }[] {
  const list: { node: AugmentedNode; warning: string }[] = []
  if (node.warnings && node.warnings.length > 0) {
    for (const w of node.warnings) {
      list.push({ node, warning: w })
    }
  } else if (node.isExpensive) {
    list.push({ node, warning: `Expensive operation (${node.nodeType})` })
  }
  for (const child of node._children) {
    list.push(...collectAllBottlenecks(child))
  }
  return list
}

function countTotalNodes(node: AugmentedNode): number {
  let count = 1
  for (const child of node._children) {
    count += countTotalNodes(child)
  }
  return count
}

function getNodeIcon(nodeType: string) {
  const upper = nodeType.toUpperCase()
  if (upper.includes('SCAN') || upper.includes('SEARCH')) {
    return <Search className="w-3.5 h-3.5 text-blue-400" />
  }
  if (upper.includes('JOIN')) {
    return <Layers className="w-3.5 h-3.5 text-purple-400" />
  }
  if (upper.includes('SORT') || upper.includes('ORDER')) {
    return <ArrowUpDown className="w-3.5 h-3.5 text-indigo-400" />
  }
  if (upper.includes('AGGREGATE') || upper.includes('GROUP') || upper.includes('DISTINCT')) {
    return <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
  }
  if (upper.includes('TEMP') || upper.includes('B-TREE')) {
    return <Database className="w-3.5 h-3.5 text-amber-400" />
  }
  if (upper.includes('FILTER') || upper.includes('LIMIT')) {
    return <Filter className="w-3.5 h-3.5 text-cyan-400" />
  }
  return <Layers className="w-3.5 h-3.5 text-[var(--muted)]" />
}

// Find selected node
function findNode(node: AugmentedNode | null, id: string | null): AugmentedNode | null {
  if (!node || !id) return null
  if (node._id === id) return node
  for (const child of node._children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

export const ExplainPlanView: React.FC<Props> = ({ plan, isExplaining, onClose, onComparePlan }) => {
  const [viewMode, setViewMode] = useState<'visual' | 'summary' | 'raw'>('visual')
  const [copied, setCopied] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState('')

  // Build augmented tree with unique IDs
  const augmentedRoot = useMemo(() => {
    if (!plan?.root) return null
    return augmentTree(plan.root, 'node-0', 0)
  }, [plan])

  // Expanded nodes state: default all expanded
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({})

  // If node not selected or selection changed, pick augmentedRoot
  const activeSelectedId = selectedNodeId || augmentedRoot?._id || null

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedNodes((prev) => ({
      ...prev,
      [id]: prev[id] === undefined ? false : !prev[id],
    }))
  }

  const expandAll = () => {
    if (!augmentedRoot) return
    const allIds = collectAllNodeIds(augmentedRoot)
    const map: Record<string, boolean> = {}
    allIds.forEach((id) => {
      map[id] = true
    })
    setExpandedNodes(map)
  }

  const collapseAll = () => {
    if (!augmentedRoot) return
    const allIds = collectAllNodeIds(augmentedRoot)
    const map: Record<string, boolean> = {}
    allIds.forEach((id) => {
      map[id] = false
    })
    map[augmentedRoot._id] = true
    setExpandedNodes(map)
  }

  const selectedNode = useMemo(() => {
    return findNode(augmentedRoot, activeSelectedId) || augmentedRoot
  }, [augmentedRoot, activeSelectedId])

  const bottlenecks = useMemo(() => {
    if (!augmentedRoot) return []
    return collectAllBottlenecks(augmentedRoot)
  }, [augmentedRoot])

  const totalNodesCount = useMemo(() => {
    if (!augmentedRoot) return 0
    return countTotalNodes(augmentedRoot)
  }, [augmentedRoot])

  const copyTimeoutRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  const handleCopyRaw = () => {
    if (!plan) return
    const textToCopy =
      plan.format === 'json'
        ? (() => {
            try {
              return JSON.stringify(JSON.parse(plan.raw), null, 2)
            } catch {
              return plan.raw
            }
          })()
        : plan.raw

    navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000)
  }

  if (isExplaining) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-[var(--muted)] min-h-[300px]">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs font-mono">Analyzing and explaining query execution plan...</p>
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-[var(--muted)] min-h-[250px]">
        <ListTree className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-xs font-mono">No query plan available. Click "Explain" to generate plan.</p>
      </div>
    )
  }

  if (plan.error) {
    return (
      <div className="flex-1 flex flex-col p-6 min-h-[250px] bg-[var(--surface)]">
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-semibold mb-1">Explain Query Failed</h4>
            <pre className="text-xs font-mono whitespace-pre-wrap">{plan.error}</pre>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-[var(--muted)] hover:text-[var(--fg)] p-1 rounded"
              title="Close"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg)] border-t border-[var(--border)] overflow-hidden">
      {/* Explain Toolbar */}
      <div className="h-9 border-b border-[var(--border)] px-3 flex items-center justify-between text-xs bg-[var(--surface)] shrink-0 select-none">
        <div className="flex items-center gap-2">
          {/* Dialect pill */}
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
            {plan.dialect || 'SQL'}
          </span>

          {/* Mode Switcher */}
          <div className="flex items-center rounded-md border border-[var(--border)] bg-[var(--bg)] p-0.5 text-[11px]" role="tablist" aria-label="Explain Views">
            <button
              role="tab"
              aria-selected={viewMode === 'visual'}
              onClick={() => setViewMode('visual')}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded transition-colors ${
                viewMode === 'visual'
                  ? 'bg-[var(--surface)] text-[var(--fg)] font-medium shadow-xs'
                  : 'text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <ListTree className="w-3 h-3 text-indigo-400" />
              <span>Visual Plan</span>
            </button>
            <button
              role="tab"
              aria-selected={viewMode === 'summary'}
              onClick={() => setViewMode('summary')}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded transition-colors ${
                viewMode === 'summary'
                  ? 'bg-[var(--surface)] text-[var(--fg)] font-medium shadow-xs'
                  : 'text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <BarChart3 className="w-3 h-3 text-emerald-400" />
              <span>Summary</span>
              {bottlenecks.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[9px] bg-amber-500/20 text-amber-400 font-mono">
                  {bottlenecks.length}
                </span>
              )}
            </button>
            <button
              role="tab"
              aria-selected={viewMode === 'raw'}
              onClick={() => setViewMode('raw')}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded transition-colors ${
                viewMode === 'raw'
                  ? 'bg-[var(--surface)] text-[var(--fg)] font-medium shadow-xs'
                  : 'text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <FileCode className="w-3 h-3 text-cyan-400" />
              <span>Raw Plan</span>
            </button>
          </div>

          {viewMode === 'visual' && (
            <div className="flex items-center gap-1 ml-2 border-l border-[var(--border)] pl-2">
              <button
                onClick={expandAll}
                className="p-1 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]"
                title="Expand All Nodes"
                aria-label="Expand All Nodes"
              >
                <Maximize2 className="w-3 h-3" />
              </button>
              <button
                onClick={collapseAll}
                className="p-1 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]"
                title="Collapse All Nodes"
                aria-label="Collapse All Nodes"
              >
                <Minimize2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Right side stats summary & actions */}
        <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--muted)]">
          {plan.summary.totalCost !== undefined && plan.summary.totalCost > 0 && (
            <div className="flex items-center gap-1 text-[var(--fg)]" title="Total Estimated Cost">
              <Coins className="w-3 h-3 text-amber-400" />
              <span>Cost: {plan.summary.totalCost.toLocaleString()}</span>
            </div>
          )}
          {plan.summary.executionTime !== undefined && plan.summary.executionTime > 0 && (
            <div className="flex items-center gap-1 text-[var(--fg)]" title="Execution Time">
              <Clock className="w-3 h-3 text-emerald-400" />
              <span>{plan.summary.executionTime.toFixed(2)}ms</span>
            </div>
          )}
          {bottlenecks.length > 0 && (
            <div
              className="flex items-center gap-1 text-amber-400 font-medium cursor-pointer"
              onClick={() => setViewMode('summary')}
              title="Query Bottlenecks Detected"
            >
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              <span>
                {bottlenecks.length} {bottlenecks.length === 1 ? 'Warning' : 'Warnings'}
              </span>
            </div>
          )}

          <button
            onClick={handleCopyRaw}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface)] border border-[var(--border)] transition-colors"
            title="Copy Raw Plan"
            aria-label="Copy Raw Plan"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>

          {onComparePlan && (
            <button
              onClick={onComparePlan}
              className="flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/25 transition-colors font-medium cursor-pointer"
              title="Compare with another query execution plan (Cmd+Shift+E)"
              aria-label="Compare Plan"
            >
              <GitCompare className="w-3 h-3" />
              <span>Compare Plan</span>
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="text-[var(--muted)] hover:text-[var(--fg)] p-1 rounded hover:bg-[var(--hover)] transition-colors"
              title="Close Explain View"
              aria-label="Close Explain View"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area based on viewMode */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* VIEW 1: VISUAL PLAN TREE + INSPECTOR */}
        {viewMode === 'visual' && (
          <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
            {/* Tree Pane */}
            <div className="flex-1 flex flex-col min-h-0 border-r border-[var(--border)] overflow-hidden">
              {/* Tree filter / search bar */}
              <div className="h-8 border-b border-[var(--border)] px-3 flex items-center gap-2 bg-[var(--surface)]/40 shrink-0">
                <Search className="w-3 h-3 text-[var(--muted)]" />
                <input
                  type="text"
                  placeholder="Filter nodes by type, table, or index..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="bg-transparent border-0 text-[11px] text-[var(--fg)] placeholder:text-[var(--muted)] focus:outline-hidden w-full font-mono"
                />
                {searchFilter && (
                  <button
                    onClick={() => setSearchFilter('')}
                    className="text-[var(--muted)] hover:text-[var(--fg)]"
                    title="Clear filter"
                    aria-label="Clear filter"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Node tree list */}
              <div className="flex-1 overflow-auto p-4 space-y-2">
                {augmentedRoot && (
                  <TreeNodeRenderer
                    node={augmentedRoot}
                    selectedId={selectedNodeId}
                    expandedNodes={expandedNodes}
                    onSelectNode={setSelectedNodeId}
                    onToggleExpand={toggleExpand}
                    filterText={searchFilter}
                  />
                )}
              </div>
            </div>

            {/* Inspector Pane */}
            <div className="w-full md:w-80 lg:w-96 flex flex-col min-h-0 bg-[var(--surface)]/30 overflow-auto">
              <NodeInspector node={selectedNode} />
            </div>
          </div>
        )}

        {/* VIEW 2: SUMMARY STATS VIEW */}
        {viewMode === 'summary' && (
          <div className="flex-1 overflow-auto p-6 space-y-6 max-w-5xl mx-auto w-full">
            {/* Top Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xs">
                <div className="flex items-center justify-between text-[var(--muted)] text-xs mb-1 font-mono">
                  <span>Total Cost</span>
                  <Coins className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-xl font-bold font-mono text-[var(--fg)]">
                  {plan.summary.totalCost !== undefined && plan.summary.totalCost > 0
                    ? plan.summary.totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })
                    : 'N/A'}
                </div>
                <p className="text-[10px] text-[var(--muted)] mt-1">
                  Estimated query execution effort
                </p>
              </div>

              <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xs">
                <div className="flex items-center justify-between text-[var(--muted)] text-xs mb-1 font-mono">
                  <span>Execution Time</span>
                  <Clock className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-xl font-bold font-mono text-emerald-400">
                  {plan.summary.executionTime !== undefined && plan.summary.executionTime > 0
                    ? `${plan.summary.executionTime.toFixed(2)} ms`
                    : 'N/A'}
                </div>
                <p className="text-[10px] text-[var(--muted)] mt-1">
                  Actual execution time (EXPLAIN ANALYZE)
                </p>
              </div>

              <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xs">
                <div className="flex items-center justify-between text-[var(--muted)] text-xs mb-1 font-mono">
                  <span>Planning Time</span>
                  <Zap className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-xl font-bold font-mono text-[var(--fg)]">
                  {plan.summary.planningTime !== undefined && plan.summary.planningTime > 0
                    ? `${plan.summary.planningTime.toFixed(2)} ms`
                    : 'N/A'}
                </div>
                <p className="text-[10px] text-[var(--muted)] mt-1">Query optimization & planning</p>
              </div>

              <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xs">
                <div className="flex items-center justify-between text-[var(--muted)] text-xs mb-1 font-mono">
                  <span>Plan Nodes</span>
                  <Layers className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-xl font-bold font-mono text-[var(--fg)]">
                  {totalNodesCount}
                </div>
                <p className="text-[10px] text-[var(--muted)] mt-1">Total operations in execution tree</p>
              </div>
            </div>

            {/* Bottlenecks & Warnings Section */}
            <div className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-[var(--fg)]">
                    Performance Warnings & Bottlenecks
                  </h3>
                </div>
                <span className="text-xs font-mono text-[var(--muted)]">
                  {bottlenecks.length} {bottlenecks.length === 1 ? 'item' : 'items'} detected
                </span>
              </div>

              {bottlenecks.length === 0 ? (
                <div className="p-4 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
                  <span>✅ No critical bottlenecks detected in this query execution plan.</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {bottlenecks.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-semibold text-amber-300">{item.warning}</div>
                          <div className="text-[11px] text-[var(--muted)] font-mono mt-0.5">
                            Node: {item.node.nodeType}
                            {item.node.relationName ? ` on table ${item.node.relationName}` : ''}
                            {item.node.cost ? ` (Cost: ${item.node.cost})` : ''}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedNodeId(item.node._id)
                          setViewMode('visual')
                        }}
                        className="px-2.5 py-1 rounded text-[11px] font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 transition-colors shrink-0"
                      >
                        Inspect Node
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Dialect specific tips */}
            <div className="p-4 rounded-lg bg-[var(--surface)]/50 border border-[var(--border)] text-xs text-[var(--muted)] space-y-1">
              <div className="font-semibold text-[var(--fg)] flex items-center gap-1.5 mb-1">
                <Info className="w-3.5 h-3.5 text-indigo-400" />
                <span>Optimization Tips</span>
              </div>
              <p>• Avoid Sequential Table Scans (Seq Scan / access_type=ALL) on large tables by indexing filter or join columns.</p>
              <p>• Look out for Temporary B-Trees or Filesort operations, which indicate in-memory/disk sorting.</p>
              <p>• Ensure join keys match foreign key indices to allow index lookups rather than nested loop scans.</p>
            </div>
          </div>
        )}

        {/* VIEW 3: RAW PLAN VIEW */}
        {viewMode === 'raw' && (
          <div className="flex-1 flex flex-col min-h-0 bg-[var(--surface)]/20 overflow-hidden">
            <div className="h-8 border-b border-[var(--border)] px-3 flex items-center justify-between bg-[var(--surface)] text-[11px] font-mono text-[var(--muted)] shrink-0">
              <span>Raw {plan.format === 'json' ? 'JSON Plan' : 'Query Plan Text'}</span>
              <button
                onClick={handleCopyRaw}
                className="flex items-center gap-1 text-[var(--muted)] hover:text-[var(--fg)]"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="flex-1 p-4 text-xs font-mono overflow-auto whitespace-pre-wrap text-[var(--fg)] bg-black/40 selection:bg-indigo-500/30">
              {plan.format === 'json'
                ? (() => {
                    try {
                      return JSON.stringify(JSON.parse(plan.raw), null, 2)
                    } catch {
                      return plan.raw
                    }
                  })()
                : plan.raw}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Recursive Tree Node Card ──
interface TreeNodeProps {
  node: AugmentedNode
  selectedId: string | null
  expandedNodes: Record<string, boolean>
  onSelectNode: (id: string) => void
  onToggleExpand: (id: string, e: React.MouseEvent) => void
  filterText: string
}

const TreeNodeRenderer: React.FC<TreeNodeProps> = ({
  node,
  selectedId,
  expandedNodes,
  onSelectNode,
  onToggleExpand,
  filterText,
}) => {
  const isExpanded = expandedNodes[node._id] !== false
  const hasChildren = node._children && node._children.length > 0
  const isSelected = selectedId === node._id

  // Search filter matching
  const matchesFilter = useMemo(() => {
    if (!filterText) return true
    const term = filterText.toLowerCase()
    return (
      node.nodeType.toLowerCase().includes(term) ||
      (node.relationName && node.relationName.toLowerCase().includes(term)) ||
      (node.indexName && node.indexName.toLowerCase().includes(term)) ||
      (node.filter && node.filter.toLowerCase().includes(term))
    )
  }, [node, filterText])

  return (
    <div className={`flex flex-col ${!matchesFilter ? 'opacity-30' : ''}`}>
      {/* Node Card */}
      <div
        role="button"
        tabIndex={0}
        aria-selected={isSelected}
        aria-label={`${node.nodeType}${node.relationName ? ` on table ${node.relationName}` : ''}`}
        onClick={() => onSelectNode(node._id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelectNode(node._id)
          }
        }}
        className={`group relative flex items-start gap-2 p-2.5 rounded-lg border transition-all cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-indigo-500 ${
          isSelected
            ? 'bg-indigo-500/10 border-indigo-500 shadow-xs ring-1 ring-indigo-500/30'
            : node.isExpensive
            ? 'bg-amber-500/5 border-amber-500/30 hover:border-amber-500/60'
            : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--muted)]/40 hover:bg-[var(--hover)]'
        }`}
        style={{ marginLeft: `${node._depth * 20}px` }}
      >
        {/* Expand / Collapse Button */}
        {hasChildren ? (
          <button
            onClick={(e) => onToggleExpand(node._id, e)}
            className="p-0.5 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] shrink-0 mt-0.5"
            aria-label={isExpanded ? 'Collapse node' : 'Expand node'}
            title={isExpanded ? 'Collapse node' : 'Expand node'}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <div className="w-4 shrink-0" />
        )}

        {/* Node Icon */}
        <div className="mt-0.5 shrink-0">{getNodeIcon(node.nodeType)}</div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Node Title */}
            <span className="font-semibold text-xs text-[var(--fg)] font-mono">
              {node.nodeType}
            </span>

            {/* Relation / Table Pill */}
            {node.relationName && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-blue-500/15 text-blue-400 border border-blue-500/20">
                {node.relationName}
                {node.alias ? ` (${node.alias})` : ''}
              </span>
            )}

            {/* Index Pill */}
            {node.indexName && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-purple-500/15 text-purple-400 border border-purple-500/20">
                idx: {node.indexName}
              </span>
            )}

            {/* Bottleneck warning badge */}
            {node.isExpensive && (
              <span className="flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/25">
                <AlertTriangle className="w-2.5 h-2.5" />
                <span>Bottleneck</span>
              </span>
            )}
          </div>

          {/* Metrics summary on card */}
          <div className="flex items-center gap-3 mt-1.5 text-[10px] font-mono text-[var(--muted)] flex-wrap">
            {node.cost !== undefined && node.cost > 0 && (
              <span className="flex items-center gap-1">
                <Coins className="w-2.5 h-2.5 text-amber-400/80" />
                <span>cost: {node.cost.toFixed(1)}</span>
              </span>
            )}
            {node.actualTime !== undefined && node.actualTime > 0 && (
              <span className="flex items-center gap-1 text-emerald-400">
                <Clock className="w-2.5 h-2.5" />
                <span>time: {node.actualTime.toFixed(2)}ms</span>
              </span>
            )}
            {node.rows !== undefined && node.rows > 0 && (
              <span>rows: {node.rows.toLocaleString()}</span>
            )}
            {node.filter && (
              <span className="truncate max-w-[200px] text-cyan-400/80" title={node.filter}>
                filter: {node.filter}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Children list */}
      {hasChildren && isExpanded && (
        <div className="flex flex-col mt-2 space-y-2 relative">
          {node._children.map((child) => (
            <TreeNodeRenderer
              key={child._id}
              node={child}
              selectedId={selectedId}
              expandedNodes={expandedNodes}
              onSelectNode={onSelectNode}
              onToggleExpand={onToggleExpand}
              filterText={filterText}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Node Details Inspector Panel ──
interface InspectorProps {
  node: AugmentedNode | null
}

const NodeInspector: React.FC<InspectorProps> = ({ node }) => {
  if (!node) {
    return (
      <div className="p-6 text-center text-xs text-[var(--muted)] font-mono">
        Select a node in the plan tree to view detailed metrics.
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 font-mono text-xs">
      {/* Header */}
      <div className="border-b border-[var(--border)] pb-3">
        <div className="flex items-center gap-2 mb-1">
          {getNodeIcon(node.nodeType)}
          <h3 className="text-sm font-bold text-[var(--fg)]">{node.nodeType}</h3>
        </div>
        {node.relationName && (
          <div className="text-[11px] text-[var(--muted)]">
            Table: <span className="text-blue-400 font-semibold">{node.relationName}</span>
            {node.alias && <span className="text-[var(--muted)]"> as {node.alias}</span>}
          </div>
        )}
      </div>

      {/* Warnings Banner */}
      {node.warnings && node.warnings.length > 0 && (
        <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300 space-y-1">
          <div className="font-semibold flex items-center gap-1.5 text-xs text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Warnings & Recommendations</span>
          </div>
          {node.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-amber-300/90 leading-relaxed">
              • {w}
            </p>
          ))}
        </div>
      )}

      {/* Cost Metrics */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
          <Coins className="w-3 h-3 text-amber-400" />
          <span>Cost Estimates</span>
        </h4>
        <div className="grid grid-cols-2 gap-2 bg-[var(--surface)] p-2.5 rounded border border-[var(--border)]">
          <div>
            <span className="text-[10px] text-[var(--muted)]">Startup Cost:</span>
            <div className="text-xs font-semibold text-[var(--fg)]">
              {node.startupCost !== undefined ? node.startupCost.toFixed(2) : '0.00'}
            </div>
          </div>
          <div>
            <span className="text-[10px] text-[var(--muted)]">Total Cost:</span>
            <div className="text-xs font-semibold text-amber-400">
              {node.totalCost !== undefined
                ? node.totalCost.toFixed(2)
                : node.cost !== undefined
                ? node.cost.toFixed(2)
                : 'N/A'}
            </div>
          </div>
        </div>
      </div>

      {/* Timing Metrics (if analyze) */}
      {(node.actualTime !== undefined || node.actualStartupTime !== undefined) && (
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-3 h-3 text-emerald-400" />
            <span>Execution Timing</span>
          </h4>
          <div className="grid grid-cols-2 gap-2 bg-[var(--surface)] p-2.5 rounded border border-[var(--border)]">
            <div>
              <span className="text-[10px] text-[var(--muted)]">Startup Time:</span>
              <div className="text-xs font-semibold text-[var(--fg)]">
                {node.actualStartupTime !== undefined ? `${node.actualStartupTime.toFixed(3)} ms` : 'N/A'}
              </div>
            </div>
            <div>
              <span className="text-[10px] text-[var(--muted)]">Total Time:</span>
              <div className="text-xs font-semibold text-emerald-400">
                {node.actualTotalTime !== undefined
                  ? `${node.actualTotalTime.toFixed(3)} ms`
                  : node.actualTime !== undefined
                  ? `${node.actualTime.toFixed(3)} ms`
                  : 'N/A'}
              </div>
            </div>
            {node.actualLoops !== undefined && node.actualLoops > 0 && (
              <div className="col-span-2">
                <span className="text-[10px] text-[var(--muted)]">Loops:</span>
                <span className="ml-2 text-xs font-semibold text-[var(--fg)]">{node.actualLoops}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Row Metrics */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
          Row Statistics
        </h4>
        <div className="grid grid-cols-2 gap-2 bg-[var(--surface)] p-2.5 rounded border border-[var(--border)]">
          <div>
            <span className="text-[10px] text-[var(--muted)]">Plan Rows:</span>
            <div className="text-xs font-semibold text-[var(--fg)]">
              {node.planRows !== undefined
                ? node.planRows.toLocaleString()
                : node.rows !== undefined
                ? node.rows.toLocaleString()
                : 'N/A'}
            </div>
          </div>
          {node.actualRows !== undefined && (
            <div>
              <span className="text-[10px] text-[var(--muted)]">Actual Rows:</span>
              <div className="text-xs font-semibold text-indigo-400">
                {node.actualRows.toLocaleString()}
              </div>
            </div>
          )}
          {node.planWidth !== undefined && node.planWidth > 0 && (
            <div>
              <span className="text-[10px] text-[var(--muted)]">Plan Width:</span>
              <div className="text-xs font-semibold text-[var(--fg)]">{node.planWidth} bytes</div>
            </div>
          )}
        </div>
      </div>

      {/* Filter / Condition Predicates */}
      {(node.filter || node.indexCond || node.hashCond) && (
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
            <Filter className="w-3 h-3 text-cyan-400" />
            <span>Predicates & Conditions</span>
          </h4>
          <div className="space-y-2 bg-[var(--surface)] p-2.5 rounded border border-[var(--border)] text-[11px]">
            {node.filter && (
              <div>
                <span className="text-[10px] text-[var(--muted)] block">Filter:</span>
                <span className="text-cyan-400 break-all">{node.filter}</span>
              </div>
            )}
            {node.indexCond && (
              <div>
                <span className="text-[10px] text-[var(--muted)] block">Index Condition:</span>
                <span className="text-purple-400 break-all">{node.indexCond}</span>
              </div>
            )}
            {node.hashCond && (
              <div>
                <span className="text-[10px] text-[var(--muted)] block">Hash Condition:</span>
                <span className="text-purple-400 break-all">{node.hashCond}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Extra attributes */}
      {node.extra && Object.keys(node.extra).length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
            Additional Properties
          </h4>
          <div className="bg-[var(--surface)] p-2.5 rounded border border-[var(--border)] text-[11px] space-y-1 overflow-x-auto">
            {Object.entries(node.extra).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 py-0.5">
                <span className="text-[var(--muted)] shrink-0">{k}:</span>
                <span className="text-[var(--fg)] truncate">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
