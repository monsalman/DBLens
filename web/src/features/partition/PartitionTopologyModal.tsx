import React, { useEffect } from 'react'
import {
  X,
  RefreshCw,
  Download,
  Sparkles,
  Layers,
  LayoutGrid,
  List,
  Database,
  BarChart2,
  HardDrive,
  Info,
} from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { usePartitionTopology } from './usePartitionTopology'
import { PartitionHealthBanner } from './PartitionHealthBanner'
import { PartitionTreemap } from './PartitionTreemap'
import { PartitionHierarchyTree } from './PartitionHierarchyTree'
import { AutoPartitionGeneratorModal } from './AutoPartitionGeneratorModal'
import {
  formatBytes,
  formatRows,
  formatShare,
  getSkewBadge,
  getStatusBadge,
  getHealthScoreColor,
} from './partitionHelper'

export const PartitionTopologyModal: React.FC = () => {
  const isOpen = useAppStore((s) => s.isPartitionTopologyOpen)
  const close = useAppStore((s) => s.closePartitionTopology)
  const selectedPartitionTable = useAppStore((s) => s.selectedPartitionTable)
  const selectedTable = useAppStore((s) => s.selectedTable)
  const selectedSchema = useAppStore((s) => s.selectedSchema)

  // Use selected table from store or active table from grid
  const schema = selectedPartitionTable?.schema || selectedSchema || 'public'
  const table = selectedPartitionTable?.table || selectedTable || ''

  const {
    topology,
    isLoading,
    error,
    selectedNode,
    metric,
    viewMode,
    isGeneratorOpen,
    setSelectedNode,
    setMetric,
    setViewMode,
    setIsGeneratorOpen,
    refetch,
    detachPartition,
    exportMarkdown,
  } = usePartitionTopology(schema, table)

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        close()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, close])

  if (!isOpen) return null

  const skewBadge = topology ? getSkewBadge(topology.skewIndex) : null
  const healthColors = topology?.healthReport ? getHealthScoreColor(topology.healthReport.score) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative flex flex-col w-full max-w-6xl max-h-[92vh] rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden text-zinc-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold text-white">
                  Partition & Shard Topology Inspector
                </h1>
                <span className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-mono text-zinc-300">
                  {schema ? `${schema}.${table}` : table}
                </span>
                {topology && (
                  <span className="rounded border border-zinc-700 bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 uppercase">
                    {topology.dialect}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400">
                Physical storage visualizer, skew index audit, and automated maintenance planning
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportMarkdown}
              title="Export Markdown Report"
              className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export MD</span>
            </button>

            <button
              type="button"
              onClick={() => refetch()}
              disabled={isLoading}
              title="Refresh Partition Topology"
              className="rounded-md border border-zinc-700 bg-zinc-800/80 p-1.5 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={close}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              {error}
            </div>
          )}

          {/* KPI Summary Cards */}
          {topology && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {/* Strategy & Key */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-1">
                <div className="flex items-center justify-between text-zinc-400 text-xs">
                  <span>Strategy</span>
                  <Database className="h-3.5 w-3.5 text-zinc-500" />
                </div>
                <div className="text-sm font-semibold text-white">{topology.strategy}</div>
                <div className="text-[11px] text-zinc-400 font-mono truncate" title={topology.partitionKey || 'none'}>
                  Key: {topology.partitionKey || 'default'}
                </div>
              </div>

              {/* Partitions Count */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-1">
                <div className="flex items-center justify-between text-zinc-400 text-xs">
                  <span>Slices</span>
                  <Layers className="h-3.5 w-3.5 text-zinc-500" />
                </div>
                <div className="text-sm font-semibold text-white">{topology.partitions.length} partitions</div>
                <div className="text-[11px] text-zinc-400">
                  {topology.partitions.filter((p) => p.status === 'healthy').length} healthy slices
                </div>
              </div>

              {/* Total Storage & Rows */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-1">
                <div className="flex items-center justify-between text-zinc-400 text-xs">
                  <span>Storage</span>
                  <HardDrive className="h-3.5 w-3.5 text-zinc-500" />
                </div>
                <div className="text-sm font-semibold text-white">{formatBytes(topology.totalBytes)}</div>
                <div className="text-[11px] text-zinc-400 font-mono">
                  {formatRows(topology.totalRows)} rows
                </div>
              </div>

              {/* Skew Index */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-1">
                <div className="flex items-center justify-between text-zinc-400 text-xs">
                  <span>Skew Index (CV)</span>
                  <BarChart2 className="h-3.5 w-3.5 text-zinc-500" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-white font-mono">{topology.skewIndex.toFixed(2)}</span>
                  {skewBadge && (
                    <span className={`px-1.5 py-0.2 text-[10px] rounded border font-medium ${skewBadge.badgeClass}`}>
                      {skewBadge.label}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-zinc-500 truncate" title={skewBadge?.description}>
                  StdDev / Mean storage
                </div>
              </div>

              {/* Health Score */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-1">
                <div className="flex items-center justify-between text-zinc-400 text-xs">
                  <span>Health Score</span>
                  <Info className="h-3.5 w-3.5 text-zinc-500" />
                </div>
                <div className="text-sm font-semibold text-white">
                  <span className={healthColors?.textClass}>{topology.healthReport?.score ?? 100}</span>
                  <span className="text-zinc-500 text-xs"> / 100</span>
                </div>
                <div className="text-[11px] text-zinc-400 truncate">
                  {topology.healthReport?.warnings.length || 0} active alert(s)
                </div>
              </div>
            </div>
          )}

          {/* Health Banner */}
          <PartitionHealthBanner
            healthReport={topology?.healthReport}
            onOpenGenerator={() => setIsGeneratorOpen(true)}
          />

          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-2">
              {/* View Mode Toggle */}
              <div className="flex rounded-md border border-zinc-800 bg-zinc-900 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('treemap')}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors ${
                    viewMode === 'treemap'
                      ? 'bg-zinc-800 text-white font-medium shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span>Treemap Visualizer</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('tree')}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors ${
                    viewMode === 'tree'
                      ? 'bg-zinc-800 text-white font-medium shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <List className="h-3.5 w-3.5" />
                  <span>Hierarchy Table</span>
                </button>
              </div>

              {/* Treemap Metric Toggle */}
              {viewMode === 'treemap' && (
                <div className="flex rounded-md border border-zinc-800 bg-zinc-900 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setMetric('bytes')}
                    className={`rounded px-2.5 py-1 transition-colors ${
                      metric === 'bytes'
                        ? 'bg-zinc-800 text-white font-medium shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Size (Bytes)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetric('rows')}
                    className={`rounded px-2.5 py-1 transition-colors ${
                      metric === 'rows'
                        ? 'bg-zinc-800 text-white font-medium shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Rows
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsGeneratorOpen(true)}
                className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors shadow-sm"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Upcoming Partition DDL</span>
              </button>
            </div>
          </div>

          {/* Main Visualizer Area */}
          {isLoading && !topology ? (
            <div className="flex h-[420px] w-full items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
              <div className="flex flex-col items-center gap-2 text-xs text-zinc-400">
                <RefreshCw className="h-6 w-6 animate-spin text-emerald-400" />
                <span>Analyzing partition physical topology...</span>
              </div>
            </div>
          ) : viewMode === 'treemap' ? (
            <PartitionTreemap
              partitions={topology?.partitions || []}
              metric={metric}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
            />
          ) : (
            <PartitionHierarchyTree
              partitions={topology?.partitions || []}
              parentTable={table}
              schema={schema}
              dialect={topology?.dialect || 'postgres'}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
              onDetachPartition={detachPartition}
            />
          )}

          {/* Selected Partition Node Detail Drawer */}
          {selectedNode && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white font-mono text-sm">{selectedNode.name}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold border ${
                      getStatusBadge(selectedNode.status).badgeClass
                    }`}
                  >
                    {getStatusBadge(selectedNode.status).label}
                  </span>
                </div>
                <div className="text-xs text-zinc-400">
                  Parent: <span className="text-zinc-200 font-mono">{selectedNode.parentTable}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
                <div>
                  <span className="text-zinc-500 block">Bound Expression:</span>
                  <span className="font-mono text-zinc-300 text-[11px] truncate block" title={selectedNode.boundExpression}>
                    {selectedNode.boundExpression || 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Storage:</span>
                  <span className="font-mono text-zinc-200">
                    {formatBytes(selectedNode.bytes)} ({formatShare(selectedNode.byteSharePct)})
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Rows:</span>
                  <span className="font-mono text-zinc-200">
                    {formatRows(selectedNode.rows)} ({formatShare(selectedNode.rowSharePct)})
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Partition Type:</span>
                  <span className="font-mono text-zinc-300 capitalize">{selectedNode.partitionType}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-3 bg-zinc-900/40 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span>Tip: Press <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-300">Alt+Shift+P</kbd> to inspect partitions anytime.</span>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* Auto Partition Generator Modal */}
      {topology && (
        <AutoPartitionGeneratorModal
          isOpen={isGeneratorOpen}
          parentTable={table}
          schema={schema}
          dialect={topology.dialect}
          partitionKey={topology.partitionKey}
          onClose={() => setIsGeneratorOpen(false)}
        />
      )}
    </div>
  )
}
