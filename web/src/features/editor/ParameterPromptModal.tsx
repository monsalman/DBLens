import React, { useState } from 'react'
import { X, Play, Save, Braces, Hash, Type, ToggleLeft } from 'lucide-react'
import type { QueryVariable } from './sqlVariableParser'

export interface ParameterPromptModalProps {
  isOpen: boolean
  onClose: () => void
  variables: QueryVariable[]
  initialValues?: Record<string, any>
  onRun: (values: Record<string, any>) => void
  onSave: (values: Record<string, any>) => void
}

type ParamType = 'string' | 'number' | 'boolean'

function computeInitialState(variables: QueryVariable[], initialValues: Record<string, any>) {
  const nextValues: Record<string, any> = {}
  const nextTypes: Record<string, ParamType> = {}

  for (const v of variables) {
    const raw = initialValues[v.name]
    if (raw !== undefined && raw !== null) {
      if (typeof raw === 'number') {
        nextTypes[v.name] = 'number'
        nextValues[v.name] = String(raw)
      } else if (typeof raw === 'boolean') {
        nextTypes[v.name] = 'boolean'
        nextValues[v.name] = raw
      } else {
        if (typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
          nextTypes[v.name] = 'number'
          nextValues[v.name] = raw
        } else {
          nextTypes[v.name] = 'string'
          nextValues[v.name] = String(raw)
        }
      }
    } else {
      nextTypes[v.name] = 'string'
      nextValues[v.name] = ''
    }
  }

  return { nextValues, nextTypes }
}

export const ParameterPromptModal: React.FC<ParameterPromptModalProps> = ({
  isOpen,
  onClose,
  variables,
  initialValues = {},
  onRun,
  onSave,
}) => {
  const [state, setState] = useState(() => computeInitialState(variables, initialValues))
  const values = state.nextValues
  const types = state.nextTypes

  if (!isOpen) return null

  const setType = (name: string, type: ParamType) => {
    setState((prev) => ({
      ...prev,
      nextTypes: { ...prev.nextTypes, [name]: type },
    }))
  }

  const setValue = (name: string, val: any) => {
    setState((prev) => ({
      ...prev,
      nextValues: { ...prev.nextValues, [name]: val },
    }))
  }

  const getTypedValues = (): Record<string, any> => {
    const result: Record<string, any> = {}
    for (const v of variables) {
      const t = types[v.name] || 'string'
      const val = values[v.name]

      if (t === 'number') {
        const parsed = Number(val)
        result[v.name] = isNaN(parsed) || val === '' ? 0 : parsed
      } else if (t === 'boolean') {
        result[v.name] = val === true || val === 'true'
      } else {
        result[v.name] = val !== undefined ? String(val) : ''
      }
    }
    return result
  }

  const handleRun = () => {
    const typed = getTypedValues()
    onRun(typed)
    onClose()
  }

  const handleSave = () => {
    const typed = getTypedValues()
    onSave(typed)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleRun()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-slate-900 border border-slate-750 rounded-xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <Braces className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide flex items-center gap-2">
                Query Parameters
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-sky-300 font-medium border border-slate-700">
                  {variables.length} {variables.length === 1 ? 'variable' : 'variables'}
                </span>
              </h2>
              <p className="text-xs text-slate-400">Provide runtime values for bound parameters</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Variable list */}
        <div className="p-5 max-h-[60vh] overflow-y-auto space-y-3.5 divide-y divide-slate-800/60">
          {variables.map((v) => {
            const currentType = types[v.name] || 'string'
            const currentVal = values[v.name]

            return (
              <div key={v.name} className="pt-3 first:pt-0">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-sky-950/60 text-sky-300 border border-sky-800/50">
                      {v.syntax}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">({v.name})</span>
                  </div>

                  {/* Type selector */}
                  <div className="inline-flex rounded-md bg-slate-800/80 p-0.5 border border-slate-750 text-xs">
                    <button
                      type="button"
                      onClick={() => setType(v.name, 'string')}
                      className={`px-2 py-0.5 rounded flex items-center gap-1 font-medium transition-colors ${
                        currentType === 'string'
                          ? 'bg-sky-600 text-white shadow-xs'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Type className="w-3 h-3" />
                      str
                    </button>
                    <button
                      type="button"
                      onClick={() => setType(v.name, 'number')}
                      className={`px-2 py-0.5 rounded flex items-center gap-1 font-medium transition-colors ${
                        currentType === 'number'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Hash className="w-3 h-3" />
                      num
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setType(v.name, 'boolean')
                        setValue(v.name, currentVal === true || currentVal === 'true')
                      }}
                      className={`px-2 py-0.5 rounded flex items-center gap-1 font-medium transition-colors ${
                        currentType === 'boolean'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <ToggleLeft className="w-3 h-3" />
                      bool
                    </button>
                  </div>
                </div>

                {/* Input control */}
                {currentType === 'boolean' ? (
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      type="button"
                      onClick={() => setValue(v.name, true)}
                      className={`px-3 py-1 text-xs rounded-md border font-mono transition-colors ${
                        currentVal === true
                          ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500'
                          : 'bg-slate-800 text-slate-400 border-slate-750 hover:bg-slate-750'
                      }`}
                    >
                      TRUE
                    </button>
                    <button
                      type="button"
                      onClick={() => setValue(v.name, false)}
                      className={`px-3 py-1 text-xs rounded-md border font-mono transition-colors ${
                        currentVal === false
                          ? 'bg-rose-600/30 text-rose-300 border-rose-500'
                          : 'bg-slate-800 text-slate-400 border-slate-750 hover:bg-slate-750'
                      }`}
                    >
                      FALSE
                    </button>
                  </div>
                ) : (
                  <input
                    type={currentType === 'number' ? 'number' : 'text'}
                    value={currentVal ?? ''}
                    onChange={(e) => setValue(v.name, e.target.value)}
                    placeholder={`Enter ${currentType} value for ${v.name}...`}
                    className="w-full mt-1 bg-slate-950 border border-slate-700/80 rounded-md px-3 py-1.5 text-xs font-mono text-white placeholder-slate-500 focus:outline-hidden focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all"
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="text-[11px] text-slate-500">
            Press <kbd className="px-1 py-0.5 bg-slate-800 rounded border border-slate-750 text-slate-400 font-mono text-[10px]">Ctrl+Enter</kbd> to run
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="px-3 py-1.5 rounded-lg border border-slate-750 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-750 text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              Save & Close
            </button>
            <button
              type="button"
              onClick={handleRun}
              className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm shadow-sky-900/30 transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Run Query
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
