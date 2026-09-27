import React, { useState, useMemo } from 'react'
import {
  X,
  Camera,
  History,
  GitCompare,
  Plus,
  RefreshCw,
  Search,
  ArrowRight,
  AlertCircle,
  Database,
  Layers,
} from 'lucide-react'
import { useSnapshots } from './useSnapshots'
import { SnapshotTimelineSlider } from './SnapshotTimelineSlider'
import { HistoricalSchemaDiffView } from './HistoricalSchemaDiffView'
import { RollbackDdlDrawer } from './RollbackDdlDrawer'
import {
  filterSnapshots,
  calculateSnapshotStats,
} from './snapshotHelper'
import { useAppStore } from '../../stores/appStore'

interface Props {
  isOpen: boolean
  onClose: () => void
  connId: string | null
}

export const SnapshotVaultModal: React.FC<Props> = ({ isOpen, onClose, connId }) => {
  const activeConn = useAppStore((s) => s.connections.find((c) => c.id === connId))
  const isSafeMode = useAppStore((s) => (connId ? s.isSafeModeActive(connId) : false))
  const isReadOnly = Boolean(activeConn?.readOnly || isSafeMode)

  const {
    snapshots,
    isLoading,
    error,
    isCapturing,
    captureError,
    baseId,
    targetId,
    setBaseId,
    setTargetId,
    diff,
    isDiffing,
    diffError,
    rollbackPlan,
    isPlanLoading,
    planError,
    fetchSnapshots,
    captureSnapshot,
    deleteSnapshot,
    compareSnapshots,
    generateRollback,
  } = useSnapshots(isOpen ? connId : null)

  const [activeTab, setActiveTab] = useState<'timeline' | 'diff'>('timeline')
  const [isRollbackDrawerOpen, setIsRollbackDrawerOpen] = useState(false)

  // Capture form state
  const [newLabel, setNewLabel] = useState('')
  const [newTag, setNewTag] = useState<'manual' | 'pre-migration' | 'auto' | 'baseline'>('manual')
  const [newDesc, setNewDesc] = useState('')
  const [showCaptureForm, setShowCaptureForm] = useState(false)

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('all')

  const filtered = useMemo(() => {
    return filterSnapshots(snapshots, searchQuery, selectedTagFilter)
  }, [snapshots, searchQuery, selectedTagFilter])

  const stats = useMemo(() => {
    return calculateSnapshotStats(snapshots)
  }, [snapshots])

  if (!isOpen) return null

  const handleCapture = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newLabel.trim()) return
    const res = await captureSnapshot({
      label: newLabel.trim(),
      tag: newTag,
      description: newDesc.trim() || undefined,
    })
    if (res) {
      setNewLabel('')
      setNewDesc('')
      setShowCaptureForm(false)
    }
  }

  const handleCompare = async () => {
    if (!baseId) return
    const res = await compareSnapshots(baseId, targetId || undefined, !targetId || targetId === 'live')
    if (res) {
      setActiveTab('diff')
    }
  }

  const handleCompareWithLive = async (selectedBaseId: string) => {
    setBaseId(selectedBaseId)
    setTargetId(null)
    const res = await compareSnapshots(selectedBaseId, undefined, true)
    if (res) {
      setActiveTab('diff')
    }
  }

  const handleGenerateRollback = async () => {
    if (!baseId) return
    const plan = await generateRollback(baseId, targetId || undefined, diff || undefined)
    if (plan) {
      setIsRollbackDrawerOpen(true)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6 animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-5xl h-[90vh] bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--card)]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[var(--fg)]">
                  Time-Travel Schema Snapshot Vault
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Feature-50
                </span>
              </div>
              <p className="text-xs text-[var(--muted)]">
                Point-in-time schema immutability, historical drift timeline, and zero-loss rollback DDL
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchSnapshots()}
              disabled={isLoading}
              className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] cursor-pointer"
              title="Refresh Snapshots"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* KPI Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-6 py-2.5 border-b border-[var(--border)] bg-[var(--bg)] text-xs">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-500" />
            <div>
              <div className="text-[10px] text-[var(--muted)] uppercase font-semibold">Total Snapshots</div>
              <div className="font-semibold text-[var(--fg)]">{stats.total}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-500" />
            <div>
              <div className="text-[10px] text-[var(--muted)] uppercase font-semibold">Avg Tables</div>
              <div className="font-semibold text-[var(--fg)]">{stats.avgTables}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 col-span-2">
            <History className="w-4 h-4 text-purple-500" />
            <div className="min-w-0">
              <div className="text-[10px] text-[var(--muted)] uppercase font-semibold">Latest Checksum</div>
              <div className="font-mono text-[11px] text-[var(--fg)] truncate">
                {stats.latestChecksum || 'None'}
              </div>
            </div>
          </div>
        </div>

        {/* Global Alert messages */}
        {(error || captureError || diffError || planError) && (
          <div className="p-3 bg-rose-500/10 border-b border-rose-500/30 flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="truncate">
              {error || captureError || diffError || planError}
            </span>
          </div>
        )}

        {/* Compare / Action Control Bar */}
        <div className="flex items-center justify-between flex-wrap gap-2 px-6 py-2.5 border-b border-[var(--border)] bg-[var(--card)] text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[var(--muted)] font-medium">Diff Points:</span>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--bg)] border border-blue-500/40 text-blue-500 font-medium">
              <span>Point A:</span>
              <span className="text-[var(--fg)]">
                {baseId ? snapshots.find((s) => s.id === baseId)?.label || baseId.slice(0, 8) : 'None Selected'}
              </span>
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-[var(--muted)]" />

            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--bg)] border border-emerald-500/40 text-emerald-500 font-medium">
              <span>Point B:</span>
              <span className="text-[var(--fg)]">
                {targetId ? snapshots.find((s) => s.id === targetId)?.label || targetId.slice(0, 8) : 'Current Live DB'}
              </span>
            </div>

            <button
              type="button"
              onClick={handleCompare}
              disabled={!baseId || isDiffing}
              className="flex items-center gap-1 px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors cursor-pointer disabled:opacity-40"
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>{isDiffing ? 'Diffing...' : 'Compare Drift'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCaptureForm(!showCaptureForm)}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Capture Snapshot</span>
            </button>
          </div>
        </div>

        {/* Capture Snapshot Inline Form */}
        {showCaptureForm && (
          <form
            onSubmit={handleCapture}
            className="p-4 border-b border-emerald-500/30 bg-emerald-500/5 space-y-3 animate-in fade-in"
          >
            <div className="text-xs font-semibold text-[var(--fg)] flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-emerald-500" />
              <span>Capture New Point-in-Time Schema Snapshot</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                placeholder="Snapshot Label (e.g. Pre-v2.1 Migration)*"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                required
                className="px-3 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--fg)] focus:outline-none focus:border-emerald-500"
              />

              <select
                value={newTag}
                onChange={(e: any) => setNewTag(e.target.value)}
                className="px-3 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--fg)] focus:outline-none focus:border-emerald-500"
              >
                <option value="manual">Tag: Manual</option>
                <option value="pre-migration">Tag: Pre-Migration</option>
                <option value="auto">Tag: Auto</option>
                <option value="baseline">Tag: Baseline</option>
              </select>

              <input
                type="text"
                placeholder="Optional description / migration ticket..."
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="px-3 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--fg)] focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCaptureForm(false)}
                className="px-3 py-1 rounded border border-[var(--border)] text-xs text-[var(--muted)] hover:bg-[var(--hover)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCapturing || !newLabel.trim()}
                className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer disabled:opacity-50"
              >
                {isCapturing ? 'Capturing Snapshot...' : 'Save Snapshot'}
              </button>
            </div>
          </form>
        )}

        {/* View Tabs */}
        <div className="flex items-center justify-between px-6 border-b border-[var(--border)] bg-[var(--bg)]">
          <div className="flex items-center gap-4 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('timeline')}
              className={`py-2.5 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'timeline'
                  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              Timeline Vault ({snapshots.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('diff')}
              className={`py-2.5 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'diff'
                  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <span>Schema Drift Diff</span>
              {diff && diff.totalDrifts > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-600 dark:text-amber-400">
                  {diff.totalDrifts}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'timeline' && (
            <div className="flex items-center gap-2 py-1.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-[var(--muted)]" />
                <input
                  type="text"
                  placeholder="Filter snapshots..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-7 pr-3 py-1 rounded border border-[var(--border)] bg-[var(--card)] text-xs text-[var(--fg)] w-36 sm:w-48 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <select
                value={selectedTagFilter}
                onChange={(e) => setSelectedTagFilter(e.target.value)}
                className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--card)] text-xs text-[var(--fg)] focus:outline-none"
              >
                <option value="all">All Tags</option>
                <option value="manual">Manual</option>
                <option value="pre-migration">Pre-Migration</option>
                <option value="auto">Auto</option>
                <option value="baseline">Baseline</option>
              </select>
            </div>
          )}
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-[var(--bg)]">
          {activeTab === 'timeline' ? (
            <SnapshotTimelineSlider
              snapshots={filtered}
              baseId={baseId}
              targetId={targetId}
              onSelectBase={(id) => setBaseId(id)}
              onSelectTarget={(id) => setTargetId(id)}
              onDelete={(id) => deleteSnapshot(id)}
              onCompareWithLive={handleCompareWithLive}
              isDiffing={isDiffing}
              readOnly={isReadOnly}
            />
          ) : diff ? (
            <HistoricalSchemaDiffView
              diff={diff}
              onGenerateRollback={handleGenerateRollback}
              isGeneratingPlan={isPlanLoading}
            />
          ) : (
            <div className="flex flex-col items-center justify-center p-12 text-center text-[var(--muted)] border border-dashed border-[var(--border)] rounded-lg">
              <GitCompare className="w-10 h-10 mb-2 opacity-40 text-blue-500" />
              <h4 className="text-sm font-semibold text-[var(--fg)]">No Active Diff Comparison</h4>
              <p className="text-xs max-w-sm mt-1">
                Select a Base snapshot from the timeline and click Compare Drift to inspect schema changes.
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--border)] bg-[var(--card)] text-xs text-[var(--muted)]">
          <div className="flex items-center gap-2">
            <span>Shortcut: <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] font-mono text-[10px]">Alt+Shift+S</kbd></span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] text-[var(--fg)] transition-colors cursor-pointer"
          >
            Close Vault
          </button>
        </div>
      </div>

      {/* Rollback DDL Preview Drawer */}
      <RollbackDdlDrawer
        plan={rollbackPlan}
        isOpen={isRollbackDrawerOpen}
        onClose={() => setIsRollbackDrawerOpen(false)}
      />
    </div>
  )
}
