import React, { useState } from 'react'
import {
  Key,
  Link,
  Table as TableIcon,
  Sparkles,
} from 'lucide-react'
import {
  GENERATOR_PRESETS,
  type TableSeedPlan,
  type GeneratorType,
  type GeneratorConfig,
} from './seederHelper'

interface FieldGeneratorConfigProps {
  tables: TableSeedPlan[]
  onUpdateGenerator: (table: string, column: string, cfg: GeneratorConfig) => void
}

export const FieldGeneratorConfig: React.FC<FieldGeneratorConfigProps> = ({
  tables,
  onUpdateGenerator,
}) => {
  const [activeTableIdx, setActiveTableIdx] = useState(0)

  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-zinc-500 text-xs">
        No tables available in seed plan.
      </div>
    )
  }

  const activeTable = tables[activeTableIdx] || tables[0]

  return (
    <div className="space-y-4">
      {/* Table Selector Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-zinc-800">
        {tables.map((t, idx) => (
          <button
            key={t.table}
            type="button"
            onClick={() => setActiveTableIdx(idx)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-xs font-medium border-b-2 transition whitespace-nowrap ${
              idx === activeTableIdx
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>{t.table}</span>
            <span className="text-[10px] text-zinc-500 px-1 rounded bg-zinc-800">
              {t.columns.length}
            </span>
          </button>
        ))}
      </div>

      {/* Columns Generator Configuration Table */}
      <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900/60">
        <div className="overflow-x-auto max-h-[300px]">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950/80 text-zinc-400 text-[11px] uppercase tracking-wider sticky top-0 border-b border-zinc-800 z-10">
              <tr>
                <th className="px-3 py-2 font-medium">Column</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Generator Strategy</th>
                <th className="px-3 py-2 font-medium">Parameters</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
              {activeTable.columns.map((c) => {
                const isFK = c.isForeignKey || c.generator === 'fk'
                return (
                  <tr key={c.name} className="hover:bg-zinc-800/30 transition">
                    <td className="px-3 py-2.5 font-medium flex items-center gap-1.5 text-zinc-200">
                      {c.isPrimary && <Key className="w-3 h-3 text-indigo-400 flex-shrink-0" />}
                      {isFK && <Link className="w-3 h-3 text-purple-400 flex-shrink-0" />}
                      <span>{c.name}</span>
                    </td>

                    <td className="px-3 py-2.5 text-zinc-500 font-mono text-[11px]">
                      {c.dataType || 'text'}
                    </td>

                    <td className="px-3 py-2.5">
                      {c.isPrimary && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                          PK
                        </span>
                      )}
                      {isFK && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                          FK {c.refTable ? `-> ${c.refTable}` : ''}
                        </span>
                      )}
                      {!c.isPrimary && !isFK && <span className="text-zinc-600">-</span>}
                    </td>

                    <td className="px-3 py-2.5">
                      <select
                        value={c.generator}
                        onChange={(e) => {
                          const newType = e.target.value as GeneratorType
                          onUpdateGenerator(activeTable.table, c.name, {
                            ...c.config,
                            type: newType,
                          })
                        }}
                        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
                      >
                        {GENERATOR_PRESETS.map((p) => (
                          <option key={p.type} value={p.type}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-3 py-2.5">
                      {/* Dynamic Parameters per Generator */}
                      {c.generator === 'integer' || c.generator === 'decimal' ? (
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] text-zinc-500">Min:</label>
                          <input
                            type="number"
                            value={c.config.min ?? 1}
                            onChange={(e) =>
                              onUpdateGenerator(activeTable.table, c.name, {
                                ...c.config,
                                min: Number(e.target.value),
                              })
                            }
                            className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-right text-zinc-200"
                          />
                          <label className="text-[11px] text-zinc-500">Max:</label>
                          <input
                            type="number"
                            value={c.config.max ?? 1000}
                            onChange={(e) =>
                              onUpdateGenerator(activeTable.table, c.name, {
                                ...c.config,
                                max: Number(e.target.value),
                              })
                            }
                            className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-right text-zinc-200"
                          />
                        </div>
                      ) : c.generator === 'enum' ? (
                        <input
                          type="text"
                          placeholder="comma-separated choices"
                          value={(c.config.options || []).join(', ')}
                          onChange={(e) =>
                            onUpdateGenerator(activeTable.table, c.name, {
                              ...c.config,
                              options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                            })
                          }
                          className="w-48 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-200"
                        />
                      ) : c.generator === 'custom' ? (
                        <input
                          type="text"
                          placeholder="prefix (e.g. usr)"
                          value={c.config.prefix || ''}
                          onChange={(e) =>
                            onUpdateGenerator(activeTable.table, c.name, {
                              ...c.config,
                              prefix: e.target.value,
                            })
                          }
                          className="w-28 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-200"
                        />
                      ) : c.generator === 'boolean' ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-zinc-500">True %:</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={c.config.truePct ?? 50}
                            onChange={(e) =>
                              onUpdateGenerator(activeTable.table, c.name, {
                                ...c.config,
                                truePct: Number(e.target.value),
                              })
                            }
                            className="w-14 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-right text-zinc-200"
                          />
                        </div>
                      ) : (
                        <span className="text-[11px] text-zinc-500 italic">Defaults</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3-Row Sample Data Preview */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span className="font-semibold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Deterministic Preview Sample (3 Rows for {activeTable.table})
          </span>
          <span className="text-[11px] text-zinc-500">
            Seed-reproducible fixture preview
          </span>
        </div>

        <div className="border border-zinc-800 rounded-lg overflow-x-auto bg-zinc-950/60">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-zinc-900/80 text-zinc-400 text-[11px] border-b border-zinc-800">
              <tr>
                <th className="px-3 py-1.5 text-zinc-500 font-sans">#</th>
                {activeTable.columns.map((c) => (
                  <th key={c.name} className="px-3 py-1.5">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
              {activeTable.sampleRows && activeTable.sampleRows.length > 0 ? (
                activeTable.sampleRows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-zinc-900/40">
                    <td className="px-3 py-1.5 text-zinc-600 font-sans">{rIdx + 1}</td>
                    {activeTable.columns.map((c) => {
                      const val = row[c.name]
                      return (
                        <td key={c.name} className="px-3 py-1.5 truncate max-w-xs">
                          {val === null || val === undefined ? (
                            <span className="text-zinc-600 italic">null</span>
                          ) : typeof val === 'boolean' ? (
                            <span className={val ? 'text-emerald-400' : 'text-rose-400'}>
                              {String(val)}
                            </span>
                          ) : typeof val === 'object' ? (
                            JSON.stringify(val)
                          ) : (
                            String(val)
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={activeTable.columns.length + 1}
                    className="px-3 py-4 text-center text-zinc-500 italic font-sans"
                  >
                    No preview data generated.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
