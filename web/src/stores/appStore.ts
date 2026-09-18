import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ConnectionConfig, QueryHistoryItem } from '../lib/api'

export type ActiveTab = 'table' | 'sql' | 'erd' | 'diff' | 'processes' | 'advisor'

export interface SqlTab {
  id: string
  connId: string
  name: string
  query: string
  params?: Record<string, any>
}

export interface QueryBookmark {
  id: string
  name: string
  sql: string
  tags: string[]
  createdAt: number
}

const DEFAULT_BOOKMARKS: QueryBookmark[] = [
  {
    id: 'bm_1',
    name: 'Table Row Count Summary',
    sql: 'SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema = current_schema();',
    tags: ['general', 'diagnostics'],
    createdAt: 1710000000000,
  },
  {
    id: 'bm_2',
    name: 'Recent Activity Check',
    sql: 'SELECT * FROM information_schema.tables ORDER BY update_time DESC LIMIT 10;',
    tags: ['diagnostics', 'analytics'],
    createdAt: 1710000000000,
  },
  {
    id: 'bm_3',
    name: 'Find Large Tables',
    sql: 'SELECT table_name, data_length + index_length AS total_size FROM information_schema.tables ORDER BY total_size DESC LIMIT 10;',
    tags: ['analytics', 'performance'],
    createdAt: 1710000000000,
  },
]

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
  diffPreload: { sourceConnId?: string; sourceSchema?: string; sourceTable?: string } | null
  setDiffPreload: (preload: { sourceConnId?: string; sourceSchema?: string; sourceTable?: string } | null) => void

  // SQL Console History
  queryHistory: QueryHistoryItem[]
  addQueryHistory: (item: QueryHistoryItem) => void
  clearQueryHistory: () => void

  // SQL Console Tabs & Bookmarks
  sqlTabs: Record<string, SqlTab[]>
  activeSqlTabId: Record<string, string>
  queryBookmarks: QueryBookmark[]
  addSqlTab: (connId: string, name?: string, initialQuery?: string) => string
  closeSqlTab: (connId: string, tabId: string) => void
  renameSqlTab: (connId: string, tabId: string, name: string) => void
  updateSqlTabQuery: (connId: string, tabId: string, query: string) => void
  updateSqlTabParams: (connId: string, tabId: string, params: Record<string, any>) => void
  setActiveSqlTabId: (connId: string, tabId: string) => void
  addBookmark: (bookmark: Omit<QueryBookmark, 'id' | 'createdAt'> & { id?: string; createdAt?: number }) => void
  deleteBookmark: (id: string) => void

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

  // Command Palette
  isCommandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void
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
          const nextTabs = { ...state.sqlTabs }
          delete nextTabs[id]
          const nextActiveTabIds = { ...state.activeSqlTabId }
          delete nextActiveTabIds[id]
          return {
            connections: next,
            activeConnectionId: state.activeConnectionId === id ? (next[0]?.id || null) : state.activeConnectionId,
            sqlTabs: nextTabs,
            activeSqlTabId: nextActiveTabIds,
          }
        }),

      activeTab: 'table',
      setActiveTab: (activeTab) => set({ activeTab }),
      selectedSchema: 'public',
      setSelectedSchema: (selectedSchema) => set({ selectedSchema, selectedTable: null }),
      selectedTable: null,
      setSelectedTable: (selectedTable) => set({ selectedTable }),
      diffPreload: null,
      setDiffPreload: (diffPreload) => set({ diffPreload }),

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

      // SQL Tabs & Bookmarks State
      sqlTabs: {},
      activeSqlTabId: {},
      queryBookmarks: DEFAULT_BOOKMARKS,

      addSqlTab: (connId: string, name?: string, initialQuery?: string) => {
        const newTabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)
        set((state) => {
          const existing = state.sqlTabs[connId] || []
          const tabName = name?.trim() || `Query ${existing.length + 1}`
          const query = initialQuery !== undefined ? initialQuery : 'SELECT * FROM users LIMIT 10;'
          const newTab: SqlTab = {
            id: newTabId,
            connId,
            name: tabName,
            query,
          }
          return {
            sqlTabs: {
              ...state.sqlTabs,
              [connId]: [...existing, newTab],
            },
            activeSqlTabId: {
              ...state.activeSqlTabId,
              [connId]: newTabId,
            },
          }
        })
        return newTabId
      },

      closeSqlTab: (connId: string, tabId: string) =>
        set((state) => {
          const existing = state.sqlTabs[connId] || []
          if (existing.length <= 1) {
            return state
          }
          const nextTabs = existing.filter((t) => t.id !== tabId)
          const currentActiveId = state.activeSqlTabId[connId]
          let nextActiveId = currentActiveId
          if (currentActiveId === tabId) {
            const closedIndex = existing.findIndex((t) => t.id === tabId)
            const nextIndex = Math.max(0, closedIndex - 1)
            nextActiveId = nextTabs[nextIndex]?.id || nextTabs[0]?.id
          }
          return {
            sqlTabs: {
              ...state.sqlTabs,
              [connId]: nextTabs,
            },
            activeSqlTabId: {
              ...state.activeSqlTabId,
              [connId]: nextActiveId,
            },
          }
        }),

      renameSqlTab: (connId: string, tabId: string, name: string) =>
        set((state) => {
          const existing = state.sqlTabs[connId] || []
          const trimmed = name.trim()
          return {
            sqlTabs: {
              ...state.sqlTabs,
              [connId]: existing.map((t) => (t.id === tabId ? { ...t, name: trimmed || t.name } : t)),
            },
          }
        }),

      updateSqlTabQuery: (connId: string, tabId: string, query: string) =>
        set((state) => {
          const existing = state.sqlTabs[connId] || []
          return {
            sqlTabs: {
              ...state.sqlTabs,
              [connId]: existing.map((t) => (t.id === tabId ? { ...t, query } : t)),
            },
          }
        }),

      updateSqlTabParams: (connId: string, tabId: string, params: Record<string, any>) =>
        set((state) => {
          const existing = state.sqlTabs[connId] || []
          return {
            sqlTabs: {
              ...state.sqlTabs,
              [connId]: existing.map((t) => (t.id === tabId ? { ...t, params } : t)),
            },
          }
        }),

      setActiveSqlTabId: (connId: string, tabId: string) =>
        set((state) => ({
          activeSqlTabId: {
            ...state.activeSqlTabId,
            [connId]: tabId,
          },
        })),

      addBookmark: (bookmark) =>
        set((state) => {
          const newBm: QueryBookmark = {
            id: bookmark.id || 'bm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            name: bookmark.name.trim() || 'Untitled Query',
            sql: bookmark.sql,
            tags: bookmark.tags && bookmark.tags.length > 0 ? bookmark.tags : ['general'],
            createdAt: bookmark.createdAt || Date.now(),
          }
          return {
            queryBookmarks: [newBm, ...(state.queryBookmarks || [])],
          }
        }),

      deleteBookmark: (id: string) =>
        set((state) => ({
          queryBookmarks: (state.queryBookmarks || []).filter((b) => b.id !== id),
        })),

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

      isCommandPaletteOpen: false,
      setCommandPaletteOpen: (isCommandPaletteOpen) => set({ isCommandPaletteOpen }),
    }),
    {
      name: 'dblens-storage',
      partialize: (state) => ({
        activeConnectionId: state.activeConnectionId,
        activeTab: state.activeTab,
        selectedSchema: state.selectedSchema,
        selectedTable: state.selectedTable,
        queryHistory: state.queryHistory,
        sqlTabs: state.sqlTabs,
        activeSqlTabId: state.activeSqlTabId,
        queryBookmarks: state.queryBookmarks,
      }),
    }
  )
)
