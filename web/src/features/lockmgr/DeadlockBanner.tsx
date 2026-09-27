import React from 'react'
import { AlertOctagon, ArrowRight, Skull, ShieldAlert } from 'lucide-react'
import type { DeadlockCycle } from './lockHelper'

interface DeadlockBannerProps {
  deadlocks: DeadlockCycle[]
  onSelectPID: (pid: number) => void
  onKillPID: (pid: number) => void
}

export const DeadlockBanner: React.FC<DeadlockBannerProps> = ({
  deadlocks,
  onSelectPID,
  onKillPID,
}) => {
  if (!deadlocks || deadlocks.length === 0) return null

  return (
    <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 dark:bg-red-950/30 p-3.5 shadow-sm text-red-900 dark:text-red-200">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-md bg-red-500/20 text-red-600 dark:text-red-400 shrink-0 animate-pulse">
          <AlertOctagon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" />
              Circular Deadlock Detected ({deadlocks.length} {deadlocks.length === 1 ? 'cycle' : 'cycles'})
            </h4>
            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/20 text-red-600 dark:text-red-400 font-bold border border-red-500/30">
              URGENT
            </span>
          </div>
          <p className="text-xs text-red-600 dark:text-red-300/90 mt-0.5">
            Two or more transactions are waiting on locks held by each other in a closed loop. None can make progress until at least one session is cancelled or terminated.
          </p>

          <div className="mt-3 space-y-2">
            {deadlocks.map((dl, idx) => (
              <div
                key={idx}
                className="bg-[var(--bg)]/80 dark:bg-black/40 border border-red-500/25 rounded-md p-2.5 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-[11px] text-[var(--muted)]">Cycle #{idx + 1}:</span>
                  {dl.pids.map((pid, pIdx) => (
                    <React.Fragment key={`${idx}-${pid}-${pIdx}`}>
                      <button
                        type="button"
                        onClick={() => onSelectPID(pid)}
                        className="font-mono font-medium px-2 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300 hover:bg-purple-500/25 border border-purple-500/30 transition-colors cursor-pointer"
                        title={`Inspect session PID ${pid}`}
                      >
                        PID {pid}
                      </button>
                      {pIdx < dl.pids.length - 1 && (
                        <ArrowRight className="w-3.5 h-3.5 text-red-400 dark:text-red-500 shrink-0" />
                      )}
                    </React.Fragment>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  {dl.pids.slice(0, -1).map(pid => (
                    <button
                      key={`kill-${pid}`}
                      type="button"
                      onClick={() => onKillPID(pid)}
                      className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-medium text-[11px] flex items-center gap-1 transition-colors shadow-sm"
                      title={`Terminate PID ${pid} to break deadlock cycle`}
                    >
                      <Skull className="w-3 h-3" />
                      Kill PID {pid}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
