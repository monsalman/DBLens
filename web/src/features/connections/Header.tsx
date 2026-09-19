import React from 'react'
import { Plus, Moon, Sun, Pencil, Trash2, Search, ShieldCheck } from 'lucide-react'
import { api, type ConnectionConfig } from '../../lib/api'
import { useAppStore, type ActiveTab } from '../../stores/appStore'

interface Props {
  connections: ConnectionConfig[]
  activeConnId: string | null
  onSwitch: (id: string) => void
  onAdd: () => void
  onEdit: (conn: ConnectionConfig) => void
  onDeleted: (id: string) => void
  activeTab: ActiveTab
  onTabChange: (tab: ActiveTab) => void
  selectedSchema: string
  onSchemaChange: (schema: string) => void
  selectedTable: string | null
  onSelectTable: (table: string | null) => void
  isDark: boolean
  onToggleTheme: () => void
  onOpenCommandPalette?: () => void
}

export const Header: React.FC<Props> = ({
  connections,
  activeConnId,
  onSwitch,
  onAdd,
  onEdit,
  onDeleted,
  activeTab,
  onTabChange,
  isDark,
  onToggleTheme,
  onOpenCommandPalette,
}) => {
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)

  const handleOpenPalette = () => {
    if (onOpenCommandPalette) {
      onOpenCommandPalette()
    } else {
      setCommandPaletteOpen(true)
    }
  }
  async function handleDelete(c: ConnectionConfig, e: React.MouseEvent) {
    e.stopPropagation()
    if (window.confirm('Delete connection profile?')) {
      try {
        await api.removeProfile(c.id)
        onDeleted(c.id)
      } catch (err) {
        console.error('Failed to delete profile', err)
      }
    }
  }

  return (
    <header className="h-10 flex items-center justify-between shrink-0 border-b border-[var(--border)] px-3 bg-[var(--bg)] text-[var(--fg)]">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs font-medium tracking-tight">dbls</span>
        
        {/* Connection switcher */}
        <div className="flex items-center gap-1">
          {connections.map(c => (
            <div key={c.id} className="group relative flex items-center">
              <button onClick={() => onSwitch(c.id)}
                className={`px-2 py-0.5 text-[11px] rounded transition-colors flex items-center gap-1.5 ${
                  c.id === activeConnId
                    ? 'bg-[var(--active)] text-[var(--fg)] font-medium'
                    : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                }`}>
                <span>{c.label || c.name || c.id}</span>
                <span className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 ${c.id === activeConnId ? 'opacity-100' : ''}`}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(c); }} className="hover:text-[var(--fg)] p-0.5" title="Edit">
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={(e) => handleDelete(c, e)} className="hover:text-red-400 p-0.5" title="Delete">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              </button>
            </div>
          ))}
          <button onClick={onAdd} className="p-1 text-[var(--muted)] hover:text-[var(--fg)] transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Search / Command Palette Quick Button */}
      <button
        type="button"
        onClick={handleOpenPalette}
        className="flex items-center gap-2 px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--fg)] bg-[var(--surface)] hover:bg-[var(--hover)] border border-[var(--border)] rounded-md transition-colors cursor-pointer group"
        title="Command Palette (Cmd+K / Ctrl+K)"
      >
        <Search className="w-3.5 h-3.5 text-[var(--muted)] group-hover:text-[var(--fg)] transition-colors" />
        <span className="hidden sm:inline text-[11px]">Search or run command...</span>
        <kbd className="font-mono text-[10px] text-[var(--muted)] bg-[var(--hover)] border border-[var(--border)] px-1.5 py-0.2 rounded group-hover:text-[var(--fg)] transition-colors">
          ⌘K
        </kbd>
      </button>

      {/* Tab nav & Theme Toggle */}
      <div className="flex items-center gap-2">
        {/* Tab nav */}
        <div className="flex items-center gap-0.5">
          {[
            { id: 'table' as const, label: 'Tables' },
            { id: 'sql' as const, label: 'SQL Editor' },
            { id: 'erd' as const, label: 'ERD' },
            { id: 'diff' as const, label: 'Schema Diff' },
            { id: 'processes' as const, label: 'Processes' },
            { id: 'advisor' as const, label: 'Advisor', icon: ShieldCheck },
          ].map(tab => {
            const Icon = (tab as any).icon
            return (
              <button key={tab.id} onClick={() => onTabChange(tab.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded transition-colors ${
                  activeTab === tab.id
                    ? 'text-[var(--fg)] bg-[var(--active)] font-medium'
                    : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                }`}>
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Dark/Light Toggle */}
        <button onClick={onToggleTheme}
          className="p-1.5 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
          title={`${isDark ? 'Light' : 'Dark'} mode`}>
          {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
      </div>
    </header>
  )
}
