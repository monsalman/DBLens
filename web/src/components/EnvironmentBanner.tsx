import React from 'react'
import { AlertTriangle, Shield, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ConnectionConfig } from '../lib/api'
import { useAppStore } from '../stores/appStore'

interface Props {
  connection: ConnectionConfig | null
}

export const EnvironmentBanner: React.FC<Props> = ({ connection }) => {
  const { setSafeMode, isSafeModeActive } = useAppStore()

  if (!connection) return null
  const env = connection.environment
  if (env !== 'production' && env !== 'staging') return null

  const isProd = env === 'production'
  const isSafeMode = isSafeModeActive(connection.id)

  const handleToggle = () => {
    setSafeMode(connection.id, !isSafeMode)
  }

  return (
    <div
      className={`w-full px-3 py-1.5 flex items-center justify-between text-xs font-mono border-b shrink-0 transition-colors z-20 ${
        isProd
          ? 'bg-red-500/10 text-red-400 border-red-500/30'
          : 'bg-amber-500/10 text-amber-500 border-amber-500/30'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {isProd ? (
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 animate-pulse" />
        ) : (
          <ShieldAlert className="w-4 h-4 shrink-0 text-amber-500" />
        )}
        <div className="flex items-center gap-2 truncate">
          <span className="font-bold tracking-wider uppercase">
            {isProd ? 'PRODUCTION ENVIRONMENT' : 'STAGING ENVIRONMENT'}
          </span>
          <span className="opacity-75 hidden sm:inline">
            — {isSafeMode ? 'Safe Mode active: Guardrails & confirmation enforced.' : 'Safe Mode disabled: Proceed with caution.'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {connection.readOnly && (
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-red-500/20 text-red-300 border border-red-500/30">
            Read-Only Lock
          </span>
        )}
        <button
          type="button"
          onClick={handleToggle}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
            isSafeMode
              ? isProd
                ? 'bg-red-500 text-white border-red-400 hover:bg-red-600'
                : 'bg-amber-500 text-black border-amber-400 hover:bg-amber-600'
              : 'bg-[var(--surface)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--fg)]'
          }`}
          title="Toggle Safe Mode guardrails"
        >
          {isSafeMode ? (
            <ShieldCheck className="w-3.5 h-3.5" />
          ) : (
            <Shield className="w-3.5 h-3.5" />
          )}
          <span>Safe Mode: {isSafeMode ? 'ON' : 'OFF'}</span>
        </button>
      </div>
    </div>
  )
}
