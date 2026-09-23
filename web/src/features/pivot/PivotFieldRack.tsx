import React from 'react'
import {
  Rows,
  Columns as ColumnsIcon,
  Sigma,
  Flame,
  RotateCcw,
  X,
} from 'lucide-react'
import type { PivotConfig, AggregatorType } from './pivotHelper'

interface PivotFieldRackProps {
  columns: string[]
  config: PivotConfig
  onChange: (partial: Partial<PivotConfig>) => void
  heatShading: boolean
  onToggleHeatShading: () => void
  onResetDefaults?: () => void
}

const AGGREGATORS: { id: AggregatorType; label: string; desc: string }[] = [
  { id: 'sum', label: 'SUM', desc: 'Sum of numeric values' },
  { id: 'count', label: 'COUNT', desc: 'Count of records' },
  { id: 'avg', label: 'AVG', desc: 'Average of values' },
  { id: 'min', label: 'MIN', desc: 'Minimum value' },
  { id: 'max', label: 'MAX', desc: 'Maximum value' },
]

export const PivotFieldRack: React.FC<PivotFieldRackProps> = ({
  columns,
  config,
  onChange,
  heatShading,
  onToggleHeatShading,
  onResetDefaults,
}) => {
  const handleAddRowField = (field: string) => {
    if (!field || config.rowFields.includes(field)) return
    onChange({ rowFields: [...config.rowFields, field] })
  }

  const handleRemoveRowField = (field: string) => {
    onChange({ rowFields: config.rowFields.filter((f) => f !== field) })
  }

  const availableForRow = columns.filter((c) => !config.rowFields.includes(c))

  return (
    <div className="bg-[var(--surface)] border-b border-[var(--border)] p-3 text-xs select-none">
      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-12 gap-3 items-start">
        {/* 1. Row Fields Section (lg: 4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-1.5 bg-[var(--bg)]/60 p-2 rounded border border-[var(--border)]">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--fg)]">
            <span className="flex items-center gap-1.5 text-blue-400">
              <Rows className="w-3.5 h-3.5" />
              Row Fields (Group By)
            </span>
            <span className="text-[10px] text-[var(--muted)] font-mono">
              {config.rowFields.length} selected
            </span>
          </div>

          {/* Selected Row Chips */}
          <div className="flex flex-wrap items-center gap-1 min-h-[26px]">
            {config.rowFields.map((field) => (
              <span
                key={field}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-300 font-mono text-[11px]"
              >
                <span>{field}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveRowField(field)}
                  className="hover:text-red-400 p-0.5 rounded transition-colors"
                  title={`Remove ${field}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}

            {/* Add Row Field Dropdown */}
            {availableForRow.length > 0 && (
              <div className="relative inline-block">
                <select
                  value=""
                  onChange={(e) => handleAddRowField(e.target.value)}
                  className="appearance-none bg-transparent hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] text-[10px] font-mono px-1.5 py-0.5 rounded border border-dashed border-[var(--border)] cursor-pointer focus:outline-none transition-colors"
                  title="Add row field"
                >
                  <option value="" disabled>
                    + Add field
                  </option>
                  {availableForRow.map((c) => (
                    <option key={c} value={c} className="bg-[var(--surface)] text-[var(--fg)]">
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* 2. Column Field Section (lg: 3 cols) */}
        <div className="lg:col-span-3 flex flex-col gap-1.5 bg-[var(--bg)]/60 p-2 rounded border border-[var(--border)]">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--fg)]">
            <span className="flex items-center gap-1.5 text-indigo-400">
              <ColumnsIcon className="w-3.5 h-3.5" />
              Column Pivot (Cross-Tab)
            </span>
          </div>
          <select
            value={config.colField}
            onChange={(e) => onChange({ colField: e.target.value })}
            className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono text-[var(--fg)] focus:outline-none focus:border-indigo-500"
          >
            <option value="" disabled>
              Select column...
            </option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Value Field & Aggregator (lg: 3 cols) */}
        <div className="lg:col-span-3 flex flex-col gap-1.5 bg-[var(--bg)]/60 p-2 rounded border border-[var(--border)]">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--fg)]">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Sigma className="w-3.5 h-3.5" />
              Values & Aggregation
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={config.valueField}
              onChange={(e) => onChange({ valueField: e.target.value })}
              className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono text-[var(--fg)] focus:outline-none focus:border-emerald-500"
            >
              <option value="" disabled>
                Select value...
              </option>
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {/* Aggregator selector */}
            <div className="flex items-center bg-[var(--surface)] border border-[var(--border)] rounded overflow-hidden p-0.5">
              {AGGREGATORS.map((agg) => (
                <button
                  key={agg.id}
                  type="button"
                  onClick={() => onChange({ aggregator: agg.id })}
                  className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded transition-colors ${
                    config.aggregator === agg.id
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-xs'
                      : 'text-[var(--muted)] hover:text-[var(--fg)]'
                  }`}
                  title={agg.desc}
                >
                  {agg.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 4. Controls & Options (lg: 2 cols) */}
        <div className="lg:col-span-2 flex flex-col gap-1.5 bg-[var(--bg)]/60 p-2 rounded border border-[var(--border)]">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--fg)]">
            <span>Display Options</span>
            {onResetDefaults && (
              <button
                type="button"
                onClick={onResetDefaults}
                className="text-[var(--muted)] hover:text-[var(--fg)] text-[10px] flex items-center gap-0.5"
                title="Reset to inferred defaults"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                Reset
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 mt-0.5">
            {/* Subtotals toggle */}
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--fg)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={config.subtotals}
                onChange={(e) => onChange({ subtotals: e.target.checked })}
                className="rounded border-[var(--border)] text-indigo-600 focus:ring-0 cursor-pointer"
              />
              <span>Totals</span>
            </label>

            {/* Heat Shading toggle */}
            <button
              type="button"
              onClick={onToggleHeatShading}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors border ${
                heatShading
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-medium'
                  : 'bg-[var(--surface)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--fg)]'
              }`}
              title="Toggle heatmap cell background shading"
            >
              <Flame className="w-3 h-3 text-amber-400" />
              <span>Heat</span>
            </button>

            {/* Col Limit selector */}
            <div className="flex items-center gap-1 text-[10px] text-[var(--muted)] font-mono">
              <span>Max</span>
              <select
                value={config.colLimit ?? 50}
                onChange={(e) => onChange({ colLimit: Number(e.target.value) })}
                className="bg-[var(--surface)] border border-[var(--border)] rounded px-1 py-0.5 text-[10px] font-mono text-[var(--fg)]"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
