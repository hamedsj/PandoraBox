import { useRef, useCallback, useState } from 'react'
import { ChevronDown, Tag, XCircle, Plus } from 'lucide-react'
import { decodeBodyBytes, type RawBody } from '@/lib/httpBodies'
import type { Request } from '@/api/client'

interface Props {
  value: string
  onChange: (v: string) => void
  request?: Request  // for Auto-Mark context
}

/** Escape HTML special chars for the overlay div */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Convert raw string with §...§ markers to HTML with highlighted spans */
function highlightMarkers(raw: string): string {
  const parts: string[] = []
  let i = 0
  let markerIndex = 0
  while (i < raw.length) {
    if (raw[i] === '§') {
      const close = raw.indexOf('§', i + 1)
      if (close === -1) {
        parts.push(escapeHtml(raw[i]))
        i++
        continue
      }
      markerIndex++
      const inner = escapeHtml(raw.slice(i, close + 1))
      parts.push(
        `<mark class="intruder-marker" data-marker="${markerIndex}" style="background:rgba(251,191,36,0.25);border-radius:2px;color:rgb(251,191,36);outline:1px solid rgba(251,191,36,0.5)">${inner}</mark>`
      )
      i = close + 1
    } else {
      // collect plain chars
      const start = i
      while (i < raw.length && raw[i] !== '§') i++
      parts.push(escapeHtml(raw.slice(start, i)))
    }
  }
  return parts.join('').replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')
}

const AUTO_MARK_OPTIONS = [
  { id: 'query', label: 'Query Parameters' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'json', label: 'JSON Body Values' },
  { id: 'form', label: 'Form Body Values' },
]

function autoMarkQuery(raw: string): string {
  return raw.replace(/(\?|&)([^=&\s]+)=([^&\s\r\n]*)/g, (_, sep, key, val) => {
    return `${sep}${key}=§${val}§`
  })
}

function autoMarkCookies(raw: string): string {
  // Find Cookie: header line and wrap each value
  return raw.replace(/^(Cookie:\s*)(.+)$/im, (_, prefix, cookieStr) => {
    const marked = cookieStr.replace(/([^=;\s]+)=([^;\s]*)/g, (_: string, k: string, v: string) => `${k}=§${v}§`)
    return `${prefix}${marked}`
  })
}

function autoMarkJson(raw: string): string {
  // Find JSON body (after double CRLF/LF) and mark leaf string/number values
  const sep = raw.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n'
  const idx = raw.indexOf(sep)
  if (idx === -1) return raw
  const headers = raw.slice(0, idx + sep.length)
  const body = raw.slice(idx + sep.length)
  try {
    const obj = JSON.parse(body)
    const marked = JSON.stringify(obj, (_, v) => {
      if (typeof v === 'string' || typeof v === 'number') return `§${v}§`
      return v
    }, 2)
    return headers + marked
  } catch {
    return raw
  }
}

function autoMarkForm(raw: string): string {
  const sep = raw.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n'
  const idx = raw.indexOf(sep)
  if (idx === -1) return raw
  const headers = raw.slice(0, idx + sep.length)
  const body = raw.slice(idx + sep.length)
  const marked = body.replace(/([^=&\s]+)=([^&\s]*)/g, (_, k, v) => `${k}=§${v}§`)
  return headers + marked
}

export function RawEditor({ value, onChange }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showAutoMark, setShowAutoMark] = useState(false)

  const highlighted = highlightMarkers(value)

  const handleAutoMark = useCallback((option: string) => {
    setShowAutoMark(false)
    let next = value
    if (option === 'query') next = autoMarkQuery(value)
    else if (option === 'cookies') next = autoMarkCookies(value)
    else if (option === 'json') next = autoMarkJson(value)
    else if (option === 'form') next = autoMarkForm(value)
    onChange(next)
  }, [value, onChange])

  const handleClearMarkers = useCallback(() => {
    onChange(value.replace(/§([^§]*)§/g, '$1'))
  }, [value, onChange])

  const handleAddMark = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart: start, selectionEnd: end } = ta
    const next = value.slice(0, start) + '§' + value.slice(start, end) + '§' + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      ta.selectionStart = start + 1
      ta.selectionEnd = end + 1
      ta.focus()
    })
  }, [value, onChange])

  // Ctrl+M or Cmd+M: wrap selection in §§
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
      e.preventDefault()
      handleAddMark()
    }
  }, [handleAddMark])

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowAutoMark((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:border-zinc-500 transition-colors"
          >
            <Tag size={12} />
            Auto-Mark
            <ChevronDown size={10} />
          </button>
          {showAutoMark && (
            <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-border bg-card shadow-lg py-1">
              {AUTO_MARK_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleAutoMark(opt.id)}
                  className="flex w-full items-center px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleAddMark}
          title="Wrap selection in §§ markers (⌘M)"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:border-zinc-500 transition-colors"
        >
          <Plus size={12} />
          Add Mark
        </button>

        <button
          type="button"
          onClick={handleClearMarkers}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:border-zinc-500 transition-colors"
        >
          <XCircle size={12} />
          Clear Markers
        </button>

        <span className="text-xs text-muted-foreground ml-auto">
          Tip: select text and press <kbd className="px-1 py-0.5 rounded bg-muted text-xs font-mono">⌘M</kbd> to mark
        </span>
      </div>

      {/* Editor area */}
      <div className="relative flex-1 min-h-0 rounded-md border border-border overflow-hidden font-mono text-xs">
        {/* Highlight overlay */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none overflow-auto whitespace-pre-wrap break-all p-3 leading-relaxed text-transparent"
          style={{ fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' }}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
        {/* Real textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="absolute inset-0 w-full h-full bg-transparent text-foreground p-3 leading-relaxed resize-none focus:outline-none caret-foreground"
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', lineHeight: '1.6' }}
        />
      </div>
    </div>
  )
}
