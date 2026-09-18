import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Search,
  X,
  Table2,
  Eye,
  Terminal,
  GitGraph,
  Sun,
  Moon,
  RefreshCw,
  Plus,
  Unplug,
  Database,
  Layers,
  Server,
  CornerDownLeft,
  GitCompare,
  Activity,
  ShieldCheck,
} from 'lucide-react'
import { api } from '../lib/api'
import type { ConnectionConfig, TableMeta } from '../lib/api'
import { useAppStore, type ActiveTab } from '../stores/appStore'

export interface CommandPaletteProps {
  connections: ConnectionConfig[]
  activeConnId: string | null
  activeTab: ActiveTab
  selectedSchema: string
  selectedTable: string | null
  isDark: boolean
  onSwitchConnection: (id: string) => void
  onSelectTable: (table: string) => void
  onSelectSchema: (schema: string) => void
  onSelectDatabase?: (db: string) => void
  onTabChange: (tab: ActiveTab) => void
  onToggleTheme: () => void
  onNewConnection: () => void
  onDisconnect: () => void
  onRefresh: () => void
}

type CategoryType = 'Actions' | 'Tables' | 'Schemas' | 'Connections'

interface CommandItem {
  id: string
  title: string
  subtitle?: string
  category: CategoryType
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  keywords?: string[]
  onSelect: () => void
}

function fuzzySubsequence(sub: string, str: string): boolean {
  let subIdx = 0
  for (let i = 0; i < str.length && subIdx < sub.length; i++) {
    if (str[i] === sub[subIdx]) subIdx++
  }
  return subIdx === sub.length
}

function getMatchScore(item: CommandItem, query: string, tokens: string[]): number {
  const titleLower = item.title.toLowerCase()
  const fullText = `${item.title} ${item.subtitle || ''} ${item.category} ${(item.keywords || []).join(' ')}`.toLowerCase()

  for (const token of tokens) {
    if (!fullText.includes(token) && !fuzzySubsequence(token, titleLower)) {
      return -1
    }
  }

  let score = 0
  if (titleLower === query) score += 1000
  else if (titleLower.startsWith(query)) score += 500
  else if (titleLower.includes(query)) score += 200

  for (const token of tokens) {
    if (titleLower === token) score += 200
    else if (titleLower.startsWith(token)) score += 100
    else if (titleLower.includes(token)) score += 50
    else if (fullText.includes(token)) score += 20
    else if (fuzzySubsequence(token, titleLower)) score += 10
  }

  return Math.max(1, score)
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  connections,
  activeConnId,
  selectedSchema,
  isDark,
  onSwitchConnection,
  onSelectTable,
  onSelectSchema,
  onSelectDatabase,
  onTabChange,
  onToggleTheme,
  onNewConnection,
  onDisconnect,
  onRefresh,
}) => {
  const { isCommandPaletteOpen, setCommandPaletteOpen } = useAppStore()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  const closePalette = React.useCallback(() => {
    setQuery('')
    setSelectedIndex(0)
    setCommandPaletteOpen(false)
  }, [setCommandPaletteOpen])

  const [tables, setTables] = useState<TableMeta[]>([])
  const [schemas, setSchemas] = useState<string[]>([])
  const [databases, setDatabases] = useState<string[]>([])

  // Global shortcut (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (isCommandPaletteOpen) {
          closePalette()
        } else {
          setQuery('')
          setSelectedIndex(0)
          setCommandPaletteOpen(true)
        }
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [isCommandPaletteOpen, setCommandPaletteOpen, closePalette])

  // Fetch metadata when palette opens with active connection
  useEffect(() => {
    if (!isCommandPaletteOpen || !activeConnId) {
      if (!activeConnId) {
        setTables([])
        setSchemas([])
        setDatabases([])
      }
      return
    }

    let isMounted = true
    Promise.allSettled([
      api.getTables(activeConnId, selectedSchema, connections),
      api.getSchemas(activeConnId, connections),
      api.getDatabases(activeConnId, connections),
    ]).then(([tablesRes, schemasRes, databasesRes]) => {
      if (!isMounted) return
      if (tablesRes.status === 'fulfilled' && Array.isArray(tablesRes.value)) {
        setTables(tablesRes.value)
      }
      if (schemasRes.status === 'fulfilled' && Array.isArray(schemasRes.value)) {
        setSchemas(schemasRes.value)
      }
      if (databasesRes.status === 'fulfilled' && Array.isArray(databasesRes.value)) {
        setDatabases(databasesRes.value)
      }
    })

    return () => {
      isMounted = false
    }
  }, [isCommandPaletteOpen, activeConnId, selectedSchema, connections])

  // Construct command items
  const allItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = []

    // 1. Quick Actions
    items.push({
      id: 'action:sql',
      title: 'Open SQL Console',
      subtitle: 'Switch to interactive SQL query editor',
      category: 'Actions',
      icon: Terminal,
      badge: 'SQL',
      keywords: ['sql', 'query', 'console', 'studio', 'editor'],
      onSelect: () => {
        onTabChange('sql')
        closePalette()
      },
    })

    items.push({
      id: 'action:table',
      title: 'Go to Table Grid',
      subtitle: 'Browse and edit table data',
      category: 'Actions',
      icon: Table2,
      badge: 'VIEW',
      keywords: ['table', 'grid', 'browse', 'rows', 'data'],
      onSelect: () => {
        onTabChange('table')
        closePalette()
      },
    })

    items.push({
      id: 'action:erd',
      title: 'Go to Schema ERD',
      subtitle: 'Interactive entity-relationship visual diagram',
      category: 'Actions',
      icon: GitGraph,
      badge: 'ERD',
      keywords: ['erd', 'schema', 'diagram', 'graph', 'relations'],
      onSelect: () => {
        onTabChange('erd')
        closePalette()
      },
    })

    items.push({
      id: 'action:diff',
      title: 'Go to Schema Diff / Sync',
      subtitle: 'Compare schemas, tables, and generate migration SQL',
      category: 'Actions',
      icon: GitCompare,
      badge: 'DIFF',
      keywords: ['diff', 'schema', 'compare', 'sync', 'migration'],
      onSelect: () => {
        onTabChange('diff')
        closePalette()
      },
    })

    items.push({
      id: 'action:processes',
      title: 'Go to Process Activity & Query Killer',
      subtitle: 'Monitor active queries, connections, and terminate processes',
      category: 'Actions',
      icon: Activity,
      badge: 'ACTIVITY',
      keywords: ['process', 'processes', 'activity', 'kill', 'query', 'queries', 'monitor'],
      onSelect: () => {
        onTabChange('processes')
        closePalette()
      },
    })

    items.push({
      id: 'action:advisor',
      title: 'Go to Database Health & Performance Advisor',
      subtitle: 'Analyze cache hit ratio, bloat, unused indexes, and run remediation',
      category: 'Actions',
      icon: ShieldCheck,
      badge: 'ADVISOR',
      keywords: ['advisor', 'health', 'performance', 'cache', 'bloat', 'vacuum', 'indexes', 'optimize'],
      onSelect: () => {
        onTabChange('advisor')
        closePalette()
      },
    })

    items.push({
      id: 'action:theme',
      title: `Toggle Theme (${isDark ? 'Switch to Light' : 'Switch to Dark'})`,
      subtitle: `Currently in ${isDark ? 'Dark' : 'Light'} mode`,
      category: 'Actions',
      icon: isDark ? Sun : Moon,
      badge: 'THEME',
      keywords: ['theme', 'dark', 'light', 'mode', 'color'],
      onSelect: () => {
        onToggleTheme()
        closePalette()
      },
    })

    items.push({
      id: 'action:refresh',
      title: 'Refresh Tables / Schema',
      subtitle: 'Reload metadata and cache from active database',
      category: 'Actions',
      icon: RefreshCw,
      badge: 'SYNC',
      keywords: ['refresh', 'reload', 'sync', 'tables', 'schema', 'cache'],
      onSelect: () => {
        onRefresh()
        closePalette()
      },
    })

    items.push({
      id: 'action:new_conn',
      title: 'New Connection',
      subtitle: 'Connect to PostgreSQL, MySQL, or SQLite',
      category: 'Actions',
      icon: Plus,
      badge: 'CONN',
      keywords: ['new', 'connection', 'add', 'connect', 'database', 'profile'],
      onSelect: () => {
        onNewConnection()
        closePalette()
      },
    })

    if (activeConnId) {
      items.push({
        id: 'action:disconnect',
        title: 'Disconnect Active Connection',
        subtitle: 'Unset active connection session',
        category: 'Actions',
        icon: Unplug,
        badge: 'SESSION',
        keywords: ['disconnect', 'close', 'unplug', 'leave'],
        onSelect: () => {
          onDisconnect()
          closePalette()
        },
      })
    }

    // 2. Tables & Views (active connection only)
    if (activeConnId) {
      for (const t of tables) {
        const isView = t.type === 'view'
        items.push({
          id: `table:${t.name}`,
          title: t.name,
          subtitle: `${isView ? 'View' : 'Table'} in schema '${selectedSchema}'`,
          category: 'Tables',
          icon: isView ? Eye : Table2,
          badge: isView ? 'VIEW' : 'TABLE',
          keywords: ['table', 'view', t.name, selectedSchema],
          onSelect: () => {
            onSelectTable(t.name)
            onTabChange('table')
            closePalette()
          },
        })
      }

      // 3. Schemas & Databases
      for (const s of schemas) {
        items.push({
          id: `schema:${s}`,
          title: `Schema: ${s}`,
          subtitle: s === selectedSchema ? 'Current active schema' : `Switch schema to ${s}`,
          category: 'Schemas',
          icon: Layers,
          badge: 'SCHEMA',
          keywords: ['schema', s],
          onSelect: () => {
            onSelectSchema(s)
            closePalette()
          },
        })
      }

      for (const db of databases) {
        items.push({
          id: `database:${db}`,
          title: `Database: ${db}`,
          subtitle: `Switch database to ${db}`,
          category: 'Schemas',
          icon: Database,
          badge: 'DATABASE',
          keywords: ['database', 'db', db],
          onSelect: () => {
            if (onSelectDatabase) {
              onSelectDatabase(db)
            } else if (activeConnId) {
              api.selectDatabase(activeConnId, db).then(onRefresh).catch(() => {})
            }
            closePalette()
          },
        })
      }
    }

    // 4. Connections
    for (const conn of connections) {
      const isCurrent = conn.id === activeConnId
      items.push({
        id: `conn:${conn.id}`,
        title: conn.label || conn.name || conn.id,
        subtitle: `${conn.dialect || conn.driver || 'Database'}${isCurrent ? ' • Active' : ' • Click to switch'}`,
        category: 'Connections',
        icon: Server,
        badge: (conn.dialect || conn.driver || 'CONN').toUpperCase(),
        keywords: ['connection', 'profile', conn.label || '', conn.name || '', conn.dialect || '', conn.id],
        onSelect: () => {
          onSwitchConnection(conn.id)
          closePalette()
        },
      })
    }

    return items
  }, [
    tables,
    schemas,
    databases,
    connections,
    activeConnId,
    selectedSchema,
    isDark,
    onTabChange,
    onToggleTheme,
    onRefresh,
    onNewConnection,
    onDisconnect,
    onSelectTable,
    onSelectSchema,
    onSelectDatabase,
    onSwitchConnection,
    closePalette,
  ])

  // Filter and group items
  const { categorizedItems, flatFilteredItems } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const tokens = q ? q.split(/\s+/).filter(Boolean) : []

    const scored: { item: CommandItem; score: number }[] = []

    for (const item of allItems) {
      if (!q) {
        scored.push({ item, score: 0 })
      } else {
        const score = getMatchScore(item, q, tokens)
        if (score >= 0) {
          scored.push({ item, score })
        }
      }
    }

    const categories: CategoryType[] = ['Actions', 'Tables', 'Schemas', 'Connections']
    const grouped: Record<CategoryType, CommandItem[]> = {
      Actions: [],
      Tables: [],
      Schemas: [],
      Connections: [],
    }

    // Group items
    for (const { item } of scored) {
      grouped[item.category].push(item)
    }

    // Sort within categories if query present
    if (q) {
      const scoreMap = new Map(scored.map(s => [s.item.id, s.score]))
      for (const cat of categories) {
        grouped[cat].sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0))
      }
    }

    const flat: CommandItem[] = []
    for (const cat of categories) {
      for (const item of grouped[cat]) {
        flat.push(item)
      }
    }

    return { categorizedItems: grouped, flatFilteredItems: flat }
  }, [allItems, query])

  // Focus input on open
  useEffect(() => {
    if (isCommandPaletteOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [isCommandPaletteOpen])

  // Scroll active item into view
  useEffect(() => {
    if (!isCommandPaletteOpen) return
    const el = itemRefs.current[selectedIndex]
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, isCommandPaletteOpen])

  // Keyboard navigation when open
  useEffect(() => {
    if (!isCommandPaletteOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (query) {
          setQuery('')
          setSelectedIndex(0)
        } else {
          closePalette()
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (flatFilteredItems.length > 0) {
          setSelectedIndex(prev => (prev + 1) % flatFilteredItems.length)
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (flatFilteredItems.length > 0) {
          setSelectedIndex(prev => (prev - 1 + flatFilteredItems.length) % flatFilteredItems.length)
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (flatFilteredItems.length > 0 && flatFilteredItems[selectedIndex]) {
          flatFilteredItems[selectedIndex].onSelect()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isCommandPaletteOpen, query, flatFilteredItems, selectedIndex, closePalette])

  if (!isCommandPaletteOpen) {
    return null
  }

  let flatCounter = 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-center items-start pt-[12vh] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          closePalette()
        }
      }}
    >
      <div className="w-full max-w-xl bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Search Input Bar */}
        <div className="relative flex items-center px-3.5 py-2.5 border-b border-[var(--border)] gap-2.5">
          <Search className="w-4 h-4 text-[var(--muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder="Type a command or search tables, databases..."
            className="flex-1 bg-transparent text-xs text-[var(--fg)] placeholder-[var(--muted)] outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setSelectedIndex(0)
                inputRef.current?.focus()
              }}
              className="p-1 text-[var(--muted)] hover:text-[var(--fg)] transition-colors rounded"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd className="text-[10px] font-mono text-[var(--muted)] bg-[var(--hover)] border border-[var(--border)] px-1.5 py-0.5 rounded">
              ESC
            </kbd>
          )}
        </div>

        {/* Results List */}
        <div className="max-h-[380px] overflow-y-auto py-1.5">
          {flatFilteredItems.length === 0 ? (
            <div className="py-12 px-4 text-center">
              <Search className="w-8 h-8 text-[var(--muted)] mx-auto mb-2 opacity-40" />
              <p className="text-xs font-medium text-[var(--fg)]">No results found for &ldquo;{query}&rdquo;</p>
              <p className="text-[11px] text-[var(--muted)] mt-1">
                Try searching for table names, schemas, or quick actions
              </p>
            </div>
          ) : (
            (['Actions', 'Tables', 'Schemas', 'Connections'] as CategoryType[]).map((cat) => {
              const items = categorizedItems[cat]
              if (!items || items.length === 0) return null

              return (
                <div key={cat} className="mb-2 last:mb-0">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    {cat} ({items.length})
                  </div>
                  <div className="space-y-0.5 px-1.5">
                    {items.map((item) => {
                      const itemFlatIndex = flatCounter++
                      const isSelected = itemFlatIndex === selectedIndex
                      const Icon = item.icon

                      return (
                        <div
                          key={item.id}
                          ref={(el) => {
                            itemRefs.current[itemFlatIndex] = el
                          }}
                          onClick={() => item.onSelect()}
                          onMouseEnter={() => setSelectedIndex(itemFlatIndex)}
                          className={`flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[var(--active)] text-[var(--fg)] font-medium shadow-xs'
                              : 'text-[var(--fg)] hover:bg-[var(--hover)]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`p-1 rounded-md shrink-0 transition-colors ${
                                isSelected
                                  ? 'bg-[var(--hover)] text-[var(--fg)]'
                                  : 'text-[var(--muted)]'
                              }`}
                            >
                              <Icon className="w-3.5 h-3.5" />
                            </span>
                            <div className="truncate">
                              <div className="truncate leading-snug">{item.title}</div>
                              {item.subtitle && (
                                <div className="text-[10px] text-[var(--muted)] truncate">
                                  {item.subtitle}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            {item.badge && (
                              <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] bg-[var(--hover)]">
                                {item.badge}
                              </span>
                            )}
                            {isSelected && (
                              <CornerDownLeft className="w-3 h-3 text-[var(--muted)] opacity-80" />
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer info & shortcut guide */}
        <div className="px-3 py-2 border-t border-[var(--border)] flex items-center justify-between text-[11px] text-[var(--muted)] bg-[var(--surface)]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="font-mono text-[10px] bg-[var(--hover)] border border-[var(--border)] px-1 rounded">↑</kbd>
              <kbd className="font-mono text-[10px] bg-[var(--hover)] border border-[var(--border)] px-1 rounded">↓</kbd>
              <span>navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-mono text-[10px] bg-[var(--hover)] border border-[var(--border)] px-1 rounded">↵</kbd>
              <span>select</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-mono text-[10px] bg-[var(--hover)] border border-[var(--border)] px-1 rounded">esc</kbd>
              <span>close</span>
            </span>
          </div>
          <span className="font-mono text-[10px]">
            {flatFilteredItems.length} {flatFilteredItems.length === 1 ? 'item' : 'items'}
          </span>
        </div>
      </div>
    </div>
  )
}
