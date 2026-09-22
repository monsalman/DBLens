import React from 'react'

export type EnvironmentType = 'production' | 'staging' | 'development' | 'local'

export function getEnvironmentConfig(env?: string) {
  switch (env) {
    case 'production':
      return {
        label: 'PROD',
        fullLabel: 'Production',
        className: 'bg-red-500/15 text-red-500 border-red-500/30 dark:bg-red-500/20 dark:text-red-400 dark:border-red-500/40',
        dotColor: 'bg-red-500',
      }
    case 'staging':
      return {
        label: 'STG',
        fullLabel: 'Staging',
        className: 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/40',
        dotColor: 'bg-amber-500',
      }
    case 'development':
      return {
        label: 'DEV',
        fullLabel: 'Development',
        className: 'bg-blue-500/15 text-blue-600 border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/40',
        dotColor: 'bg-blue-500',
      }
    case 'local':
    default:
      return {
        label: 'LOCAL',
        fullLabel: 'Local',
        className: 'bg-slate-500/15 text-slate-500 border-slate-500/30 dark:bg-slate-500/20 dark:text-slate-400 dark:border-slate-500/40',
        dotColor: 'bg-slate-400',
      }
  }
}

export const EnvironmentBadge: React.FC<{
  env?: string
  className?: string
  showDot?: boolean
}> = ({ env, className = '', showDot = false }) => {
  const config = getEnvironmentConfig(env)
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider border leading-none shrink-0 ${config.className} ${className}`}
    >
      {showDot && <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor}`} />}
      {config.label}
    </span>
  )
}
