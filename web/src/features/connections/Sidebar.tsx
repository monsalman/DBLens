import React, { useEffect, useState } from 'react'
import { Database, Table2, ChevronRight, ChevronDown } from 'lucide-react'
import { api } from '../../lib/api'
import { useAppStore } from '../../stores/appStore'

type TreeNode = { name: string; type: 'schema' | 'table'; count?: number }

export const Sidebar: React.FC = () => {
  const { 
    activeConnectionId, selectedSchema, setSelectedSchema, 
    selectedTable, setSelectedTable, setActiveTab, activeTab 
  } = useAppStore()
  
  const [nodes, setNodes] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [schemas, setSchemas] = useState<string[]>(['public'])
  
  // Expand state for schemas
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set(['public']))
  
  useEffect(() => {
    async function loadSchemas() {
      if (!activeConnectionId) return
      try {
        const sList = await api.getSchemas(activeConnectionId)
        if (sList && sList.length > 0) {
          setSchemas(sList)
          if (!sList.includes(selectedSchema)) {
            setSelectedSchema(sList[0])
          }
        }
      } catch (err) {
        console.error('Failed to load schemas:', err)
      }
    }
    loadSchemas()
  }, [activeConnectionId])

  useEffect(() => {
    async function load() {
      if (!activeConnectionId) return
      setLoading(true)
      try {
        const tables = await api.getTables(activeConnectionId, selectedSchema)
        // Group by schema
        const grouped: Record<string, number> = {}
        tables.forEach(t => {
          const s = t.schema || selectedSchema || 'public'
          grouped[s] = (grouped[s] || 0) + 1
        })
        
        const newNodes: TreeNode[] = []
        if (Object.keys(grouped).length === 0) {
          newNodes.push({ name: selectedSchema || 'public', type: 'schema', count: 0 })
        } else {
          Object.entries(grouped).forEach(([schema]) => {
            newNodes.push({ name: schema, type: 'schema', count: grouped[schema] })
          })
        }

        // Add tables and views
        tables.forEach(t => {
          newNodes.push({
            name: t.type === 'view' ? `${t.name} (view)` : t.name,
            type: 'table',
            count: t.rowCount,
          })
        })
        
        setNodes(newNodes)
        
        // Auto-select first table if none selected or selected table not in list
        if (tables.length > 0 && (!selectedTable || !tables.some(t => t.name === selectedTable))) {
          setSelectedTable(tables[0].name)
        }
      } catch (err) {
        console.error('Failed to load schema:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [activeConnectionId, selectedSchema])
  
  if (!activeConnectionId) return null
  
  return (
    <aside className="w-56 border-r border-white/[0.06] bg-[#0b0c0e] flex flex-col shrink-0">
      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] px-1">
        {[
          { id: 'table' as const, label: 'Data' },
          { id: 'sql' as const, label: 'SQL' },
          { id: 'erd' as const, label: 'ERD' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-[11px] font-medium capitalize transition-colors relative ${
              activeTab === tab.id
                ? 'text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-zinc-100" />
            )}
          </button>
        ))}
      </div>
      
      {/* Schema selector */}
      <div className="px-2 pt-2 pb-1">
        <label className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">Database</label>
        <select
          value={selectedSchema}
          onChange={e => setSelectedSchema(e.target.value)}
          className="mt-1 w-full bg-[#0b0c0e] text-xs text-zinc-200 border border-white/[0.06] rounded px-2 py-1 focus:border-white/[0.15] outline-none cursor-pointer font-mono"
        >
          {schemas.map(s => (
            <option key={s} value={s} className="bg-[#16181d] text-zinc-200">
              {s}
            </option>
          ))}
        </select>
      </div>
      
      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex items-center justify-between px-1 mb-1">
          <label className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">Tables</label>
          {loading && <span className="text-[10px] text-zinc-500 font-mono">Loading...</span>}
        </div>
        {!loading && nodes.filter(n => n.type === 'table').length === 0 && (
          <span className="text-xs text-zinc-600 px-1">No tables found</span>
        )}
        {nodes.map((node, i) => (
          <div key={`${node.type}-${node.name}-${i}`} className="mb-0.5">
            {node.type === 'schema' ? (
              <div className="flex items-center gap-1 mt-1 px-1 text-zinc-400">
                <button
                  onClick={() => {
                    const next = new Set(expandedSchemas)
                    if (next.has(node.name)) next.delete(node.name)
                    else next.add(node.name)
                    setExpandedSchemas(next)
                  }}
                  className="p-0.5 text-zinc-500 hover:text-zinc-300"
                >
                  {expandedSchemas.has(node.name) ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </button>
                <Database className="w-3 h-3 text-zinc-500" />
                <span className="text-xs text-zinc-300 font-mono">{node.name}</span>
                {node.count !== undefined && (
                  <span className="text-[10px] text-zinc-600 font-mono">({node.count})</span>
                )}
              </div>
            ) : (
              <div
                className={`sidebar-item ${
                  selectedTable === node.name.replace(' (view)', '') ? 'sidebar-item-active' : ''
                }`}
                onClick={() => {
                  setSelectedTable(node.name.replace(' (view)', ''))
                  if (activeTab !== 'table') setActiveTab('table')
                }}
              >
                <Table2 className="w-3 h-3 text-zinc-500 shrink-0" />
                <span className="truncate text-xs font-mono text-zinc-300">
                  {node.name.replace(' (view)', '')}
                </span>
                {node.name.includes('(view)') && (
                  <span className="text-[9px] text-zinc-600 font-mono ml-auto">view</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
