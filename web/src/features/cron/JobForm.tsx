import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import type { CronJob, CronAlertRule } from '../../lib/api'
import { useAppStore } from '../../stores/appStore'

interface Props {
  job?: CronJob | null
  onClose: () => void
  onSave: (job: Partial<CronJob>) => Promise<void>
}

const emptyRule: CronAlertRule = { condition: '', threshold: 0, webhook_url: '', message: '' }

export const JobForm: React.FC<Props> = ({ job, onClose, onSave }) => {
  const connections = useAppStore((s) => s.connections)
  const [name, setName] = useState(job?.name ?? '')
  const [connId, setConnId] = useState(job?.conn_id ?? connections[0]?.id ?? '')
  const [sql, setSql] = useState(job?.sql ?? 'SELECT COUNT(*) FROM')
  const [intervalSec, setIntervalSec] = useState(String(job?.interval_sec ?? 60))
  const [enabled, setEnabled] = useState(job?.enabled ?? true)
  const [rule, setRule] = useState<CronAlertRule>(job?.alert_rule ?? { ...emptyRule })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (job) {
      setName(job.name)
      setConnId(job.conn_id)
      setSql(job.sql)
      setIntervalSec(String(job.interval_sec))
      setEnabled(job.enabled)
      setRule(job.alert_rule ?? { ...emptyRule })
    }
  }, [job])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Name is required'); return }
    if (!sql.trim()) { setError('SQL is required'); return }
    setSaving(true)
    try {
      await onSave({
        ...(job ? { id: job.id } : {}),
        name: name.trim(),
        conn_id: connId,
        sql: sql.trim(),
        interval_sec: parseInt(intervalSec) || 0,
        enabled,
        alert_rule: rule,
      })
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="font-semibold text-[var(--fg)]">{job ? 'Edit Cron Job' : 'New Cron Job'}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--hover)] text-[var(--muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--hover)] px-3 py-2 text-sm text-[var(--fg)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Heartbeat check"
            />
          </div>

          {/* Connection */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Connection</label>
            <select
              value={connId}
              onChange={(e) => setConnId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--hover)] px-3 py-2 text-sm text-[var(--fg)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">— none —</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>{c.label || c.id}</option>
              ))}
            </select>
          </div>

          {/* SQL */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">SQL *</label>
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--hover)] px-3 py-2 text-sm font-mono text-[var(--fg)] focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
              placeholder="SELECT COUNT(*) FROM users"
            />
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Interval (seconds)</label>
            <input
              type="number"
              min="0"
              value={intervalSec}
              onChange={(e) => setIntervalSec(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--hover)] px-3 py-2 text-sm text-[var(--fg)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="60"
            />
            <p className="text-[10px] text-[var(--muted)] mt-1">0 = manual only. 60 = every minute.</p>
          </div>

          {/* Enabled */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-indigo-500"
            />
            <label htmlFor="enabled" className="text-sm text-[var(--fg)]">Enabled</label>
          </div>

          {/* Alert Rule */}
          <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
            <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Alert Rule (optional)</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--muted)] mb-1">Condition</label>
                <select
                  value={rule.condition}
                  onChange={(e) => setRule((r) => ({ ...r, condition: e.target.value as any }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--hover)] px-2 py-1.5 text-sm text-[var(--fg)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">— none —</option>
                  <option value="gt">&gt; greater than</option>
                  <option value="gte">≥ greater or equal</option>
                  <option value="lt">&lt; less than</option>
                  <option value="lte">≤ less or equal</option>
                  <option value="eq">= equals</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--muted)] mb-1">Threshold</label>
                <input
                  type="number"
                  value={rule.threshold}
                  onChange={(e) => setRule((r) => ({ ...r, threshold: parseFloat(e.target.value) || 0 }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--hover)] px-2 py-1.5 text-sm text-[var(--fg)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">Webhook URL (Slack/Discord/generic)</label>
              <input
                value={rule.webhook_url}
                onChange={(e) => setRule((r) => ({ ...r, webhook_url: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--hover)] px-2 py-1.5 text-sm text-[var(--fg)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="https://hooks.slack.com/..."
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">Alert Message</label>
              <input
                value={rule.message}
                onChange={(e) => setRule((r) => ({ ...r, message: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--hover)] px-2 py-1.5 text-sm text-[var(--fg)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="[DBLens] Alert triggered"
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-[var(--muted)] hover:bg-[var(--hover)] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit as any}
            disabled={saving}
            className="btn-primary text-sm px-5 py-2 disabled:opacity-50"
          >
            {saving ? 'Saving…' : job ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
