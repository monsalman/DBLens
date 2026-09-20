export type LLMProvider = 'openai' | 'anthropic'

export interface AIAssistantConfig {
  provider: LLMProvider
  endpoint: string
  apiKey: string
  model: string
  temperature: number
}

export const AI_CONFIG_KEY = 'dblens_ai_config'

export const AI_PRESETS: Record<
  string,
  { name: string; provider: LLMProvider; endpoint: string; model: string; defaultKeyPlaceholder: string }
> = {
  openai: {
    name: 'OpenAI',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    defaultKeyPlaceholder: 'sk-...',
  },
  ollama: {
    name: 'Ollama (Local)',
    provider: 'openai',
    endpoint: 'http://localhost:11434/v1',
    model: 'llama3',
    defaultKeyPlaceholder: 'None required for local',
  },
  groq: {
    name: 'Groq',
    provider: 'openai',
    endpoint: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    defaultKeyPlaceholder: 'gsk_...',
  },
  openrouter: {
    name: 'OpenRouter',
    provider: 'openai',
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct',
    defaultKeyPlaceholder: 'sk-or-...',
  },
  anthropic: {
    name: 'Anthropic Claude',
    provider: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-20241022',
    defaultKeyPlaceholder: 'sk-ant-...',
  },
}

export const DEFAULT_AI_CONFIG: AIAssistantConfig = {
  provider: 'openai',
  endpoint: '',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.1,
}

export function loadAIConfig(): AIAssistantConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_AI_CONFIG }
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    if (!raw) return { ...DEFAULT_AI_CONFIG }
    const parsed = JSON.parse(raw)
    return {
      provider: parsed.provider === 'anthropic' ? 'anthropic' : 'openai',
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : 'gpt-4o-mini',
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : 0.1,
    }
  } catch {
    return { ...DEFAULT_AI_CONFIG }
  }
}

export function saveAIConfig(config: AIAssistantConfig): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config))
  } catch {
    // ignore quota/storage errors
  }
}

export function isLocalEndpoint(endpoint: string): boolean {
  const ep = endpoint.toLowerCase()
  return ep.includes('localhost') || ep.includes('127.0.0.1') || ep.includes('0.0.0.0') || ep.includes(':11434')
}

export function hasUsableConfig(config: AIAssistantConfig): boolean {
  if (isLocalEndpoint(config.endpoint)) {
    return true
  }
  return Boolean(config.apiKey && config.apiKey.trim().length > 0)
}
