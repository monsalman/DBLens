import React, { useState, useEffect } from 'react'
import {
  X,
  Shield,
  Zap,
  CheckCircle,
  Palette,
  RotateCcw,
  Save,
  Loader2,
} from 'lucide-react'
import { api } from '../../lib/api'
import type { RuleMeta, RuleSetting, LintSeverity } from './lintRules'

interface RulesSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onRulesUpdated?: () => void
}

export const RulesSettingsModal: React.FC<RulesSettingsModalProps> = ({
  isOpen,
  onClose,
  onRulesUpdated,
}) => {
  const [rules, setRules] = useState<RuleMeta[]>([])
  const [editedRules, setEditedRules] = useState<Record<string, RuleSetting>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  useEffect(() => {
    if (!isOpen) return

    setIsLoading(true)
    setError(null)
    api
      .getLintRules()
      .then((data) => {
        setRules(data)
        const initialMap: Record<string, RuleSetting> = {}
        for (const r of data) {
          initialMap[r.id] = { enabled: r.enabled, severity: r.severity }
        }
        setEditedRules(initialMap)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [isOpen])

  if (!isOpen) return null

  const handleToggle = (id: string) => {
    setEditedRules((prev) => {
      const current = prev[id] || { enabled: true, severity: 'warning' }
      return {
        ...prev,
        [id]: {
          ...current,
          enabled: !current.enabled,
        },
      }
    })
  }

  const handleSeverityChange = (id: string, severity: LintSeverity) => {
    setEditedRules((prev) => {
      const current = prev[id] || { enabled: true, severity: 'warning' }
      return {
        ...prev,
        [id]: {
          ...current,
          severity,
        },
      }
    })
  }

  const handleResetDefaults = () => {
    const resetMap: Record<string, RuleSetting> = {}
    for (const r of rules) {
      resetMap[r.id] = { enabled: true, severity: r.default_severity }
    }
    setEditedRules(resetMap)
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    try {
      await api.updateLintRules(editedRules)
      onRulesUpdated?.()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }

  const categories = ['all', 'safety', 'performance', 'correctness', 'style']

  const filteredRules = rules.filter((r) => {
    if (selectedCategory === 'all') return true
    return r.category.toLowerCase() === selectedCategory
  })

  const getCategoryIcon = (cat: string) => {
    switch (cat.toLowerCase()) {
      case 'safety':
        return <Shield className="w-3.5 h-3.5 text-red-400" />
      case 'performance':
        return <Zap className="w-3.5 h-3.5 text-amber-400" />
      case 'correctness':
        return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
      case 'style':
      default:
        return <Palette className="w-3.5 h-3.5 text-sky-400" />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface)]/70">
          <div>
            <h2 className="text-sm font-semibold text-[var(--fg)]">
              SQL Static Analyzer & Linter Rules
            </h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Enable rules and configure severity thresholds for in-editor feedback and quality gates.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category filter tabs */}
        <div className="px-5 py-2.5 border-b border-[var(--border)] flex items-center gap-1.5 bg-[var(--surface)]/30 text-xs">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`capitalize px-2.5 py-1 rounded-md transition-colors ${
                selectedCategory === cat
                  ? 'bg-[var(--surface)] text-[var(--fg)] font-medium border border-[var(--border)] shadow-xs'
                  : 'text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-5 divide-y divide-[var(--border)]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-12 text-[var(--muted)]">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400 mb-2" />
              <p className="text-xs">Loading analyzer rules...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-md bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
              {error}
            </div>
          ) : (
            filteredRules.map((rule) => {
              const currentSetting = editedRules[rule.id] || {
                enabled: rule.enabled,
                severity: rule.severity,
              }
              return (
                <div key={rule.id} className="py-3.5 first:pt-0 last:pb-0 flex items-start gap-4">
                  {/* Enable toggle */}
                  <label className="relative inline-flex items-center cursor-pointer mt-1">
                    <input
                      type="checkbox"
                      checked={currentSetting.enabled}
                      onChange={() => handleToggle(rule.id)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-medium text-xs text-[var(--fg)]">
                        {rule.name}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--muted)] bg-[var(--surface)] px-1.5 py-0.2 rounded border border-[var(--border)]">
                        {rule.id}
                      </span>
                      <div className="flex items-center gap-1 text-[10px] text-[var(--muted)]">
                        {getCategoryIcon(rule.category)}
                        <span className="capitalize">{rule.category}</span>
                      </div>
                    </div>

                    <p className="text-xs text-[var(--muted)] leading-relaxed font-sans">
                      {rule.description}
                    </p>
                  </div>

                  {/* Severity selector */}
                  <div className="shrink-0">
                    <select
                      value={currentSetting.severity}
                      disabled={!currentSetting.enabled}
                      onChange={(e) =>
                        handleSeverityChange(rule.id, e.target.value as LintSeverity)
                      }
                      className="text-xs bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] rounded px-2 py-1 disabled:opacity-40 cursor-pointer focus:outline-hidden focus:border-indigo-500"
                    >
                      <option value="error">Error</option>
                      <option value="warning">Warning</option>
                      <option value="info">Info</option>
                    </select>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-between bg-[var(--surface)]/70 text-xs">
          <button
            onClick={handleResetDefaults}
            disabled={isLoading || isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isLoading || isSaving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors shadow-xs"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Save Rules</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
