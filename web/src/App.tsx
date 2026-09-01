import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Header } from './features/connections/Header'
import { Sidebar } from './features/connections/Sidebar'
import { TableGridView } from './features/grid/TableGridView'
import { SqlConsoleView } from './features/editor/SqlConsoleView'
import { SchemaErdView } from './features/erd/SchemaErdView'
import { AddConnectionModal } from './features/connections/AddConnectionModal'
import { PeekDrawer } from './components/PeekDrawer'
import { DryRunModal } from './components/DryRunModal'
import { useAppStore } from './stores/appStore'
import { api } from './lib/api'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 30,
    },
  },
})

export function App() {
  const {
    activeTab,
    connections,
    setConnections,
    activeConnectionId,
    setActiveConnectionId,
    setIsAddConnOpen,
  } = useAppStore()

  // Bootstrap connections
  useEffect(() => {
    async function init() {
      try {
        const profiles = await api.getProfiles()
        setConnections(profiles)
        if (profiles.length > 0 && !activeConnectionId) {
          setActiveConnectionId(profiles[0].id)
        }
      } catch (err) {
        console.error('Failed to load profiles:', err)
      }
    }
    init()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex flex-col h-screen w-screen bg-[#0b0c0e] text-[#e4e4e7] overflow-hidden font-sans">
        {connections.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-[#0b0c0e] text-zinc-400 gap-3">
            <span className="font-mono text-sm text-zinc-300 font-medium">Connect to your first database</span>
            <button
              onClick={() => setIsAddConnOpen(true)}
              className="btn-primary"
            >
              Add Connection
            </button>
          </div>
        ) : (
          <>
            {/* Top Header */}
            <Header />

            {/* Workspace Body */}
            <div className="flex-1 flex overflow-hidden">
              {/* Sidebar */}
              <Sidebar />

              {/* Main Active Tab View */}
              <main className="flex-1 flex flex-col overflow-hidden relative">
                {activeTab === 'table' && <TableGridView />}
                {activeTab === 'sql' && <SqlConsoleView />}
                {activeTab === 'erd' && <SchemaErdView />}
              </main>
            </div>
          </>
        )}

        {/* Global Modals & Drawers */}
        <AddConnectionModal />
        <PeekDrawer />
        <DryRunModal />
      </div>
    </QueryClientProvider>
  )
}

export default App
