import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ConnectionConfig, QueryHistoryItem } from '../lib/api'

export type ActiveTab = 'table' | 'sql' | 'erd'

interface AppState {
  // Connections
  connections: ConnectionConfig[]
  activeConnectionId: string | null
  setConnections: (connections: ConnectionConfig[]) => void
  setActiveConnectionId: (id: string) => void
  addConnection: (conn: ConnectionConfig) => void
  removeConnection: (id: string) => void

  // Navigation & Active items
  activeTab: ActiveTab
  setActiveTab: (tab: ActiveTab) => void
  selectedSchema: string
  setSelectedSchema: (schema: string) => void
  selectedTable: string | null
  setSelectedTable: (table: string | null) => void

  // SQL Console History
  queryHistory: QueryHistoryItem[]
  addQueryHistory: (item: QueryHistoryItem) => void
  clearQueryHistory: () => void

  // Modals & Drawers
  isAddConnOpen: boolean
  setIsAddConnOpen: (open: boolean) => void
  peekDrawer: {
    isOpen: boolean
    targetTable?: string
    targetColumn?: string
    filterValue?: any
  }
  openPeekDrawer: (targetTable: string, targetColumn: string, filterValue: any) => void
  closePeekDrawer: () => void

  // Dry run / confirmation modal
  dryRunModal: {
    isOpen: boolean
    title: string
    sql: string
    onConfirm: () => void
  }
  openDryRunModal: (title: string, sql: string, onConfirm: () => void) => void
  closeDryRunModal: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      connections: [],
      activeConnectionId: null,
      setConnections: (connections) =>
        set((state) => ({
          connections,
          activeConnectionId:
            state.activeConnectionId || (connections.length > 0 ? connections[0].id : null),
        })),
      setActiveConnectionId: (activeConnectionId) => set({ activeConnectionId, selectedTable: null }),
      addConnection: (conn) =>
        set((state) => ({
          connections: [...state.connections, conn],
          activeConnectionId: conn.id,
        })),
      removeConnection: (id) =>
        set((state) => {
          const next = state.connections.filter((c) => c.id !== id)
          return {
            connections: next,
            activeConnectionId: state.activeConnectionId === id ? (next[0]?.id || null) : state.activeConnectionId,
          }
        }),

      activeTab: 'table',
      setActiveTab: (activeTab) => set({ activeTab }),
      selectedSchema: 'public',
      setSelectedSchema: (selectedSchema) => set({ selectedSchema, selectedTable: null }),
      selectedTable: 'users',
      setSelectedTable: (selectedTable) => set({ selectedTable }),

      queryHistory: [
        {
          id: 'hist_1',
          sql: 'SELECT * FROM users ORDER BY created_at DESC LIMIT 50;',
          timestamp: Date.now() - 1000 * 60 * 15,
          durationMs: 14,
          success: true,
          rowCount: 50,
        },
        {
          id: 'hist_2',
          sql: 'SELECT org_id, count(*) as member_count FROM memberships GROUP BY org_id;',
          timestamp: Date.now() - 1000 * 60 * 45,
          durationMs: 28,
          success: true,
          rowCount: 5,
        },
      ],
      addQueryHistory: (item) =>
        set((state) => ({
          queryHistory: [item, ...state.queryHistory.slice(0, 49)],
        })),
      clearQueryHistory: () => set({ queryHistory: [] }),

      isAddConnOpen: false,
      setIsAddConnOpen: (isAddConnOpen) => set({ isAddConnOpen }),

      peekDrawer: {
        isOpen: false,
      },
      openPeekDrawer: (targetTable, targetColumn, filterValue) =>
        set({
          peekDrawer: {
            isOpen: true,
            targetTable,
            targetColumn,
            filterValue,
          },
        }),
      closePeekDrawer: () =>
        set({
          peekDrawer: {
            isOpen: false,
          },
        }),

      dryRunModal: {
        isOpen: false,
        title: '',
        sql: '',
        onConfirm: () => {},
      },
      openDryRunModal: (title, sql, onConfirm) =>
        set({
          dryRunModal: {
            isOpen: true,
            title,
            sql,
            onConfirm,
          },
        }),
      closeDryRunModal: () =>
        set({
          dryRunModal: {
            isOpen: false,
            title: '',
            sql: '',
            onConfirm: () => {},
          },
        }),
    }),
    {
      name: 'dblens-storage',
      partialize: (state) => ({
        activeConnectionId: state.activeConnectionId,
        activeTab: state.activeTab,
        selectedSchema: state.selectedSchema,
        selectedTable: state.selectedTable,
        queryHistory: state.queryHistory,
      }),
    }
  )
)
