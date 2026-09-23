import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Circle, Trash2, Radio } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'

// ── Types ──────────────────────────────────────────────────────────────────

export interface ChangeEvent {
  op: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema: string
  pk: Record<string, unknown>
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  timestamp: string
}

interface ConnectedEvent {
  type: 'connected'
  table: string
  schema: string
  interval: number
}

interface FeedConfig {
  connId: string
  schema: string
  table: string
}

// ── Hook ──────────────────────────────────────────────────────────────────

const BASE_URL = '/api'
const MAX_EVENTS = 200

function useLiveFeed(config: FeedConfig | null, intervalSec: number, active: boolean, dsn: string) {
  const [events, setEvents] = useState<ChangeEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [feedError, setFeedError] = useState('')
  const esRef = useRef<EventSource | null>(null)

  const stop = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
    setConnected(false)
  }, [])

  useEffect(() => {
    if (!active || !config) {
      stop()
      return
    }
    stop() // close previous if any
    setFeedError('')

    const params = new URLSearchParams({
      schema: config.schema,
      table: config.table,
      interval: String(intervalSec),
    })
    // EventSource cannot set request headers, so the DSN travels as a query
    // param. Without it the server only knows browser-local (local_*) IDs and
    // can never resolve the connection.
    if (dsn) params.set('dsn', dsn)
    const url = `${BASE_URL}/connections/${config.connId}/live-feed?${params}`
    const es = new EventSource(url)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if ((data as ConnectedEvent).type === 'connected') {
          setConnected(true)
          return
        }
        if (data.type === 'error') {
          setFeedError(data.message || 'Live feed stopped')
          setConnected(false)
          return
        }
        const ev = data as ChangeEvent
        setEvents((prev) => {
          const next = [ev, ...prev]
          return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next
        })
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      setConnected(false)
    }

    return stop
  }, [active, config?.connId, config?.schema, config?.table, intervalSec, dsn, stop])

  const clearLog = useCallback(() => setEvents([]), [])

  return { events, connected, feedError, clearLog }
}

// ── Delta counter (last 60s) ────────────────────────────────────────────────

function useDelta(events: ChangeEvent[]) {
  const [delta, setDelta] = useState({ inserts: 0, updates: 0, deletes: 0 })

  useEffect(() => {
    const cutoff = Date.now() - 60_000
    const recent = events.filter((e) => new Date(e.timestamp).getTime() > cutoff)
    setDelta({
      inserts: recent.filter((e) => e.op === 'INSERT').length,
      updates: recent.filter((e) => e.op === 'UPDATE').length,
      deletes: recent.filter((e) => e.op === 'DELETE').length,
    })
  }, [events])

  return delta
}

// ── Op badge ────────────────────────────────────────────────────────────────

function OpBadge({ op }: { op: string }) {
  const cls =
    op === 'INSERT'
      ? 'bg-green-500/20 text-green-400 border-green-500/30'
      : op === 'UPDATE'
      ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
      : 'bg-red-500/20 text-red-400 border-red-500/30'
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold ${cls}`}>
      {op}
    </span>
  )
}

// ── Row expand ──────────────────────────────────────────────────────────────

function EventRow({ ev }: { ev: ChangeEvent }) {
  const [expanded, setExpanded] = useState(false)
  const pkStr = Object.values(ev.pk).join(', ')
  const summary =
    ev.op === 'INSERT'
      ? 'new row'
      : ev.op === 'DELETE'
      ? 'row removed'
      : ev.after
      ? Object.keys(ev.after)
          .filter((k) => JSON.stringify(ev.before?.[k]) !== JSON.stringify(ev.after?.[k]))
          .slice(0, 3)
          .join(', ') || 'changed'
      : 'changed'

  const time = new Date(ev.timestamp).toLocaleTimeString()

  return (
    <>
      <tr
        className="border-b border-[var(--border)] hover:bg-[var(--hover)] cursor-pointer text-xs font-mono"
        onClick={() => setExpanded((p) => !p)}
      >
        <td className="px-2 py-1 text-[var(--muted)] whitespace-nowrap">{time}</td>
        <td className="px-2 py-1">
          <OpBadge op={ev.op} />
        </td>
        <td className="px-2 py-1 text-[var(--fg)]">{pkStr}</td>
        <td className="px-2 py-1 text-[var(--muted)] truncate max-w-xs">{summary}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-[var(--border)] bg-[var(--surface)]">
          <td colSpan={4} className="px-3 py-2">
            <div className="grid grid-cols-2 gap-2">
              {ev.before && (
                <div>
                  <div className="text-[10px] text-[var(--muted)] mb-1 font-semibold uppercase tracking-wider">Before</div>
                  <pre className="text-[10px] text-red-300 overflow-auto max-h-40">
                    {JSON.stringify(ev.before, null, 2)}
                  </pre>
                </div>
              )}
              {ev.after && (
                <div>
                  <div className="text-[10px] text-[var(--muted)] mb-1 font-semibold uppercase tracking-wider">After</div>
                  <pre className="text-[10px] text-green-300 overflow-auto max-h-40">
                    {JSON.stringify(ev.after, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Drawer ───────────────────────────────────────────────────────────────────

const INTERVALS = [0.5, 1, 2, 5, 10, 30]

interface Props {
  isOpen: boolean
  onClose: () => void
  connId: string
  schema: string
  table: string
}

export function LiveFeedDrawer({ isOpen, onClose, connId, schema, table }: Props) {
  const [active, setActive] = useState(false)
  const [intervalSec, setIntervalSec] = useState(2)
  const dsn = useAppStore((s) => s.connections.find((c) => c.id === connId)?.dsn ?? '')
  const config: FeedConfig | null = connId && table ? { connId, schema, table } : null
  const { events, connected, feedError, clearLog } = useLiveFeed(config, intervalSec, active, dsn)
  const delta = useDelta(events)

  // Stop feed when drawer closes.
  useEffect(() => {
    if (!isOpen) setActive(false)
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] max-w-full z-50 flex flex-col bg-[var(--bg)] border-l border-[var(--border)] shadow-2xl">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 text-[var(--muted)]" />
          <span className="text-xs font-mono font-semibold text-[var(--fg)]">
            Live Feed — {schema ? `${schema}.` : ''}{table}
          </span>
          {/* Status dot */}
          <span
            className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : feedError ? 'bg-red-500' : 'bg-[var(--muted)]'}`}
            title={connected ? 'Connected' : feedError ? 'Error' : 'Stopped'}
          />
        </div>
        <button onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--fg)]">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Controls */}
      <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-2 shrink-0">
        <label className="text-[11px] text-[var(--muted)] font-mono">Interval:</label>
        <select
          value={intervalSec}
          onChange={(e) => setIntervalSec(Number(e.target.value))}
          disabled={active}
          className="text-xs py-0.5 px-1.5 bg-[var(--surface)] border border-[var(--border)] rounded font-mono text-[var(--fg)] focus:outline-none"
        >
          {INTERVALS.map((v) => (
            <option key={v} value={v}>{v}s</option>
          ))}
        </select>
        <button
          onClick={() => setActive((p) => !p)}
          className={`ml-1 flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono border transition-colors ${
            active
              ? 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'
              : 'bg-green-500/15 text-green-400 border-green-500/30 hover:bg-green-500/25'
          }`}
        >
          <Circle className={`w-2 h-2 ${active ? 'fill-red-400' : 'fill-green-400'}`} />
          {active ? 'Stop' : 'Start'}
        </button>
        <span className="ml-auto text-[10px] font-mono text-[var(--muted)]">
          +{delta.inserts} ins / ~{delta.updates} upd / -{delta.deletes} del <span className="opacity-50">60s</span>
        </span>
        <button
          onClick={clearLog}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]"
          title="Clear Log"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Event log */}
      <div className="flex-1 overflow-auto">
        {feedError && (
          <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-[11px] font-mono">
            ⚠ {feedError}
          </div>
        )}
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--muted)] gap-2">
            <Radio className="w-8 h-8 opacity-20" />
            <p className="text-xs font-mono">
              {feedError ? 'Feed stopped with an error' : active ? 'Watching for changes…' : 'Start feed to watch changes'}
            </p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[var(--bg)] z-10">
              <tr className="border-b border-[var(--border)]">
                <th className="px-2 py-1 text-[10px] font-mono text-[var(--muted)] uppercase tracking-wider">Time</th>
                <th className="px-2 py-1 text-[10px] font-mono text-[var(--muted)] uppercase tracking-wider">Op</th>
                <th className="px-2 py-1 text-[10px] font-mono text-[var(--muted)] uppercase tracking-wider">PK</th>
                <th className="px-2 py-1 text-[10px] font-mono text-[var(--muted)] uppercase tracking-wider">Summary</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, i) => (
                <EventRow key={i} ev={ev} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
