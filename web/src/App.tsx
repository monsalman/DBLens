import { useEffect, useState, useCallback } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from './lib/api'
import type { ConnectionConfig } from './lib/api'
import { Header } from './features/connections/Header'
import { Sidebar } from './features/connections/Sidebar'
import { TableGridView } from './features/grid/TableGridView'
import { SqlConsoleView } from './features/editor/SqlConsoleView'
import { SchemaErdView } from './features/erd/SchemaErdView'
import { AddConnectionModal } from './features/connections/AddConnectionModal'
import { PeekDrawer } from './components/PeekDrawer'
import { DryRunModal } from './components/DryRunModal'
import { CommandPalette } from './components/CommandPalette'
import { useAppStore } from './stores/appStore'
import { Monitor, Moon, Sun, Database, Zap, Shield, GitBranch } from 'lucide-react'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 1000 * 30 } }
})

export function App() {
  const [isDark, setIsDark] = useState(() => {
    // 1. Cek localStorage dulu
    const saved = localStorage.getItem('dblens-theme')
    if (saved === 'light' || saved === 'dark') return saved === 'dark'
    // 2. Jika belum tersimpan, ikuti preferensi OS/device
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  const toggleTheme = useCallback(() => {
    setIsDark(prev => {
      const next = !prev
      document.documentElement.classList.toggle('dark', next)
      localStorage.setItem('dblens-theme', next ? 'dark' : 'light')
      return next
    })
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('dblens-theme')) {
        setIsDark(e.matches)
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [activeConnId, setActiveConnId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingConfig, setEditingConfig] = useState<ConnectionConfig | null>(null)
  const [activeTab, setActiveTab] = useState<'table'|'sql'|'erd'>('table')
  const [selectedSchema, setSelectedSchema] = useState('public')
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries()
    setRefreshKey(k => k + 1)
  }, [])

  const handleSelectDatabase = useCallback(async (db: string) => {
    if (!activeConnId) return
    try {
      await api.selectDatabase(activeConnId, db, connections)
      handleRefresh()
    } catch (err) {
      console.error('Failed to select database', err)
    }
  }, [activeConnId, connections, handleRefresh])

  const handleDisconnect = useCallback(() => {
    setActiveConnId(null)
    setSelectedTable(null)
    useAppStore.getState().setActiveConnectionId('' as any)
  }, [])

  useEffect(() => {
    const localProfiles = api.getProfiles()
    setConnections(localProfiles)
    if (localProfiles.length > 0 && !activeConnId) {
      setActiveConnId(localProfiles[0].id)
      useAppStore.getState().setActiveConnectionId(localProfiles[0].id)
    }
  }, [])

  useEffect(() => {
    if (activeConnId) {
      useAppStore.getState().setActiveConnectionId(activeConnId)
    }
  }, [activeConnId])

  const handleDeleted = (id: string) => {
    setConnections(prev => {
      const next = prev.filter(c => c.id !== id)
      if (activeConnId === id) {
        setActiveConnId(next.length > 0 ? next[0].id : null)
        setSelectedTable(null)
      }
      return next
    })
  }

  const features = [
    { icon: <Database className="w-5 h-5" />, title: 'Multi-Engine Support', desc: 'PostgreSQL, MySQL, SQLite' },
    { icon: <Zap className="w-5 h-5" />, title: 'Lightning Fast', desc: 'Optimized for speed' },
    { icon: <Shield className="w-5 h-5" />, title: 'Secure by Default', desc: 'No credentials stored on server' },
    { icon: <GitBranch className="w-5 h-5" />, title: 'Self-Hosted', desc: 'Your data stays yours' },
  ]

  if (connections.length === 0) {
    return (
      <QueryClientProvider client={queryClient}>
        <div className={`h-screen w-screen overflow-hidden select-none transition-colors duration-300 ${isDark ? 'dark bg-[#0b0c0e] text-[#f5f5f5]' : 'bg-[#f8f9fa] text-[#1a1a2e]'}`}>
          {/* Theme Toggle - top right */}
          <div className="fixed top-4 right-4 z-50">
            <button onClick={toggleTheme}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border backdrop-blur-sm transition-all duration-200 ${
                isDark
                  ? 'border-white/[0.1] bg-black/60 text-[#a1a1aa] hover:text-[#f5f5f5] hover:bg-black/80'
                  : 'border-gray-200 bg-white/80 text-[#6b7280] hover:text-[#1a1a2e] hover:bg-white shadow-sm'
              }`}>
              {isDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              <span className="text-xs font-medium">{isDark ? 'Dark' : 'Light'}</span>
            </button>
          </div>

          {/* Main Content */}
          <div className="flex flex-col items-center justify-center min-h-screen px-6">
            {/* Logo & Title */}
            <div className="text-center mb-10 space-y-3">
              <div className={`inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-4 ${
                isDark ? 'bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30' : 'bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/20'
              }`}>
                <Monitor className="w-10 h-10 text-white" />
              </div>
              <h1 className={`font-mono text-3xl font-bold tracking-tight ${isDark ? 'text-[#f5f5f5]' : 'text-[#1a1a2e]'}`}>
                DBLens <span className={`text-base font-normal ml-2 px-2 py-0.5 rounded-md ${isDark ? 'bg-white/[0.08] text-[#a1a1aa]' : 'bg-gray-100 text-[#6b7280]'}`}>v0.1.0</span>
              </h1>
              <p className={`text-base max-w-md mx-auto ${isDark ? 'text-[#737373]' : 'text-[#6b7280]'}`}>
                Modern database administration studio — built for developers who value simplicity and performance.
              </p>
            </div>

            {/* Feature Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10 max-w-2xl w-full">
              {features.map((f, i) => (
                <div key={i} className={`rounded-xl p-4 border transition-all duration-200 ${
                  isDark
                    ? 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]'
                    : 'bg-white border-gray-100 hover:border-gray-200 shadow-sm hover:shadow-md'
                }`}>
                  <div className={`mb-2 ${isDark ? 'text-indigo-400' : 'text-indigo-500'}`}>{f.icon}</div>
                  <div className={`text-xs font-semibold mb-0.5 ${isDark ? 'text-[#d4d4d8]' : 'text-[#1a1a2e]'}`}>{f.title}</div>
                  <div className={`text-[11px] ${isDark ? 'text-[#737373]' : 'text-[#6b7280]'}`}>{f.desc}</div>
                </div>
              ))}
            </div>

            {/* CTA Buttons */}
            <div className="flex items-center gap-3">
              <button onClick={() => { setEditingConfig(null); setShowAddModal(true); }} className="btn-primary text-sm">
                + Add Connection
              </button>
              <a href="#" onClick={(e) => e.preventDefault()} className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                isDark
                  ? 'border-white/[0.1] text-[#a1a1aa] hover:text-[#f5f5f5] hover:bg-white/[0.05]'
                  : 'border-gray-200 text-[#6b7280] hover:text-[#1a1a2e] hover:bg-gray-50'
              }`}>
                Documentation
              </a>
            </div>
          </div>

          {/* Footer */}
          <div className={`fixed bottom-4 left-0 right-0 text-center text-[11px] ${isDark ? 'text-[#525252]' : 'text-[#9ca3af]'}`}>
            Open-source • Zero telemetry • 100% self-hosted
          </div>

          <AddConnectionModal
            isOpen={showAddModal}
            initialData={editingConfig}
            onClose={() => { setShowAddModal(false); setEditingConfig(null); }}
            onAdded={(conn) => {
              setConnections(prev => [...prev, conn])
              if (!activeConnId) setActiveConnId(conn.id)
            }}
            onUpdated={(updatedConn) => {
              setConnections(prev => prev.map(c => c.id === updatedConn.id ? updatedConn : c))
            }}
          />

          <CommandPalette
            connections={connections}
            activeConnId={null}
            activeTab={activeTab}
            selectedSchema={selectedSchema}
            selectedTable={selectedTable}
            isDark={isDark}
            onSwitchConnection={(id) => { setActiveConnId(id); setSelectedTable(null); }}
            onSelectTable={setSelectedTable}
            onSelectSchema={setSelectedSchema}
            onTabChange={setActiveTab}
            onToggleTheme={toggleTheme}
            onNewConnection={() => { setEditingConfig(null); setShowAddModal(true); }}
            onDisconnect={handleDisconnect}
            onRefresh={handleRefresh}
          />
        </div>
      </QueryClientProvider>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen w-screen overflow-hidden select-none transition-colors duration-200">
        <Header 
          connections={connections} 
          activeConnId={activeConnId} 
          onSwitch={(id) => { setActiveConnId(id); setSelectedTable(null); }}
          onAdd={() => { setEditingConfig(null); setShowAddModal(true); }}
          onEdit={(conn) => { setEditingConfig(conn); setShowAddModal(true); }}
          onDeleted={handleDeleted}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          selectedSchema={selectedSchema}
          onSchemaChange={setSelectedSchema}
          selectedTable={selectedTable}
          onSelectTable={setSelectedTable}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onOpenCommandPalette={() => useAppStore.getState().setCommandPaletteOpen(true)}
        />
        <div className="flex-1 flex overflow-hidden h-[calc(100vh-40px)]">
          <Sidebar 
            key={`${activeConnId}:${refreshKey}`}
            connections={connections} 
            activeConnId={activeConnId || ''} 
            selectedSchema={selectedSchema}
            onSelectSchema={setSelectedSchema}
            selectedTable={selectedTable}
            onSelectTable={(table) => {
              setSelectedTable(table)
              if (activeTab !== 'table') setActiveTab('table')
            }}
          />
          <main className="flex-1 flex flex-col overflow-hidden relative bg-[var(--bg)] text-[var(--fg)]">
            {!activeConnId ? (
              <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] gap-3 p-6 text-center">
                <Database className="w-10 h-10 opacity-30" />
                <div>
                  <p className="text-sm font-medium text-[var(--fg)]">No connection active</p>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    Select a connection above or press <kbd className="font-mono bg-[var(--hover)] border border-[var(--border)] px-1.5 py-0.5 rounded text-[11px]">⌘K</kbd> to search
                  </p>
                </div>
              </div>
            ) : (
              <>
                {activeTab === 'table' && <TableGridView key={`${activeConnId}:${selectedSchema}:${selectedTable || ''}:${refreshKey}`} connId={activeConnId} schema={selectedSchema} table={selectedTable || ''} />}
                {activeTab === 'sql' && <SqlConsoleView connId={activeConnId} />}
                {activeTab === 'erd' && <SchemaErdView connId={activeConnId} schema={selectedSchema} />}
              </>
            )}
          </main>
        </div>
      </div>
      <AddConnectionModal
        isOpen={showAddModal}
        initialData={editingConfig}
        onClose={() => { setShowAddModal(false); setEditingConfig(null); }}
        onAdded={(conn) => {
          setConnections(prev => [...prev, conn])
          if (!activeConnId) setActiveConnId(conn.id)
        }}
        onUpdated={(updatedConn) => {
          setConnections(prev => prev.map(c => c.id === updatedConn.id ? updatedConn : c))
        }}
      />
      <CommandPalette
        connections={connections}
        activeConnId={activeConnId}
        activeTab={activeTab}
        selectedSchema={selectedSchema}
        selectedTable={selectedTable}
        isDark={isDark}
        onSwitchConnection={(id) => { setActiveConnId(id); setSelectedTable(null); }}
        onSelectTable={(table) => {
          setSelectedTable(table)
          if (activeTab !== 'table') setActiveTab('table')
        }}
        onSelectSchema={setSelectedSchema}
        onSelectDatabase={handleSelectDatabase}
        onTabChange={setActiveTab}
        onToggleTheme={toggleTheme}
        onNewConnection={() => { setEditingConfig(null); setShowAddModal(true); }}
        onDisconnect={handleDisconnect}
        onRefresh={handleRefresh}
      />
      <PeekDrawer />
      <DryRunModal />
    </QueryClientProvider>
  )
}

export default App
