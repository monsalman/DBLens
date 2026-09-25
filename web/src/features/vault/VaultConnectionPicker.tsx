import React, { useState, useMemo } from 'react'
import { Search, CheckSquare, Square, Shield, Eye, Database } from 'lucide-react'
import type { ConnectionConfig, VaultConnection } from '../../lib/api'
import { formatVaultEnvironment, convertConnectionToVaultItem } from './vaultHelper'

interface Props {
  connections: ConnectionConfig[]
  selectedItems: Map<string, VaultConnection>
  onChange: (items: Map<string, VaultConnection>) => void
  scrubPasswords: boolean
}

export const VaultConnectionPicker: React.FC<Props> = ({
  connections,
  selectedItems,
  onChange,
  scrubPasswords,
}) => {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return connections
    const q = search.toLowerCase()
    return connections.filter(
      (c) =>
        (c.label || '').toLowerCase().includes(q) ||
        (c.name || '').toLowerCase().includes(q) ||
        (c.driver || c.dialect || '').toLowerCase().includes(q) ||
        (c.environment || '').toLowerCase().includes(q)
    )
  }, [connections, search])

  const toggleSelect = (c: ConnectionConfig) => {
    const next = new Map(selectedItems)
    if (next.has(c.id)) {
      next.delete(c.id)
    } else {
      next.set(c.id, convertConnectionToVaultItem(c))
    }
    onChange(next)
  }

  const selectAll = () => {
    const next = new Map(selectedItems)
    for (const c of filtered) {
      if (!next.has(c.id)) {
        next.set(c.id, convertConnectionToVaultItem(c))
      }
    }
    onChange(next)
  }

  const deselectAll = () => {
    const next = new Map(selectedItems)
    for (const c of filtered) {
      next.delete(c.id)
    }
    onChange(next)
  }

  const toggleReadOnlyPolicy = (c: ConnectionConfig, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = new Map(selectedItems)
    const existing = next.get(c.id) || convertConnectionToVaultItem(c)
    existing.policy.enforce_read_only = !existing.policy.enforce_read_only
    next.set(c.id, existing)
    onChange(next)
  }

  const toggleAuditPolicy = (c: ConnectionConfig, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = new Map(selectedItems)
    const existing = next.get(c.id) || convertConnectionToVaultItem(c)
    existing.policy.require_audit_log = !existing.policy.require_audit_log
    next.set(c.id, existing)
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="text"
            placeholder="Search connections by name, driver, or environment..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--surface)] text-[var(--fg)] text-xs pl-8 pr-3 py-1.5 rounded-md border border-[var(--border)] focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0 text-xs">
          <button
            type="button"
            onClick={selectAll}
            className="px-2 py-1 text-[11px] rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border border-[var(--border)] transition-colors"
          >
            Select All
          </button>
          <button
            type="button"
            onClick={deselectAll}
            className="px-2 py-1 text-[11px] rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border border-[var(--border)] transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="max-h-60 overflow-y-auto border border-[var(--border)] rounded-md divide-y divide-[var(--border)] bg-[var(--surface)]">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-[var(--muted)]">
            No connections found.
          </div>
        ) : (
          filtered.map((c) => {
            const isSelected = selectedItems.has(c.id)
            const item = selectedItems.get(c.id) || convertConnectionToVaultItem(c)
            const envBadge = formatVaultEnvironment(c.environment)

            return (
              <div
                key={c.id}
                onClick={() => toggleSelect(c)}
                className={`p-2.5 flex items-center justify-between gap-3 text-xs cursor-pointer transition-colors ${
                  isSelected ? 'bg-indigo-500/5 hover:bg-indigo-500/10' : 'hover:bg-[var(--hover)]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleSelect(c)
                    }}
                    className="text-indigo-500 hover:text-indigo-400 focus:outline-none"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4" />
                    ) : (
                      <Square className="w-4 h-4 text-[var(--muted)]" />
                    )}
                  </button>

                  <Database className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-[var(--fg)] truncate">
                        {c.label || c.name || c.id}
                      </span>
                      <span
                        className={`text-[9px] px-1 py-0.2 rounded border font-mono ${envBadge.colorClass}`}
                      >
                        {envBadge.label}
                      </span>
                      <span className="text-[10px] text-[var(--muted)] font-mono uppercase">
                        {c.driver || c.dialect}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--muted)] truncate font-mono mt-0.5">
                      {scrubPasswords ? 'password → $ENV_VAR' : 'credentials embedded'}
                    </div>
                  </div>
                </div>

                {isSelected && (
                  <div
                    className="flex items-center gap-1.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={(e) => toggleReadOnlyPolicy(c, e)}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                        item.policy.enforce_read_only
                          ? 'bg-rose-500/15 text-rose-500 border-rose-500/40 font-medium'
                          : 'text-[var(--muted)] hover:text-[var(--fg)] border-transparent'
                      }`}
                      title="Enforce Read-Only Safe Mode for this connection"
                    >
                      <Eye className="w-3 h-3" />
                      <span>Safe Mode</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => toggleAuditPolicy(c, e)}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                        item.policy.require_audit_log
                          ? 'bg-amber-500/15 text-amber-500 border-amber-500/40 font-medium'
                          : 'text-[var(--muted)] hover:text-[var(--fg)] border-transparent'
                      }`}
                      title="Require immutable audit logging"
                    >
                      <Shield className="w-3 h-3" />
                      <span>Audit</span>
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] text-[var(--muted)] px-1">
        <span>
          {selectedItems.size} of {connections.length} connection{connections.length === 1 ? '' : 's'} selected
        </span>
        {scrubPasswords && (
          <span className="text-emerald-500 dark:text-emerald-400 font-mono text-[10px]">
            ✓ Password scrubbing active
          </span>
        )}
      </div>
    </div>
  )
}
