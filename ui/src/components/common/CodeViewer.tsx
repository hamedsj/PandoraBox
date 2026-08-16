import { useEffect, useRef } from 'react'
import { EditorState, Compartment, type Extension, StateEffect, StateField } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  Decoration,
  type DecorationSet,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { search, searchKeymap, openSearchPanel } from '@codemirror/search'
import { useThemeStore } from '@/store/theme'
import { languageExtension, pandoraHighlight } from '@/lib/cmHttpLanguage'
import type { HighlightSpec } from '@/components/common/Highlight'

/**
 * Small, stable surface consumers use to poke the editor (insert a file at the
 * cursor, read the selection, focus). Replaces the raw Monaco editor instance
 * the old CodeViewer exposed, so callers never depend on the editor library.
 */
export interface EditorHandle {
  getValue(): string
  getSelectionText(): string
  /** Replace the current selection (or insert at the cursor), then focus. */
  replaceSelection(text: string): void
  focus(): void
}

interface CodeViewerProps {
  value: string
  language: string
  maxHeight?: number
  readOnly?: boolean
  onChange?: (value: string) => void
  minHeight?: number
  autoHeight?: boolean
  /** Fill the parent's height (parent must have a bounded height). Overrides
   *  autoHeight/maxHeight — used where the editor owns a flex pane. */
  fill?: boolean
  /** Grow to full content height with no internal scrollbar, letting the parent
   *  be the single scroll container. Overrides autoHeight/maxHeight. */
  flow?: boolean
  scrollBeyondLastLine?: boolean
  extraBottomLines?: number
  wordWrap?: 'on' | 'off'
  /** When set, matches are highlighted and the first one is revealed. */
  highlight?: HighlightSpec | null
  /** Receives a stable handle to the editor (e.g. for cursor inserts). */
  onEditorMount?: (handle: EditorHandle) => void
  /** Kept for API compatibility; CodeMirror uses the browser's native menu. */
  contextMenu?: boolean
  /** Ctrl/Cmd+F inside the editor calls this instead of the built-in search. */
  onRequestFind?: () => void
  /** Stable key under which the scroll position is cached across remounts. */
  viewStateKey?: string
}

// Bounded cache of scroll positions, keyed by a caller-provided id.
const scrollCache = new Map<string, number>()
function rememberScroll(key: string, top: number) {
  scrollCache.delete(key)
  scrollCache.set(key, top)
  if (scrollCache.size > 60) {
    const oldest = scrollCache.keys().next().value
    if (oldest !== undefined) scrollCache.delete(oldest)
  }
}

type ConverterSelectionDetail = {
  text: string
  x: number
  y: number
  canReplace?: boolean
  replaceSelection?: (nextText: string) => void
  reason?: 'select' | 'cleared' | 'blur'
}

// ── Search-highlight decorations ──────────────────────────────────────────────
const setHighlight = StateEffect.define<{ term: string; caseInsensitive: boolean; useRegex: boolean } | null>()
const highlightMark = Decoration.mark({ class: 'pandora-search-hit' })

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setHighlight)) continue
      const spec = effect.value
      if (!spec || !spec.term) return Decoration.none
      const text = tr.state.doc.toString()
      const ranges: { from: number; to: number }[] = []
      try {
        if (spec.useRegex) {
          const flags = spec.caseInsensitive ? 'gi' : 'g'
          const re = new RegExp(spec.term, flags)
          let m: RegExpExecArray | null
          while ((m = re.exec(text)) !== null) {
            if (m[0].length === 0) { re.lastIndex++; continue }
            ranges.push({ from: m.index, to: m.index + m[0].length })
          }
        } else {
          const hay = spec.caseInsensitive ? text.toLowerCase() : text
          const needle = spec.caseInsensitive ? spec.term.toLowerCase() : spec.term
          let idx = hay.indexOf(needle)
          while (idx !== -1) {
            ranges.push({ from: idx, to: idx + needle.length })
            idx = hay.indexOf(needle, idx + needle.length)
          }
        }
      } catch {
        return Decoration.none
      }
      return Decoration.set(ranges.map((r) => highlightMark.range(r.from, r.to)))
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

// ── Instance theme (fully CSS-variable driven, so it follows the app theme) ────
function instanceTheme(opts: { readOnly: boolean; autoHeight: boolean; fill: boolean; flow: boolean; minHeight: number; maxHeight: number }): Extension {
  const { readOnly, autoHeight, fill, flow, minHeight, maxHeight } = opts
  // flow: grow to full content height with NO internal scrollbar, so the parent
  //       is the single scroll container. CodeMirror still virtualizes to the
  //       visible slice, so large bodies stay cheap.
  // fill: occupy the parent's bounded height and scroll internally.
  // autoHeight: grow to content up to maxHeight, then scroll internally.
  return EditorView.theme({
    '&': {
      color: 'hsl(var(--foreground))',
      backgroundColor: 'hsl(var(--card))',
      // Dedicated editor size (Settings › Editor Font Size), a touch denser than
      // the UI base so code sits in tune with the surrounding text.
      fontSize: 'var(--editor-font-size, 13px)',
      borderRadius: '0.75rem',
      ...(fill ? { height: '100%' } : flow ? {} : autoHeight ? {} : { height: `${maxHeight}px` }),
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono, monospace)',
      lineHeight: '1.55',
      // Crisp glyphs + tasteful mono ligatures, matching the app's code feel.
      fontVariantLigatures: 'contextual',
      fontFeatureSettings: '"calt" 1',
      '-webkit-font-smoothing': 'antialiased',
      overflow: flow ? 'visible' : 'auto',
      ...(flow
        ? { minHeight: `${minHeight}px` }
        : fill
          ? {}
          : autoHeight
            ? { maxHeight: `${maxHeight}px`, minHeight: `${minHeight}px` }
            : {}),
    },
    '.cm-content': {
      padding: '12px 0',
      caretColor: 'hsl(var(--primary))',
    },
    // A little breathing room between the gutter and the code.
    '.cm-line': { padding: '0 4px 0 8px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'hsl(var(--primary))', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'hsl(var(--primary) / 0.25)',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'hsl(var(--muted-foreground))',
      border: 'none',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 12px',
      minWidth: '2.5ch',
      // Line numbers recede so the code is the focus.
      color: 'hsl(var(--muted-foreground) / 0.5)',
      fontSize: '0.92em',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'hsl(var(--primary))' },
    '.cm-activeLine': { backgroundColor: readOnly ? 'transparent' : 'hsl(var(--muted) / 0.45)' },
    '.cm-matchingBracket': {
      backgroundColor: 'hsl(var(--primary) / 0.18)',
      outline: '1px solid hsl(var(--primary) / 0.5)',
    },
    '.pandora-search-hit': {
      backgroundColor: 'hsl(var(--primary) / 0.28)',
      borderRadius: '2px',
    },
    '.cm-selectionMatch': { backgroundColor: 'hsl(var(--primary) / 0.12)' },
    '&.cm-editor.cm-focused': { outline: 'none' },
    '.cm-scroller::-webkit-scrollbar': { width: '10px', height: '10px' },
    '.cm-scroller::-webkit-scrollbar-thumb': {
      backgroundColor: 'hsl(var(--muted-foreground) / 0.35)',
      borderRadius: '5px',
    },
    '.cm-scroller::-webkit-scrollbar-thumb:hover': { backgroundColor: 'hsl(var(--primary) / 0.5)' },
  }, { dark: useThemeStore.getState().mode === 'dark' })
}

export function CodeViewer({
  value,
  language,
  maxHeight = 420,
  readOnly = true,
  onChange,
  minHeight = 140,
  autoHeight = true,
  fill = false,
  flow = false,
  wordWrap = 'on',
  highlight,
  onEditorMount,
  onRequestFind,
  viewStateKey,
}: CodeViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onRequestFindRef = useRef(onRequestFind)
  onRequestFindRef.current = onRequestFind
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  // Theme fields that force a theme/highlight reconfigure when changed.
  const mode = useThemeStore((s) => s.mode)
  const variant = useThemeStore((s) => s.variant)
  const accentColor = useThemeStore((s) => s.accentColor)
  const editorFontSize = useThemeStore((s) => s.editorFontSize)
  const fontFamily = useThemeStore((s) => s.fontFamily)

  // Compartments for the pieces we reconfigure without rebuilding the editor.
  const langComp = useRef(new Compartment())
  const wrapComp = useRef(new Compartment())
  const themeComp = useRef(new Compartment())
  const hlStyleComp = useRef(new Compartment())
  const editableComp = useRef(new Compartment())

  // Build the editor once.
  useEffect(() => {
    if (!containerRef.current) return

    const emitSelection = (view: EditorView) => {
      const sel = view.state.selection.main
      if (sel.empty) {
        dispatchConverterCleared()
        return
      }
      const text = view.state.sliceDoc(sel.from, sel.to)
      if (!text.trim()) {
        dispatchConverterCleared()
        return
      }
      const coords = view.coordsAtPos(sel.head) ?? view.coordsAtPos(sel.to)
      if (!coords) {
        dispatchConverterCleared()
        return
      }
      dispatchConverterSelection({
        reason: 'select',
        text: text.slice(0, 25000),
        x: coords.left,
        y: coords.bottom + 8,
        canReplace: !readOnlyRef.current,
        replaceSelection: !readOnlyRef.current
          ? (nextText: string) => {
              const live = view.state.selection.main
              view.dispatch({
                changes: { from: live.from, to: live.to, insert: nextText },
                selection: { anchor: live.from + nextText.length },
              })
              onChangeRef.current?.(view.state.doc.toString())
              view.focus()
            }
          : undefined,
      })
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current?.(update.state.doc.toString())
      }
      if (update.selectionSet) {
        emitSelection(update.view)
      }
    })

    const findKeymap = keymap.of([
      {
        key: 'Mod-f',
        run: (view) => {
          if (onRequestFindRef.current) {
            onRequestFindRef.current()
            return true
          }
          return openSearchPanel(view)
        },
      },
    ])

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      history(),
      bracketMatching(),
      indentOnInput(),
      search({ top: true }),
      highlightField,
      findKeymap,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      updateListener,
      hlStyleComp.current.of(pandoraHighlight(mode)),
      langComp.current.of(languageExtension(language) ?? []),
      wrapComp.current.of(wordWrap === 'on' ? EditorView.lineWrapping : []),
      themeComp.current.of(instanceTheme({ readOnly, autoHeight, fill, flow, minHeight, maxHeight })),
      editableComp.current.of([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
      EditorView.domEventHandlers({
        blur: () => { dispatchConverterBlur(); return false },
      }),
    ]

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: containerRef.current,
    })
    viewRef.current = view

    // Restore cached scroll for this key.
    if (viewStateKey) {
      const cached = scrollCache.get(viewStateKey)
      if (cached != null) view.scrollDOM.scrollTop = cached
    }

    const handle: EditorHandle = {
      getValue: () => view.state.doc.toString(),
      getSelectionText: () => {
        const sel = view.state.selection.main
        return sel.empty ? '' : view.state.sliceDoc(sel.from, sel.to)
      },
      replaceSelection: (text: string) => {
        const sel = view.state.selection.main
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length },
        })
        onChangeRef.current?.(view.state.doc.toString())
        view.focus()
      },
      focus: () => view.focus(),
    }
    onEditorMount?.(handle)

    return () => {
      if (viewStateKey) rememberScroll(viewStateKey, view.scrollDOM.scrollTop)
      view.destroy()
      viewRef.current = null
    }
    // Build once; live changes flow through the compartment effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the document in sync when the value prop changes externally.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }, [value])

  // Language.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: langComp.current.reconfigure(languageExtension(language) ?? []) })
  }, [language])

  // Word wrap.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: wrapComp.current.reconfigure(wordWrap === 'on' ? EditorView.lineWrapping : []) })
  }, [wordWrap])

  // Read-only.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableComp.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    })
  }, [readOnly])

  // Theme + token highlight follow app mode/accent/font changes.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: [
        themeComp.current.reconfigure(instanceTheme({ readOnly, autoHeight, fill, flow, minHeight, maxHeight })),
        hlStyleComp.current.reconfigure(pandoraHighlight(mode)),
      ],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, variant, accentColor, editorFontSize, fontFamily, readOnly, autoHeight, fill, flow, minHeight, maxHeight])

  // Search highlight decorations + reveal first match.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: setHighlight.of(
        highlight && highlight.term
          ? { term: highlight.term, caseInsensitive: !!highlight.caseInsensitive, useRegex: !!highlight.useRegex }
          : null,
      ),
    })
    // Reveal the first match.
    if (highlight?.term) {
      const first = view.state.field(highlightField, false)?.iter()
      if (first && first.value) {
        view.dispatch({ effects: EditorView.scrollIntoView(first.from, { y: 'center' }) })
      }
    }
  }, [value, highlight?.term, highlight?.caseInsensitive, highlight?.useRegex])

  return <div ref={containerRef} className={`overflow-hidden rounded-lg border border-border/60 bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]${fill ? ' h-full' : ''}`} />
}

function dispatchConverterSelection(detail: ConverterSelectionDetail | null) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('pandora:converter-selection', { detail }))
}

// Selection cleared inside the editor — listeners should dismiss the popup.
function dispatchConverterCleared() {
  dispatchConverterSelection({ reason: 'cleared', text: '', x: 0, y: 0 })
}

// Editor lost focus (also fires when clicking INTO the popup) — do NOT dismiss.
function dispatchConverterBlur() {
  dispatchConverterSelection({ reason: 'blur', text: '', x: 0, y: 0 })
}
