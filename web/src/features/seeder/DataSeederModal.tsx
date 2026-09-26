import React, { useEffect, useState } from 'react'
import {
  X,
  Database,
  Play,
  Download,
  Dices,
  RefreshCw,
  GitBranch,
  SlidersHorizontal,
  ChevronRight,
  ChevronLeft,
  ShieldAlert,
  Loader2,
  FileCode,
  FileJson,
  Terminal,
  Check,
} from 'lucide-react'
import { buildSeedCliCommand, copyCliCommand } from '../cli/cliHelper'
import { useAppStore } from '../../stores/appStore'
import { useSeeder } from './useSeeder'
import { TableDAGTimeline } from './TableDAGTimeline'
import { FieldGeneratorConfig } from './FieldGeneratorConfig'
import { SeedProgressDrawer } from './SeedProgressDrawer'
import { formatNumber, calculateRowEstimates } from './seederHelper'

export interface DataSeederModalProps {
  isOpen?: boolean
  onClose?: () => void
  initialTable?: string
}

export const DataSeederModal: React.FC<DataSeederModalProps> = ({
  isOpen: propIsOpen,
  onClose: propOnClose,
  initialTable: propTable,
}) => {
  const isStoreOpen = useAppStore((s) => s.isSeederOpen)
  const closeStore = useAppStore((s) => s.closeSeeder)
  const storeTargetTable = useAppStore((s) => s.seederTargetTable)
  const activeConnId = useAppStore((s) => s.activeConnectionId)
  const connections = useAppStore((s) => s.connections)

  const isOpen = propIsOpen !== undefined ? propIsOpen : isStoreOpen
  const handleClose = propOnClose || closeStore
  const targetTable = propTable || storeTargetTable

  const activeConn = connections.find((c) => c.id === activeConnId)
  const isSafeMode = Boolean(
    activeConn?.readOnly ||
    activeConn?.environment === 'production'
  )

  const {
    selectedTables,
    setSelectedTables,
    defaultRowCount,
    setDefaultRowCount,
    customRowCounts,
    setCustomRowCounts,
    seed,
    setSeed,
    cascade,
    setCascade,
    updateColumnGenerator,
    plan,
    loadingPlan,
    running,
    exporting,
    progress,
    result,
    error,
    activeTab,
    setActiveTab,
    fetchPlan,
    runSeeder,
    exportFixture,
    resetState,
  } = useSeeder(targetTable)

  const [copiedCLI, setCopiedCLI] = useState(false)

  const handleCopyCLI = async () => {
    const cmd = buildSeedCliCommand({
      conn: activeConnId || activeConn?.id || 'conn',
      tables: selectedTables.length > 0 ? selectedTables : (targetTable ? [targetTable] : undefined),
      rows: defaultRowCount,
      seed: seed,
      format: 'direct',
    })
    await copyCliCommand(cmd)
    setCopiedCLI(true)
    setTimeout(() => setCopiedCLI(false), 2000)
  }

  const handleModalClose = () => {
    resetState()
    handleClose()
  }

  // Fetch plan on initial open
  useEffect(() => {
    if (isOpen && activeConnId && !plan && !loadingPlan) {
      fetchPlan()
    }
  }, [isOpen, activeConnId, plan, loadingPlan, fetchPlan])

  // Keyboard escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !running) {
        handleModalClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, running, handleModalClose])

  if (!isOpen) return null

  const rowEstimates = plan
    ? calculateRowEstimates(plan.tables || [], defaultRowCount)
    : { totalRows: 0, estimatedDurationSec: 0 }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div className="flex flex-col w-full max-w-5xl h-[88vh] bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-zinc-100">
                  Synthetic Test Data Pipeline & DAG Fixture Seeder
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  Alt+S
                </span>
                {isSafeMode && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <ShieldAlert className="w-3 h-3" /> Safe Mode Active
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Topologically resolves FK constraints, generates deterministic test data, and exports reproducible fixtures.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Seed Controller */}
            <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1 text-xs">
              <span className="text-zinc-500 text-[11px]">Seed:</span>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(parseInt(e.target.value, 10) || 1)}
                className="w-20 bg-transparent text-zinc-200 font-mono text-xs focus:outline-none"
              />
              <button
                type="button"
                title="Reroll Seed"
                onClick={() => setSeed(Math.floor(Math.random() * 900000) + 100000)}
                className="text-zinc-400 hover:text-indigo-400 transition"
              >
                <Dices className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={handleCopyCLI}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-mono transition cursor-pointer"
              title="Copy equivalent DBLens CLI command"
            >
              {copiedCLI ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Terminal className="w-3.5 h-3.5 text-indigo-400" />
              )}
              <span>{copiedCLI ? 'CLI Copied!' : '>_ CLI'}</span>
            </button>

            <button
              type="button"
              onClick={handleModalClose}
              disabled={running}
              className="text-zinc-400 hover:text-zinc-200 p-1 rounded-md hover:bg-zinc-800 transition disabled:opacity-30"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Stepper Navigation */}
        <div className="flex items-center justify-between px-6 py-2.5 bg-zinc-900/40 border-b border-zinc-800/80 text-xs">
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('dag')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md font-medium transition ${
                activeTab === 'dag'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>1. Tables & DAG</span>
              {plan && (
                <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded bg-black/30">
                  {plan.dagOrder.length}
                </span>
              )}
            </button>

            <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />

            <button
              type="button"
              onClick={() => setActiveTab('columns')}
              disabled={!plan}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md font-medium transition ${
                activeTab === 'columns'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 disabled:opacity-40'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>2. Columns & Samples</span>
            </button>

            <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />

            <button
              type="button"
              onClick={() => setActiveTab('run')}
              disabled={!plan}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md font-medium transition ${
                activeTab === 'run'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 disabled:opacity-40'
              }`}
            >
              <Play className="w-3.5 h-3.5" />
              <span>3. Run & Export</span>
            </button>
          </div>

          {/* Quick Refresh Plan */}
          <button
            type="button"
            onClick={fetchPlan}
            disabled={loadingPlan || running}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingPlan ? 'animate-spin' : ''}`} />
            <span>Recalculate DAG</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-lg text-xs flex items-center justify-between">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => fetchPlan()}
                className="underline hover:text-white"
              >
                Retry
              </button>
            </div>
          )}

          {loadingPlan && !plan && (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-400 space-y-3">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
              <p className="text-xs">Introspecting schema, resolving foreign keys, and computing DAG levels...</p>
            </div>
          )}

          {/* Tab 1: DAG & Tables */}
          {activeTab === 'dag' && plan && (
            <div className="space-y-4">
              {/* Global Controls Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 p-3.5 bg-zinc-900/50 border border-zinc-800 rounded-lg text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-zinc-400 font-medium">Default rows per table:</span>
                  <div className="flex items-center gap-1">
                    {[10, 20, 50, 100].map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => {
                          setDefaultRowCount(cnt)
                          setCustomRowCounts({})
                        }}
                        className={`px-2.5 py-1 rounded text-xs font-mono transition ${
                          defaultRowCount === cnt && Object.keys(customRowCounts).length === 0
                            ? 'bg-indigo-600 text-white font-semibold'
                            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                        }`}
                      >
                        {cnt}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none text-zinc-300">
                  <input
                    type="checkbox"
                    checked={cascade}
                    onChange={(e) => setCascade(e.target.checked)}
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-indigo-600 focus:ring-0 cursor-pointer"
                  />
                  <span>Cascade Parents (auto-include referenced parent tables)</span>
                </label>
              </div>

              {/* Table DAG Timeline */}
              <TableDAGTimeline
                tables={plan.tables || []}
                dagOrder={plan.dagOrder || []}
                selectedTables={selectedTables}
                onToggleTable={(tbl) => {
                  setSelectedTables((prev) =>
                    prev.includes(tbl) ? prev.filter((t) => t !== tbl) : [...prev, tbl]
                  )
                }}
                onSelectAll={() => setSelectedTables((plan.tables || []).map((t) => t.table))}
                onDeselectAll={() => setSelectedTables([])}
                customRowCounts={customRowCounts}
                onUpdateRowCount={(tbl, count) => {
                  setCustomRowCounts((prev) => ({ ...prev, [tbl]: count }))
                }}
                defaultRowCount={defaultRowCount}
                cyclesDetected={plan.cyclesDetected}
              />
            </div>
          )}

          {/* Tab 2: Column Generators & Preview Samples */}
          {activeTab === 'columns' && plan && (
            <FieldGeneratorConfig
              tables={plan.tables || []}
              onUpdateGenerator={updateColumnGenerator}
            />
          )}

          {/* Tab 3: Run & Export */}
          {activeTab === 'run' && plan && (
            <div className="space-y-6">
              {/* Summary Overview Card */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs">
                <div>
                  <span className="text-zinc-500 uppercase tracking-wider text-[10px] block">
                    Execution Targets
                  </span>
                  <span className="text-lg font-semibold text-zinc-100 font-mono">
                    {plan.dagOrder.length} Tables
                  </span>
                  <p className="text-zinc-400 mt-0.5">
                    Order: {plan.dagOrder.join(' → ')}
                  </p>
                </div>

                <div>
                  <span className="text-zinc-500 uppercase tracking-wider text-[10px] block">
                    Total Volume
                  </span>
                  <span className="text-lg font-semibold text-zinc-100 font-mono">
                    {formatNumber(rowEstimates.totalRows)} Rows
                  </span>
                  <p className="text-zinc-400 mt-0.5">
                    Est. Duration: ~{rowEstimates.estimatedDurationSec}s
                  </p>
                </div>

                <div>
                  <span className="text-zinc-500 uppercase tracking-wider text-[10px] block">
                    Referential Integrity
                  </span>
                  <span className="text-lg font-semibold text-emerald-400">
                    Guaranteed (DAG)
                  </span>
                  <p className="text-zinc-400 mt-0.5">
                    {plan.cyclesDetected ? '2-Pass Circular Resolution' : 'Zero FK Violations'}
                  </p>
                </div>
              </div>

              {/* Action Buttons Toolbar */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={runSeeder}
                  disabled={running || isSafeMode}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold shadow-md transition ${
                    isSafeMode
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                >
                  {running ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 fill-current" />
                  )}
                  <span>Run Seeder into Database</span>
                </button>

                <div className="h-6 w-px bg-zinc-800 mx-1 hidden sm:block" />

                <button
                  type="button"
                  onClick={() => exportFixture('sql')}
                  disabled={exporting}
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition border border-zinc-700/60"
                >
                  <FileCode className="w-4 h-4 text-amber-400" />
                  <span>Export SQL Fixture (.sql)</span>
                  <Download className="w-3.5 h-3.5 ml-0.5 text-zinc-400" />
                </button>

                <button
                  type="button"
                  onClick={() => exportFixture('json')}
                  disabled={exporting}
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition border border-zinc-700/60"
                >
                  <FileJson className="w-4 h-4 text-emerald-400" />
                  <span>Export JSON Fixture (.json)</span>
                  <Download className="w-3.5 h-3.5 ml-0.5 text-zinc-400" />
                </button>
              </div>

              {isSafeMode && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-lg text-xs flex items-center gap-2.5">
                  <ShieldAlert className="w-4 h-4 flex-shrink-0 text-amber-400" />
                  <span>
                    Database insertion is blocked because this connection is in Safe Mode (read-only / production). You can still export standalone .sql and .json fixtures freely!
                  </span>
                </div>
              )}

              {/* Real-time Progress Drawer */}
              <SeedProgressDrawer
                progress={progress}
                result={result}
                running={running}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-zinc-800 bg-zinc-900/60 text-xs">
          <div className="text-zinc-500">
            {plan && (
              <span>
                Total estimated: <strong className="text-zinc-300 font-mono">{formatNumber(rowEstimates.totalRows)}</strong> rows across{' '}
                <strong className="text-zinc-300 font-mono">{plan.dagOrder.length}</strong> tables
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {activeTab !== 'dag' && (
              <button
                type="button"
                onClick={() => setActiveTab(activeTab === 'run' ? 'columns' : 'dag')}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-zinc-300 hover:bg-zinc-800 transition"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
            )}

            {activeTab !== 'run' ? (
              <button
                type="button"
                onClick={() => setActiveTab(activeTab === 'dag' ? 'columns' : 'run')}
                disabled={!plan}
                className="flex items-center gap-1 px-4 py-1.5 rounded-md font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleModalClose}
                disabled={running}
                className="px-4 py-1.5 rounded-md text-zinc-400 hover:text-zinc-200 transition"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
