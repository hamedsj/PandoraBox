import Editor, { useMonaco, type BeforeMount, type OnMount } from '@monaco-editor/react'
import { useEffect, useState } from 'react'
import { useThemeStore } from '@/store/theme'

interface CodeViewerProps {
  value: string
  language: string
  maxHeight?: number
  readOnly?: boolean
  onChange?: (value: string) => void
  minHeight?: number
  autoHeight?: boolean
}

export function CodeViewer({
  value,
  language,
  maxHeight = 420,
  readOnly = true,
  onChange,
  minHeight = 140,
  autoHeight = true,
}: CodeViewerProps) {
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
    targetMonaco.editor.defineTheme(themeName, buildMonacoTheme(mode))
  }

  useEffect(() => {
    if (!monaco || typeof window === 'undefined') return
    applyThemeDefinition(monaco)
  }, [monaco, themeName, mode, variant, accentColor, fontFamily])

  const lineHeight = Math.round(resolvedTypography.fontSize * 1.65)

  useEffect(() => {
    setEditorHeight(minHeight)
  }, [value, language, resolvedTypography.fontSize, minHeight])

  const onMount: OnMount = (editor) => {
    const syncHeight = () => {
      if (!autoHeight) {
        editor.layout({ width: editor.getLayoutInfo().width, height: maxHeight })
        return
      }
      const nextHeight = Math.max(minHeight, Math.min(editor.getContentHeight() + 2, maxHeight))
      setEditorHeight(nextHeight)
      editor.layout({ width: editor.getLayoutInfo().width, height: nextHeight })
    }

    syncHeight()
    const disposable = editor.onDidContentSizeChange(syncHeight)
    return () => disposable.dispose()
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <Editor
        key={`${themeName}-${resolvedTypography.fontFamily}-${resolvedTypography.fontSize}`}
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
          scrollBeyondLastLine: !readOnly,
          wordWrap: 'on',
          wrappingIndent: 'indent',
          automaticLayout: true,
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
          contextmenu: !readOnly,
        }}
      />
    </div>
  )
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
    rules: [],
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
