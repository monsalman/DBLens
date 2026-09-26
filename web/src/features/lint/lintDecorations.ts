import {
  EditorView,
  Decoration,
  type DecorationSet,
  hoverTooltip,
  gutter,
  GutterMarker,
} from '@codemirror/view'
import { RangeSetBuilder, type Extension, StateField } from '@codemirror/state'
import type { LintDiagnostic, QuickFix } from './lintRules'

class LintGutterMarker extends GutterMarker {
  severity: string
  constructor(severity: string) {
    super()
    this.severity = severity
  }
  toDOM() {
    const el = document.createElement('div')
    el.className = `cm-lint-gutter-marker cm-lint-gutter-${this.severity}`
    el.textContent = this.severity === 'error' ? '●' : this.severity === 'warning' ? '▲' : 'ℹ'
    el.title = `${this.severity.toUpperCase()} on this line`
    return el
  }
}

const errorMark = Decoration.mark({ class: 'cm-lint-error' })
const warningMark = Decoration.mark({ class: 'cm-lint-warning' })
const infoMark = Decoration.mark({ class: 'cm-lint-info' })

function getDecorationForSeverity(severity: string): Decoration {
  switch (severity) {
    case 'error':
      return errorMark
    case 'warning':
      return warningMark
    case 'info':
    default:
      return infoMark
  }
}

const lintTheme = EditorView.baseTheme({
  '.cm-lint-error': {
    textDecoration: 'underline wavy #ef4444 !important',
    textDecorationSkipInk: 'none',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  '.cm-lint-warning': {
    textDecoration: 'underline wavy #f59e0b !important',
    textDecorationSkipInk: 'none',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
  },
  '.cm-lint-info': {
    textDecoration: 'underline wavy #38bdf8 !important',
    textDecorationSkipInk: 'none',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  '.cm-lint-tooltip': {
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    color: '#f8fafc',
    padding: '8px 12px',
    borderRadius: '8px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
    fontSize: '12px',
    maxWidth: '380px',
    zIndex: '100',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  '.cm-lint-gutter': {
    width: '16px',
  },
  '.cm-lint-gutter-marker': {
    fontSize: '11px',
    textAlign: 'center',
    lineHeight: '1.4',
    cursor: 'pointer',
  },
  '.cm-lint-gutter-error': {
    color: '#ef4444',
  },
  '.cm-lint-gutter-warning': {
    color: '#f59e0b',
  },
  '.cm-lint-gutter-info': {
    color: '#38bdf8',
  },
})

export function createLintExtension(
  diagnostics: LintDiagnostic[],
  onApplyFix?: (fix: QuickFix) => void
): Extension {
  // 1. Mark decorations StateField
  const marksField = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state.doc.length, diagnostics)
    },
    update(decorations, tr) {
      if (tr.docChanged) {
        return decorations.map(tr.changes)
      }
      return decorations
    },
    provide: (f) => EditorView.decorations.from(f),
  })

  // 2. Hover Tooltip
  const tooltipExtension = hoverTooltip((view, pos) => {
    const docLen = view.state.doc.length
    const matching = diagnostics.find((d) => {
      const from = Math.max(0, Math.min(d.start_offset, docLen))
      const to = Math.max(from + 1, Math.min(d.end_offset, docLen))
      return pos >= from && pos <= to
    })

    if (!matching) return null

    const from = Math.max(0, Math.min(matching.start_offset, docLen))
    const to = Math.max(from + 1, Math.min(matching.end_offset, docLen))

    return {
      pos: from,
      end: to,
      above: true,
      create() {
        const dom = document.createElement('div')
        dom.className = 'cm-lint-tooltip flex flex-col gap-1.5'

        // Header: badge + rule_id
        const header = document.createElement('div')
        header.className = 'flex items-center gap-2'

        const badge = document.createElement('span')
        const sevColor =
          matching.severity === 'error'
            ? 'background: rgba(239,68,68,0.2); color: #f87171; border: 1px solid rgba(239,68,68,0.4);'
            : matching.severity === 'warning'
              ? 'background: rgba(245,158,11,0.2); color: #fbbf24; border: 1px solid rgba(245,158,11,0.4);'
              : 'background: rgba(56,189,248,0.2); color: #38bdf8; border: 1px solid rgba(56,189,248,0.4);'
        badge.style.cssText = `padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; ${sevColor}`
        badge.textContent = matching.severity

        const ruleId = document.createElement('span')
        ruleId.style.cssText = 'color: #94a3b8; font-size: 11px; font-family: monospace;'
        ruleId.textContent = matching.rule_id

        header.appendChild(badge)
        header.appendChild(ruleId)
        dom.appendChild(header)

        // Message
        const msg = document.createElement('div')
        msg.style.cssText = 'color: #e2e8f0; line-height: 1.4;'
        msg.textContent = matching.message
        dom.appendChild(msg)

        // Quick fix button
        if (matching.quick_fix && onApplyFix) {
          const btn = document.createElement('button')
          btn.style.cssText =
            'margin-top: 4px; padding: 4px 8px; border-radius: 4px; background: #3b82f6; color: #fff; font-size: 11px; font-weight: 500; border: none; cursor: pointer; display: flex; align-items: center; gap: 4px; align-self: flex-start;'
          btn.textContent = `💡 ${matching.quick_fix.title}`
          btn.onclick = (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (matching.quick_fix) {
              onApplyFix(matching.quick_fix)
            }
          }
          dom.appendChild(btn)
        }

        return { dom }
      },
    }
  })

  // 3. Gutter Markers
  const gutterExtension = gutter({
    class: 'cm-lint-gutter',
    markers(view) {
      const builder = new RangeSetBuilder<GutterMarker>()
      const lineMap = new Map<number, string>()
      const totalLines = view.state.doc.lines

      for (const d of diagnostics) {
        if (d.line > 0 && d.line <= totalLines) {
          const existing = lineMap.get(d.line)
          if (!existing || d.severity === 'error' || (d.severity === 'warning' && existing === 'info')) {
            lineMap.set(d.line, d.severity)
          }
        }
      }

      const lines = Array.from(lineMap.keys()).sort((a, b) => a - b)
      for (const lineNum of lines) {
        const line = view.state.doc.line(lineNum)
        const sev = lineMap.get(lineNum)!
        builder.add(line.from, line.from, new LintGutterMarker(sev))
      }
      return builder.finish()
    },
  })

  return [marksField, tooltipExtension, gutterExtension, lintTheme]
}

function buildDecorations(docLen: number, diagnostics: LintDiagnostic[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  if (docLen === 0 || diagnostics.length === 0) {
    return builder.finish()
  }

  // Filter and sort diagnostics
  const valid = diagnostics
    .filter((d) => d.start_offset >= 0 && d.end_offset >= d.start_offset)
    .sort((a, b) => {
      if (a.start_offset !== b.start_offset) {
        return a.start_offset - b.start_offset
      }
      return a.end_offset - b.end_offset
    })

  let lastEnd = -1

  for (const d of valid) {
    let from = Math.max(0, Math.min(d.start_offset, docLen))
    let to = Math.max(from, Math.min(d.end_offset, docLen))
    if (from === to && to < docLen) {
      to = from + 1
    }
    if (from >= to) continue

    // Prevent overlapping intervals for RangeSetBuilder
    if (from < lastEnd) {
      from = lastEnd
      if (from >= to) continue
    }

    builder.add(from, to, getDecorationForSeverity(d.severity))
    lastEnd = to
  }

  return builder.finish()
}
