import React, { useState, useMemo, useRef } from 'react'
import {
  BarChart3,
  LineChart,
  AreaChart,
  PieChart,
  TrendingUp,
  Download,
  Database,
  ChevronDown,
} from 'lucide-react'
import type { QueryResult } from '../../lib/api'
import {
  THEMES,
  detectColumns,
  aggregateData,
  formatValue,
  calculateTicks,
  describeArc,
  truncate,
} from './SqlChartStudioHelpers'
import type {
  ChartType,
  AggregationType,
  AggregatedItem,
  TooltipState,
} from './SqlChartStudioHelpers'

interface Props {
  result: QueryResult | null | undefined
}

export const SqlChartStudio: React.FC<Props> = ({ result }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const [chartType, setChartType] = useState<ChartType>('bar')
  const [selectedThemeId, setSelectedThemeId] = useState<string>('emerald')
  const [aggregation, setAggregation] = useState<AggregationType>('sum')
  const [userXColumn, setUserXColumn] = useState<string | null>(null)
  const [userYColumn, setUserYColumn] = useState<string | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const theme = THEMES[selectedThemeId] || THEMES.emerald
  const columns = useMemo(() => result?.columns || [], [result?.columns])
  const rows = useMemo(() => result?.rows || [], [result?.rows])

  // Auto detect default columns
  const detected = useMemo(() => {
    return detectColumns(columns, rows)
  }, [columns, rows])

  const xColumn = userXColumn && columns.includes(userXColumn) ? userXColumn : detected.defaultX
  const yColumn = userYColumn && columns.includes(userYColumn) ? userYColumn : detected.defaultY

  // Compute aggregation data
  const aggData = useMemo(() => {
    if (!xColumn || !yColumn || rows.length === 0) {
      return { items: [], total: 0, min: 0, max: 0, avg: 0, count: 0 }
    }
    return aggregateData(rows, columns, xColumn, yColumn, aggregation)
  }, [rows, columns, xColumn, yColumn, aggregation])

  // Handle Export SVG
  const handleExportSvg = () => {
    const svg = svgRef.current
    if (!svg) return

    const serializer = new XMLSerializer()
    let svgStr = serializer.serializeToString(svg)
    if (!svgStr.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
      svgStr = svgStr.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"')
    }

    // Embed standalone color fallbacks for external viewers
    svgStr = svgStr
      .replace(/var\(--bg\)/g, '#09090b')
      .replace(/var\(--fg\)/g, '#f5f5f5')
      .replace(/var\(--muted\)/g, '#a1a1aa')
      .replace(/var\(--border\)/g, 'rgba(255, 255, 255, 0.12)')
      .replace(/var\(--surface\)/g, '#18181b')

    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dblens-chart-${chartType}-${Date.now()}.svg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Handle Export PNG
  const handleExportPng = () => {
    const svg = svgRef.current
    if (!svg) return

    const serializer = new XMLSerializer()
    let svgStr = serializer.serializeToString(svg)
    if (!svgStr.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
      svgStr = svgStr.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"')
    }

    svgStr = svgStr
      .replace(/var\(--bg\)/g, '#09090b')
      .replace(/var\(--fg\)/g, '#f5f5f5')
      .replace(/var\(--muted\)/g, '#a1a1aa')
      .replace(/var\(--border\)/g, 'rgba(255, 255, 255, 0.12)')
      .replace(/var\(--surface\)/g, '#18181b')

    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()

    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      const width = (svg.clientWidth || 800) * scale
      const height = (svg.clientHeight || 400) * scale
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.fillStyle = '#09090b'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return
        const pngUrl = URL.createObjectURL(pngBlob)
        const a = document.createElement('a')
        a.href = pngUrl
        a.download = `dblens-chart-${chartType}-${Date.now()}.png`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(pngUrl)
      }, 'image/png')
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
    }

    img.src = url
  }

  const handleElementHover = (
    e: React.MouseEvent,
    item: { label: string; value: number; percent?: number; color?: string }
  ) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setTooltip({
      x: Math.min(x + 14, rect.width - 180),
      y: Math.max(10, y - 45),
      label: item.label,
      value: item.value,
      formattedValue: formatValue(item.value),
      percent: item.percent !== undefined ? item.percent.toFixed(1) : undefined,
      color: item.color || theme.primary,
    })
  }

  const handleElementLeave = () => {
    setTooltip(null)
    setHoveredIndex(null)
  }

  // Guard / Empty states
  if (!result || result.error || !rows || rows.length === 0 || columns.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
        <div className="w-14 h-14 rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center mb-4 text-[var(--muted)] shadow-inner">
          <BarChart3 className="w-7 h-7 text-emerald-400 opacity-80" />
        </div>
        <h3 className="text-sm font-semibold text-[var(--fg)] mb-1">
          {result?.error
            ? 'Query Error'
            : !rows || rows.length === 0
            ? 'No Query Results'
            : 'No Data to Visualize'}
        </h3>
        <p className="text-xs text-[var(--muted)] max-w-sm mb-4">
          {result?.error
            ? result.error
            : 'Execute a SQL query returning rows and numeric columns to unlock 1-click charts and visual aggregations.'}
        </p>
        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)] bg-[var(--surface)] px-3 py-1.5 rounded-full border border-[var(--border)] font-mono">
          <Database className="w-3.5 h-3.5 text-blue-400" />
          <span>Tip: SELECT category, SUM(amount) FROM ... GROUP BY category</span>
        </div>
      </div>
    )
  }

  // SVG Chart Geometry
  const viewBoxWidth = 800
  const viewBoxHeight = 380
  const marginLeft = 65
  const marginRight = 35
  const marginTop = 30
  const marginBottom = 65
  const plotWidth = viewBoxWidth - marginLeft - marginRight
  const plotHeight = viewBoxHeight - marginTop - marginBottom
  const baselineY = marginTop + plotHeight

  // Ticks and scale
  const displayItems = chartType === 'bar' ? aggData.items.slice(0, 60) : aggData.items.slice(0, 150)
  const minVal = Math.min(0, ...displayItems.map((it) => it.value))
  const rawMax = Math.max(...displayItems.map((it) => it.value))
  const maxVal = rawMax === minVal ? (rawMax === 0 ? 1 : rawMax * 1.25) : rawMax
  const valRange = maxVal - minVal || 1
  const ticks = calculateTicks(minVal, maxVal, 5)

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg)] select-none">
      {/* Studio Controls Toolbar */}
      <div className="h-11 border-b border-[var(--border)] px-3 flex items-center justify-between bg-[var(--surface)]/70 shrink-0 gap-2 flex-wrap text-xs">
        {/* Left: Chart Type Pills */}
        <div className="flex items-center gap-1 bg-[var(--bg)] p-0.5 rounded-lg border border-[var(--border)] shadow-xs">
          <button
            onClick={() => setChartType('bar')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              chartType === 'bar'
                ? 'bg-[var(--surface)] text-[var(--fg)] shadow-xs border border-[var(--border)]'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
            title="Bar Chart"
          >
            <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Bar</span>
          </button>

          <button
            onClick={() => setChartType('line')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              chartType === 'line'
                ? 'bg-[var(--surface)] text-[var(--fg)] shadow-xs border border-[var(--border)]'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
            title="Line Chart"
          >
            <LineChart className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">Line</span>
          </button>

          <button
            onClick={() => setChartType('area')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              chartType === 'area'
                ? 'bg-[var(--surface)] text-[var(--fg)] shadow-xs border border-[var(--border)]'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
            title="Area Chart"
          >
            <AreaChart className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Area</span>
          </button>

          <button
            onClick={() => setChartType('donut')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              chartType === 'donut'
                ? 'bg-[var(--surface)] text-[var(--fg)] shadow-xs border border-[var(--border)]'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
            title="Donut Chart"
          >
            <PieChart className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Donut</span>
          </button>

          <button
            onClick={() => setChartType('kpi')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              chartType === 'kpi'
                ? 'bg-[var(--surface)] text-[var(--fg)] shadow-xs border border-[var(--border)]'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
            title="KPI Summary Card"
          >
            <TrendingUp className="w-3.5 h-3.5 text-rose-400" />
            <span className="hidden sm:inline">KPI Card</span>
          </button>
        </div>

        {/* Center: Dimensions & Aggregations */}
        <div className="flex items-center gap-2">
          {/* Dimension (X) */}
          <div className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
            <span className="hidden md:inline font-mono">X:</span>
            <div className="relative">
              <select
                value={xColumn}
                onChange={(e) => setUserXColumn(e.target.value)}
                className="appearance-none bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 pr-5 text-xs text-[var(--fg)] font-mono focus:outline-hidden hover:border-[var(--muted)] cursor-pointer"
                title="Dimension (X-Axis)"
              >
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
            </div>
          </div>

          {/* Metric (Y) */}
          <div className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
            <span className="hidden md:inline font-mono">Y:</span>
            <div className="relative">
              <select
                value={yColumn}
                onChange={(e) => setUserYColumn(e.target.value)}
                className="appearance-none bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 pr-5 text-xs text-[var(--fg)] font-mono focus:outline-hidden hover:border-[var(--muted)] cursor-pointer"
                title="Metric (Y-Axis)"
              >
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
            </div>
          </div>

          {/* Aggregation */}
          <div className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
            <span className="hidden lg:inline font-mono">Agg:</span>
            <div className="relative">
              <select
                value={aggregation}
                onChange={(e) => setAggregation(e.target.value as AggregationType)}
                className="appearance-none bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 pr-5 text-xs text-[var(--fg)] font-mono focus:outline-hidden hover:border-[var(--muted)] cursor-pointer"
                title="Aggregation Method"
              >
                <option value="none">None (Raw)</option>
                <option value="sum">Sum</option>
                <option value="avg">Avg</option>
                <option value="count">Count</option>
                <option value="min">Min</option>
                <option value="max">Max</option>
              </select>
              <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Right: Theme & Exports */}
        <div className="flex items-center gap-2">
          {/* Color Themes */}
          <div className="flex items-center gap-1 bg-[var(--bg)] p-1 rounded-md border border-[var(--border)]">
            {Object.values(THEMES).map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedThemeId(t.id)}
                className={`w-3.5 h-3.5 rounded-full transition-transform ${
                  selectedThemeId === t.id ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'
                }`}
                style={{ backgroundColor: t.primary }}
                title={`${t.name} Theme`}
              />
            ))}
          </div>

          {/* Export SVG */}
          <button
            onClick={handleExportSvg}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface)] border border-[var(--border)] transition-colors"
            title="Download Chart as SVG"
          >
            <Download className="w-3 h-3" />
            <span>SVG</span>
          </button>

          {/* Export PNG */}
          <button
            onClick={handleExportPng}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface)] border border-[var(--border)] transition-colors"
            title="Download Chart as PNG (High-Res)"
          >
            <Download className="w-3 h-3" />
            <span>PNG</span>
          </button>
        </div>
      </div>

      {/* Main Chart Canvas Area */}
      <div
        ref={containerRef}
        className="flex-1 relative flex flex-col items-center justify-center p-4 overflow-auto min-h-0"
      >
        {/* Interactive Tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none z-30 px-3 py-2 rounded-lg bg-[#141416]/95 border border-[var(--border)] shadow-2xl backdrop-blur-xs text-xs font-mono text-white transition-opacity"
            style={{
              left: tooltip.x,
              top: tooltip.y,
            }}
          >
            <div className="flex items-center gap-1.5 font-semibold text-zinc-100 mb-0.5 truncate max-w-[200px]">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tooltip.color }} />
              <span className="truncate">{tooltip.label}</span>
            </div>
            <div className="text-zinc-400 text-[11px] flex items-center justify-between gap-3">
              <span>{yColumn}:</span>
              <span className="text-white font-bold">{tooltip.formattedValue}</span>
            </div>
            {tooltip.percent !== undefined && (
              <div className="text-zinc-400 text-[10px] flex items-center justify-between gap-3 mt-0.5">
                <span>Share:</span>
                <span className="text-emerald-400 font-medium">{tooltip.percent}%</span>
              </div>
            )}
          </div>
        )}

        {/* SVG Drawing Canvas */}
        <div className="w-full max-w-5xl h-full flex flex-col justify-center items-center">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
            className="w-full h-auto max-h-[500px] select-none"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.primary} stopOpacity="0.45" />
                <stop offset="90%" stopColor={theme.primary} stopOpacity="0.02" />
              </linearGradient>

              <linearGradient id="barGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.accent} stopOpacity="0.9" />
                <stop offset="100%" stopColor={theme.primary} stopOpacity="0.8" />
              </linearGradient>
            </defs>

            {/* BAR CHART */}
            {chartType === 'bar' && (
              <g>
                {/* Horizontal Gridlines & Y-Axis Ticks */}
                {ticks.map((tickVal, i) => {
                  const tickY = baselineY - ((tickVal - minVal) / valRange) * plotHeight
                  return (
                    <g key={i}>
                      <line
                        x1={marginLeft}
                        y1={tickY}
                        x2={marginLeft + plotWidth}
                        y2={tickY}
                        stroke="var(--border)"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text
                        x={marginLeft - 8}
                        y={tickY + 4}
                        textAnchor="end"
                        fontSize="10"
                        fill="var(--muted)"
                        fontFamily="monospace"
                      >
                        {formatValue(tickVal)}
                      </text>
                    </g>
                  )
                })}

                {/* Bars */}
                {displayItems.map((item, i) => {
                  const step = plotWidth / displayItems.length
                  const barWidth = Math.max(6, Math.min(42, step * 0.72))
                  const barX = marginLeft + i * step + (step - barWidth) / 2
                  const height = Math.max(3, ((item.value - minVal) / valRange) * plotHeight)
                  const barY = baselineY - height
                  const isHovered = hoveredIndex === i

                  const labelX = barX + barWidth / 2
                  const labelY = baselineY + 16
                  const rotate = displayItems.length > 14

                  return (
                    <g key={i}>
                      <rect
                        x={barX}
                        y={barY}
                        width={barWidth}
                        height={height}
                        rx="3"
                        fill={isHovered ? theme.accent : theme.primary}
                        className="transition-all duration-150 cursor-pointer"
                        onMouseEnter={(e) => {
                          setHoveredIndex(i)
                          handleElementHover(e, item)
                        }}
                        onMouseMove={(e) => handleElementHover(e, item)}
                        onMouseLeave={handleElementLeave}
                      />

                      {/* X-Axis Labels */}
                      {(!rotate || i % Math.ceil(displayItems.length / 25) === 0) && (
                        <text
                          x={labelX}
                          y={labelY}
                          transform={rotate ? `rotate(-40, ${labelX}, ${labelY})` : undefined}
                          textAnchor={rotate ? 'end' : 'middle'}
                          fontSize="9"
                          fill="var(--muted)"
                          fontFamily="monospace"
                        >
                          {truncate(item.label, 12)}
                        </text>
                      )}
                    </g>
                  )
                })}

                {/* Baseline Axis */}
                <line
                  x1={marginLeft}
                  y1={baselineY}
                  x2={marginLeft + plotWidth}
                  y2={baselineY}
                  stroke="var(--border)"
                  strokeWidth="1.5"
                />
              </g>
            )}

            {/* LINE CHART */}
            {chartType === 'line' && (
              <g>
                {/* Horizontal Gridlines & Y-Axis Ticks */}
                {ticks.map((tickVal, i) => {
                  const tickY = baselineY - ((tickVal - minVal) / valRange) * plotHeight
                  return (
                    <g key={i}>
                      <line
                        x1={marginLeft}
                        y1={tickY}
                        x2={marginLeft + plotWidth}
                        y2={tickY}
                        stroke="var(--border)"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text
                        x={marginLeft - 8}
                        y={tickY + 4}
                        textAnchor="end"
                        fontSize="10"
                        fill="var(--muted)"
                        fontFamily="monospace"
                      >
                        {formatValue(tickVal)}
                      </text>
                    </g>
                  )
                })}

                {/* Line Path */}
                {displayItems.length > 0 && (() => {
                  const pts = displayItems.map((item, i) => {
                    const step = displayItems.length > 1 ? plotWidth / (displayItems.length - 1) : plotWidth / 2
                    const x = displayItems.length > 1 ? marginLeft + i * step : marginLeft + plotWidth / 2
                    const y = baselineY - ((item.value - minVal) / valRange) * plotHeight
                    return { x, y, item }
                  })

                  const pathD = pts.reduce(
                    (acc, p, i) => (i === 0 ? `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}` : `${acc} L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`),
                    ''
                  )

                  return (
                    <g>
                      <path
                        d={pathD}
                        fill="none"
                        stroke={theme.primary}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      {/* Points & Hovers */}
                      {pts.map((p, i) => (
                        <g key={i}>
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={hoveredIndex === i ? 6 : displayItems.length > 35 ? 2.5 : 4}
                            fill="var(--bg)"
                            stroke={hoveredIndex === i ? theme.accent : theme.primary}
                            strokeWidth="2"
                          />
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r="14"
                            fill="transparent"
                            className="cursor-pointer"
                            onMouseEnter={(e) => {
                              setHoveredIndex(i)
                              handleElementHover(e, p.item)
                            }}
                            onMouseMove={(e) => handleElementHover(e, p.item)}
                            onMouseLeave={handleElementLeave}
                          />

                          {/* X Labels */}
                          {i % Math.ceil(displayItems.length / 15) === 0 && (
                            <text
                              x={p.x}
                              y={baselineY + 16}
                              textAnchor="middle"
                              fontSize="9"
                              fill="var(--muted)"
                              fontFamily="monospace"
                            >
                              {truncate(p.item.label, 12)}
                            </text>
                          )}
                        </g>
                      ))}
                    </g>
                  )
                })()}

                <line
                  x1={marginLeft}
                  y1={baselineY}
                  x2={marginLeft + plotWidth}
                  y2={baselineY}
                  stroke="var(--border)"
                  strokeWidth="1.5"
                />
              </g>
            )}

            {/* AREA CHART */}
            {chartType === 'area' && (
              <g>
                {/* Horizontal Gridlines & Y-Axis Ticks */}
                {ticks.map((tickVal, i) => {
                  const tickY = baselineY - ((tickVal - minVal) / valRange) * plotHeight
                  return (
                    <g key={i}>
                      <line
                        x1={marginLeft}
                        y1={tickY}
                        x2={marginLeft + plotWidth}
                        y2={tickY}
                        stroke="var(--border)"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text
                        x={marginLeft - 8}
                        y={tickY + 4}
                        textAnchor="end"
                        fontSize="10"
                        fill="var(--muted)"
                        fontFamily="monospace"
                      >
                        {formatValue(tickVal)}
                      </text>
                    </g>
                  )
                })}

                {/* Area Gradient + Line */}
                {displayItems.length > 0 && (() => {
                  const pts = displayItems.map((item, i) => {
                    const step = displayItems.length > 1 ? plotWidth / (displayItems.length - 1) : plotWidth / 2
                    const x = displayItems.length > 1 ? marginLeft + i * step : marginLeft + plotWidth / 2
                    const y = baselineY - ((item.value - minVal) / valRange) * plotHeight
                    return { x, y, item }
                  })

                  const lineD = pts.reduce(
                    (acc, p, i) => (i === 0 ? `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}` : `${acc} L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`),
                    ''
                  )

                  const firstP = pts[0]
                  const lastP = pts[pts.length - 1]
                  const areaD = `${lineD} L ${lastP.x.toFixed(2)} ${baselineY} L ${firstP.x.toFixed(2)} ${baselineY} Z`

                  return (
                    <g>
                      <path d={areaD} fill="url(#areaGradient)" />
                      <path
                        d={lineD}
                        fill="none"
                        stroke={theme.primary}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      {pts.map((p, i) => (
                        <g key={i}>
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={hoveredIndex === i ? 6 : displayItems.length > 35 ? 2 : 3.5}
                            fill="var(--bg)"
                            stroke={hoveredIndex === i ? theme.accent : theme.primary}
                            strokeWidth="2"
                          />
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r="14"
                            fill="transparent"
                            className="cursor-pointer"
                            onMouseEnter={(e) => {
                              setHoveredIndex(i)
                              handleElementHover(e, p.item)
                            }}
                            onMouseMove={(e) => handleElementHover(e, p.item)}
                            onMouseLeave={handleElementLeave}
                          />

                          {i % Math.ceil(displayItems.length / 15) === 0 && (
                            <text
                              x={p.x}
                              y={baselineY + 16}
                              textAnchor="middle"
                              fontSize="9"
                              fill="var(--muted)"
                              fontFamily="monospace"
                            >
                              {truncate(p.item.label, 12)}
                            </text>
                          )}
                        </g>
                      ))}
                    </g>
                  )
                })()}

                <line
                  x1={marginLeft}
                  y1={baselineY}
                  x2={marginLeft + plotWidth}
                  y2={baselineY}
                  stroke="var(--border)"
                  strokeWidth="1.5"
                />
              </g>
            )}

            {/* DONUT CHART */}
            {chartType === 'donut' && (() => {
              const donutCx = 230
              const donutCy = 190
              const outerR = 120
              const innerR = 75

              // Take top 6 items, group rest into Other
              const sorted = [...aggData.items].sort((a, b) => b.value - a.value)
              const maxSlices = 6
              let slices: AggregatedItem[] = []
              if (sorted.length <= maxSlices) {
                slices = sorted
              } else {
                const top = sorted.slice(0, maxSlices - 1)
                const rest = sorted.slice(maxSlices - 1)
                const restVal = rest.reduce((s, it) => s + Math.max(0, it.value), 0)
                slices = [
                  ...top,
                  {
                    label: 'Other',
                    value: restVal,
                    count: rest.reduce((s, it) => s + it.count, 0),
                  },
                ]
              }

              const totalDonut = slices.reduce((s, it) => s + Math.max(0, it.value), 0) || 1

              let currAngle = 0
              const arcSegments = slices.map((slice, i) => {
                const sliceVal = Math.max(0, slice.value)
                const angle = (sliceVal / totalDonut) * 2 * Math.PI
                const start = currAngle
                const end = currAngle + angle
                currAngle = end
                const color = theme.palette[i % theme.palette.length]
                const isHovered = hoveredIndex === i
                const pathD = describeArc(
                  donutCx,
                  donutCy,
                  isHovered ? outerR + 6 : outerR,
                  innerR,
                  start,
                  end
                )
                const pct = (sliceVal / totalDonut) * 100
                return { slice, start, end, color, pathD, isHovered, pct, index: i }
              })

              return (
                <g>
                  {/* Slices */}
                  {arcSegments.map((seg) => (
                    <path
                      key={seg.index}
                      d={seg.pathD}
                      fill={seg.color}
                      className="transition-all duration-150 cursor-pointer hover:brightness-115"
                      onMouseEnter={(e) => {
                        setHoveredIndex(seg.index)
                        handleElementHover(e, {
                          label: seg.slice.label,
                          value: seg.slice.value,
                          percent: seg.pct,
                          color: seg.color,
                        })
                      }}
                      onMouseMove={(e) =>
                        handleElementHover(e, {
                          label: seg.slice.label,
                          value: seg.slice.value,
                          percent: seg.pct,
                          color: seg.color,
                        })
                      }
                      onMouseLeave={handleElementLeave}
                    />
                  ))}

                  {/* Center Stat */}
                  <text
                    x={donutCx}
                    y={donutCy - 5}
                    textAnchor="middle"
                    fontSize="22"
                    fontWeight="700"
                    fill="var(--fg)"
                    fontFamily="monospace"
                  >
                    {formatValue(totalDonut)}
                  </text>
                  <text
                    x={donutCx}
                    y={donutCy + 16}
                    textAnchor="middle"
                    fontSize="11"
                    fill="var(--muted)"
                    fontFamily="monospace"
                  >
                    {truncate(yColumn, 14)}
                  </text>

                  {/* Right Legend */}
                  <g transform="translate(420, 60)">
                    <text x="0" y="0" fontSize="11" fontWeight="600" fill="var(--muted)" letterSpacing="0.05em">
                      DISTRIBUTION BREAKDOWN
                    </text>

                    {arcSegments.map((seg, i) => {
                      const rowY = 22 + i * 40
                      return (
                        <g
                          key={i}
                          className="cursor-pointer"
                          onMouseEnter={(e) => {
                            setHoveredIndex(seg.index)
                            handleElementHover(e, {
                              label: seg.slice.label,
                              value: seg.slice.value,
                              percent: seg.pct,
                              color: seg.color,
                            })
                          }}
                          onMouseLeave={handleElementLeave}
                        >
                          <circle cx="6" cy={rowY + 5} r="5" fill={seg.color} />
                          <text
                            x="18"
                            y={rowY + 9}
                            fontSize="11"
                            fill="var(--fg)"
                            fontFamily="monospace"
                            fontWeight={seg.isHovered ? '700' : '500'}
                          >
                            {truncate(seg.slice.label, 16)}
                          </text>

                          <text
                            x="320"
                            y={rowY + 9}
                            textAnchor="end"
                            fontSize="11"
                            fill="var(--muted)"
                            fontFamily="monospace"
                          >
                            {formatValue(seg.slice.value)} ({seg.pct.toFixed(1)}%)
                          </text>

                          {/* Progress Line */}
                          <line
                            x1="18"
                            y1={rowY + 18}
                            x2="320"
                            y2={rowY + 18}
                            stroke="var(--border)"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                          <line
                            x1="18"
                            y1={rowY + 18}
                            x2={18 + (302 * seg.pct) / 100}
                            y2={rowY + 18}
                            stroke={seg.color}
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        </g>
                      )
                    })}
                  </g>
                </g>
              )
            })()}

            {/* KPI SUMMARY CARD */}
            {chartType === 'kpi' && (() => {
              const sortedTop = [...aggData.items].sort((a, b) => b.value - a.value).slice(0, 3)
              const maxTop = Math.max(...sortedTop.map((it) => it.value), 1)

              return (
                <g>
                  {/* Card Border / Canvas Frame */}
                  <rect
                    x="15"
                    y="15"
                    width="770"
                    height="350"
                    rx="12"
                    fill="var(--surface)"
                    stroke="var(--border)"
                    strokeWidth="1"
                  />

                  {/* Header Title */}
                  <text
                    x="40"
                    y="46"
                    fontSize="11"
                    fontWeight="700"
                    fill="var(--muted)"
                    letterSpacing="0.08em"
                    fontFamily="monospace"
                  >
                    KPI EXECUTIVE SUMMARY • {aggregation.toUpperCase()} OF {yColumn.toUpperCase()}
                  </text>

                  {/* Giant Stat Display */}
                  <text
                    x="40"
                    y="100"
                    fontSize="46"
                    fontWeight="800"
                    fill={theme.primary}
                    fontFamily="monospace"
                  >
                    {formatValue(aggData.total)}
                  </text>
                  <text x="40" y="124" fontSize="12" fill="var(--muted)">
                    Calculated over {aggData.items.length} {xColumn} records ({rows.length} total rows)
                  </text>

                  {/* 4 Sub-metrics cards */}
                  {[
                    { label: 'AVERAGE', val: formatValue(aggData.avg) },
                    { label: 'MINIMUM', val: formatValue(aggData.min) },
                    { label: 'MAXIMUM', val: formatValue(aggData.max) },
                    { label: 'RECORDS', val: String(aggData.items.length) },
                  ].map((sub, i) => {
                    const cardX = 40 + i * 180
                    return (
                      <g key={i}>
                        <rect
                          x={cardX}
                          y="146"
                          width="168"
                          height="58"
                          rx="8"
                          fill="var(--bg)"
                          stroke="var(--border)"
                          strokeWidth="1"
                        />
                        <text
                          x={cardX + 12}
                          y="166"
                          fontSize="9.5"
                          fontWeight="600"
                          fill="var(--muted)"
                          letterSpacing="0.05em"
                          fontFamily="monospace"
                        >
                          {sub.label}
                        </text>
                        <text
                          x={cardX + 12}
                          y="192"
                          fontSize="18"
                          fontWeight="700"
                          fill="var(--fg)"
                          fontFamily="monospace"
                        >
                          {sub.val}
                        </text>
                      </g>
                    )
                  })}

                  {/* Top 3 Breakdown Header */}
                  <text
                    x="40"
                    y="238"
                    fontSize="11"
                    fontWeight="600"
                    fill="var(--muted)"
                    letterSpacing="0.05em"
                    fontFamily="monospace"
                  >
                    TOP DIMENSION BREAKDOWN
                  </text>

                  {/* Breakdown Bars */}
                  {sortedTop.map((item, i) => {
                    const rowY = 252 + i * 36
                    const pct = item.percent !== undefined ? item.percent.toFixed(1) : '0'
                    const barWidth = Math.max(4, Math.min(380, (item.value / maxTop) * 380))
                    const barColor = theme.palette[i % theme.palette.length]

                    return (
                      <g key={i}>
                        <text
                          x="40"
                          y={rowY + 13}
                          fontSize="11"
                          fill="var(--fg)"
                          fontFamily="monospace"
                          fontWeight="500"
                        >
                          {truncate(item.label, 18)}
                        </text>

                        <rect
                          x="220"
                          y={rowY + 4}
                          width="380"
                          height="10"
                          rx="5"
                          fill="var(--bg)"
                          stroke="var(--border)"
                        />
                        <rect
                          x="220"
                          y={rowY + 4}
                          width={barWidth}
                          height="10"
                          rx="5"
                          fill={barColor}
                        />

                        <text
                          x="620"
                          y={rowY + 13}
                          fontSize="11"
                          fill="var(--muted)"
                          fontFamily="monospace"
                        >
                          {formatValue(item.value)} ({pct}%)
                        </text>
                      </g>
                    )
                  })}
                </g>
              )
            })()}
          </svg>
        </div>
      </div>
    </div>
  )
}
