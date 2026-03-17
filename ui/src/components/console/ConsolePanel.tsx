import { useRef, useState, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { X, Trash2 } from 'lucide-react'
import { useConsoleStore, type ConsoleEntry } from '@/store/console'
import { cn } from '@/lib/utils'

type SourceFilter = 'all' | 'middleware' | 'flow'

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    return `${hh}:${mm}:${ss}.${ms}`
  } catch {
    return ''
  }
}

function SourceBadge({ source }: { source: ConsoleEntry['source'] }) {
  return (
    <span
      className={cn(
        'inline-block px-1.5 py-0 rounded text-[10px] font-semibold uppercase leading-5 mr-2 shrink-0',
        source === 'middleware'
          ? 'bg-purple-500/20 text-purple-400'
          : 'bg-blue-500/20 text-blue-400'
      )}
    >
      {source}
    </span>
  )
}

const MIN_HEIGHT = 120
const MAX_HEIGHT_FRACTION = 0.6
const DEFAULT_HEIGHT = 220
const HEADER_HEIGHT = 36

export function ConsolePanel() {
  const { entries, isOpen, toggle, clear } = useConsoleStore()
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [height, setHeight] = useState(DEFAULT_HEIGHT)

  const filtered = filter === 'all' ? entries : entries.filter((e) => e.source === filter)

  // --- resize ---
  const dragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)

  const onMouseDownHandle = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    dragStartY.current = e.clientY
    dragStartH.current = height
  }, [height])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return
      const delta = dragStartY.current - e.clientY
      const maxH = window.innerHeight * MAX_HEIGHT_FRACTION
      setHeight(Math.min(maxH, Math.max(MIN_HEIGHT, dragStartH.current + delta)))
    }
    function onMouseUp() { dragging.current = false }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // --- virtualizer ---
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22,
    overscan: 10,
  })

  // Auto-scroll to bottom when new entries arrive (if pinned)
  useEffect(() => {
    if (!isOpen || !atBottom.current || filtered.length === 0) return
    virtualizer.scrollToIndex(filtered.length - 1, { align: 'end' })
  }, [filtered.length, isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    atBottom.current = distFromBottom < 30
  }

  const panelHeight = isOpen ? height : 0

  return (
    <div
      className="fixed bottom-0 left-56 right-0 z-50 bg-background border-t border-border overflow-hidden"
      style={{
        height: panelHeight,
        transition: 'height 200ms ease',
      }}
    >
      {isOpen && (
        <>
          {/* Drag handle */}
          <div
            className="w-full h-1 cursor-row-resize hover:bg-primary/30 transition-colors"
            onMouseDown={onMouseDownHandle}
          />

          {/* Header */}
          <div
            className="flex items-center gap-2 px-3 border-b border-border shrink-0"
            style={{ height: HEADER_HEIGHT }}
          >
            <span className="text-xs font-semibold text-foreground mr-1">Console</span>

            {/* Source filters */}
            <div className="flex gap-1">
              {(['all', 'middleware', 'flow'] as SourceFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'px-2 py-0.5 rounded text-[11px] transition-colors',
                    filter === f
                      ? 'bg-primary/20 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  )}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            <div className="flex-1" />

            <button
              onClick={clear}
              title="Clear console"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={toggle}
              title="Close console"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* Log body */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="overflow-auto"
            style={{ height: height - HEADER_HEIGHT - 4 /* handle */ }}
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs italic text-muted-foreground">No output yet…</p>
            ) : (
              <div
                className="relative"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((item) => {
                  const entry = filtered[item.index]
                  return (
                    <div
                      key={entry.id}
                      className="absolute top-0 left-0 right-0 flex items-baseline px-3 font-mono text-xs leading-5"
                      style={{ transform: `translateY(${item.start}px)` }}
                    >
                      <span className="text-muted-foreground mr-2 shrink-0 tabular-nums">
                        {formatTimestamp(entry.timestamp)}
                      </span>
                      <SourceBadge source={entry.source} />
                      <span className="text-foreground break-all">{entry.text}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
