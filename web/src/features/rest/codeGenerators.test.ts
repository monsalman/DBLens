declare const process: { exit: (code: number) => void }

import { generateCurl, generateJavaScript, generatePython, generateGo } from './codeGenerators.ts'

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
  } catch (err: any) {
    failed++
    console.error(`  ✗ ${name}: ${err.message}`)
  }
}

console.log('--- Running codeGenerators Unit Tests ---')

test('generateCurl: generates valid GET command with headers', () => {
  const curl = generateCurl({
    method: 'GET',
    url: 'http://localhost:8080/api/connections/1/rest/users?status=eq.active',
    headers: {
      'Accept': 'application/json',
      'X-DBLENS-DSN': 'postgres://user:pass@localhost:5432/db',
    },
  })
  assert(curl.startsWith('curl'), 'Should start with curl')
  assert(curl.includes('"http://localhost:8080/api/connections/1/rest/users?status=eq.active"'), 'Should contain URL')
  assert(curl.includes('-H "Accept: application/json"'), 'Should contain Accept header')
  assert(curl.includes('-H "X-DBLENS-DSN: postgres://user:pass@localhost:5432/db"'), 'Should contain DSN header')
})

test('generateCurl: generates POST command with method and body payload', () => {
  const curl = generateCurl({
    method: 'POST',
    url: 'http://localhost:8080/api/connections/1/rest/users',
    headers: {
      'Content-Type': 'application/json',
    },
    body: '{"name": "Alice"}',
  })
  assert(curl.includes('-X POST'), 'Should include -X POST')
  assert(curl.includes(`-d '{"name": "Alice"}'`), 'Should include body payload')
})

test('generateJavaScript: generates async fetch function', () => {
  const js = generateJavaScript({
    method: 'POST',
    url: 'http://localhost:8080/api/connections/1/rest/users',
    headers: {
      'Content-Type': 'application/json',
    },
    body: '{"name": "Bob"}',
  })
  assert(js.includes("fetch('http://localhost:8080/api/connections/1/rest/users'"), 'Should call fetch with URL')
  assert(js.includes("method: 'POST'"), 'Should set method to POST')
  assert(js.includes("'Content-Type': 'application/json'"), 'Should set Content-Type header')
  assert(js.includes('body: JSON.stringify('), 'Should stringify body')
})

test('generatePython: generates requests script', () => {
  const py = generatePython({
    method: 'PATCH',
    url: 'http://localhost:8080/api/connections/1/rest/users?id=eq.1',
    headers: {
      'Content-Type': 'application/json',
    },
    body: '{"status": "inactive"}',
  })
  assert(py.includes('import requests'), 'Should import requests')
  assert(py.includes('response = requests.patch('), 'Should call requests.patch')
  assert(py.includes('payload = {'), 'Should define payload')
})

test('generateGo: generates net/http client snippet', () => {
  const goCode = generateGo({
    method: 'DELETE',
    url: 'http://localhost:8080/api/connections/1/rest/users?id=eq.1',
    headers: {
      'X-DBLENS-DSN': 'sqlite://test.db',
    },
  })
  assert(goCode.includes('package main'), 'Should be main package')
  assert(goCode.includes('http.NewRequest("DELETE", url, nil)'), 'Should construct DELETE request with nil body')
  assert(goCode.includes('req.Header.Set("X-DBLENS-DSN", "sqlite://test.db")'), 'Should set header')
})

console.log(`codeGenerators Tests: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
