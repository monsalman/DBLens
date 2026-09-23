import React, { useState } from 'react'
import {
  X,
  RefreshCw,
  Download,
  AlertTriangle,
  Search,
  Eye,
  Zap,
  Link2,
  Table as TableIcon,
  FileCode2,
  ListTree,
  Network,
  Trash2,
} from 'lucide-react'
import type { ConnectionConfig } from '../../lib/api'
import { useImpact } from './useImpact'
import { ImpactGraph } from './ImpactGraph'
import { ImpactPlanModal } from './ImpactPlanModal'
import {
  getRiskBadgeClass,
  groupNodesByKind,
  type ImpactNode,
} from './impactHelper'

interface ImpactAnalyzerPanelProps {
  isOpen: boolean
  onClose: () => void
  connId: string
  schema?: string
  object: string
  objectType?: 'table' | 'column' | 'view' | 'routine' | string
  column?: string
  profiles?: ConnectionConfig[]
}

export const ImpactAnalyzerPanel: React.FC<ImpactAnalyzerPanelProps> = ({
  isOpen,
  onClose,
  connId,
  schema = 'public',
  object,
  objectType = 'table',
  column,
  profiles,
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedNode, setSelectedNode] = useState<ImpactNode | null>(null)
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [activeTab, setActiveTab] = useState<'graph' | 'list'>('graph')

  const {
    graph,
    loading,
    error,
    fetchImpact,
    plan,
    planLoading,
    generatePlan,
    downloadMarkdownReport,
  } = useImpact({
    connId,
    schema,
    object,
    objectType,
    column,
    profiles,
    autoLoad: isOpen,
  })

  if (!isOpen) return null

  const handleOpenPlan = async () => {
    setShowPlanModal(true)
    if (!plan) {
      await generatePlan(true)
    }
  }

  const grouped = groupNodesByKind(graph?.nodes || [])
  const filteredNodes = (graph?.nodes || []).filter((n) => {
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    return (
      n.name.toLowerCase().includes(term) ||
      n.kind.toLowerCase().includes(term) ||
      (n.detail && n.detail.toLowerCase().includes(term))
    )
  })

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6">
        <div className="flex flex-col w-full max-w-5xl h-[90vh] max-h-[900px] bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden font-sans">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Network className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-semibold text-[var(--fg)]">
                    Schema Object Impact Analyzer
                  </h2>
                  {graph && (
                    <span
                      className={`px-2.5 py-0.5 text-xs font-mono font-bold rounded-md border uppercase ${getRiskBadgeClass(
                        graph.risk_score
                      )}`}
                    >
                      {graph.risk_score} RISK
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--muted)] font-mono mt-0.5">
                  <span>Target:</span>
                  {schema && <span className="px-1.5 py-0.2 rounded bg-[var(--bg)] border border-[var(--border)]">{schema}</span>}
                  <span className="text-[var(--fg)] font-semibold">{object}</span>
                  {column && (
                    <>
                      <span>.</span>
                      <span className="text-amber-400 font-semibold">{column}</span>
                    </>
                  )}
                  <span className="text-[10px] uppercase text-[var(--muted)]">({column ? 'column' : objectType})</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchImpact()}
                disabled={loading}
                title="Refresh dependencies"
                className="p-1.5 text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] rounded-md transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => downloadMarkdownReport(true)}
                title="Export Impact Markdown"
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Export MD</span>
              </button>
              <button
                onClick={onClose}
                className="p-1.5 text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] rounded-md transition-colors ml-2"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 px-6 py-2.5 border-b border-[var(--border)] bg-[var(--surface)]/50 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="text-[var(--muted)]">Dependents:</span>
              <span className="text-[var(--fg)] font-bold">{graph?.total_dependents || 0}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sky-400">
              <Eye className="w-3.5 h-3.5" />
              <span>{grouped.view?.length || 0} Views</span>
            </div>
            <div className="flex items-center gap-1.5 text-amber-400">
              <Zap className="w-3.5 h-3.5" />
              <span>{grouped.trigger?.length || 0} Triggers</span>
            </div>
            <div className="flex items-center gap-1.5 text-purple-400">
              <Link2 className="w-3.5 h-3.5" />
              <span>{grouped.foreign_key?.length || 0} Foreign Keys</span>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-400">
              <TableIcon className="w-3.5 h-3.5" />
              <span>{grouped.table?.length || 0} Tables</span>
            </div>
          </div>

          {/* Main Controls & Search */}
          <div className="flex items-center justify-between px-6 py-2 border-b border-[var(--border)] bg-[var(--bg)]">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('graph')}
                className={`flex items-center gap-1 px-3 py-1 text-xs rounded-md font-mono transition-colors ${
                  activeTab === 'graph'
                    ? 'bg-indigo-500/15 text-indigo-400 font-semibold'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <Network className="w-3.5 h-3.5" />
                <span>Visual Graph</span>
              </button>
              <button
                onClick={() => setActiveTab('list')}
                className={`flex items-center gap-1 px-3 py-1 text-xs rounded-md font-mono transition-colors ${
                  activeTab === 'list'
                    ? 'bg-indigo-500/15 text-indigo-400 font-semibold'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <ListTree className="w-3.5 h-3.5" />
                <span>Dependency List ({graph?.nodes?.length || 0})</span>
              </button>
            </div>

            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-[var(--muted)]" />
              <input
                type="text"
                placeholder="Filter dependents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1 text-xs font-mono bg-[var(--surface)] border border-[var(--border)] rounded-md text-[var(--fg)] focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Center Canvas / Content Area */}
          <div className="flex-1 overflow-auto p-6 bg-[var(--bg)]">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-64 gap-2 text-xs font-mono text-[var(--muted)]">
                <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                <span>Analyzing catalog relations and textual references...</span>
              </div>
            ) : error ? (
              <div className="flex items-center gap-2 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-xs font-mono text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : activeTab === 'graph' ? (
              <div className="space-y-4">
                <ImpactGraph
                  graph={graph}
                  selectedNodeId={selectedNode?.id}
                  onSelectNode={(node) => setSelectedNode(node)}
                />

                {selectedNode && (
                  <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex items-center justify-between text-xs font-mono">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--muted)]">Selected:</span>
                        <span className="text-[var(--fg)] font-bold">{selectedNode.name}</span>
                        <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] uppercase">
                          {selectedNode.kind}
                        </span>
                        <span className="text-[10px] text-amber-400">[{selectedNode.ref_kind}]</span>
                      </div>
                      {selectedNode.detail && (
                        <div className="text-[11px] text-[var(--muted)]">{selectedNode.detail}</div>
                      )}
                    </div>
                    <button
                      onClick={() => setSelectedNode(null)}
                      className="text-[10px] text-[var(--muted)] hover:text-[var(--fg)]"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredNodes.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-xs font-mono text-[var(--muted)]">
                    No matching dependent objects found.
                  </div>
                ) : (
                  <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--surface)]">
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead>
                        <tr className="border-b border-[var(--border)] bg-[var(--bg)] text-[10px] uppercase text-[var(--muted)]">
                          <th className="py-2 px-3">Kind</th>
                          <th className="py-2 px-3">Name</th>
                          <th className="py-2 px-3">Ref Type</th>
                          <th className="py-2 px-3">Drop Behavior</th>
                          <th className="py-2 px-3">Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {filteredNodes.map((n) => (
                          <tr
                            key={n.id}
                            className="hover:bg-[var(--hover)] transition-colors cursor-pointer"
                            onClick={() => setSelectedNode(n)}
                          >
                            <td className="py-2 px-3">
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg)] border border-[var(--border)] uppercase">
                                {n.kind === 'view' && <Eye className="w-3 h-3 text-sky-400" />}
                                {n.kind === 'trigger' && <Zap className="w-3 h-3 text-amber-400" />}
                                {n.kind === 'foreign_key' && <Link2 className="w-3 h-3 text-purple-400" />}
                                {n.kind === 'table' && <TableIcon className="w-3 h-3 text-emerald-400" />}
                                {n.kind === 'routine' && <FileCode2 className="w-3 h-3 text-rose-400" />}
                                <span>{n.kind}</span>
                              </span>
                            </td>
                            <td className="py-2 px-3 font-semibold text-[var(--fg)]">{n.name}</td>
                            <td className="py-2 px-3 text-[11px] text-[var(--muted)]">
                              <span className={n.ref_kind === 'textual_reference' ? 'text-amber-400' : 'text-indigo-300'}>
                                {n.ref_kind}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-[11px] text-[var(--muted)]">
                              {n.drop_behavior || 'RESTRICT'}
                            </td>
                            <td className="py-2 px-3 text-[11px] text-[var(--muted)] truncate max-w-xs">
                              {n.detail || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-between px-6 py-3.5 border-t border-[var(--border)] bg-[var(--surface)]">
            <div className="text-xs text-[var(--muted)] font-mono">
              Press <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--fg)]">Esc</kbd> to close.
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleOpenPlan}
                disabled={loading || planLoading}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded bg-red-600 hover:bg-red-500 text-white shadow-sm transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Generate Safe Drop Plan</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Remediation Plan Modal */}
      <ImpactPlanModal
        isOpen={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        plan={plan}
        loading={planLoading}
      />
    </>
  )
}
