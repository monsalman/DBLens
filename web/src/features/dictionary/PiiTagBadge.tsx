import React from 'react'
import { ShieldAlert } from 'lucide-react'
import { getPiiBadgeInfo } from './dictionaryHelper'

interface PiiTagBadgeProps {
  piiType?: string
  size?: 'sm' | 'md'
  showDescription?: boolean
}

export const PiiTagBadge: React.FC<PiiTagBadgeProps> = ({
  piiType,
  size = 'sm',
  showDescription = false,
}) => {
  if (!piiType) return null

  const info = getPiiBadgeInfo(piiType)

  const isSmall = size === 'sm'

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono font-semibold rounded border ${info.bg} ${info.color} ${info.border} ${
        isSmall ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'
      }`}
      title={info.description}
    >
      <ShieldAlert className={isSmall ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0'} />
      <span>{info.label}</span>
      {showDescription && (
        <span className="text-[10px] opacity-75 font-sans font-normal ml-1">
          ({info.description})
        </span>
      )}
    </span>
  )
}
