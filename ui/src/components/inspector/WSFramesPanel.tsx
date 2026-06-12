import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { ChevronDown, Copy, CaseSensitive, Regex } from 'lucide-react'
import { copyText } from '@/lib/clipboard'
import { useProxyStore } from '@/store/proxy'
import type { WebSocketFrame, WebSocketSession } from '@/api/client'
import { cn } from '@/lib/utils'
import { hexDump } from '@/lib/hex'
import { Highlight, buildHighlightRegex, type HighlightSpec } from '@/components/common/Highlight'

type PayloadTab = 'string' | 'hex' | 'base64' | 'raw'

type PayloadStringView = {
  available: boolean
  value: string
  label: string
}

type PayloadViews = {
  bytes: Uint8Array
  hex: string
  base64: string
  raw: string
  string: PayloadStringView
}

function payloadToBytes(payload: WebSocketFrame['payload']): Uint8Array {
  if (!payload) return new Uint8Array()
  if (Array.isArray(payload)) return Uint8Array.from(payload)
  return Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
}

function encodeBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''

  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function decodeUtf8(bytes: Uint8Array, fatal = false): string | null {
  try {
    return new TextDecoder('utf-8', { fatal }).decode(bytes)
  } catch {
    return null
  }
}

function decodeClosePayload(bytes: Uint8Array): string {
  if (bytes.length === 0) return '[no close payload]'
  if (bytes.length < 2) return '[invalid close payload]'

  const code = (bytes[0] << 8) | bytes[1]
  const reasonBytes = bytes.slice(2)
  const reason = decodeUtf8(reasonBytes, true)

  if (reason === null) return `code=${code} reason=[invalid utf-8]`
  return reason ? `code=${code} reason=${reason}` : `code=${code}`
}

function buildStringView(frame: WebSocketFrame, bytes: Uint8Array): PayloadStringView {
  if (bytes.length === 0) {
    return {
      available: true,
      value: '',
      label: 'Empty payload',
    }
  }

  if (frame.opcode === 8) {
    return {
      available: true,
      value: decodeClosePayload(bytes),
      label: 'WebSocket close payload',
    }
  }

  const utf8 = decodeUtf8(bytes, true)
  if (utf8 !== null) {
    return {
      available: true,
      value: utf8,
      label: 'Strict UTF-8',
    }
  }

  return {
    available: false,
    value: '',
    label: 'Payload is not strict UTF-8 text',
  }
}

function rawBytesView(bytes: Uint8Array): string {
  return JSON.stringify(Array.from(bytes))
}

// Payload views (hex/base64/raw/string) are derived from immutable frame bytes,
// so cache them per frame object. Without this, every keystroke in the search
// box rebuilt hex + base64 + raw for every frame.
const viewsCache = new WeakMap<WebSocketFrame, PayloadViews>()

function getPayloadViews(frame: WebSocketFrame): PayloadViews {
  const cached = viewsCache.get(frame)
  if (cached) return cached
  const bytes = payloadToBytes(frame.payload)
  const views: PayloadViews = {
    bytes,
    hex: hexDump(bytes).text,
    base64: encodeBase64(bytes),
    raw: rawBytesView(bytes),
    string: buildStringView(frame, bytes),
  }
  viewsCache.set(frame, views)
  return views
}

function buildSearchableText(frame: WebSocketFrame, views: PayloadViews): string {
  const parts = [
    views.hex,
    views.base64,
    views.raw,
    opcodeName(frame.opcode),
    frame.direction,
  ]

  if (views.string.available) {
    parts.push(views.string.value)
  }

  return parts.join('\n')
}

function buildPreview(frame: WebSocketFrame, views: PayloadViews): string {
  if (frame.opcode === 8) {
    return views.string.value
  }

  if (frame.opcode === 1 && views.string.available) {
    const singleLine = views.string.value.replace(/\s+/g, ' ').trim()
    return singleLine || 'Empty text payload'
  }

  if (views.bytes.length === 0) {
    return 'Empty payload'
  }

  return `Binary payload · ${formatBytes(views.bytes.length)}`
}

function defaultTabForFrame(frame: WebSocketFrame, views: PayloadViews): PayloadTab {
  if ((frame.opcode === 1 || frame.opcode === 8) && views.string.available) return 'string'
  return 'hex'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

function formatTime(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return 'unknown'
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

function opcodeName(op: number): string {
  switch (op) {
    case 0: return 'CONT'
    case 1: return 'TEXT'
    case 2: return 'BIN'
    case 8: return 'CLOSE'
    case 9: return 'PING'
    case 10: return 'PONG'
    default: return `OP${op}`
  }
}

function opcodeClass(op: number): string {
  switch (op) {
    case 1: return 'bg-primary/10 text-primary border-primary/20'
    case 2: return 'bg-amber-500/12 text-amber-400 border-amber-500/25'
    case 8: return 'bg-red-500/12 text-red-400 border-red-500/25'
    case 9:
    case 10: return 'bg-sky-500/10 text-sky-400 border-sky-500/20'
    case 0: return 'bg-violet-500/10 text-violet-400 border-violet-500/20'
    default: return 'bg-muted/60 text-muted-foreground border-border'
  }
}

function isControl(op: number): boolean {
  return op === 8 || op === 9 || op === 10
}

export function WSFramesPanel({
  session,
  initialFrames: initialFramesProp,
}: {
  session: WebSocketSession | null
  initialFrames: WebSocketFrame[] | null
}) {
  const initialFrames: WebSocketFrame[] = initialFramesProp ?? []

  const liveFrames = useProxyStore((s) => s.wsFrames.get(session?.id ?? -1) ?? [])

  const allFrames = useMemo(() => {
    if (initialFrames.length === 0) return liveFrames
    const maxId = Math.max(...initialFrames.map((f) => f.id))
    const newLive = liveFrames.filter((f) => f.id > maxId)
    return [...initialFrames, ...newLive]
  }, [initialFrames, liveFrames])

  const [dirFilter, setDirFilter] = useState<'all' | 'c2s' | 's2c'>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | 'text' | 'binary' | 'control'>('all')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Debounce search so a chatty socket stays responsive while typing.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchDraft), 120)
    return () => window.clearTimeout(t)
  }, [searchDraft])

  const searchSpec = useMemo<HighlightSpec | null>(
    () => (search.trim() ? { term: search, caseInsensitive: !caseSensitive, useRegex } : null),
    [search, caseSensitive, useRegex],
  )
  const searchRegex = useMemo(() => buildHighlightRegex(searchSpec), [searchSpec])
  const searchRegexError = useMemo(() => {
    if (!useRegex || !search.trim()) return null
    try { new RegExp(search); return null } catch (e) { return (e as Error).message }
  }, [useRegex, search])

  const listRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setIsAtBottom(atBottom)
    setShowScrollBtn(!atBottom)
  }, [])

  useEffect(() => {
    if (isAtBottom) scrollToBottom()
  }, [allFrames.length, isAtBottom, scrollToBottom])

  const filteredFrames = useMemo(() => {
    return allFrames.filter((frame) => {
      if (dirFilter !== 'all' && frame.direction !== dirFilter) return false
      if (typeFilter === 'text' && frame.opcode !== 1) return false
      if (typeFilter === 'binary' && frame.opcode !== 2) return false
      if (typeFilter === 'control' && !isControl(frame.opcode)) return false

      if (searchRegex) {
        const haystack = buildSearchableText(frame, getPayloadViews(frame))
        searchRegex.lastIndex = 0
        if (!searchRegex.test(haystack)) return false
      }

      return true
    })
  }, [allFrames, dirFilter, typeFilter, searchRegex])

  const totalBytes = allFrames.reduce((sum, frame) => sum + frame.length, 0)
  const isOpen = session ? session.closed_at === null : true

  return (
    <div className="flex h-full flex-col relative bg-card">
      <div className="border-b border-border bg-gradient-to-b from-muted/30 to-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            {session ? `Session #${session.id}` : 'No session'} · {allFrames.length} frames · {formatBytes(totalBytes)}
          </span>
          {session && (
            isOpen ? (
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                live
              </span>
            ) : (
              <span className="text-muted-foreground">
                closed {session.closed_at ? formatTime(session.closed_at) : ''}
              </span>
            )
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {(['all', 'c2s', 's2c'] as const).map((dir) => (
            <button
              key={dir}
              onClick={() => setDirFilter(dir)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                dirFilter === dir
                  ? 'border-primary/30 bg-primary/12 text-primary'
                  : 'border-border bg-background/70 text-muted-foreground hover:text-foreground',
              )}
            >
              {dir === 'all' ? 'All' : dir === 'c2s' ? 'Sent' : 'Recv'}
            </button>
          ))}

          <div className="mx-1 h-4 w-px bg-border" />

          {(['all', 'text', 'binary', 'control'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                typeFilter === type
                  ? 'border-primary/30 bg-primary/12 text-primary'
                  : 'border-border bg-background/70 text-muted-foreground hover:text-foreground',
              )}
            >
              {type}
            </button>
          ))}

          <div className="mx-1 h-4 w-px bg-border" />

          <div
            className={cn(
              'flex h-8 min-w-[190px] flex-1 items-center gap-1 rounded-full border bg-background/80 px-3 transition-colors',
              searchRegexError ? 'border-red-500/60' : 'border-border focus-within:ring-1 focus-within:ring-primary',
            )}
          >
            <input
              type="text"
              placeholder="Search hex, base64, or text"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              spellCheck={false}
              className={cn(
                'min-w-0 flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none',
                useRegex && 'font-mono',
              )}
            />
            <button
              onClick={() => setCaseSensitive((v) => !v)}
              title={caseSensitive ? 'Case-sensitive' : 'Case-insensitive'}
              className={cn('rounded p-0.5 transition-colors', caseSensitive ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}
            >
              <CaseSensitive size={13} />
            </button>
            <button
              onClick={() => setUseRegex((v) => !v)}
              title="Regular expression"
              className={cn('rounded p-0.5 transition-colors', useRegex ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}
            >
              <Regex size={13} />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-2"
      >
        {filteredFrames.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
            No frames
          </div>
        ) : (
          <div className="space-y-2 px-2">
            {filteredFrames.map((frame) => (
              <FrameRow
                key={frame.id}
                frame={frame}
                highlight={searchSpec}
                expanded={expandedId === frame.id}
                onToggle={() => setExpandedId(expandedId === frame.id ? null : frame.id)}
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 flex items-center gap-1 rounded-full bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
        >
          <ChevronDown size={12} />
          Latest
        </button>
      )}
    </div>
  )
}

function FrameRow({
  frame,
  highlight,
  expanded,
  onToggle,
}: {
  frame: WebSocketFrame
  highlight: HighlightSpec | null
  expanded: boolean
  onToggle: () => void
}) {
  const [activeTab, setActiveTab] = useState<PayloadTab>('hex')
  const [wrap, setWrap] = useState(true)

  const isSent = frame.direction === 'c2s'
  const views = useMemo(() => getPayloadViews(frame), [frame])
  const preview = buildPreview(frame, views)

  useEffect(() => {
    if (expanded) {
      setActiveTab(defaultTabForFrame(frame, views))
    }
  }, [expanded, frame, views])

  const tabMeta = useMemo(() => {
    const items: Array<{
      id: PayloadTab
      label: string
      disabled?: boolean
      hint?: string
    }> = [
      { id: 'string', label: 'String', disabled: !views.string.available, hint: views.string.label },
      { id: 'hex', label: 'Hex' },
      { id: 'base64', label: 'Base64' },
      { id: 'raw', label: 'Raw' },
    ]
    return items
  }, [views.string.available, views.string.label])

  const activePayload = getPayloadValue(activeTab, views)
  const activeLanguage = getPayloadLanguage(activeTab)

  const handleCopy = useCallback(() => {
    copyText(activePayload, 'Copied frame payload')
  }, [activePayload])

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border bg-gradient-to-b from-card to-card/90 transition-colors',
        expanded ? 'border-primary/25 shadow-[0_12px_30px_-18px_rgba(0,0,0,0.45)]' : 'border-border hover:border-primary/20',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex w-full flex-col gap-2 px-3 py-3 text-left',
          isSent ? 'items-end' : 'items-start',
        )}
      >
        <div className="flex w-full items-center gap-2">
          {isSent ? <div className="flex-1" /> : null}
          <span className={cn('font-bold text-sm', isSent ? 'text-primary' : 'text-emerald-400')}>
            {isSent ? '→' : '←'}
          </span>
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em]',
              opcodeClass(frame.opcode),
            )}
          >
            {opcodeName(frame.opcode)}
          </span>
          <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {formatBytes(frame.length)}
          </span>
          {frame.truncated && (
            <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
              truncated
            </span>
          )}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {formatTime(frame.timestamp)}
          </span>
        </div>

        <div className={cn(
          'w-full rounded-xl border border-border/80 bg-muted/20 px-3 py-2 font-mono text-[11px] text-muted-foreground',
          isSent ? 'text-right' : 'text-left',
        )}>
          <span className="block max-h-9 overflow-hidden break-all">{preview}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/80 px-3 pb-3 pt-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <FrameMetaPill label="Direction" value={isSent ? 'Client → Server' : 'Server → Client'} />
            <FrameMetaPill label="Payload" value={formatBytes(views.bytes.length)} />
            <FrameMetaPill label="Encoding" value={views.string.available ? views.string.label : 'Binary only'} />
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setWrap((value) => !value)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                  wrap
                    ? 'border-primary/30 bg-primary/12 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                Wrap
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Copy size={11} />
                Copy
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-muted/10">
            <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-2">
              {tabMeta.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  disabled={tab.disabled}
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.hint}
                  className={cn(
                    'rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                    activeTab === tab.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                    tab.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'string' && !views.string.available ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                {views.string.label}
              </div>
            ) : (
              <div className="px-3 py-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <span>{tabTitle(activeTab, views)}</span>
                  <span className="font-mono normal-case tracking-normal text-muted-foreground/80">
                    {activeLanguage}
                  </span>
                </div>
                <pre
                  className={cn(
                    'max-h-[24rem] overflow-auto rounded-xl border border-border/80 bg-card px-3 py-3 font-mono text-[11px] text-foreground',
                    wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
                  )}
                >
                  {activePayload ? <Highlight text={activePayload} spec={highlight} /> : '[empty payload]'}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function getPayloadValue(tab: PayloadTab, views: PayloadViews): string {
  switch (tab) {
    case 'string':
      return views.string.value
    case 'hex':
      return views.hex
    case 'base64':
      return views.base64
    case 'raw':
      return views.raw
  }
}

function getPayloadLanguage(tab: PayloadTab): string {
  switch (tab) {
    case 'string':
      return 'utf-8'
    case 'hex':
      return 'hex'
    case 'base64':
      return 'base64'
    case 'raw':
      return 'byte-array'
  }
}

function tabTitle(tab: PayloadTab, views: PayloadViews): string {
  switch (tab) {
    case 'string':
      return views.string.label
    case 'hex':
      return 'Exact payload bytes as hex'
    case 'base64':
      return 'Exact payload bytes as base64'
    case 'raw':
      return 'Exact payload bytes as array'
  }
}

function FrameMetaPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-border bg-background/80 px-2.5 py-1 text-[10px] text-muted-foreground">
      <span className="mr-1 uppercase tracking-[0.18em]">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}
