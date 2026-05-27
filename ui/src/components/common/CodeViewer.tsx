import Editor, { useMonaco, type BeforeMount, type OnMount } from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'
import type { editor as MonacoEditorNS } from 'monaco-editor'
import { useThemeStore } from '@/store/theme'
import { registerHttpLanguage, httpTokenRules } from '@/lib/httpLanguage'
import type { HighlightSpec } from '@/components/common/Highlight'

interface CodeViewerProps {
  value: string
  language: string
  maxHeight?: number
  readOnly?: boolean
  onChange?: (value: string) => void
  minHeight?: number
  autoHeight?: boolean
  scrollBeyondLastLine?: boolean
  extraBottomLines?: number
  wordWrap?: 'on' | 'off'
  /** When set, matches are highlighted and the first one is revealed. */
  highlight?: HighlightSpec | null
  /** Receives the underlying editor instance (e.g. for cursor inserts). */
  onEditorMount?: (editor: MonacoEditorNS.IStandaloneCodeEditor) => void
  /** Show Monaco's native right-click menu. Defaults to editable mode only. */
  contextMenu?: boolean
  /** When set, Ctrl/Cmd+F inside the editor calls this instead of opening
   *  Monaco's built-in find widget. */
  onRequestFind?: () => void
  /** Stable key under which the editor's scroll/cursor (view state) is cached,
   *  so it survives unmount/remount (e.g. navigating away and back). */
  viewStateKey?: string
}

// Bounded cache of editor view states (scroll position, cursor, folding),
// keyed by a caller-provided id. Restored on remount for the same key.
const viewStateCache = new Map<string, MonacoEditorNS.ICodeEditorViewState>()
function rememberViewState(key: string, state: MonacoEditorNS.ICodeEditorViewState | null) {
  if (!state) return
  viewStateCache.delete(key)
  viewStateCache.set(key, state)
  if (viewStateCache.size > 60) {
    const oldest = viewStateCache.keys().next().value
    if (oldest !== undefined) viewStateCache.delete(oldest)
  }
}

type ConverterSelectionDetail = {
  text: string
  x: number
  y: number
  canReplace?: boolean
  replaceSelection?: (nextText: string) => void
}

export function CodeViewer({
  value,
  language,
  maxHeight = 420,
  readOnly = true,
  onChange,
  minHeight = 140,
  autoHeight = true,
  scrollBeyondLastLine = !readOnly,
  extraBottomLines = 0,
  wordWrap = 'on',
  highlight,
  onEditorMount,
  contextMenu = !readOnly,
  onRequestFind,
  viewStateKey,
}: CodeViewerProps) {
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null)
  const decorationsRef = useRef<MonacoEditorNS.IEditorDecorationsCollection | null>(null)
  const onRequestFindRef = useRef(onRequestFind)
  onRequestFindRef.current = onRequestFind
  const [mountTick, setMountTick] = useState(0)
  const mode = useThemeStore((state) => state.mode)
  const variant = useThemeStore((state) => state.variant)
  const accentColor = useThemeStore((state) => state.accentColor)
  const fontSize = useThemeStore((state) => state.fontSize)
  const fontFamily = useThemeStore((state) => state.fontFamily)
  const monaco = useMonaco()
  const themeName = mode === 'dark' ? 'pandora-dark' : 'pandora-light'
  const resolvedTypography = getResolvedTypography(fontSize)
  const [editorHeight, setEditorHeight] = useState<number>(minHeight)
  const applyThemeDefinition = (targetMonaco: Parameters<NonNullable<BeforeMount>>[0]) => {
    registerHttpLanguage(targetMonaco)
    targetMonaco.editor.defineTheme(themeName, buildMonacoTheme(mode))
  }

  // Re-define and re-apply the theme in place when mode/accent changes, instead
  // of remounting the editor (which flashes and loses scroll/find state).
  useEffect(() => {
    if (!monaco || typeof window === 'undefined') return
    applyThemeDefinition(monaco)
    monaco.editor.setTheme(themeName)
  }, [monaco, themeName, mode, variant, accentColor, fontFamily])

  const lineHeight = Math.round(resolvedTypography.fontSize * 1.65)

  // Apply font changes live via updateOptions rather than remounting.
  useEffect(() => {
    editorRef.current?.updateOptions({
      fontSize: resolvedTypography.fontSize,
      fontFamily: resolvedTypography.fontFamily,
      lineHeight,
    })
  }, [resolvedTypography.fontSize, resolvedTypography.fontFamily, lineHeight])

  useEffect(() => {
    setEditorHeight(minHeight)
  }, [language, resolvedTypography.fontSize, minHeight])

  const onMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor
    decorationsRef.current = null
    setMountTick((t) => t + 1)
    onEditorMount?.(editor)

    // Replace Monaco's built-in find widget with the app's own search when the
    // host provides one (Ctrl/Cmd+F). The ref keeps it from going stale.
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyF, () => {
      if (onRequestFindRef.current) onRequestFindRef.current()
      else editor.getAction('actions.find')?.run()
    })

    const emitSelection = () => {
      const model = editor.getModel()
      const selection = editor.getSelection()
      if (!model || !selection || selection.isEmpty()) {
        dispatchConverterSelection(null)
        return
      }

      const text = model.getValueInRange(selection)
      if (!text.trim()) {
        dispatchConverterSelection(null)
        return
      }

      const endPos = selection.getEndPosition()
      const visiblePos = editor.getScrolledVisiblePosition(endPos)
      const node = editor.getDomNode()
      if (!visiblePos || !node) {
        dispatchConverterSelection(null)
        return
      }

      const rect = node.getBoundingClientRect()
      dispatchConverterSelection({
        text: text.slice(0, 25000),
        x: rect.left + visiblePos.left,
        y: rect.top + visiblePos.top + visiblePos.height + 8,
        canReplace: !readOnly,
        replaceSelection: !readOnly
          ? (nextText: string) => {
              const liveModel = editor.getModel()
              const liveSelection = editor.getSelection()
              if (!liveModel || !liveSelection) return
              editor.executeEdits('converter-replace', [{
                range: liveSelection,
                text: nextText,
                forceMoveMarkers: true,
              }])
              onChange?.(liveModel.getValue())
              editor.focus()
            }
          : undefined,
      })
    }

    const syncHeight = () => {
      if (!autoHeight) {
        editor.layout({ width: editor.getLayoutInfo().width, height: maxHeight })
        return
      }
      const spareHeight = Math.max(0, extraBottomLines) * lineHeight
      const nextHeight = Math.max(minHeight, Math.min(editor.getContentHeight() + spareHeight + 2, maxHeight))
      setEditorHeight(nextHeight)
      editor.layout({ width: editor.getLayoutInfo().width, height: nextHeight })
    }

    syncHeight()
    const disposable = editor.onDidContentSizeChange(syncHeight)
    const selectionDisposable = editor.onDidChangeCursorSelection(emitSelection)
    const blurDisposable = editor.onDidBlurEditorText(() => dispatchConverterSelection(null))
    editor.onDidDispose(() => {
      disposable.dispose()
      selectionDisposable.dispose()
      blurDisposable.dispose()
    })
  }

  // Restore scroll/cursor on (re)mount and persist it on unmount / key change.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !viewStateKey) return
    const cached = viewStateCache.get(viewStateKey)
    if (cached) editor.restoreViewState(cached)
    return () => {
      rememberViewState(viewStateKey, editor.saveViewState())
    }
  }, [viewStateKey, mountTick])

  // Highlight + reveal search matches inside the editor.
  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) return
    if (!decorationsRef.current) decorationsRef.current = editor.createDecorationsCollection()
    const collection = decorationsRef.current

    if (!highlight || !highlight.term) {
      collection.clear()
      return
    }
    let matches: MonacoEditorNS.FindMatch[] = []
    try {
      matches = model.findMatches(highlight.term, true, highlight.useRegex, !highlight.caseInsensitive, null, false)
    } catch {
      collection.clear()
      return
    }
    collection.set(matches.map((m) => ({ range: m.range, options: { inlineClassName: 'pandora-search-hit' } })))
    if (matches.length > 0) editor.revealRangeInCenterIfOutsideViewport(matches[0].range)
    // Depend on the spec's primitive fields, not the object: re-revealing on every
    // render would fight the user's scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, highlight?.term, highlight?.caseInsensitive, highlight?.useRegex, mountTick])

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <Editor
        beforeMount={applyThemeDefinition}
        onMount={onMount}
        height={`${autoHeight ? editorHeight : maxHeight}px`}
        language={language}
        value={value}
        onChange={(next) => onChange?.(next ?? '')}
        theme={themeName}
        options={{
          readOnly,
          domReadOnly: readOnly,
          minimap: { enabled: false },
          lineNumbers: 'on',
          glyphMargin: false,
          folding: true,
          scrollBeyondLastLine,
          wordWrap,
          wrappingIndent: 'indent',
          automaticLayout: true,
          // Render find/hover/suggest popups in a body-level portal so they are
          // not clipped by the editor's rounded overflow-hidden wrapper.
          fixedOverflowWidgets: true,
          fontSize: resolvedTypography.fontSize,
          lineHeight,
          fontFamily: resolvedTypography.fontFamily,
          padding: { top: 14, bottom: 14 },
          renderLineHighlight: readOnly ? 'none' : 'line',
          overviewRulerLanes: 0,
          lineDecorationsWidth: 8,
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
            alwaysConsumeMouseWheel: false,
          },
          contextmenu: contextMenu,
        }}
      />
    </div>
  )
}

function dispatchConverterSelection(detail: ConverterSelectionDetail | null) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('pandora:converter-selection', { detail }))
}

function cssHslVarToHex(value: string, fallback: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  const match = normalized.match(/^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/)
  if (!match) return fallback

  const h = Number(match[1])
  const s = Number(match[2]) / 100
  const l = Number(match[3]) / 100

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  let r = 0
  let g = 0
  let b = 0

  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }

  return rgbToHex(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  )
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function withAlpha(hex: string, alpha: string): string {
  return `${hex}${alpha}`
}

function buildMonacoTheme(mode: 'dark' | 'light') {
  const styles = typeof window !== 'undefined'
    ? window.getComputedStyle(document.documentElement)
    : null

  const background = cssHslVarToHex(styles?.getPropertyValue('--background') ?? '', mode === 'dark' ? '#0f1117' : '#ffffff')
  const card = cssHslVarToHex(styles?.getPropertyValue('--card') ?? '', mode === 'dark' ? '#151923' : '#f8fafc')
  const foreground = cssHslVarToHex(styles?.getPropertyValue('--foreground') ?? '', mode === 'dark' ? '#e5e7eb' : '#111827')
  const border = cssHslVarToHex(styles?.getPropertyValue('--border') ?? '', mode === 'dark' ? '#2a3140' : '#d8e0ea')
  const primary = cssHslVarToHex(styles?.getPropertyValue('--primary') ?? '', mode === 'dark' ? '#2dd4bf' : '#0f766e')
  const muted = cssHslVarToHex(styles?.getPropertyValue('--muted') ?? '', mode === 'dark' ? '#1b2230' : '#eef2f7')
  const mutedForeground = cssHslVarToHex(styles?.getPropertyValue('--muted-foreground') ?? '', mode === 'dark' ? '#94a3b8' : '#64748b')

  return {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: httpTokenRules(mode),
    colors: {
      'editor.background': card,
      'editor.foreground': foreground,
      'editorLineNumber.foreground': mutedForeground,
      'editorLineNumber.activeForeground': primary,
      'editorCursor.foreground': primary,
      'editor.selectionBackground': withAlpha(primary, mode === 'dark' ? '33' : '22'),
      'editor.inactiveSelectionBackground': withAlpha(primary, mode === 'dark' ? '1f' : '18'),
      'editor.lineHighlightBackground': withAlpha(muted, mode === 'dark' ? 'aa' : 'cc'),
      'editorLineNumber.dimmedForeground': withAlpha(mutedForeground, '88'),
      'editorGutter.background': card,
      'editorIndentGuide.background1': withAlpha(border, mode === 'dark' ? '90' : '70'),
      'editorIndentGuide.activeBackground1': withAlpha(primary, mode === 'dark' ? '80' : '66'),
      'editorWhitespace.foreground': withAlpha(mutedForeground, '55'),
      'editorBracketMatch.background': withAlpha(primary, mode === 'dark' ? '22' : '16'),
      'editorBracketMatch.border': withAlpha(primary, mode === 'dark' ? '99' : '88'),
      'editorWidget.background': background,
      'editorWidget.border': border,
      'editorHoverWidget.background': background,
      'editorHoverWidget.border': border,
      'scrollbarSlider.background': withAlpha(mutedForeground, mode === 'dark' ? '40' : '30'),
      'scrollbarSlider.hoverBackground': withAlpha(primary, mode === 'dark' ? '55' : '44'),
      'scrollbarSlider.activeBackground': withAlpha(primary, mode === 'dark' ? '70' : '5a'),
    },
  }
}

function getResolvedTypography(fallbackFontSize: number): { fontSize: number; fontFamily: string } {
  if (typeof window === 'undefined') {
    return {
      fontSize: fallbackFontSize,
      fontFamily: 'monospace',
    }
  }

  const styles = window.getComputedStyle(document.documentElement)
  const sizeValue = styles.getPropertyValue('--font-size-base').trim()
  const familyValue = styles.getPropertyValue('--font-mono').trim()
  const parsedSize = Number.parseFloat(sizeValue)

  return {
    fontSize: Number.isFinite(parsedSize) ? parsedSize : fallbackFontSize,
    fontFamily: familyValue || 'monospace',
  }
}
