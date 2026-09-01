import React from 'react'
import { Plus } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'

export const Header: React.FC = () => {
  const {
    connections,
    activeConnectionId,
    setActiveConnectionId,
    setIsAddConnOpen,
  } = useAppStore()

  const activeConn = connections.find((c) => c.id === activeConnectionId)
  
  if (!activeConn) return null
  
  return (
    <header className="h-10 border-b border-white/[0.06] bg-[#0b0c0e] px-3 flex items-center justify-between shrink-0 select-none">
      {/* Left: Logo + Connections */}
      <div className="flex items-center gap-4">
        <span className="font-mono font-medium text-sm text-zinc-200 tracking-tight">
          dbls v0.1.0
        </span>
        
        <div className="flex items-center gap-1">
          {connections.map((c) => {
            const isActive = c.id === activeConnectionId
            const dialectClass = getDialectBadge(c.dialect || c.driver || '')
            return (
              <button
                key={c.id}
                onClick={() => setActiveConnectionId(c.id)}
                className={`flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                  isActive
                    ? 'text-zinc-100 bg-white/[0.06]'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color || '#818cf8' }} />
                <span className="max-w-[120px] truncate">{c.label || c.name || c.id}</span>
                <span className={`${dialectClass} px-1 rounded-[3px] text-[9px] font-mono uppercase`}>
                  {c.dialect || c.driver}
                </span>
              </button>
            )
          })}
          <button
            onClick={() => setIsAddConnOpen(true)}
            className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.03] rounded transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Right: Status */}
      <div className="flex items-center gap-3">
        {activeConn.readOnly ? (
          <span className="text-xs text-amber-400/90 font-mono">Read-only</span>
        ) : (
          <span className="text-xs text-emerald-400/90 font-mono">Connected</span>
        )}
        <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-zinc-500 font-mono">
          <span className="text-zinc-400">Ctrl</span>+Enter
        </kbd>
      </div>
    </header>
  )
}

function getDialectBadge(dialect: string): string {
  switch (dialect.toLowerCase()) {
    case 'postgres': return 'badge-pg'
    case 'mysql': return 'badge-mysql'
    case 'sqlite': return 'badge-sqlite'
    default: return 'bg-white/[0.08] text-zinc-300'
  }
}
