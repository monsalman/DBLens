import React, { useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Layers,
  Database,
  Filter,
  Maximize2,
  Minimize2,
  ArrowRight,
} from 'lucide-react'
import type { AlignedNode } from './planDiffHelper'
import { getDeltaBadgeClass, getSeverityBadgeClass } from './planDiffHelper'

interface Props {
  rootNode: AlignedNode | null | undefined
}

export const PlanDiffTree: React.FC<Props> = ({ rootNode }) => {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [filterSeverity, setFilterSeverity] = useState<string>('all')

  if (!rootNode) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-[var(--muted)]">
        <Layers className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-xs font-mono">No plan comparison tree available.</p>
      </div>
    )
  }

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const collapseAll = () => {
    const allIds = new Set<string>()
    const collect = (node: AlignedNode) => {
      if (node.children && node.children.length > 0) {
        allIds.add(node.id)
        node.children.forEach(collect)
      }
    }
    collect(rootNode)
    setCollapsedIds(allIds)
  }

  const expandAll = () => {
    setCollapsedIds(new Set())
  }

  const renderNode = (node: AlignedNode, depth = 0): React.ReactNode => {
    const hasChildren = node.children && node.children.length > 0
    const isCollapsed = collapsedIds.has(node.id)

    // Check if node matches filter
    const matchesFilter =
      filterSeverity === 'all' ||
      node.bottleneckSeverity.toLowerCase() === filterSeverity.toLowerCase()

    return (
      <React.Fragment key={node.id}>
        {matchesFilter && (
          <div
            className={`group flex items-center justify-between py-2 px-3 hover:bg-[var(--surface)] border-b border-[var(--border)] transition-colors text-xs font-mono ${
              node.bottleneckSeverity === 'critical'
                ? 'bg-rose-950/20'
                : node.bottleneckSeverity === 'high'
                ? 'bg-amber-950/15'
                : ''
            }`}
            style={{ paddingLeft: `${Math.max(12, depth * 22 + 12)}px` }}
          >
            {/* Left Column: Chevron + Operation + Relation */}
            <div className="flex items-center gap-2 min-w-0 flex-1 mr-4">
              {hasChildren ? (
                <button
                  onClick={() => toggleCollapse(node.id)}
                  className="p-0.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] cursor-pointer"
                  title={isCollapsed ? 'Expand node' : 'Collapse node'}
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-4.5 inline-block" />
              )}

              {/* Severity Pill */}
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold border ${getSeverityBadgeClass(
                  node.bottleneckSeverity
                )}`}
              >
                {node.bottleneckSeverity}
              </span>

              {/* Operation */}
              <div className="truncate font-sans font-medium text-[var(--fg)]">
                {node.operation}
              </div>

              {/* Relation badge */}
              {node.relation && (
                <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-indigo-400">
                  <Database className="w-2.5 h-2.5" />
                  {node.relation}
                </span>
              )}

              {/* Index details */}
              {(node.indexBefore || node.indexAfter) && (
                <span className="text-[10px] text-[var(--muted)] hidden md:inline truncate max-w-[180px]">
                  {node.indexAfter || node.indexBefore}
                </span>
              )}

              {/* Filter preview */}
              {(node.filterAfter || node.filterBefore) && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] text-[var(--muted)] hidden lg:inline truncate max-w-[220px]"
                  title={node.filterAfter || node.filterBefore}
                >
                  <Filter className="w-2.5 h-2.5" />
                  {node.filterAfter || node.filterBefore}
                </span>
              )}
            </div>

            {/* Right Column: Comparative Metrics */}
            <div className="flex items-center gap-3 shrink-0 text-right font-mono">
              {/* Cost Delta */}
              <div className="flex items-center gap-1.5" title="Cost Before -> After">
                <span className="text-[11px] text-[var(--muted)] hidden sm:inline">
                  {node.costBefore.toFixed(1)}
                  <ArrowRight className="w-2.5 h-2.5 inline mx-1 opacity-50" />
                  {node.costAfter.toFixed(1)}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${getDeltaBadgeClass(
                    node.costDeltaPct
                  )}`}
                >
                  {node.costDeltaPct > 0 ? '+' : ''}
                  {node.costDeltaPct.toFixed(1)}%
                </span>
              </div>

              {/* Time Delta (if execution time recorded) */}
              {(node.timeBeforeMs > 0 || node.timeAfterMs > 0) && (
                <div className="flex items-center gap-1.5" title="Execution Time Before -> After">
                  <span className="text-[11px] text-[var(--muted)] hidden md:inline">
                    {node.timeBeforeMs.toFixed(2)}ms
                    <ArrowRight className="w-2.5 h-2.5 inline mx-1 opacity-50" />
                    {node.timeAfterMs.toFixed(2)}ms
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${getDeltaBadgeClass(
                      node.timeDeltaPct
                    )}`}
                  >
                    {node.timeDeltaPct > 0 ? '+' : ''}
                    {node.timeDeltaPct.toFixed(1)}%
                  </span>
                </div>
              )}

              {/* Rows Before / After */}
              {(node.rowsBefore > 0 || node.rowsAfter > 0) && (
                <span className="text-[10px] text-[var(--muted)] hidden xl:inline w-20">
                  {node.rowsBefore.toLocaleString()}r → {node.rowsAfter.toLocaleString()}r
                </span>
              )}
            </div>
          </div>
        )}

        {hasChildren && !isCollapsed && (
          <div>
            {node.children!.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </React.Fragment>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Tree Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--surface)] border-b border-[var(--border)] text-xs shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[var(--fg)] flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            Aligned Plan Nodes
          </span>

          {/* Severity Filter */}
          <div className="flex items-center gap-1 ml-3">
            <span className="text-[11px] text-[var(--muted)]">Severity:</span>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="px-2 py-0.5 rounded text-[11px] bg-[var(--bg)] border border-[var(--border)] text-[var(--fg)] outline-hidden cursor-pointer"
            >
              <option value="all">All Levels</option>
              <option value="critical">Critical Only</option>
              <option value="high">High Only</option>
              <option value="medium">Medium Only</option>
              <option value="low">Low / Improvements</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={expandAll}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] text-[11px] text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
            title="Expand All Nodes"
          >
            <Maximize2 className="w-3 h-3" />
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] text-[11px] text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
            title="Collapse All Nodes"
          >
            <Minimize2 className="w-3 h-3" />
            Collapse All
          </button>
        </div>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
        {renderNode(rootNode, 0)}
      </div>
    </div>
  )
}
