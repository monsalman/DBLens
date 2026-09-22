import type { WebhookDelivery, SimulateWebhookRequest } from '../../lib/api'

export function parseHeadersString(headersText: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!headersText || !headersText.trim()) return result

  const lines = headersText.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim()
      const val = trimmed.slice(colonIdx + 1).trim()
      if (key) result[key] = val
    }
  }
  return result
}

export function formatHeadersString(headers?: Record<string, string>): string {
  if (!headers || Object.keys(headers).length === 0) return ''
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

export function buildSimulateRequest(params: {
  webhookId?: string
  url?: string
  secret?: string
  event: string
  schema?: string
  table: string
  oldRecordJson?: string
  newRecordJson?: string
}): SimulateWebhookRequest {
  let oldRecord: Record<string, any> | undefined
  let newRecord: Record<string, any> | undefined

  if (params.event === 'UPDATE' || params.event === 'DELETE') {
    if (params.oldRecordJson && params.oldRecordJson.trim()) {
      oldRecord = JSON.parse(params.oldRecordJson)
    }
  }

  if (params.event === 'INSERT' || params.event === 'UPDATE') {
    if (params.newRecordJson && params.newRecordJson.trim()) {
      newRecord = JSON.parse(params.newRecordJson)
    }
  }

  return {
    webhook_id: params.webhookId || undefined,
    url: params.url || undefined,
    secret: params.secret || undefined,
    event: params.event,
    schema: params.schema || 'public',
    table: params.table || 'users',
    old_record: oldRecord,
    new_record: newRecord,
  }
}

export function filterDeliveries(
  deliveries: WebhookDelivery[],
  filter: {
    event?: string
    status?: string
    search?: string
  }
): WebhookDelivery[] {
  return deliveries.filter((d) => {
    if (filter.event && filter.event !== 'ALL' && d.event !== filter.event) {
      return false
    }

    if (filter.status === 'SUCCESS') {
      if (d.response_status_code < 200 || d.response_status_code >= 300) return false
    } else if (filter.status === 'FAILED') {
      if (d.response_status_code >= 200 && d.response_status_code < 300 && !d.error) return false
    }

    if (filter.search && filter.search.trim()) {
      const q = filter.search.toLowerCase()
      const matchUrl = d.url?.toLowerCase().includes(q)
      const matchPayload = d.request_payload?.toLowerCase().includes(q)
      const matchName = d.webhook_name?.toLowerCase().includes(q)
      if (!matchUrl && !matchPayload && !matchName) return false
    }

    return true
  })
}
