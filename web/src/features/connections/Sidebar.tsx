import React, { useState } from 'react'
import {
  Table2,
  Terminal,
  Network,
  Layers,
  Search,
  Eye,
  RefreshCw,
} from 'lucide-react'
import { useAppStore, type ActiveTab } from '../../stores/appStore'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'

export const Sidebar: React.FC = () => {
  const {
    activeConnectionId,
    activeTab,
    setActiveTab,
    selectedSchema,
    setSelectedSchema,
    selectedTable,
    setSelectedTable,
  } = useAppStore()

  const [filterText, setFilterText] = useState('')

  const {
    data: schemaMeta,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['schema', activeConnectionId, selectedSchema],
    queryFn: () => (activeConnectionId ? api.getSchema(activeConnectionId, selectedSchema) : null),
    enabled: !!activeConnectionId,
  })

  const tables = schemaMeta?.tables?.filter((t) => t.type === 'table') || []
  const views = schemaMeta?.tables?.filter((t) => t.type === 'view') || []

  const filteredTables = tables.filter((t) =>
    t.name.toLowerCase().includes(filterText.toLowerCase())
  )
  const filteredViews = views.filter((v) =>
    v.name.toLowerCase().includes(filterText.toLowerCase())
  )

  const navTabs: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { id: 'table', label: 'Table Data', icon: <Table2 className="w-4 h-4" /> },
    { id: 'sql', label: 'SQL Console', icon: <Terminal className="w-4 h-4" /> },
    { id: 'erd', label: 'Schema ERD', icon: <Network className="w-4 h-4" /> },
  ]

  return (
    <aside className="w-64 border-r border-zinc-800 bg-zinc-950 flex flex-col shrink-0 select-none">
      {/* View Mode Tabs */}
      <div className="p-3 border-b border-zinc-800/80">
        <div className="grid grid-cols-3 gap-1 bg-zinc-900/90 p-1 rounded-lg border border-zinc-800/80">
          {navTabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-md text-[11px] font-medium transition-all ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100 shadow-xs border border-zinc-700/50'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30'
                }`}
                title={tab.label}
              >
                {tab.icon}
                <span className="mt-1 text-[10px] truncate max-w-full">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Schema Selector Dropdown */}
      <div className="px-3 py-2 border-b border-zinc-800/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Layers className="w-3.5 h-3.5 text-zinc-400" />
          <span>Schema:</span>
        </div>
        <select
          value={selectedSchema}
          onChange={(e) => setSelectedSchema(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 font-mono focus:outline-hidden focus:border-zinc-700"
        >
          {schemaMeta?.schemas?.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          )) || <option value="public">public</option>}
        </select>
      </div>

      {/* Search Filter for Tables */}
      <div className="p-2.5 border-b border-zinc-800/60">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter tables..."
            className="w-full bg-zinc-900 border border-zinc-800/80 rounded-md pl-8 pr-2.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-hidden focus:border-zinc-700"
          />
        </div>
      </div>

      {/* Tables & Views Tree List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* Tables Section */}
        <div>
          <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
            <span>Tables ({filteredTables.length})</span>
            <button
              onClick={() => refetch()}
              className="hover:text-zinc-300 p-0.5 rounded"
              title="Refresh Schema"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="mt-1 space-y-0.5">
            {filteredTables.map((table) => {
              const isSelected = selectedTable === table.name
              return (
                <button
                  key={table.name}
                  onClick={() => {
                    setSelectedTable(table.name)
                    if (activeTab !== 'table') {
                      setActiveTab('table')
                    }
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-mono transition-colors group ${
                    isSelected
                      ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Table2
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isSelected ? 'text-indigo-400' : 'text-zinc-400 group-hover:text-zinc-400'
                      }`}
                    />
                    <span className="truncate">{table.name}</span>
                  </div>
                  {table.rowCount !== undefined && (
                    <span className="text-[10px] font-sans px-1.5 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                      {table.rowCount >= 1000 ? `${(table.rowCount / 1000).toFixed(1)}k` : table.rowCount}
                    </span>
                  )}
                </button>
              )
            })}

            {filteredTables.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-zinc-400">No tables found</div>
            )}
          </div>
        </div>

        {/* Views Section */}
        {filteredViews.length > 0 && (
          <div>
            <div className="px-2 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Views ({filteredViews.length})
            </div>
            <div className="mt-1 space-y-0.5">
              {filteredViews.map((view) => {
                const isSelected = selectedTable === view.name
                return (
                  <button
                    key={view.name}
                    onClick={() => {
                      setSelectedTable(view.name)
                      if (activeTab !== 'table') {
                        setActiveTab('table')
                      }
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-mono transition-colors group ${
                      isSelected
                        ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Eye className="w-3.5 h-3.5 shrink-0 text-zinc-400 group-hover:text-zinc-400" />
                      <span className="truncate">{view.name}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-zinc-800/80 text-[11px] text-zinc-400 flex items-center justify-between">
        <span>SQLite / Postgres / MySQL</span>
        <span className="font-mono text-[10px] text-zinc-400">Auto-IDLE</span>
      </div>
    </aside>
  )
}
