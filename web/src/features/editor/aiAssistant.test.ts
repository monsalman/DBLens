import {
  DEFAULT_AI_CONFIG,
  AI_PRESETS,
  AI_CONFIG_KEY,
  loadAIConfig,
  saveAIConfig,
  isLocalEndpoint,
  hasUsableConfig,
  type AIAssistantConfig,
} from './aiAssistant.ts'

declare const process: { exit: (code: number) => void }

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

// Mock localStorage if in node environment
const storageMock: Record<string, string> = {}
if (typeof (globalThis as any).localStorage === 'undefined') {
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => storageMock[k] ?? null,
    setItem: (k: string, v: string) => {
      storageMock[k] = v
    },
    removeItem: (k: string) => {
      delete storageMock[k]
    },
    clear: () => {
      for (const k of Object.keys(storageMock)) delete storageMock[k]
    },
  }
}

console.log('--- Running AI Assistant Unit Tests ---')

// 1. Presets validation
test('AI_PRESETS: contains required providers and models', () => {
  assert(Boolean(AI_PRESETS.openai), 'missing openai preset')
  assert(Boolean(AI_PRESETS.ollama), 'missing ollama preset')
  assert(Boolean(AI_PRESETS.anthropic), 'missing anthropic preset')
  assert(Boolean(AI_PRESETS.groq), 'missing groq preset')
  assert(Boolean(AI_PRESETS.openrouter), 'missing openrouter preset')

  assert(AI_PRESETS.ollama.endpoint.includes('11434'), 'ollama endpoint should default to 11434')
  assert(AI_PRESETS.anthropic.provider === 'anthropic', 'anthropic provider should be anthropic')
  assert(AI_PRESETS.openai.provider === 'openai', 'openai provider should be openai')
})

// 2. isLocalEndpoint
test('isLocalEndpoint: correctly identifies local vs remote endpoints', () => {
  assert(isLocalEndpoint('http://localhost:11434/v1'), 'should detect localhost')
  assert(isLocalEndpoint('http://127.0.0.1:11434'), 'should detect 127.0.0.1')
  assert(isLocalEndpoint('http://0.0.0.0:8000/v1'), 'should detect 0.0.0.0')
  assert(!isLocalEndpoint('https://api.openai.com/v1'), 'openai is not local')
  assert(!isLocalEndpoint('https://api.anthropic.com/v1'), 'anthropic is not local')
  assert(!isLocalEndpoint('https://api.groq.com/openai/v1'), 'groq is not local')
})

// 3. hasUsableConfig
test('hasUsableConfig: allows local endpoints without key, requires key for remote', () => {
  const localCfg: AIAssistantConfig = {
    provider: 'openai',
    endpoint: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'llama3',
    temperature: 0.1,
  }
  assert(hasUsableConfig(localCfg), 'local ollama should be usable without API key')

  const remoteNoKey: AIAssistantConfig = {
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.1,
  }
  assert(!hasUsableConfig(remoteNoKey), 'remote openai should require API key')

  const remoteWithKey: AIAssistantConfig = {
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    apiKey: 'sk-test-12345',
    model: 'gpt-4o-mini',
    temperature: 0.1,
  }
  assert(hasUsableConfig(remoteWithKey), 'remote with key should be usable')
})

// 4. loadAIConfig and saveAIConfig
test('loadAIConfig & saveAIConfig: stores and restores config from localStorage', () => {
  localStorage.removeItem(AI_CONFIG_KEY)
  const def = loadAIConfig()
  assert(def.model === DEFAULT_AI_CONFIG.model, 'should return default config when storage empty')

  const custom: AIAssistantConfig = {
    provider: 'anthropic',
    endpoint: 'https://custom.endpoint.com',
    apiKey: 'sk-ant-test',
    model: 'claude-3-5-sonnet',
    temperature: 0.5,
  }
  saveAIConfig(custom)
  const loaded = loadAIConfig()
  assert(loaded.provider === 'anthropic', 'loaded provider should match')
  assert(loaded.endpoint === 'https://custom.endpoint.com', 'loaded endpoint should match')
  assert(loaded.apiKey === 'sk-ant-test', 'loaded apiKey should match')
  assert(loaded.model === 'claude-3-5-sonnet', 'loaded model should match')
  assert(loaded.temperature === 0.5, 'loaded temperature should match')
})

console.log(`\nResult: ${passed} passed, ${failed} failed.`)
if (failed > 0) {
  process.exit(1)
}
