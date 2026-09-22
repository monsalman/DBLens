import React, { useState, useCallback } from 'react'
import { Clock, Plus, RefreshCw } from 'lucide-react'
import { api, type CronJob, type CronJobRun } from '../../lib/api'
import { JobCard } from './JobCard'
import { JobForm } from './JobForm'
import { RunHistoryDrawer } from './RunHistoryDrawer'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export const CronStudio: React.FC<Props> = ({ isOpen, onClose }) => {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(false)
  const [editJob, setEditJob] = useState<CronJob | null | undefined>(undefined) // undefined=closed, null=new
  const [historyJob, setHistoryJob] = useState<{ name: string; runs: CronJobRun[] } | null>(null)
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = await api.listCronJobs()
      setJobs(list ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Load on open
  React.useEffect(() => {
    if (isOpen) load()
  }, [isOpen, load])

  const handleSave = async (job: Partial<CronJob>) => {
    if (job.id) {
      const updated = await api.updateCronJob(job.id, job)
      setJobs((prev) => prev.map((j) => j.id === updated.id ? updated : j))
    } else {
      const created = await api.createCronJob(job)
      setJobs((prev) => [created, ...prev])
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this cron job?')) return
    await api.deleteCronJob(id)
    setJobs((prev) => prev.filter((j) => j.id !== id))
  }

  const handleRun = async (id: string) => {
    setRunningIds((s) => new Set(s).add(id))
    try {
      await api.runCronJobNow(id)
      // Brief delay then refresh to pick up new history
      setTimeout(() => load(), 1500)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRunningIds((s) => { const n = new Set(s); n.delete(id); return n })
    }
  }

  const handleShowHistory = async (job: CronJob) => {
    try {
      const runs = await api.getCronJobHistory(job.id)
      setHistoryJob({ name: job.name, runs })
    } catch (e: any) {
      setError(e.message)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" />
            <h1 className="font-semibold text-[var(--fg)]">Cron & Alerts</h1>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400">
              {jobs.length} job{jobs.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              title="Refresh"
              className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setEditJob(null)}
              className="btn-primary text-xs flex items-center gap-1.5 px-3 py-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> New Job
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] ml-2"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {loading && jobs.length === 0 && (
            <div className="flex justify-center py-12 text-[var(--muted)]">
              <RefreshCw className="w-6 h-6 animate-spin opacity-40" />
            </div>
          )}

          {!loading && jobs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--muted)]">
              <Clock className="w-10 h-10 opacity-20" />
              <p className="text-sm">No cron jobs yet</p>
              <button onClick={() => setEditJob(null)} className="btn-primary text-xs px-4 py-2">
                + Create first job
              </button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {jobs.map((job) => (
              <div key={job.id} className="relative">
                <JobCard
                  job={job}
                  onRun={handleRun}
                  onEdit={(j) => setEditJob(j)}
                  onDelete={handleDelete}
                  onHistory={handleShowHistory}
                  running={runningIds.has(job.id)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Job Form Modal */}
      {editJob !== undefined && (
        <JobForm
          job={editJob}
          onClose={() => setEditJob(undefined)}
          onSave={handleSave}
        />
      )}

      {/* Run History Drawer */}
      {historyJob && (
        <RunHistoryDrawer
          jobName={historyJob.name}
          runs={historyJob.runs}
          onClose={() => setHistoryJob(null)}
        />
      )}
    </div>
  )
}
