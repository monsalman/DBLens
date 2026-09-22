declare const process: { exit: (code: number) => void }

import {
  parseHeadersString,
  formatHeadersString,
  buildSimulateRequest,
  filterDeliveries,
} from './webhookHelper.ts'
import type { WebhookDelivery } from '../../lib/api'

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`)
  }
}

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.error(`  ✗ ${name}:`, err)
  }
}

console.log('--- Running Webhook & Event Simulator Helper Unit Tests ---')

// 1. parseHeadersString & formatHeadersString
test('parseHeadersString & formatHeadersString', () => {
  const raw = 'Authorization: Bearer test-token\nContent-Type: application/json\n# Comment\n  InvalidLine\nX-Service: Billing  '
  const parsed = parseHeadersString(raw)
  assert(parsed['Authorization'] === 'Bearer test-token', 'Authorization header mismatch')
  assert(parsed['Content-Type'] === 'application/json', 'Content-Type header mismatch')
  assert(parsed['X-Service'] === 'Billing', 'X-Service header mismatch')
  assert(parsed['InvalidLine'] === undefined, 'InvalidLine should not be parsed')

  const formatted = formatHeadersString(parsed)
  assert(formatted.includes('Authorization: Bearer test-token'), 'Missing formatted auth')
  assert(formatted.includes('X-Service: Billing'), 'Missing formatted service')
})

// 2. buildSimulateRequest
test('buildSimulateRequest event routing', () => {
  const req = buildSimulateRequest({
    webhookId: 'wh_123',
    event: 'UPDATE',
    schema: 'public',
    table: 'products',
    oldRecordJson: '{"id": 1, "price": 10}',
    newRecordJson: '{"id": 1, "price": 15}',
  })

  assert(req.webhook_id === 'wh_123', 'webhook_id mismatch')
  assert(req.event === 'UPDATE', 'event mismatch')
  assert(req.table === 'products', 'table mismatch')
  assert(req.old_record?.price === 10, 'old_record mismatch')
  assert(req.new_record?.price === 15, 'new_record mismatch')

  // Test INSERT ignores old record
  const reqInsert = buildSimulateRequest({
    event: 'INSERT',
    table: 'items',
    oldRecordJson: '{"id": 99}',
    newRecordJson: '{"id": 100, "name": "Test"}',
  })
  assert(reqInsert.old_record === undefined, 'old_record should be undefined for INSERT')
  assert(reqInsert.new_record?.name === 'Test', 'new_record mismatch')
})

// 3. filterDeliveries
test('filterDeliveries by event, status, and query', () => {
  const sampleDeliveries: WebhookDelivery[] = [
    {
      id: 'del_1',
      event: 'INSERT',
      url: 'https://api.example.com/events',
      request_payload: '{"table":"users","name":"Alice"}',
      response_status_code: 200,
      response_body: '{"ok":true}',
      latency_ms: 25,
      timestamp: new Date().toISOString(),
    },
    {
      id: 'del_2',
      event: 'DELETE',
      url: 'https://internal.service/hook',
      request_payload: '{"table":"orders","id":42}',
      response_status_code: 500,
      response_body: 'Internal Server Error',
      error: 'HTTP 500',
      latency_ms: 120,
      timestamp: new Date().toISOString(),
    },
  ]

  // Filter by event
  const insertOnly = filterDeliveries(sampleDeliveries, { event: 'INSERT' })
  assert(insertOnly.length === 1 && insertOnly[0].id === 'del_1', 'insert filter failed')

  // Filter by status SUCCESS
  const successOnly = filterDeliveries(sampleDeliveries, { status: 'SUCCESS' })
  assert(successOnly.length === 1 && successOnly[0].id === 'del_1', 'status success filter failed')

  // Filter by status FAILED
  const failedOnly = filterDeliveries(sampleDeliveries, { status: 'FAILED' })
  assert(failedOnly.length === 1 && failedOnly[0].id === 'del_2', 'status failed filter failed')

  // Filter by search query
  const searched = filterDeliveries(sampleDeliveries, { search: 'orders' })
  assert(searched.length === 1 && searched[0].id === 'del_2', 'search filter failed')
})

console.log(`Webhook Helper Tests: ${passed} passed, ${failed} failed\n`)
if (failed > 0) {
  process.exit(1)
}
