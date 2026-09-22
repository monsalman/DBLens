import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  X,
  Webhook,
  Send,
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  RotateCw,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Clock,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react'
import {
  api,
  type Webhook as WebhookModel,
  type WebhookDelivery,
  type SimulateWebhookRequest,
  type TableMeta,
} from '../../lib/api'
import { useAppStore } from '../../stores/appStore'

interface Props {
  isOpen?: boolean
  onClose?: () => void
}

export const WebhookModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const storeIsOpen = useAppStore((s) => s.isWebhookModalOpen)
  const setStoreIsOpen = useAppStore((s) => s.setIsWebhookModalOpen)
  const activeConnId = useAppStore((s) => s.activeConnectionId)
  const selectedSchema = useAppStore((s) => s.selectedSchema)
  const connections = useAppStore((s) => s.connections)

  const show = isOpen !== undefined ? isOpen : storeIsOpen
  const handleClose = () => {
    if (onClose) {
      onClose()
    } else {
      setStoreIsOpen(false)
    }
  }

  // Active navigation tab inside modal
  const [activeTab, setActiveTab] = useState<'webhooks' | 'deliveries' | 'simulator'>('webhooks')

  // Webhooks state
  const [webhooks, setWebhooks] = useState<WebhookModel[]>([])
  const [loadingWebhooks, setLoadingWebhooks] = useState(false)
  const [webhookError, setWebhookError] = useState<string | null>(null)

  // Deliveries state
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [loadingDeliveries, setLoadingDeliveries] = useState(false)
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null)
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  // Deliveries filtering
  const [deliveryFilterEvent, setDeliveryFilterEvent] = useState<string>('ALL')
  const [deliveryFilterStatus, setDeliveryFilterStatus] = useState<string>('ALL')
  const [deliverySearch, setDeliverySearch] = useState<string>('')

  // Webhook Form state (Add / Edit)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formSecret, setFormSecret] = useState('')
  const [formShowSecret, setFormShowSecret] = useState(false)
  const [formEvents, setFormEvents] = useState<string[]>(['INSERT', 'UPDATE', 'DELETE'])
  const [formTables, setFormTables] = useState<string>('*')
  const [formEnabled, setFormEnabled] = useState(true)
  const [formHeadersText, setFormHeadersText] = useState('')
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Simulator state
  const [simTargetMode, setSimTargetMode] = useState<'webhook' | 'custom'>('webhook')
  const [simSelectedWebhookId, setSimSelectedWebhookId] = useState<string>('')
  const [simCustomUrl, setSimCustomUrl] = useState<string>('')
  const [simCustomSecret, setSimCustomSecret] = useState<string>('')
  const [simEvent, setSimEvent] = useState<'INSERT' | 'UPDATE' | 'DELETE'>('INSERT')
  const [simSchema, setSimSchema] = useState<string>(selectedSchema || 'public')
  const [simTable, setSimTable] = useState<string>('users')
  const [simOldRecord, setSimOldRecord] = useState<string>('{\n  "id": 101,\n  "status": "pending"\n}')
  const [simNewRecord, setSimNewRecord] = useState<string>('{\n  "id": 101,\n  "name": "Jane Doe",\n  "email": "jane@example.com",\n  "status": "active"\n}')
  const [simulating, setSimulating] = useState(false)
  const [simResult, setSimResult] = useState<any | null>(null)
  const [simError, setSimError] = useState<string | null>(null)

  // Tables list for auto-complete hints
  const [availableTables, setAvailableTables] = useState<string[]>([])

  // Copied feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }

  // Fetch webhooks
  const fetchWebhooks = useCallback(async () => {
    if (!activeConnId) return
    setLoadingWebhooks(true)
    setWebhookError(null)
    try {
      const list = await api.getWebhooks(activeConnId, connections)
      setWebhooks(list || [])
      if (list && list.length > 0 && !simSelectedWebhookId) {
        setSimSelectedWebhookId(list[0].id)
      }
    } catch (err: any) {
      setWebhookError(err.message || 'Failed to load webhooks')
    } finally {
      setLoadingWebhooks(false)
    }
  }, [activeConnId, connections, simSelectedWebhookId])

  // Fetch deliveries
  const fetchDeliveries = useCallback(async () => {
    if (!activeConnId) return
    setLoadingDeliveries(true)
    setDeliveriesError(null)
    try {
      const list = await api.getWebhookDeliveries(activeConnId, connections)
      setDeliveries(list || [])
    } catch (err: any) {
      setDeliveriesError(err.message || 'Failed to load deliveries')
    } finally {
      setLoadingDeliveries(false)
    }
  }, [activeConnId, connections])

  // Fetch available tables for schema
  useEffect(() => {
    if (!activeConnId) return
    api.getTables(activeConnId, selectedSchema, connections)
      .then((tbls) => {
        const names = (tbls || []).map((t: TableMeta) => t.name)
        setAvailableTables(names)
      })
      .catch(() => {})
  }, [activeConnId, selectedSchema, connections])

  // Initial load
  useEffect(() => {
    if (show && activeConnId) {
      fetchWebhooks()
      fetchDeliveries()
    }
  }, [show, activeConnId, fetchWebhooks, fetchDeliveries])

  // Reset form
  const resetForm = () => {
    setEditingWebhookId(null)
    setFormName('')
    setFormUrl('')
    setFormSecret('')
    setFormShowSecret(false)
    setFormEvents(['INSERT', 'UPDATE', 'DELETE'])
    setFormTables('*')
    setFormEnabled(true)
    setFormHeadersText('')
    setFormError(null)
  }

  // Open Add Form
  const handleOpenAdd = () => {
    resetForm()
    setIsFormOpen(true)
  }

  // Open Edit Form
  const handleOpenEdit = (wh: WebhookModel) => {
    setEditingWebhookId(wh.id)
    setFormName(wh.name)
    setFormUrl(wh.url)
    setFormSecret(wh.secret || '')
    setFormEvents(wh.events && wh.events.length > 0 ? wh.events : ['INSERT', 'UPDATE', 'DELETE'])
    setFormTables(wh.tables && wh.tables.length > 0 ? wh.tables.join(', ') : '*')
    setFormEnabled(wh.enabled)
    if (wh.headers && Object.keys(wh.headers).length > 0) {
      const lines = Object.entries(wh.headers).map(([k, v]) => `${k}: ${v}`).join('\n')
      setFormHeadersText(lines)
    } else {
      setFormHeadersText('')
    }
    setFormError(null)
    setIsFormOpen(true)
  }

  // Submit Webhook Form
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeConnId) return

    const trimmedName = formName.trim()
    const trimmedUrl = formUrl.trim()

    if (!trimmedName) {
      setFormError('Webhook Name is required')
      return
    }
    if (!trimmedUrl) {
      setFormError('Endpoint URL is required')
      return
    }

    // Parse custom headers
    const parsedHeaders: Record<string, string> = {}
    if (formHeadersText.trim()) {
      const lines = formHeadersText.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const colonIdx = trimmed.indexOf(':')
        if (colonIdx > 0) {
          const key = trimmed.slice(0, colonIdx).trim()
          const val = trimmed.slice(colonIdx + 1).trim()
          if (key) parsedHeaders[key] = val
        }
      }
    }

    // Parse tables
    const parsedTables = formTables
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    const payload: Partial<WebhookModel> = {
      name: trimmedName,
      url: trimmedUrl,
      secret: formSecret.trim() || undefined,
      events: formEvents,
      tables: parsedTables.length > 0 ? parsedTables : ['*'],
      enabled: formEnabled,
      headers: Object.keys(parsedHeaders).length > 0 ? parsedHeaders : undefined,
    }

    setFormSubmitting(true)
    setFormError(null)

    try {
      if (editingWebhookId) {
        await api.updateWebhook(activeConnId, editingWebhookId, payload, connections)
      } else {
        await api.createWebhook(activeConnId, payload, connections)
      }
      setIsFormOpen(false)
      resetForm()
      await fetchWebhooks()
    } catch (err: any) {
      setFormError(err.message || 'Failed to save webhook')
    } finally {
      setFormSubmitting(false)
    }
  }

  // Delete Webhook
  const handleDeleteWebhook = async (id: string, name: string) => {
    if (!activeConnId) return
    if (!window.confirm(`Delete webhook "${name}"?`)) return

    try {
      await api.deleteWebhook(activeConnId, id, connections)
      await fetchWebhooks()
    } catch (err: any) {
      alert(err.message || 'Failed to delete webhook')
    }
  }

  // Toggle Webhook Enabled
  const handleToggleWebhook = async (wh: WebhookModel) => {
    if (!activeConnId) return
    try {
      await api.updateWebhook(
        activeConnId,
        wh.id,
        { ...wh, enabled: !wh.enabled },
        connections
      )
      await fetchWebhooks()
    } catch (err: any) {
      alert(err.message || 'Failed to toggle webhook state')
    }
  }

  // Quick Test Ping
  const [pingingId, setPingingId] = useState<string | null>(null)
  const handleTestPing = async (wh: WebhookModel) => {
    if (!activeConnId) return
    setPingingId(wh.id)
    try {
      const res = await api.simulateWebhook(
        activeConnId,
        {
          webhook_id: wh.id,
          event: wh.events.includes('INSERT') ? 'INSERT' : wh.events[0] || 'INSERT',
          schema: selectedSchema || 'public',
          table: wh.tables.includes('*') ? 'test_events' : wh.tables[0],
          new_record: { ping: true, timestamp: new Date().toISOString() },
        },
        connections
      )
      await fetchDeliveries()
      if (res.success) {
        alert(`Ping successful! Response ${res.delivery.response_status_code} (${res.delivery.latency_ms}ms)`)
      } else {
        alert(`Ping completed with status ${res.delivery.response_status_code || 'Error'}: ${res.delivery.error || res.delivery.response_body || 'Check delivery log'}`)
      }
    } catch (err: any) {
      alert(`Ping failed: ${err.message}`)
    } finally {
      setPingingId(null)
    }
  }

  // Retry delivery
  const handleRetryDelivery = async (id: string) => {
    if (!activeConnId) return
    setRetryingId(id)
    try {
      const retried = await api.retryWebhookDelivery(activeConnId, id, connections)
      await fetchDeliveries()
      setExpandedDeliveryId(retried.id)
    } catch (err: any) {
      alert(`Retry failed: ${err.message}`)
    } finally {
      setRetryingId(null)
    }
  }

  // Execute simulation
  const handleExecuteSimulate = async () => {
    if (!activeConnId) return
    setSimulating(true)
    setSimError(null)
    setSimResult(null)

    let parsedOld: any = undefined
    let parsedNew: any = undefined

    if (simEvent === 'UPDATE' || simEvent === 'DELETE') {
      try {
        if (simOldRecord.trim()) parsedOld = JSON.parse(simOldRecord)
      } catch (err: any) {
        setSimError('Invalid JSON in Old Record: ' + err.message)
        setSimulating(false)
        return
      }
    }

    if (simEvent === 'INSERT' || simEvent === 'UPDATE') {
      try {
        if (simNewRecord.trim()) parsedNew = JSON.parse(simNewRecord)
      } catch (err: any) {
        setSimError('Invalid JSON in New Record: ' + err.message)
        setSimulating(false)
        return
      }
    }

    const req: SimulateWebhookRequest = {
      event: simEvent,
      schema: simSchema.trim() || 'public',
      table: simTable.trim() || 'users',
      old_record: parsedOld,
      new_record: parsedNew,
    }

    if (simTargetMode === 'webhook') {
      if (!simSelectedWebhookId) {
        setSimError('Please select a registered webhook')
        setSimulating(false)
        return
      }
      req.webhook_id = simSelectedWebhookId
    } else {
      if (!simCustomUrl.trim()) {
        setSimError('Custom Target URL is required')
        setSimulating(false)
        return
      }
      req.url = simCustomUrl.trim()
      if (simCustomSecret.trim()) {
        req.secret = simCustomSecret.trim()
      }
    }

    try {
      const res = await api.simulateWebhook(activeConnId, req, connections)
      setSimResult(res)
      await fetchDeliveries()
    } catch (err: any) {
      setSimError(err.message || 'Failed to dispatch synthetic event')
    } finally {
      setSimulating(false)
    }
  }

  // Preset generators for simulator
  const loadPreset = (preset: 'user' | 'order' | 'delete') => {
    if (preset === 'user') {
      setSimEvent('INSERT')
      setSimTable('users')
      setSimNewRecord(JSON.stringify({ id: 205, name: 'Alex Rivera', role: 'admin', created_at: new Date().toISOString() }, null, 2))
      setSimOldRecord('{}')
    } else if (preset === 'order') {
      setSimEvent('UPDATE')
      setSimTable('orders')
      setSimOldRecord(JSON.stringify({ id: 1042, status: 'pending', payment_received: false }, null, 2))
      setSimNewRecord(JSON.stringify({ id: 1042, status: 'completed', payment_received: true, completed_at: new Date().toISOString() }, null, 2))
    } else if (preset === 'delete') {
      setSimEvent('DELETE')
      setSimTable('sessions')
      setSimOldRecord(JSON.stringify({ session_id: 'sess_9941a8', user_id: 42, ip: '192.168.1.1' }, null, 2))
      setSimNewRecord('{}')
    }
  }

  // Filtered deliveries
  const filteredDeliveries = useMemo(() => {
    return deliveries.filter((d) => {
      if (deliveryFilterEvent !== 'ALL' && d.event !== deliveryFilterEvent) {
        return false
      }
      if (deliveryFilterStatus === 'SUCCESS') {
        if (d.response_status_code < 200 || d.response_status_code >= 300) return false
      } else if (deliveryFilterStatus === 'FAILED') {
        if (d.response_status_code >= 200 && d.response_status_code < 300 && !d.error) return false
      }
      if (deliverySearch.trim()) {
        const query = deliverySearch.toLowerCase()
        const matchUrl = d.url?.toLowerCase().includes(query)
        const matchPayload = d.request_payload?.toLowerCase().includes(query)
        const matchName = d.webhook_name?.toLowerCase().includes(query)
        if (!matchUrl && !matchPayload && !matchName) return false
      }
      return true
    })
  }, [deliveries, deliveryFilterEvent, deliveryFilterStatus, deliverySearch])

  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4 sm:p-6 animate-in fade-in duration-150">
      <div
        className="flex flex-col w-full max-w-5xl h-[90vh] max-h-[850px] bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden text-[var(--fg)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
              <Webhook className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                Database Webhooks & Change Event Simulator
                <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20">
                  CDC Engine
                </span>
              </h2>
              <p className="text-[11px] text-[var(--muted)]">
                Manage webhook dispatchers, inspect payload delivery logs, and simulate synthetic events.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-5 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('webhooks')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'webhooks'
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <Webhook className="w-3.5 h-3.5" />
              Registered Webhooks
              <span className="ml-1 px-1.5 py-0.2 text-[10px] rounded-full bg-[var(--hover)] text-[var(--muted)] font-mono">
                {webhooks.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('deliveries')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'deliveries'
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              Deliveries Log
              <span className="ml-1 px-1.5 py-0.2 text-[10px] rounded-full bg-[var(--hover)] text-[var(--muted)] font-mono">
                {deliveries.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('simulator')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'simulator'
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              Event Simulator
            </button>
          </div>

          <div className="flex items-center gap-2 py-1.5">
            {activeTab === 'webhooks' && (
              <button
                type="button"
                onClick={handleOpenAdd}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md shadow-sm transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Webhook
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (activeTab === 'webhooks') fetchWebhooks()
                else if (activeTab === 'deliveries') fetchDeliveries()
              }}
              className="p-1.5 text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] rounded-md transition-colors"
              title="Refresh"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  loadingWebhooks || loadingDeliveries ? 'animate-spin' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* TAB 1: WEBHOOKS LIST & MODAL FORM */}
          {activeTab === 'webhooks' && (
            <div className="space-y-4">
              {webhookError && (
                <div className="flex items-center gap-2 p-3 text-xs rounded-lg bg-red-500/10 text-red-500 border border-red-500/20">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{webhookError}</span>
                </div>
              )}

              {/* Inline Webhook Form */}
              {isFormOpen && (
                <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/5 space-y-4 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                    <h3 className="text-xs font-semibold text-[var(--fg)] flex items-center gap-2">
                      {editingWebhookId ? <Pencil className="w-3.5 h-3.5 text-blue-500" /> : <Plus className="w-3.5 h-3.5 text-blue-500" />}
                      {editingWebhookId ? 'Edit Webhook Configuration' : 'Register New Webhook Endpoint'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => { setIsFormOpen(false); resetForm(); }}
                      className="text-[var(--muted)] hover:text-[var(--fg)]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {formError && (
                    <div className="p-2.5 text-xs rounded bg-red-500/10 text-red-500 border border-red-500/20 flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formError}
                    </div>
                  )}

                  <form onSubmit={handleFormSubmit} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                          Webhook Name <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          placeholder="e.g. Audit Log Streamer"
                          required
                          className="w-full px-2.5 py-1.5 text-xs bg-[var(--surface)] border border-[var(--border)] rounded-md focus:outline-none focus:border-blue-500 font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                          Target URL <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="url"
                          value={formUrl}
                          onChange={(e) => setFormUrl(e.target.value)}
                          placeholder="https://api.example.com/webhooks"
                          required
                          className="w-full px-2.5 py-1.5 text-xs bg-[var(--surface)] border border-[var(--border)] rounded-md focus:outline-none focus:border-blue-500 font-mono"
                        />
                        <span className="text-[10px] text-[var(--muted)] mt-0.5 block">
                          SSRF-protected. Cloud metadata (169.254.169.254) blocked.
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                          Signing Secret (HMAC-SHA256)
                        </label>
                        <div className="relative">
                          <input
                            type={formShowSecret ? 'text' : 'password'}
                            value={formSecret}
                            onChange={(e) => setFormSecret(e.target.value)}
                            placeholder="Optional secret for X-DBLens-Signature"
                            className="w-full px-2.5 py-1.5 pr-8 text-xs bg-[var(--surface)] border border-[var(--border)] rounded-md focus:outline-none focus:border-blue-500 font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setFormShowSecret(!formShowSecret)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--fg)]"
                          >
                            {formShowSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                          Tables Filter (comma-separated or * for all)
                        </label>
                        <input
                          type="text"
                          value={formTables}
                          onChange={(e) => setFormTables(e.target.value)}
                          placeholder="*, users, orders"
                          className="w-full px-2.5 py-1.5 text-xs bg-[var(--surface)] border border-[var(--border)] rounded-md focus:outline-none focus:border-blue-500 font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                        Events to Dispatch
                      </label>
                      <div className="flex items-center gap-3">
                        {(['INSERT', 'UPDATE', 'DELETE'] as const).map((evt) => {
                          const checked = formEvents.includes(evt)
                          return (
                            <label key={evt} className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFormEvents([...formEvents, evt])
                                  } else {
                                    setFormEvents(formEvents.filter((item) => item !== evt))
                                  }
                                }}
                                className="rounded text-blue-600 focus:ring-blue-500"
                              />
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  evt === 'INSERT'
                                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                    : evt === 'UPDATE'
                                    ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                                    : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                                }`}
                              >
                                {evt}
                              </span>
                            </label>
                          )
                        })}

                        <label className="flex items-center gap-1.5 text-xs cursor-pointer ml-auto">
                          <input
                            type="checkbox"
                            checked={formEnabled}
                            onChange={(e) => setFormEnabled(e.target.checked)}
                            className="rounded text-blue-600"
                          />
                          <span className="text-[11px] font-medium text-[var(--fg)]">Enabled</span>
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                        Custom Headers (one per line: Key: Value)
                      </label>
                      <textarea
                        rows={2}
                        value={formHeadersText}
                        onChange={(e) => setFormHeadersText(e.target.value)}
                        placeholder="Authorization: Bearer my-api-token&#10;X-Service-Name: DBLens"
                        className="w-full px-2.5 py-1.5 text-xs bg-[var(--surface)] border border-[var(--border)] rounded-md focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => { setIsFormOpen(false); resetForm(); }}
                        className="px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] rounded-md transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={formSubmitting}
                        className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors"
                      >
                        {formSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {editingWebhookId ? 'Update Webhook' : 'Save Webhook'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Webhooks List */}
              {loadingWebhooks && webhooks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[var(--muted)]">
                  <Loader2 className="w-6 h-6 animate-spin mb-2" />
                  <span className="text-xs">Loading registered webhooks...</span>
                </div>
              ) : webhooks.length === 0 && !isFormOpen ? (
                <div className="flex flex-col items-center justify-center py-16 border border-dashed border-[var(--border)] rounded-xl text-center">
                  <Webhook className="w-10 h-10 text-[var(--muted)] mb-3 opacity-50" />
                  <h4 className="text-xs font-medium text-[var(--fg)] mb-1">No Webhooks Registered</h4>
                  <p className="text-[11px] text-[var(--muted)] max-w-sm mb-4">
                    Set up your first webhook endpoint to receive real-time database change events (INSERT, UPDATE, DELETE).
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenAdd}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Register Webhook
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {webhooks.map((wh) => (
                    <div
                      key={wh.id}
                      className={`p-4 rounded-xl border transition-all ${
                        wh.enabled
                          ? 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--border-hover,var(--border))]'
                          : 'bg-[var(--surface)]/50 border-[var(--border)] opacity-70'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              wh.enabled ? 'bg-emerald-500 ring-2 ring-emerald-500/20' : 'bg-zinc-400'
                            }`}
                          />
                          <h4 className="text-xs font-semibold text-[var(--fg)]">{wh.name}</h4>
                          <span className="text-[10px] text-[var(--muted)] font-mono">({wh.id})</span>
                          {(wh.secret || wh.has_secret) && (
                            <span className="flex items-center gap-1 text-[10px] text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 rounded font-mono">
                              <ShieldCheck className="w-3 h-3" />
                              HMAC-SHA256
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleTestPing(wh)}
                            disabled={pingingId === wh.id}
                            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-blue-500 hover:bg-blue-500/10 rounded transition-colors"
                            title="Send quick ping synthetic event"
                          >
                            {pingingId === wh.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Send className="w-3 h-3" />
                            )}
                            Test Ping
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleWebhook(wh)}
                            className={`px-2 py-0.5 text-[10px] font-medium rounded border transition-colors ${
                              wh.enabled
                                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20'
                                : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/20'
                            }`}
                          >
                            {wh.enabled ? 'Active' : 'Disabled'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEdit(wh)}
                            className="p-1 text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] rounded transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteWebhook(wh.id, wh.name)}
                            className="p-1 text-[var(--muted)] hover:text-red-400 hover:bg-[var(--hover)] rounded transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* URL */}
                      <div className="flex items-center gap-2 mb-3">
                        <code className="text-[11px] text-[var(--fg)] font-mono bg-[var(--bg)] px-2 py-1 rounded border border-[var(--border)] truncate max-w-xl">
                          {wh.url}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(wh.url, `url_${wh.id}`)}
                          className="p-1 text-[var(--muted)] hover:text-[var(--fg)]"
                          title="Copy URL"
                        >
                          {copiedKey === `url_${wh.id}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>

                      {/* Events & Tables tags */}
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="text-[var(--muted)]">Events:</span>
                        {(wh.events || []).map((e) => (
                          <span
                            key={e}
                            className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                              e === 'INSERT'
                                ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                : e === 'UPDATE'
                                ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                                : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                            }`}
                          >
                            {e}
                          </span>
                        ))}

                        <span className="text-[var(--muted)] ml-2">Tables:</span>
                        {(wh.tables || []).map((t) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[var(--hover)] text-[var(--fg)] border border-[var(--border)]"
                          >
                            {t}
                          </span>
                        ))}

                        {wh.created_at && (
                          <span className="text-[10px] text-[var(--muted)] ml-auto">
                            Created: {new Date(wh.created_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: DELIVERIES LOG */}
          {activeTab === 'deliveries' && (
            <div className="space-y-4">
              {deliveriesError && (
                <div className="flex items-center gap-2 p-3 text-xs rounded-lg bg-red-500/10 text-red-500 border border-red-500/20">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{deliveriesError}</span>
                </div>
              )}

              {/* Filters bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[var(--muted)]">Event:</span>
                  <select
                    value={deliveryFilterEvent}
                    onChange={(e) => setDeliveryFilterEvent(e.target.value)}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-xs focus:outline-none"
                  >
                    <option value="ALL">All Events</option>
                    <option value="INSERT">INSERT</option>
                    <option value="UPDATE">UPDATE</option>
                    <option value="DELETE">DELETE</option>
                  </select>

                  <span className="text-[11px] text-[var(--muted)] ml-2">Status:</span>
                  <select
                    value={deliveryFilterStatus}
                    onChange={(e) => setDeliveryFilterStatus(e.target.value)}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-xs focus:outline-none"
                  >
                    <option value="ALL">All Status</option>
                    <option value="SUCCESS">Success (2xx)</option>
                    <option value="FAILED">Failed / Error</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={deliverySearch}
                    onChange={(e) => setDeliverySearch(e.target.value)}
                    placeholder="Search url, payload, webhook..."
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-2.5 py-1 text-xs focus:outline-none w-56 font-mono"
                  />
                  {deliverySearch && (
                    <button
                      type="button"
                      onClick={() => setDeliverySearch('')}
                      className="text-[var(--muted)] hover:text-[var(--fg)]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Deliveries list */}
              {loadingDeliveries && deliveries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[var(--muted)]">
                  <Loader2 className="w-6 h-6 animate-spin mb-2" />
                  <span className="text-xs">Loading delivery logs...</span>
                </div>
              ) : filteredDeliveries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 border border-dashed border-[var(--border)] rounded-xl text-center">
                  <Clock className="w-10 h-10 text-[var(--muted)] mb-3 opacity-50" />
                  <h4 className="text-xs font-medium text-[var(--fg)] mb-1">No Delivery Logs Found</h4>
                  <p className="text-[11px] text-[var(--muted)] max-w-sm mb-4">
                    {deliveries.length > 0
                      ? 'No delivery matches current filters.'
                      : 'Change events and simulator dispatches will appear here in real-time.'}
                  </p>
                  {deliveries.length === 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('simulator')}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Try Event Simulator
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredDeliveries.map((del) => {
                    const isExpanded = expandedDeliveryId === del.id
                    const isSuccess = del.response_status_code >= 200 && del.response_status_code < 300
                    return (
                      <div
                        key={del.id}
                        className="border border-[var(--border)] rounded-lg bg-[var(--surface)] overflow-hidden transition-colors"
                      >
                        <div
                          className="flex items-center justify-between p-3 cursor-pointer hover:bg-[var(--hover)] transition-colors select-none"
                          onClick={() => setExpandedDeliveryId(isExpanded ? null : del.id)}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-[var(--muted)]">
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </span>

                            {/* Status badge */}
                            <span
                              className={`px-2 py-0.5 text-[10px] font-semibold rounded font-mono ${
                                isSuccess
                                  ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                  : del.response_status_code > 0
                                  ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                                  : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                              }`}
                            >
                              {del.response_status_code > 0 ? `${del.response_status_code}` : 'ERR'}
                            </span>

                            {/* Event badge */}
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                                del.event === 'INSERT'
                                  ? 'bg-emerald-500/10 text-emerald-500'
                                  : del.event === 'UPDATE'
                                  ? 'bg-blue-500/10 text-blue-500'
                                  : 'bg-rose-500/10 text-rose-500'
                              }`}
                            >
                              {del.event}
                            </span>

                            {/* URL and Name */}
                            <div className="truncate flex items-center gap-1.5">
                              {del.webhook_name && (
                                <span className="text-xs font-medium text-[var(--fg)] truncate">
                                  {del.webhook_name}
                                </span>
                              )}
                              <span className="text-xs text-[var(--muted)] font-mono truncate max-w-sm">
                                {del.url}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 ml-2">
                            {del.latency_ms > 0 && (
                              <span className="text-[11px] text-[var(--muted)] font-mono">
                                {del.latency_ms}ms
                              </span>
                            )}
                            <span className="text-[11px] text-[var(--muted)]">
                              {new Date(del.timestamp).toLocaleTimeString()}
                            </span>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRetryDelivery(del.id)
                              }}
                              disabled={retryingId === del.id}
                              className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-blue-500 hover:bg-blue-500/10 rounded transition-colors"
                              title="Re-send delivery"
                            >
                              <RotateCw className={`w-3 h-3 ${retryingId === del.id ? 'animate-spin' : ''}`} />
                              Retry
                            </button>
                          </div>
                        </div>

                        {/* Expandable inspector */}
                        {isExpanded && (
                          <div className="p-4 border-t border-[var(--border)] bg-[var(--bg)] space-y-3 animate-in fade-in duration-100">
                            {del.error && (
                              <div className="p-2.5 text-xs rounded bg-red-500/10 text-red-500 border border-red-500/20 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                <div>
                                  <span className="font-semibold">Dispatch Error:</span> {del.error}
                                </div>
                              </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {/* Request Payload */}
                              <div>
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                                    Request Payload (JSON)
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => copyToClipboard(del.request_payload, `req_${del.id}`)}
                                    className="text-[10px] text-blue-500 hover:underline flex items-center gap-1"
                                  >
                                    {copiedKey === `req_${del.id}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                    Copy
                                  </button>
                                </div>
                                <pre className="p-3 text-[11px] font-mono bg-[var(--surface)] border border-[var(--border)] rounded-md overflow-x-auto max-h-56 leading-relaxed">
                                  {(() => {
                                    try {
                                      return JSON.stringify(JSON.parse(del.request_payload), null, 2)
                                    } catch {
                                      return del.request_payload
                                    }
                                  })()}
                                </pre>
                              </div>

                              {/* Response Body */}
                              <div>
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                                    Response Body ({del.response_status_code || 0})
                                  </span>
                                  {del.response_body && (
                                    <button
                                      type="button"
                                      onClick={() => copyToClipboard(del.response_body, `resp_${del.id}`)}
                                      className="text-[10px] text-blue-500 hover:underline flex items-center gap-1"
                                    >
                                      {copiedKey === `resp_${del.id}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                      Copy
                                    </button>
                                  )}
                                </div>
                                <pre className="p-3 text-[11px] font-mono bg-[var(--surface)] border border-[var(--border)] rounded-md overflow-x-auto max-h-56 leading-relaxed">
                                  {del.response_body ? (
                                    (() => {
                                      try {
                                        return JSON.stringify(JSON.parse(del.response_body), null, 2)
                                      } catch {
                                        return del.response_body
                                      }
                                    })()
                                  ) : (
                                    <span className="text-[var(--muted)] italic">No response body received</span>
                                  )}
                                </pre>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: EVENT SIMULATOR */}
          {activeTab === 'simulator' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs">
                <div>
                  <h4 className="font-semibold text-[var(--fg)] flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5 text-blue-500" />
                    Change Event Simulator Playground
                  </h4>
                  <p className="text-[11px] text-[var(--muted)]">
                    Trigger synthetic CDC events without touching or modifying database records.
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-[var(--muted)] mr-1">Presets:</span>
                  <button
                    type="button"
                    onClick={() => loadPreset('user')}
                    className="px-2 py-1 text-[10px] rounded bg-[var(--hover)] hover:bg-[var(--active)] font-mono"
                  >
                    User INSERT
                  </button>
                  <button
                    type="button"
                    onClick={() => loadPreset('order')}
                    className="px-2 py-1 text-[10px] rounded bg-[var(--hover)] hover:bg-[var(--active)] font-mono"
                  >
                    Order UPDATE
                  </button>
                  <button
                    type="button"
                    onClick={() => loadPreset('delete')}
                    className="px-2 py-1 text-[10px] rounded bg-[var(--hover)] hover:bg-[var(--active)] font-mono"
                  >
                    Session DELETE
                  </button>
                </div>
              </div>

              {simError && (
                <div className="flex items-center gap-2 p-3 text-xs rounded-lg bg-red-500/10 text-red-500 border border-red-500/20">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{simError}</span>
                </div>
              )}

              {/* Simulation Result Card */}
              {simResult && (
                <div
                  className={`p-4 rounded-xl border transition-all ${
                    simResult.success
                      ? 'bg-emerald-500/5 border-emerald-500/30'
                      : 'bg-rose-500/5 border-rose-500/30'
                  } space-y-2.5 animate-in fade-in duration-150`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {simResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-rose-500" />
                      )}
                      <span className="text-xs font-semibold text-[var(--fg)]">
                        {simResult.success ? 'Dispatch Succeeded' : 'Dispatch Failed / Unreachable'}
                      </span>
                      <span
                        className={`px-2 py-0.2 rounded text-[10px] font-mono font-semibold ${
                          simResult.delivery.response_status_code >= 200 &&
                          simResult.delivery.response_status_code < 300
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : 'bg-rose-500/10 text-rose-500'
                        }`}
                      >
                        Status {simResult.delivery.response_status_code || '0 (ERR)'}
                      </span>
                      <span className="text-[10px] text-[var(--muted)] font-mono">
                        {simResult.delivery.latency_ms}ms
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('deliveries')
                        setExpandedDeliveryId(simResult.delivery.id)
                      }}
                      className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                    >
                      Inspect in Deliveries Log
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>

                  {simResult.delivery.error && (
                    <div className="text-xs text-rose-500 font-mono bg-rose-500/10 p-2 rounded border border-rose-500/20">
                      {simResult.delivery.error}
                    </div>
                  )}

                  {simResult.delivery.response_body && (
                    <div>
                      <span className="text-[10px] text-[var(--muted)] block mb-1">Response Body:</span>
                      <pre className="text-[11px] font-mono bg-[var(--surface)] p-2.5 rounded border border-[var(--border)] max-h-32 overflow-x-auto">
                        {simResult.delivery.response_body}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Target Selector */}
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] space-y-3">
                <h4 className="text-xs font-semibold text-[var(--fg)]">1. Target Endpoint</h4>

                <div className="flex items-center gap-4 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="simTargetMode"
                      checked={simTargetMode === 'webhook'}
                      onChange={() => setSimTargetMode('webhook')}
                      className="text-blue-600"
                    />
                    <span>Registered Webhook</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="simTargetMode"
                      checked={simTargetMode === 'custom'}
                      onChange={() => setSimTargetMode('custom')}
                      className="text-blue-600"
                    />
                    <span>Custom Test URL</span>
                  </label>
                </div>

                {simTargetMode === 'webhook' ? (
                  <div>
                    {webhooks.length === 0 ? (
                      <div className="text-xs text-[var(--muted)] italic">
                        No webhooks registered yet. Switch to "Custom Test URL" or add a webhook first.
                      </div>
                    ) : (
                      <select
                        value={simSelectedWebhookId}
                        onChange={(e) => setSimSelectedWebhookId(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-md focus:outline-none focus:border-blue-500"
                      >
                        {webhooks.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} — {w.url}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                        Endpoint URL <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="url"
                        value={simCustomUrl}
                        onChange={(e) => setSimCustomUrl(e.target.value)}
                        placeholder="https://webhook.site/..."
                        className="w-full px-2.5 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-md focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                        HMAC Secret Key (optional)
                      </label>
                      <input
                        type="password"
                        value={simCustomSecret}
                        onChange={(e) => setSimCustomSecret(e.target.value)}
                        placeholder="Secret for signature"
                        className="w-full px-2.5 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-md focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Event & Target Table */}
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] space-y-3">
                <h4 className="text-xs font-semibold text-[var(--fg)]">2. Change Event Parameters</h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                      Event Type
                    </label>
                    <div className="flex items-center gap-1">
                      {(['INSERT', 'UPDATE', 'DELETE'] as const).map((evt) => (
                        <button
                          key={evt}
                          type="button"
                          onClick={() => setSimEvent(evt)}
                          className={`flex-1 py-1 text-xs font-semibold rounded border transition-colors ${
                            simEvent === evt
                              ? evt === 'INSERT'
                                ? 'bg-emerald-500 text-white border-emerald-500'
                                : evt === 'UPDATE'
                                ? 'bg-blue-500 text-white border-blue-500'
                                : 'bg-rose-500 text-white border-rose-500'
                              : 'bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--fg)]'
                          }`}
                        >
                          {evt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                      Schema Name
                    </label>
                    <input
                      type="text"
                      value={simSchema}
                      onChange={(e) => setSimSchema(e.target.value)}
                      placeholder="public"
                      className="w-full px-2.5 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-md focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                      Table Name
                    </label>
                    <input
                      type="text"
                      value={simTable}
                      onChange={(e) => setSimTable(e.target.value)}
                      placeholder="users"
                      list="tables-datalist"
                      className="w-full px-2.5 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-md focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <datalist id="tables-datalist">
                      {availableTables.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              {/* Record Editors */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Old Record (UPDATE/DELETE) */}
                <div className={`p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] space-y-2 ${simEvent === 'INSERT' ? 'opacity-40' : ''}`}>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-[var(--fg)]">
                      Old Record (before change)
                    </label>
                    <span className="text-[10px] text-[var(--muted)]">
                      {simEvent === 'INSERT' ? 'Disabled for INSERT' : 'JSON Object'}
                    </span>
                  </div>
                  <textarea
                    rows={6}
                    value={simOldRecord}
                    onChange={(e) => setSimOldRecord(e.target.value)}
                    disabled={simEvent === 'INSERT'}
                    className="w-full p-2.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-md focus:outline-none focus:border-blue-500 font-mono leading-relaxed"
                  />
                </div>

                {/* New Record (INSERT/UPDATE) */}
                <div className={`p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] space-y-2 ${simEvent === 'DELETE' ? 'opacity-40' : ''}`}>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-[var(--fg)]">
                      New Record (after change)
                    </label>
                    <span className="text-[10px] text-[var(--muted)]">
                      {simEvent === 'DELETE' ? 'Disabled for DELETE' : 'JSON Object'}
                    </span>
                  </div>
                  <textarea
                    rows={6}
                    value={simNewRecord}
                    onChange={(e) => setSimNewRecord(e.target.value)}
                    disabled={simEvent === 'DELETE'}
                    className="w-full p-2.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-md focus:outline-none focus:border-blue-500 font-mono leading-relaxed"
                  />
                </div>
              </div>

              {/* Dispatch Action */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleExecuteSimulate}
                  disabled={simulating}
                  className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md shadow-sm transition-colors cursor-pointer"
                >
                  {simulating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Dispatching Event...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Dispatch Synthetic Event
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)] bg-[var(--surface)] shrink-0 text-xs">
          <div className="text-[11px] text-[var(--muted)]">
            {activeTab === 'webhooks'
              ? `${webhooks.length} webhook(s) configured`
              : activeTab === 'deliveries'
              ? `${deliveries.length} delivery records retained (max 100)`
              : 'Synthetic events bypass database transactions safely'}
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="px-3.5 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
