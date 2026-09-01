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
  } = useAppStore()

  // Bootstrap connections if empty
  useEffect(() => {
    async function init() {
      if (connections.length === 0) {
        const conns = await api.getConnections()
        setConnections(conns)
        if (conns.length > 0 && !activeConnectionId) {
          setActiveConnectionId(conns[0].id)
        }
      }
    }
    init()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
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

        {/* Global Modals & Drawers */}
        <AddConnectionModal />
        <PeekDrawer />
        <DryRunModal />
      </div>
    </QueryClientProvider>
  )
}

export default App
