import React from 'react'
import { Plus, ShieldAlert } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'

export const Header: React.FC = () => {
  const {
    connections,
    activeConnectionId,
    setActiveConnectionId,
    setIsAddConnOpen,
  } = useAppStore()

  const activeConn = connections.find((c) => c.id === activeConnectionId)

  return (
    <header className="h-14 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md px-4 flex items-center justify-between z-20 shrink-0 select-none">
      {/* Brand & Logo */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 font-mono font-bold text-white text-base tracking-tighter">
            DL
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold text-zinc-100 tracking-tight text-base font-sans">
              DBLens
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono border border-zinc-700/50">
              v0.1.0-beta
            </span>
          </div>
        </div>

        {/* Quick Connection Switcher Pills */}
        <div className="hidden md:flex items-center gap-1.5 bg-zinc-900/90 border border-zinc-800/80 p-1 rounded-lg">
          {connections.map((c) => {
            const isActive = c.id === activeConnectionId
            return (
              <button
                key={c.id}
                onClick={() => setActiveConnectionId(c.id)}
                className={`flex items-center gap-2 px-2.5 py-1 rounded text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/60'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full ring-2 ring-zinc-900"
                  style={{ backgroundColor: c.color || '#6366f1' }}
                />
                <span>{c.name}</span>
                <span className="uppercase text-[9px] px-1 rounded bg-zinc-950/60 text-zinc-400 font-mono">
                  {c.driver}
                </span>
              </button>
            )
          })}

          <button
            onClick={() => setIsAddConnOpen(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 rounded transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </div>
      </div>

      {/* Right Actions & Status */}
      <div className="flex items-center gap-3">
        {/* Read-only toggle status */}
        {activeConn?.readOnly ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-medium">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Read-Only Locked</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Connected</span>
          </div>
        )}

        {/* Keyboard shortcut hint */}
        <div className="hidden lg:flex items-center gap-1 text-[11px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-2 py-1 rounded">
          <kbd className="font-mono text-zinc-300">Ctrl</kbd>+
          <kbd className="font-mono text-zinc-300">Enter</kbd>
          <span className="ml-1 text-zinc-400">Run SQL</span>
        </div>
      </div>
    </header>
  )
}
