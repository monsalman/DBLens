import { useEffect, useState } from 'react'
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 1000 * 30 } }
})

export function App() {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('dblens-theme')
    return saved === 'light' ? false : true
  })

  useEffect(() => {
    if (isDark) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
    localStorage.setItem('dblens-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [activeConnId, setActiveConnId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingConfig, setEditingConfig] = useState<ConnectionConfig | null>(null)
  const [activeTab, setActiveTab] = useState<'table'|'sql'|'erd'>('table')
  const [selectedSchema, setSelectedSchema] = useState('public')
  const [selectedTable, setSelectedTable] = useState<string | null>(null)

  // Load connections on mount
  useEffect(() => {
    api.getProfiles().then(profiles => {
      setConnections(profiles)
      if (profiles.length > 0 && !activeConnId) {
        setActiveConnId(profiles[0].id)
      }
    }).catch(() => {})
  }, [])

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

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen w-screen overflow-hidden select-none transition-colors duration-200">
        {connections.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-[#f8f9fa] h-full">
            <div className="text-center space-y-6">
              <h1 className="font-mono text-lg text-[#1a1a1a] font-medium tracking-tight dark:text-[#e5e5e5]">DBLens</h1>
              <p className="text-sm text-[#6b7280]">Connect to your first database</p>
              <button onClick={() => { setEditingConfig(null); setShowAddModal(true); }} className="btn-primary">Add Connection</button>
            </div>
          </div>
        ) : (
          <>
            <Header 
              connections={connections} 
              activeConnId={activeConnId!} 
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
              onToggleTheme={() => setIsDark(prev => !prev)}
            />
            <div className="flex-1 flex overflow-hidden h-[calc(100vh-40px)]">
              <Sidebar 
                connections={connections} 
                activeConnId={activeConnId!} 
                selectedSchema={selectedSchema}
                onSelectSchema={setSelectedSchema}
                selectedTable={selectedTable}
                onSelectTable={(table) => {
                  setSelectedTable(table)
                  if (activeTab !== 'table') setActiveTab('table')
                }}
              />
              <main className="flex-1 flex flex-col overflow-hidden relative bg-white dark:bg-[#000]">
                {activeTab === 'table' && <TableGridView connId={activeConnId!} schema={selectedSchema} table={selectedTable || ''} />}
                {activeTab === 'sql' && <SqlConsoleView connId={activeConnId!} />}
                {activeTab === 'erd' && <SchemaErdView connId={activeConnId!} schema={selectedSchema} />}
              </main>
            </div>
          </>
        )}
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
        <PeekDrawer />
        <DryRunModal />
      </div>
    </QueryClientProvider>
  )
}

export default App
