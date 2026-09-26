import React from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Gauge } from 'lucide-react'

interface QpsLiveGaugeProps {
  currentQps: number
  percent: number
  elapsedMs: number
  totalQueries: number
  successfulQueries: number
  failedQueries: number
  status: 'running' | 'completed' | 'cancelled' | 'failed' | string
}

export const QpsLiveGauge: React.FC<QpsLiveGaugeProps> = ({
  currentQps,
  percent,
  elapsedMs,
  totalQueries,
  successfulQueries,
  failedQueries,
  status,
}) => {
  // Format elapsed seconds
  const elapsedSec = (elapsedMs / 1000).toFixed(1)

  // Status icon & label
  const renderStatusBadge = () => {
    switch (status) {
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Benchmarking Live
          </span>
        )
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-500/10 text-sky-400 border border-sky-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed
          </span>
        )
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3.5 h-3.5" />
            Cancelled
          </span>
        )
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <XCircle className="w-3.5 h-3.5" />
            Failed
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400">
            {status}
          </span>
        )
    }
  }

  // Semi-circle SVG arc calculation
  const radius = 58
  const circumference = Math.PI * radius
  // Normalize QPS against a dynamic baseline (e.g. up to 5000 max, scaling logarithmically or linearly)
  const maxScaleQps = Math.max(currentQps * 1.3, 1000)
  const qpsRatio = Math.min(Math.max(currentQps / maxScaleQps, 0), 1)
  const strokeDashoffset = circumference * (1 - qpsRatio)

  return (
    <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-5 flex flex-col justify-between select-none">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
            Live Throughput Gauge
          </span>
        </div>
        {renderStatusBadge()}
      </div>

      {/* Center Dial Gauge */}
      <div className="flex items-center justify-center my-2 relative">
        <svg viewBox="0 0 160 95" className="w-48 h-auto overflow-visible">
          <defs>
            <linearGradient id="gaugeGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>

          {/* Background track arc */}
          <path
            d="M 22 85 A 58 58 0 0 1 138 85"
            fill="none"
            stroke="#27272a"
            strokeWidth="10"
            strokeLinecap="round"
          />

          {/* Active colored arc */}
          <path
            d="M 22 85 A 58 58 0 0 1 138 85"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-300 ease-out"
          />

          {/* Value in center */}
          <text
            x="80"
            y="72"
            textAnchor="middle"
            className="font-bold text-2xl fill-zinc-100 font-mono tracking-tight"
          >
            {Math.round(currentQps).toLocaleString()}
          </text>
          <text
            x="80"
            y="88"
            textAnchor="middle"
            className="text-[10px] fill-zinc-400 uppercase tracking-widest"
          >
            Queries / Sec
          </text>
        </svg>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5 mt-2">
        <div className="flex justify-between text-xs text-zinc-400">
          <span>Progress</span>
          <span className="font-mono text-zinc-200">
            {percent.toFixed(0)}% ({elapsedSec}s)
          </span>
        </div>
        <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-200 ease-out"
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-zinc-800/60 text-center">
        <div className="bg-zinc-900/50 rounded-lg p-2 border border-zinc-800/40">
          <div className="text-[11px] text-zinc-400">Total Run</div>
          <div className="text-sm font-semibold text-zinc-200 font-mono">
            {totalQueries.toLocaleString()}
          </div>
        </div>
        <div className="bg-zinc-900/50 rounded-lg p-2 border border-zinc-800/40">
          <div className="text-[11px] text-emerald-400">Success</div>
          <div className="text-sm font-semibold text-emerald-300 font-mono">
            {successfulQueries.toLocaleString()}
          </div>
        </div>
        <div className="bg-zinc-900/50 rounded-lg p-2 border border-zinc-800/40">
          <div className="text-[11px] text-rose-400">Failed</div>
          <div className="text-sm font-semibold text-rose-300 font-mono">
            {failedQueries.toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  )
}
