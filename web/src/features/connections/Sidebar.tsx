import React, { useEffect, useState } from 'react'
import { Table2, Shield, GitBranch, Zap, Clock } from 'lucide-react'
import { api, type ConnectionConfig } from '../../lib/api'
import { EnvironmentBadge } from '../../components/EnvironmentBadge'
import { useAppStore } from '../../stores/appStore'

interface Props {
  connections: ConnectionConfig[]
  activeConnId: string
  selectedSchema?: string
  onSelectSchema?: (schema: string) => void
  selectedTable?: string | null
  onSelectTable?: (table: string | null) => void
}

export const Sidebar: React.FC<Props> = ({
  connections = [],
  activeConnId,
  selectedSchema = 'public',
  onSelectSchema,
  selectedTable,
  onSelectTable,
}) => {
  const [tables, setTables] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [schemas, setSchemas] = useState<string[]>(['public'])
  const [databases, setDatabases] = useState<string[]>([])
  const [selectedDb, setSelectedDb] = useState<string>('')
  const [dbLoading, setDbLoading] = useState(false)

  const loadTables = (connId: string, schema: string) => {
    setLoading(true)
    api.getTables(connId, schema, connections).then(tList => {
      const names = tList.map(t => t.name)
      setTables(names)
      if (names.length > 0 && (!selectedTable || !names.includes(selectedTable)) && onSelectTable) {
        onSelectTable(names[0])
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }

  // Load databases & schemas automatically on active connection change
  useEffect(() => {
    if (!activeConnId) return
    
    setDbLoading(true)
    api.getDatabases(activeConnId, connections).then(dbList => {
      if (dbList && dbList.length > 0) {
        setDatabases(dbList)
        if (!selectedDb) setSelectedDb(dbList[0])
      }
    }).catch(() => {}).finally(() => setDbLoading(false))

    api.getSchemas(activeConnId, connections).then(sList => {
      if (sList && sList.length > 0) {
        setSchemas(sList)
        if (!sList.includes(selectedSchema) && onSelectSchema) {
          onSelectSchema(sList[0])
        }
      }
    }).catch(() => {})
  }, [activeConnId])

  useEffect(() => {
    if (!activeConnId) return
    loadTables(activeConnId, selectedSchema)
  }, [activeConnId, selectedSchema])

  const handleDbChange = async (dbName: string) => {
    setSelectedDb(dbName)
    try {
      await api.selectDatabase(activeConnId, dbName)
      loadTables(activeConnId, selectedSchema)
    } catch (err) {
      console.error('Failed to select database', err)
    }
  }

  const activeConn = connections.find(c => c.id === activeConnId)

  return (
    <aside className="w-56 bg-[var(--bg)] border-r border-[var(--border)] flex flex-col shrink-0 overflow-hidden">
      {/* Active Connection Info */}
      {activeConn && (
        <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between gap-2 bg-[var(--surface)]/40 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-xs font-semibold text-[var(--fg)] truncate">
              {activeConn.label || activeConn.name || activeConn.id}
            </span>
            {activeConn.ssh_tunnel?.enabled && (
              <span
                className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-mono font-semibold rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shrink-0"
                title="Connected via SSH Bastion Tunnel"
              >
                <Shield className="w-2.5 h-2.5" />
                <span>SSH</span>
              </span>
            )}
          </div>
          <EnvironmentBadge env={activeConn.environment} />
        </div>
      )}

      {/* Database Selector (Always visible like Adminer) */}
      <div className="px-3 py-2 border-b border-[var(--border)] space-y-1">
        <label className="text-[10px] uppercase text-[var(--muted)] font-semibold tracking-wider block">
          Database {dbLoading && <span className="text-[9px] lowercase font-normal opacity-70">(loading...)</span>}
        </label>
        <select
          value={selectedDb}
          onChange={(e) => handleDbChange(e.target.value)}
          className="w-full bg-[var(--surface)] text-xs text-[var(--fg)] border border-[var(--border)] rounded px-2 py-1 outline-none font-mono cursor-pointer"
        >
          {databases.length === 0 && <option value="">(default db)</option>}
          {databases.map((db) => (
            <option key={db} value={db}>
              {db}
            </option>
          ))}
        </select>
      </div>

      {/* Schema Selector (for Postgres/multischema DBs) */}
      {schemas.length > 1 && (
        <div className="px-3 py-2 border-b border-[var(--border)] space-y-1">
          <label className="text-[10px] uppercase text-[var(--muted)] font-semibold tracking-wider block">Schema</label>
          <select
            value={selectedSchema}
            onChange={(e) => onSelectSchema?.(e.target.value)}
            className="w-full bg-[var(--surface)] text-xs text-[var(--fg)] border border-[var(--border)] rounded px-2 py-1 outline-none font-mono cursor-pointer"
          >
            {schemas.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Tables List */}
      <div className="flex-1 overflow-y-auto p-2">
        <label className="text-[10px] uppercase text-[var(--muted)] font-semibold tracking-wider ml-1 mb-1 block">Tables</label>
        {loading && <div className="ml-1 text-[11px] text-[var(--muted)]">Loading...</div>}
        {!loading && tables.length === 0 && <div className="ml-1 text-[11px] text-[var(--muted)]">No tables found</div>}
        {tables.map(name => (
          <div
            key={name}
            onClick={() => onSelectTable?.(name)}
            className={`sidebar-item ${selectedTable === name ? 'sidebar-item-active' : ''}`}
          >
            <Table2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{name}</span>
          </div>
        ))}
      </div>

      {/* Studio & Hub Triggers */}
      <div className="p-2 border-t border-[var(--border)] bg-[var(--surface)]/20 shrink-0 space-y-1.5">
        <button
          onClick={() => useAppStore.getState().openRoutineStudio('routines')}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs font-medium text-[var(--fg)] hover:bg-[var(--surface)] hover:text-purple-500 rounded border border-[var(--border)] transition-colors cursor-pointer group"
          title="Open Routine, Function, View & Trigger Studio"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Zap className="w-3.5 h-3.5 text-purple-500 shrink-0" />
            <span className="truncate">Routine Studio</span>
          </div>
          <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-purple-500/10 text-purple-500 border border-purple-500/20 shrink-0">
            SQL
          </span>
        </button>

        <button
          onClick={() => useAppStore.getState().setIsMigrationModalOpen(true)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs font-medium text-[var(--fg)] hover:bg-[var(--surface)] hover:text-blue-500 rounded border border-[var(--border)] transition-colors cursor-pointer group"
          title="Open Schema Migration Generator & Changelog Hub"
        >
          <div className="flex items-center gap-2 min-w-0">
            <GitBranch className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span className="truncate">Migration Hub</span>
          </div>
          <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20 shrink-0">
            CI/CD
          </span>
        </button>

        <button
          onClick={() => useAppStore.getState().setIsCronStudioOpen(true)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs font-medium text-[var(--fg)] hover:bg-[var(--surface)] hover:text-amber-500 rounded border border-[var(--border)] transition-colors cursor-pointer group"
          title="Open Cron Jobs & Heartbeat Alerts"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="truncate">Cron & Alerts</span>
          </div>
          <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 shrink-0">
            ⏱
          </span>
        </button>
      </div>
    </aside>
  )
}
