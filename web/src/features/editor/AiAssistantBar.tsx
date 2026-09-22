import React, { useState, useEffect, useRef } from 'react'
import {
  Sparkles,
  Settings,
  X,
  Loader2,
  Copy,
  Check,
  Send,
  Wand2,
  HelpCircle,
  Eye,
  EyeOff,
  CornerDownLeft,
  FileText,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { api } from '../../lib/api'
import type { ConnectionConfig } from '../../lib/api'
import {
  loadAIConfig,
  saveAIConfig,
  AI_PRESETS,
  DEFAULT_AI_CONFIG,
  type AIAssistantConfig,
  type LLMProvider,
  hasUsableConfig,
} from './aiAssistant'

async function safeCopyText(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to fallback
  }

  try {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    textArea.style.top = '0'
    textArea.setAttribute('readonly', '')
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    const successful = document.execCommand('copy')
    document.body.removeChild(textArea)
    if (successful) return true
  } catch {
    // Fall through to prompt
  }

  try {
    window.prompt('Copy to clipboard: Ctrl+C / Cmd+C, Enter', text)
    return true
  } catch {
    return false
  }
}

export interface AiAssistantBarProps {
  connId: string
  currentQuery: string
  activeSchema?: string
  profiles?: ConnectionConfig[]
  isOpen: boolean
  onToggle: () => void
  onApplySql: (sql: string, mode?: 'replace' | 'insert') => void
  fixContext?: {
    query: string
    error: string
  } | null
  onClearFixContext?: () => void
  explainRequested?: boolean
  onClearExplainRequested?: () => void
}

export const AiAssistantBar: React.FC<AiAssistantBarProps> = ({
  connId,
  currentQuery,
  activeSchema,
  profiles,
  isOpen,
  onToggle,
  onApplySql,
  fixContext,
  onClearFixContext,
  explainRequested,
  onClearExplainRequested,
}) => {
  const [config, setConfig] = useState<AIAssistantConfig>(loadAIConfig)
  const [prompt, setPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [generatedSql, setGeneratedSql] = useState<string | null>(null)
  const [explanation, setExplanation] = useState<string | null>(null)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [copiedSql, setCopiedSql] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)

  // Global Cmd+I / Ctrl+I shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        onToggle()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onToggle])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [isOpen])

  // Handle fixContext trigger
  useEffect(() => {
    if (fixContext && isOpen) {
      setGeneratedSql(null)
      setExplanation(null)
      setError(null)
    }
  }, [fixContext, isOpen])

  const handleExplain = async () => {
    const queryToExplain = fixContext?.query || currentQuery
    if (!queryToExplain.trim()) {
      setError('No query to explain')
      return
    }

    setIsLoading(true)
    setLoadingStatus('Explaining SQL query...')
    setError(null)
    setExplanation(null)
    setGeneratedSql(null)

    try {
      const res = await api.explainSqlWithAI(
        connId,
        {
          query: queryToExplain.trim(),
          schema: activeSchema,
          config,
        },
        profiles
      )
      setExplanation(res.explanation)
    } catch (err: any) {
      setError(err?.message || 'Failed to explain SQL')
    } finally {
      setIsLoading(false)
      setLoadingStatus('')
    }
  }

  // Handle explainRequested trigger
  useEffect(() => {
    if (explainRequested && isOpen && currentQuery.trim()) {
      handleExplain()
      onClearExplainRequested?.()
    }
  }, [explainRequested, isOpen, currentQuery])

  const handleApplyPreset = (presetKey: string) => {
    const preset = AI_PRESETS[presetKey]
    if (!preset) return
    const updated: AIAssistantConfig = {
      ...config,
      provider: preset.provider,
      endpoint: preset.endpoint,
      model: preset.model,
    }
    setConfig(updated)
    saveAIConfig(updated)
  }

  const handleSaveConfig = () => {
    saveAIConfig(config)
    setIsSettingsOpen(false)
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) return
    setIsLoading(true)
    setLoadingStatus('Generating SQL from schema...')
    setError(null)
    setGeneratedSql(null)
    setExplanation(null)

    try {
      const res = await api.generateSqlWithAI(
        connId,
        {
          prompt: prompt.trim(),
          schema: activeSchema,
          config,
        },
        profiles
      )
      setGeneratedSql(res.sql)
    } catch (err: any) {
      setError(err?.message || 'Failed to generate SQL')
    } finally {
      setIsLoading(false)
      setLoadingStatus('')
    }
  }

  const handleFix = async () => {
    if (!fixContext) return
    setIsLoading(true)
    setLoadingStatus('Analyzing error and fixing query...')
    setError(null)
    setGeneratedSql(null)

    try {
      const res = await api.fixSqlWithAI(
        connId,
        {
          query: fixContext.query,
          error: fixContext.error,
          schema: activeSchema,
          config,
        },
        profiles
      )
      setGeneratedSql(res.sql)
    } catch (err: any) {
      setError(err?.message || 'Failed to fix SQL')
    } finally {
      setIsLoading(false)
      setLoadingStatus('')
    }
  }

  const handleCopyOfflinePrompt = async () => {
    setIsLoading(true)
    setLoadingStatus('Assembling offline schema prompt...')
    try {
      let op: 'generate' | 'fix' | 'explain' = 'generate'
      let queryVal = currentQuery
      let errorVal = ''
      let promptVal = prompt

      if (fixContext) {
        op = 'fix'
        queryVal = fixContext.query
        errorVal = fixContext.error
      } else if (explanation !== null || (!prompt && currentQuery.trim())) {
        op = 'explain'
        queryVal = currentQuery
      }

      const offlinePrompt = await api.buildAssistantPrompt(
        connId,
        {
          op,
          prompt: promptVal,
          query: queryVal,
          error: errorVal,
          schema: activeSchema,
        },
        profiles
      )

      await safeCopyText(offlinePrompt)
      setCopiedPrompt(true)
      setTimeout(() => setCopiedPrompt(false), 2500)
    } catch (err: any) {
      setError(err?.message || 'Failed to build offline prompt')
    } finally {
      setIsLoading(false)
      setLoadingStatus('')
    }
  }

  if (!isOpen) return null

  return (
    <div className="relative border-b border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] text-xs z-20 shadow-md">
      {/* Top Banner / Bar */}
      <div className="flex flex-col gap-2 p-2.5">
        {/* Fix Context Header if triggered by query error */}
        {fixContext && (
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300">
            <div className="flex items-center gap-2 overflow-hidden">
              <Wand2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="font-semibold text-[11px] shrink-0">Fix Failing SQL</span>
              <span className="truncate text-[10px] text-amber-200/80 font-mono">
                {fixContext.error.slice(0, 90)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleFix}
                disabled={isLoading}
                className="btn-primary text-[11px] px-2 py-0.5 flex items-center gap-1"
              >
                {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                <span>Fix Query</span>
              </button>
              <button
                onClick={() => onClearFixContext?.()}
                className="p-1 rounded text-amber-400 hover:bg-amber-500/20 transition-colors"
                title="Dismiss Fix"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Main Prompt Input Bar */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 pl-1.5 text-indigo-400 shrink-0 font-medium">
            <Sparkles className="w-4 h-4 animate-pulse text-indigo-400" />
            <span className="hidden sm:inline font-semibold">Ask AI</span>
          </div>

          <div className="relative flex-1 flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleGenerate()
                }
              }}
              placeholder="Ask in natural language (e.g. 'find users who spent over $100 last month')..."
              className="w-full h-8 pl-2.5 pr-8 rounded bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-indigo-500 text-xs placeholder-[var(--muted)]"
              disabled={isLoading}
            />
            {prompt && (
              <button
                onClick={() => setPrompt('')}
                className="absolute right-2 text-[var(--muted)] hover:text-[var(--fg)] p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            onClick={handleGenerate}
            disabled={isLoading || !prompt.trim()}
            className="btn-primary flex items-center gap-1.5 h-8 px-3 text-xs disabled:opacity-40"
            title="Generate SQL (Enter)"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span className="hidden md:inline">Generate</span>
          </button>

          <button
            onClick={handleExplain}
            disabled={isLoading || (!currentQuery.trim() && !fixContext?.query)}
            className="flex items-center gap-1 h-8 px-2.5 rounded bg-[var(--bg)] hover:bg-[var(--hover)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors disabled:opacity-40"
            title="Explain current SQL query"
          >
            <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden lg:inline">Explain Query</span>
          </button>

          <button
            onClick={handleCopyOfflinePrompt}
            disabled={isLoading}
            className="flex items-center gap-1 h-8 px-2.5 rounded bg-[var(--bg)] hover:bg-[var(--hover)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            title="Copy full prompt with compact DB schema for ChatGPT / Claude / DeepSeek"
          >
            {copiedPrompt ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span className="hidden lg:inline">
              {copiedPrompt ? 'Copied!' : 'Copy Offline Prompt'}
            </span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={`p-1.5 rounded border transition-colors ${
              isSettingsOpen
                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                : 'bg-[var(--bg)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
            title="AI Model & Provider Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={onToggle}
            className="p-1.5 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]"
            title="Close Ask AI (Cmd+I)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Loading status bar */}
        {isLoading && (
          <div className="flex items-center gap-2 px-2 py-1 rounded bg-indigo-500/10 text-indigo-300 text-[11px] font-mono animate-pulse">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{loadingStatus || 'Processing with AI...'}</span>
          </div>
        )}

        {/* Error notification */}
        {error && (
          <div className="flex items-start justify-between p-2 rounded bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-200 p-0.5 ml-2"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Generated SQL Preview Card */}
        {generatedSql && (
          <div className="p-3 rounded border border-emerald-500/30 bg-[var(--bg)] flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-emerald-400 font-semibold text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Generated SQL
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={async () => {
                    await safeCopyText(generatedSql)
                    setCopiedSql(true)
                    setTimeout(() => setCopiedSql(false), 2000)
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[var(--surface)] hover:bg-[var(--hover)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
                  title="Copy SQL to clipboard"
                >
                  {copiedSql ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedSql ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  onClick={() => {
                    onApplySql(generatedSql, 'insert')
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[var(--surface)] hover:bg-[var(--hover)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
                  title="Insert at cursor or append"
                >
                  <CornerDownLeft className="w-3 h-3" />
                  <span>Insert</span>
                </button>
                <button
                  onClick={() => {
                    onApplySql(generatedSql, 'replace')
                  }}
                  className="btn-primary text-[11px] px-2.5 py-0.5 flex items-center gap-1"
                  title="Replace current query in active editor"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Replace Editor</span>
                </button>
                <button
                  onClick={() => setGeneratedSql(null)}
                  className="p-1 rounded text-[var(--muted)] hover:text-[var(--fg)]"
                  title="Dismiss preview"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
            <pre className="p-2.5 rounded bg-[var(--surface)] font-mono text-xs text-[var(--fg)] overflow-x-auto whitespace-pre-wrap border border-[var(--border)]">
              {generatedSql}
            </pre>
          </div>
        )}

        {/* Explanation Card */}
        {explanation && (
          <div className="p-3 rounded border border-sky-500/30 bg-[var(--bg)] flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sky-400 font-semibold text-[11px]">
                <HelpCircle className="w-3.5 h-3.5" />
                Query Explanation
              </span>
              <button
                onClick={() => setExplanation(null)}
                className="p-1 rounded text-[var(--muted)] hover:text-[var(--fg)]"
                title="Dismiss explanation"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="p-2.5 rounded bg-[var(--surface)] text-xs text-[var(--fg)] overflow-x-auto whitespace-pre-wrap border border-[var(--border)] leading-relaxed font-sans">
              {explanation}
            </div>
          </div>
        )}

        {/* Settings Popover / Panel */}
        {isSettingsOpen && (
          <div className="p-3 rounded border border-indigo-500/30 bg-[var(--bg)] flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-indigo-400" />
                <span className="font-semibold text-xs">BYOK AI Provider Settings</span>
                {!hasUsableConfig(config) && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-medium">
                    Key or Localhost Required
                  </span>
                )}
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 rounded text-[var(--muted)] hover:text-[var(--fg)]"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Presets Row */}
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--muted)]">Quick Presets:</span>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(AI_PRESETS).map(([k, p]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleApplyPreset(k)}
                    className="px-2 py-1 rounded bg-[var(--surface)] hover:bg-[var(--hover)] border border-[var(--border)] text-[11px] transition-colors"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Form Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-[var(--muted)] mb-1">Provider Type</label>
                <select
                  value={config.provider}
                  onChange={(e) => setConfig({ ...config, provider: e.target.value as LLMProvider })}
                  className="w-full h-8 px-2 rounded bg-[var(--surface)] border border-[var(--border)] text-xs"
                >
                  <option value="openai">OpenAI / Compatible (Ollama, Groq, OpenRouter, LocalAI)</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[var(--muted)] mb-1">
                  Model Name
                </label>
                <input
                  type="text"
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  placeholder="e.g. gpt-4o-mini, llama3, claude-3-5-sonnet"
                  className="w-full h-8 px-2 rounded bg-[var(--surface)] border border-[var(--border)] text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[var(--muted)] mb-1">
                  Endpoint URL (optional override)
                </label>
                <input
                  type="text"
                  value={config.endpoint}
                  onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
                  placeholder="https://api.openai.com/v1 or http://localhost:11434/v1"
                  className="w-full h-8 px-2 rounded bg-[var(--surface)] border border-[var(--border)] text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[var(--muted)] mb-1">
                  API Key (BYOK)
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={config.apiKey}
                    onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                    placeholder="sk-... (optional for local Ollama)"
                    className="w-full h-8 pl-2 pr-8 rounded bg-[var(--surface)] border border-[var(--border)] text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 text-[var(--muted)] hover:text-[var(--fg)] p-1"
                    title={showApiKey ? 'Hide' : 'Show'}
                  >
                    {showApiKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
              <span className="text-[11px] text-[var(--muted)]">
                Keys are stored only in your browser localStorage.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfig(DEFAULT_AI_CONFIG)
                    saveAIConfig(DEFAULT_AI_CONFIG)
                  }}
                  className="px-2.5 py-1 rounded text-[11px] text-[var(--muted)] hover:text-[var(--fg)]"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  className="btn-primary px-3 py-1 text-xs"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
