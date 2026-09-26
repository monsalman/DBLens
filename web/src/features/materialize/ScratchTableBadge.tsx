interface ScratchTableBadgeProps {
  count: number
  className?: string
  onClick?: () => void
}

export function ScratchTableBadge({ count, className = '', onClick }: ScratchTableBadgeProps) {
  if (count <= 0) return null

  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center justify-center px-1.5 py-0.2 text-[10px] font-mono font-medium rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 transition-colors ${
        onClick ? 'cursor-pointer hover:bg-amber-500/25' : ''
      } ${className}`}
      title={`${count} active scratch table${count > 1 ? 's' : ''}`}
    >
      {count}
    </span>
  )
}
