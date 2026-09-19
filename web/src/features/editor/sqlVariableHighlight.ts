import {
  EditorView,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

const varDecoration = Decoration.mark({
  class: 'cm-sql-variable',
})

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const tree = syntaxTree(view.state)
  const regex = /(?:(?<!:):[a-zA-Z_]\w*(?!:)|{{[ \t]*[a-zA-Z_]\w*[ \t]*}})/g

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to)
    regex.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
      const matchFrom = from + match.index
      const matchTo = matchFrom + match[0].length

      // Skip variables inside single-quoted strings or comments
      const node = tree.resolveInner(matchFrom, 1)
      if (node.name === 'String' || node.name === 'LineComment' || node.name === 'BlockComment') {
        continue
      }

      builder.add(matchFrom, matchTo, varDecoration)
    }
  }

  return builder.finish()
}

const sqlVariableHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
)

const sqlVariableTheme = EditorView.baseTheme({
  '.cm-sql-variable': {
    color: '#38bdf8 !important', // Tailwind sky-400
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    borderRadius: '3px',
    padding: '1px 3px',
    border: '1px solid rgba(56, 189, 248, 0.35)',
    fontWeight: '600',
    fontStyle: 'normal',
  },
})

export const sqlVariableHighlight: Extension = [
  sqlVariableHighlightPlugin,
  sqlVariableTheme,
]
