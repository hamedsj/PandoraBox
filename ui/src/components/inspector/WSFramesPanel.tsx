import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useProxyStore } from '@/store/proxy'
import type { WebSocketFrame, WebSocketSession } from '@/api/client'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

// Returns { text, isHex } where isHex=true means we fell back to a hex dump.
function decodeWsPayload(frame: WebSocketFrame): { text: string; isHex: boolean } {
  if (!frame.payload) return { text: '', isHex: false }
  try {
    const bytes = base64ToBytes(frame.payload)
    if (bytes.length === 0) return { text: '', isHex: false }

    // Text frames (opcode 1): decode as UTF-8, replace invalid bytes with ?.
    if (frame.opcode === 1) {
      return { text: new TextDecoder('utf-8').decode(bytes), isHex: false }
    }

    // Binary frames (opcode 2 or continuation 0): try UTF-8 first.
    // If the result is ≥50% replacement characters (non-printable / invalid),
    // fall back to a hex dump so the raw bytes are actually readable.
    const utf8 = new TextDecoder('utf-8').decode(bytes)
    const replacements = (utf8.match(/\uFFFD/g) ?? []).length
    if (replacements / utf8.length < 0.5) {
      return { text: utf8, isHex: false }
    }

    // Hex dump: "xxd"-style — 16 bytes per row, hex + ASCII side-by-side.
    return { text: hexDump(bytes), isHex: true }
  } catch {
    return { text: '[decode error]', isHex: false }
  }
}

function hexDump(bytes: Uint8Array): string {
  const rows: string[] = []
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16)
    const offset = i.toString(16).padStart(4, '0')
    const hex = Array.from(chunk)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(16 * 3 - 1, ' ')
    const ascii = Array.from(chunk)
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
      .join('')
    rows.push(`${offset}  ${hex}  |${ascii}|`)
  }
  return rows.join('\n')
}

function tryPrettifyJson(text: string, isHex: boolean): string {
  if (isHex) return text // hex dumps are already formatted
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

function formatTime(ts: string): string {
  const d = new Date(ts)
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
    case 1: return 'bg-muted/60 text-muted-foreground border-border'
    case 2: return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
    case 8: return 'bg-red-500/20 text-red-400 border-red-500/30'
    case 9:
    case 10: return 'bg-muted/40 text-muted-foreground/70 border-border'
    case 0: return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
    default: return 'bg-muted/60 text-muted-foreground border-border'
  }
}

function isControl(op: number): boolean {
  return op === 8 || op === 9 || op === 10
}

// ── Main component ────────────────────────────────────────────────────────────

export function WSFramesPanel({
  session,
  initialFrames: initialFramesProp,
}: {
  session: WebSocketSession | null
  initialFrames: WebSocketFrame[] | null
}) {
  // Go nil slices marshal to JSON null — normalize to empty array.
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
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

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

  // Auto-scroll when new frames arrive and user is at bottom.
  useEffect(() => {
    if (isAtBottom) scrollToBottom()
  }, [allFrames.length, isAtBottom, scrollToBottom])

  const filteredFrames = useMemo(() => {
    return allFrames.filter((f) => {
      if (dirFilter !== 'all' && f.direction !== dirFilter) return false
      if (typeFilter === 'text' && f.opcode !== 1) return false
      if (typeFilter === 'binary' && f.opcode !== 2) return false
      if (typeFilter === 'control' && !isControl(f.opcode)) return false
      if (search) {
        const { text } = decodeWsPayload(f)
        if (!text.toLowerCase().includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [allFrames, dirFilter, typeFilter, search])

  const totalBytes = allFrames.reduce((s, f) => s + f.length, 0)
  const isOpen = session ? session.closed_at === null : true

  return (
    <div className="flex flex-col h-full relative">
      {/* Session status bar */}
      <div className="px-3 py-2 border-b border-border bg-muted/20 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">
          {session ? `Session #${session.id}` : 'No session'} · {allFrames.length} frames · {formatBytes(totalBytes)}
        </span>
        {session && (
          isOpen ? (
            <span className="flex items-center gap-1 text-emerald-400 font-medium">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              live
            </span>
          ) : (
            <span className="text-muted-foreground">
              closed {session.closed_at ? formatTime(session.closed_at) : ''}
            </span>
          )
        )}

        {/* Filters */}
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {/* Direction */}
          {(['all', 'c2s', 's2c'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirFilter(d)}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-medium border transition-colors',
                dirFilter === d
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {d === 'all' ? 'All ↕' : d === 'c2s' ? '→ Sent' : '← Recv'}
            </button>
          ))}
          <div className="w-px h-4 bg-border mx-0.5" />
          {/* Type */}
          {(['all', 'text', 'binary', 'control'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-medium border transition-colors capitalize',
                typeFilter === t
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'all' ? 'All' : t.toUpperCase()}
            </button>
          ))}
          <div className="w-px h-4 bg-border mx-0.5" />
          {/* Search */}
          <input
            type="text"
            placeholder="Search payload…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-[10px] px-2 py-0.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-28"
          />
        </div>
      </div>

      {/* Frame list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-2 space-y-1 relative"
      >
        {filteredFrames.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-muted-foreground text-xs">
            No frames
          </div>
        ) : (
          filteredFrames.map((frame) => (
            <FrameRow
              key={frame.id}
              frame={frame}
              expanded={expandedId === frame.id}
              onToggle={() => setExpandedId(expandedId === frame.id ? null : frame.id)}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:bg-primary/90 transition-colors"
        >
          <ChevronDown size={12} />
          scroll to latest
        </button>
      )}
    </div>
  )
}

// ── Frame row ─────────────────────────────────────────────────────────────────

function FrameRow({
  frame,
  expanded,
  onToggle,
}: {
  frame: WebSocketFrame
  expanded: boolean
  onToggle: () => void
}) {
  const isSent = frame.direction === 'c2s'
  const { text: decoded, isHex } = decodeWsPayload(frame)
  const preview = decoded.slice(0, 120)
  const fullText = tryPrettifyJson(decoded, isHex)

  return (
    <div
      className={cn(
        'mx-2 rounded cursor-pointer transition-colors hover:bg-muted/30',
        isSent
          ? 'border-r-2 border-primary pl-2 pr-3'
          : 'border-l-2 border-emerald-500 pl-3 pr-2',
      )}
      onClick={onToggle}
    >
      {/* Row header */}
      <div
        className={cn(
          'flex items-center gap-2 py-1.5 text-xs',
          isSent ? 'flex-row-reverse' : 'flex-row',
        )}
      >
        <span className={cn('font-bold', isSent ? 'text-primary' : 'text-emerald-400')}>
          {isSent ? '→' : '←'}
        </span>
        <span
          className={cn(
            'text-[10px] font-bold px-1.5 py-0.5 rounded border',
            opcodeClass(frame.opcode),
          )}
        >
          {opcodeName(frame.opcode)}
        </span>
        <span className="text-muted-foreground">{formatBytes(frame.length)}</span>
        {frame.truncated && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
            1MB cap
          </span>
        )}
        <span className="text-muted-foreground/60 ml-auto font-mono">{formatTime(frame.timestamp)}</span>
      </div>

      {/* Payload preview */}
      {decoded && !expanded && (
        <div
          className={cn(
            'font-mono text-[11px] text-muted-foreground pb-1.5 truncate',
            isSent ? 'text-right' : 'text-left',
          )}
        >
          {preview}
          {decoded.length > 120 && '…'}
        </div>
      )}

      {/* Expanded payload */}
      {expanded && fullText && (
        <div className="pb-2" onClick={(e) => e.stopPropagation()}>
          {isHex && (
            <div className="mb-1 text-[10px] text-amber-400/80 font-mono uppercase tracking-wide">
              hex dump
            </div>
          )}
          <pre className="font-mono text-[11px] text-foreground whitespace-pre bg-muted/30 rounded p-2 max-h-60 overflow-auto">
            {fullText}
          </pre>
        </div>
      )}
    </div>
  )
}
