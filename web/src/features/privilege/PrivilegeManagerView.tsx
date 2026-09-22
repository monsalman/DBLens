import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Shield,
  ShieldAlert,
  Key,
  Check,
  X,
  AlertTriangle,
  RefreshCw,
  Search,
  Copy,
  User,
  Users,
  CheckCircle2,
  Filter,
  ArrowRight,
  Database,
} from 'lucide-react'
import {
  api,
  type PrivilegeReport,
  type PrivilegeChange,
  type PrivilegePlan,
} from '../../lib/api'
import { useAppStore } from '../../stores/appStore'
import {
  buildGrantKey,
  buildInitialGrantSet,
  computeStagedChanges,
  isDangerousChange,
  filterRoles,
  filterTables,
} from './privilegeHelper'

interface Props {
  connId: string
}

export const PrivilegeManagerView: React.FC<Props> = ({ connId }) => {
  const connections = useAppStore((s) => s.connections)
  const activeConn = useMemo(
    () => connections.find((c) => c.id === connId),
    [connections, connId]
  )

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [report, setReport] = useState<PrivilegeReport | null>(null)

  // Working grant state
  const [currentGrants, setCurrentGrants] = useState<Set<string>>(new Set())
  const [workingGrants, setWorkingGrants] = useState<Set<string>>(new Set())

  // Selection & Filters
  const [selectedRole, setSelectedRole] = useState<string | null>(null)
  const [roleSearch, setRoleSearch] = useState('')
  const [tableSearch, setTableSearch] = useState('')
  const [schemaFilter, setSchemaFilter] = useState<string>('all')

  // Preview / Apply Modal State
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewPlan, setPreviewPlan] = useState<PrivilegePlan | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [applyLoading, setApplyLoading] = useState(false)
  const [confirmInput, setConfirmInput] = useState('')
  const [copied, setCopied] = useState(false)

  const loadPrivileges = useCallback(async () => {
    if (!connId) return
    setLoading(true)
    setError(null)
    try {
      const data = await api.getPrivileges(connId, undefined, connections)
      setReport(data)
      const grantSet = buildInitialGrantSet(data)
      setCurrentGrants(grantSet)
      setWorkingGrants(new Set(grantSet))

      if (data.roles.length > 0 && !selectedRole) {
        setSelectedRole(data.roles[0].name)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load database privileges')
    } finally {
      setLoading(false)
    }
  }, [connId, connections, selectedRole])

  useEffect(() => {
    loadPrivileges()
  }, [loadPrivileges])

  // Compute staged changes
  const stagedChanges = useMemo<PrivilegeChange[]>(() => {
    if (!report) return []
    return computeStagedChanges(
      currentGrants,
      workingGrants,
      report.roles,
      report.tables,
      report.supportedPrivileges || ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'TRUNCATE']
    )
  }, [currentGrants, workingGrants, report])

  const dangerousCount = useMemo(() => {
    if (!report) return 0
    return stagedChanges.filter((ch) => isDangerousChange(ch, report.roles)).length
  }, [stagedChanges, report])

  const grantsCount = useMemo(
    () => stagedChanges.filter((c) => c.action === 'GRANT').length,
    [stagedChanges]
  )
  const revokesCount = useMemo(
    () => stagedChanges.filter((c) => c.action === 'REVOKE').length,
    [stagedChanges]
  )

  // Filtered lists
  const filteredRoles = useMemo(() => {
    if (!report) return []
    return filterRoles(report.roles, roleSearch)
  }, [report, roleSearch])

  const availableSchemas = useMemo(() => {
    if (!report) return []
    const schemas = new Set<string>()
    for (const tbl of report.tables) {
      if (tbl.includes('.')) {
        schemas.add(tbl.split('.')[0])
      }
    }
    return Array.from(schemas).sort()
  }, [report])

  const filteredTables = useMemo(() => {
    if (!report) return []
    let tables = report.tables
    if (schemaFilter !== 'all') {
      tables = tables.filter((t) => t.startsWith(`${schemaFilter}.`))
    }
    return filterTables(tables, tableSearch)
  }, [report, schemaFilter, tableSearch])

  // Cell toggle logic
  const handleToggle = (role: string, table: string, priv: string) => {
    const key = buildGrantKey(role, table, priv)
    setWorkingGrants((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // Quick actions for active role
  const handleGrantAllForRole = () => {
    if (!selectedRole || !report) return
    setWorkingGrants((prev) => {
      const next = new Set(prev)
      for (const t of filteredTables) {
        for (const p of report.supportedPrivileges) {
          next.add(buildGrantKey(selectedRole, t, p))
        }
      }
      return next
    })
  }

  const handleRevokeAllForRole = () => {
    if (!selectedRole || !report) return
    setWorkingGrants((prev) => {
      const next = new Set(prev)
      for (const t of filteredTables) {
        for (const p of report.supportedPrivileges) {
          next.delete(buildGrantKey(selectedRole, t, p))
        }
      }
      return next
    })
  }

  const handleClearChanges = () => {
    setWorkingGrants(new Set(currentGrants))
  }

  // Review & Preview Modal
  const handleOpenPreview = async () => {
    if (!report || stagedChanges.length === 0) return
    setPreviewLoading(true)
    setIsPreviewOpen(true)
    setConfirmInput('')
    setCopied(false)
    try {
      const plan = await api.previewPrivileges(
        connId,
        { changes: stagedChanges, roles: report.roles },
        connections
      )
      setPreviewPlan(plan)
    } catch (err: any) {
      setError(err.message || 'Failed to generate preview plan')
      setIsPreviewOpen(false)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleApplyChanges = async () => {
    if (!previewPlan) return
    setApplyLoading(true)
    setError(null)
    try {
      await api.applyPrivileges(
        connId,
        { plan: previewPlan, changes: stagedChanges, roles: report?.roles },
        connections
      )
      setIsPreviewOpen(false)
      setSuccessMsg(`Successfully applied ${previewPlan.statements.length} privilege change(s).`)
      setTimeout(() => setSuccessMsg(null), 5000)
      await loadPrivileges()
    } catch (err: any) {
      setError(err.message || 'Failed to apply privilege plan')
    } finally {
      setApplyLoading(false)
    }
  }

  const handleCopySQL = () => {
    if (!previewPlan) return
    navigator.clipboard.writeText(previewPlan.statements.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const activeRoleObj = useMemo(() => {
    if (!report || !selectedRole) return null
    return report.roles.find((r) => r.name === selectedRole) || null
  }, [report, selectedRole])

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      {/* Top Banner & Notifications */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 flex items-center justify-between text-xs text-red-500">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="p-1 hover:bg-red-500/20 rounded cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/30 flex items-center justify-between text-xs text-emerald-500">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="p-1 hover:bg-emerald-500/20 rounded cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Header bar */}
      <div className="h-11 px-4 border-b border-[var(--border)] flex items-center justify-between shrink-0 bg-[var(--surface)]">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 rounded">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
              Role & Access Privilege Manager
              {report?.dialect && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] border border-[var(--border)] text-[var(--muted)] lowercase">
                  {report.dialect}
                </span>
              )}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeConn?.readOnly && (
            <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-amber-500/10 text-amber-500 border border-amber-500/30">
              Safe Mode (Read-Only)
            </span>
          )}

          <button
            onClick={loadPrivileges}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover)] text-[var(--fg)] transition-colors disabled:opacity-50 cursor-pointer"
            title="Reload roles and privileges"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Main split view: Role Sidebar + Permission Matrix */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Role Explorer Sidebar */}
        <div className="w-64 sm:w-72 border-r border-[var(--border)] flex flex-col bg-[var(--surface)] shrink-0">
          <div className="p-2.5 border-b border-[var(--border)]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--muted)]" />
              <input
                type="text"
                value={roleSearch}
                onChange={(e) => setRoleSearch(e.target.value)}
                placeholder="Search roles or users..."
                className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--fg)] placeholder-[var(--muted)] focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <div className="px-2 py-1 text-[10px] font-mono uppercase text-[var(--muted)] tracking-wider">
              Database Roles / Grantees ({filteredRoles.length})
            </div>

            {filteredRoles.map((role) => {
              const isSelected = selectedRole === role.name
              return (
                <button
                  key={role.name}
                  onClick={() => setSelectedRole(role.name)}
                  className={`w-full text-left p-2 rounded text-xs transition-colors flex flex-col gap-1 cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-500/15 border border-indigo-500/30 text-[var(--fg)]'
                      : 'hover:bg-[var(--hover)] border border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium truncate flex items-center gap-1.5">
                      <User className="w-3 h-3 text-[var(--muted)]" />
                      {role.name}
                    </span>
                    {isSelected && <ArrowRight className="w-3 h-3 text-indigo-500 shrink-0" />}
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    {role.isSuperuser && (
                      <span className="px-1.5 py-0.2 text-[9px] font-mono font-semibold rounded bg-red-500/15 text-red-500 border border-red-500/30">
                        SUPERUSER
                      </span>
                    )}
                    {role.canLogin && (
                      <span className="px-1.5 py-0.2 text-[9px] font-mono rounded bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                        LOGIN
                      </span>
                    )}
                    {role.connectionLimit !== undefined && role.connectionLimit >= 0 && (
                      <span className="px-1.5 py-0.2 text-[9px] font-mono rounded bg-blue-500/15 text-blue-500 border border-blue-500/30">
                        LIMIT: {role.connectionLimit}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}

            {filteredRoles.length === 0 && (
              <div className="p-4 text-center text-xs text-[var(--muted)]">
                No roles match the search criteria.
              </div>
            )}
          </div>
        </div>

        {/* 2D Permission Matrix Content */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg)] min-w-0">
          {/* Matrix Controls & Active Role Info */}
          <div className="p-3 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2.5 bg-[var(--surface)] shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted)]">Inspecting:</span>
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[var(--hover)] border border-[var(--border)] text-[var(--fg)]">
                {selectedRole || 'No role selected'}
              </span>
              {activeRoleObj?.isSuperuser && (
                <span className="text-[10px] font-mono text-red-400 bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3" /> Admin/Superuser
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Schema Filter */}
              {availableSchemas.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-[var(--muted)]" />
                  <select
                    value={schemaFilter}
                    onChange={(e) => setSchemaFilter(e.target.value)}
                    className="text-xs bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg)] focus:outline-none cursor-pointer"
                  >
                    <option value="all">All Schemas</option>
                    {availableSchemas.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Table search filter */}
              <div className="relative">
                <Search className="w-3 h-3 absolute left-2 top-2 text-[var(--muted)]" />
                <input
                  type="text"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Filter tables..."
                  className="w-40 sm:w-48 pl-7 pr-2 py-1 text-xs bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--fg)] placeholder-[var(--muted)] focus:outline-none"
                />
              </div>

              {/* Quick grant/revoke buttons */}
              <button
                onClick={handleGrantAllForRole}
                disabled={!selectedRole || filteredTables.length === 0}
                className="px-2 py-1 text-[11px] rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 transition-colors disabled:opacity-40 cursor-pointer"
              >
                Grant All
              </button>
              <button
                onClick={handleRevokeAllForRole}
                disabled={!selectedRole || filteredTables.length === 0}
                className="px-2 py-1 text-[11px] rounded bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 transition-colors disabled:opacity-40 cursor-pointer"
              >
                Revoke All
              </button>
            </div>
          </div>

          {/* 2D Table Matrix */}
          <div className="flex-1 overflow-auto p-4">
            {!selectedRole ? (
              <div className="h-full flex flex-col items-center justify-center text-[var(--muted)] gap-2">
                <Users className="w-8 h-8 opacity-40" />
                <p className="text-xs">Select a role from the sidebar to inspect and configure table grants.</p>
              </div>
            ) : filteredTables.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-[var(--muted)] gap-2">
                <Database className="w-8 h-8 opacity-40" />
                <p className="text-xs">No tables match the search filter.</p>
              </div>
            ) : (
              <div className="border border-[var(--border)] rounded overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--surface)] border-b border-[var(--border)] text-[var(--muted)] font-mono text-[11px]">
                      <th className="p-2.5 font-medium min-w-[200px]">Table Name</th>
                      {(report?.supportedPrivileges || ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'TRUNCATE']).map(
                        (priv) => (
                          <th key={priv} className="p-2.5 text-center font-medium min-w-[90px]">
                            {priv}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {filteredTables.map((tbl) => (
                      <tr key={tbl} className="hover:bg-[var(--hover)] transition-colors">
                        <td className="p-2.5 font-mono text-xs font-medium text-[var(--fg)] truncate max-w-[240px]">
                          {tbl}
                        </td>
                        {(report?.supportedPrivileges || ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'TRUNCATE']).map(
                          (priv) => {
                            const key = buildGrantKey(selectedRole, tbl, priv)
                            const isGrantedCurrent = currentGrants.has(key)
                            const isGrantedWorking = workingGrants.has(key)

                            const isStagedGrant = !isGrantedCurrent && isGrantedWorking
                            const isStagedRevoke = isGrantedCurrent && !isGrantedWorking

                            return (
                              <td key={priv} className="p-1 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleToggle(selectedRole, tbl, priv)}
                                  className={`w-full py-1.5 px-2 rounded font-mono text-[11px] transition-all flex items-center justify-center gap-1 cursor-pointer select-none ${
                                    isStagedGrant
                                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 ring-1 ring-emerald-500/30 font-bold'
                                      : isStagedRevoke
                                      ? 'bg-red-500/20 text-red-400 border border-red-500/50 line-through ring-1 ring-red-500/30 font-bold'
                                      : isGrantedWorking
                                      ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/25'
                                      : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] opacity-60'
                                  }`}
                                  title={`${isStagedGrant ? 'Staged GRANT' : isStagedRevoke ? 'Staged REVOKE' : isGrantedWorking ? 'Granted' : 'Ungranted'}: Click to toggle`}
                                >
                                  {isStagedGrant && <span className="text-[10px]">+GRANT</span>}
                                  {isStagedRevoke && <span className="text-[10px]">-REVOKE</span>}
                                  {!isStagedGrant && !isStagedRevoke && (
                                    isGrantedWorking ? <Check className="w-3.5 h-3.5" /> : <span className="text-zinc-600 dark:text-zinc-500">-</span>
                                  )}
                                </button>
                              </td>
                            )
                          }
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Staged Changes Action Bar */}
      {stagedChanges.length > 0 && (
        <div className="h-12 px-4 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between shrink-0 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 font-mono">
              {stagedChanges.length} Staged Change{stagedChanges.length > 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              {grantsCount > 0 && <span className="text-emerald-500">+{grantsCount} Grant{grantsCount > 1 ? 's' : ''}</span>}
              {revokesCount > 0 && <span className="text-red-500">-{revokesCount} Revoke{revokesCount > 1 ? 's' : ''}</span>}
            </div>
            {dangerousCount > 0 && (
              <span className="px-2 py-0.5 text-[11px] font-mono font-medium rounded bg-red-500/15 text-red-400 border border-red-500/30 flex items-center gap-1.5 animate-pulse">
                <ShieldAlert className="w-3.5 h-3.5" />
                {dangerousCount} Dangerous Revoke{dangerousCount > 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearChanges}
              className="px-2.5 py-1 text-xs rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
            >
              Clear Changes
            </button>
            <button
              type="button"
              onClick={handleOpenPreview}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 hover:bg-indigo-500 text-white shadow transition-colors cursor-pointer"
            >
              <Key className="w-3.5 h-3.5" />
              <span>Review & Apply ({stagedChanges.length})</span>
            </button>
          </div>
        </div>
      )}

      {/* Dry Run Preview & 2-Step Confirmation Modal */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            {/* Modal Header */}
            <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                {previewPlan?.dangerous ? (
                  <ShieldAlert className="w-4 h-4 text-red-500" />
                ) : (
                  <Shield className="w-4 h-4 text-indigo-500" />
                )}
                <h2 className="text-xs font-semibold uppercase tracking-wider">
                  Dry-Run Privilege DDL Preview
                </h2>
              </div>
              <button
                onClick={() => setIsPreviewOpen(false)}
                className="text-[var(--muted)] hover:text-[var(--fg)] p-1 rounded transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 overflow-y-auto space-y-4 flex-1">
              {previewLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-[var(--muted)]">
                  <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                  <span>Generating dry-run DDL and running security checks...</span>
                </div>
              ) : previewPlan ? (
                <>
                  {/* Dangerous Warnings Banner */}
                  {previewPlan.warnings && previewPlan.warnings.length > 0 && (
                    <div className="space-y-2">
                      {previewPlan.warnings.map((w, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded border text-xs flex items-start gap-2.5 ${
                            w.level === 'critical'
                              ? 'bg-red-500/10 border-red-500/30 text-red-400'
                              : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                          }`}
                        >
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <span className="font-semibold uppercase tracking-wide font-mono text-[10px]">
                              {w.level} Warning [Role: {w.role}]
                            </span>
                            <p className="leading-relaxed">{w.message}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* SQL Statement Syntax Preview */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-mono uppercase text-[var(--muted)] tracking-wider">
                        Generated Statements ({previewPlan.statements.length})
                      </label>
                      <button
                        type="button"
                        onClick={handleCopySQL}
                        className="flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
                      >
                        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copied ? 'Copied' : 'Copy SQL'}</span>
                      </button>
                    </div>

                    <div className="p-3 bg-[var(--bg)] border border-[var(--border)] rounded font-mono text-xs text-indigo-300 dark:text-indigo-200 whitespace-pre-wrap max-h-56 overflow-auto select-text">
                      {previewPlan.statements.join('\n')}
                    </div>
                  </div>

                  {/* 2-Step Confirmation for Dangerous Changes */}
                  {previewPlan.dangerous && (
                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-red-500">
                        <ShieldAlert className="w-4 h-4" />
                        <span>High-Risk Guardrail: Two-Step Confirmation Required</span>
                      </div>
                      <p className="text-[11px] text-red-400 leading-relaxed">
                        This plan modifies administrative or superuser privileges. Type{' '}
                        <strong className="font-mono font-bold text-red-300">CONFIRM</strong> below to authorize execution.
                      </p>
                      <input
                        type="text"
                        value={confirmInput}
                        onChange={(e) => setConfirmInput(e.target.value)}
                        placeholder="Type CONFIRM to proceed"
                        className="w-full px-3 py-1.5 text-xs bg-[var(--bg)] border border-red-500/40 rounded font-mono text-[var(--fg)] placeholder-[var(--muted)] focus:outline-none focus:border-red-500"
                      />
                    </div>
                  )}
                </>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between shrink-0">
              <span className="text-[11px] text-[var(--muted)] font-mono">
                {activeConn?.readOnly ? 'Safe Mode Active: Cannot apply in read-only' : 'Will execute against target database'}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(false)}
                  className="px-3 py-1.5 text-xs rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyChanges}
                  disabled={
                    applyLoading ||
                    activeConn?.readOnly ||
                    Boolean(previewPlan?.dangerous && confirmInput.trim() !== 'CONFIRM')
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow transition-colors cursor-pointer"
                >
                  {applyLoading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Applying...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Confirm & Apply Plan</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
