import React, { useEffect, useState } from 'react'
import { Table2 } from 'lucide-react'
import { api, type ConnectionConfig } from '../../lib/api'

interface Props {
  connections: ConnectionConfig[]
  activeConnId: string
  selectedSchema?: string
  onSelectSchema?: (schema: string) => void
  selectedTable?: string | null
  onSelectTable?: (table: string | null) => void
}

export const Sidebar: React.FC<Props> = ({
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
    api.getTables(connId, schema).then(tList => {
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
    api.getDatabases(activeConnId).then(dbList => {
      if (dbList && dbList.length > 0) {
        setDatabases(dbList)
        if (!selectedDb) setSelectedDb(dbList[0])
      }
    }).catch(() => {}).finally(() => setDbLoading(false))

    api.getSchemas(activeConnId).then(sList => {
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

  return (
    <aside className="w-56 bg-[var(--bg)] border-r border-[var(--border)] flex flex-col shrink-0 overflow-hidden">
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
    </aside>
  )
}
