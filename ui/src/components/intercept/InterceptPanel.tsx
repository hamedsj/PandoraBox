import { useEffect, useRef, useState } from 'react'
import Editor, { type BeforeMount } from '@monaco-editor/react'
import { api } from '@/api/client'
import type { InterceptFilter, Request } from '@/api/client'
import { useProxyStore } from '@/store/proxy'
import { useThemeStore } from '@/store/theme'
import { MethodBadge } from '@/components/common/MethodBadge'
import { InterceptFilterModal } from './InterceptFilterModal'
import { Shield, ShieldOff, Check, X, Filter, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { subscribeShortcutAction } from '@/lib/shortcuts'
import { useNavigate } from 'react-router-dom'

export function InterceptPanel() {
  const navigate = useNavigate()
  const status = useProxyStore((s) => s.status)
  const addToReplay = useProxyStore((s) => s.addToReplay)
  const mode = useThemeStore((s) => s.mode)
  const fontSize = useThemeStore((s) => s.fontSize)

  const [queue, setQueue] = useState<Request[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [interceptFilter, setInterceptFilter] = useState<InterceptFilter>({ host: '', method: '', path: '' })

  const editContentRef = useRef(editContent)
  useEffect(() => { editContentRef.current = editContent }, [editContent])

  const interceptEnabled = status?.intercept_enabled ?? false
  const selected = queue.find((r) => r.id === selectedId) ?? null

  // Load filter on mount
  useEffect(() => {
    api.intercept.getFilter().then(setInterceptFilter).catch(console.error)
  }, [])

  async function fetchQueue() {
    const r = await api.intercept.queue()
    setQueue(r.queue || [])
  }

  useEffect(() => {
    fetchQueue().catch(console.error)
    const t = setInterval(() => fetchQueue().catch(console.error), 1000)
    return () => clearInterval(t)
  }, [])

  // Populate editor when selection changes
  useEffect(() => {
    if (selectedId === null) {
      setEditContent('')
      return
    }
    const req = queue.find((r) => r.id === selectedId)
    if (req) setEditContent(buildRawRequest(req))
    // intentionally not including queue in deps — only reset on selection change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Keyboard shortcuts
  useEffect(() => {
    return subscribeShortcutAction((actionId) => {
      if (actionId === 'common.closeCurrent' || actionId === 'common.escape') {
        setSelectedId(null)
        return
      }
      if (actionId === 'intercept.toggleEnabled') {
        toggleIntercept().catch(console.error)
        return
      }
      if (actionId === 'intercept.selectPrev') {
        if (queue.length === 0) return
        const idx = queue.findIndex((r) => r.id === selectedId)
        const next = queue[idx <= 0 ? 0 : idx - 1]
        if (next) setSelectedId(next.id)
        return
      }
      if (actionId === 'intercept.selectNext') {
        if (queue.length === 0) return
        const idx = queue.findIndex((r) => r.id === selectedId)
        const next = queue[idx < 0 ? 0 : Math.min(queue.length - 1, idx + 1)]
        if (next) setSelectedId(next.id)
        return
      }
      if (!selected) return
      if (actionId === 'common.sendSelectedToReplay') {
        addToReplay(selected)
        navigate('/replay')
      } else if (actionId === 'intercept.forwardSelected' || actionId === 'intercept.applyAndForward') {
        forward(selected.id).catch(console.error)
      } else if (actionId === 'intercept.dropSelected') {
        drop(selected.id).catch(console.error)
      }
    })
  }, [addToReplay, navigate, queue, selected, selectedId])

  async function toggleIntercept() {
    if (interceptEnabled) {
      // Flush queue with current edits before disabling
      const currentId = selectedId
      const currentEdit = editContentRef.current
      if (currentId !== null) {
        try {
          await api.intercept.modify(currentId, safeBase64(currentEdit))
        } catch {
          // request may have already been resolved; ignore
        }
      }
      await api.intercept.forwardAll().catch(console.error)
      await api.intercept.toggle(false)
    } else {
      await api.intercept.toggle(true)
    }
    const s = await api.proxy.status()
    useProxyStore.getState().setStatus(s)
    setSelectedId(null)
    await fetchQueue()
  }

  async function forward(id: number) {
    const content = editContentRef.current
    if (content) {
      await api.intercept.modify(id, safeBase64(content))
    } else {
      await api.intercept.forward(id)
    }
    setSelectedId(null)
    await fetchQueue()
  }

  async function drop(id: number) {
    await api.intercept.drop(id)
    setSelectedId(null)
    await fetchQueue()
  }

  async function applyFilter(f: InterceptFilter) {
    await api.intercept.setFilter(f)
    setInterceptFilter(f)
    setFilterOpen(false)
  }

  const isFilterActive = !!(interceptFilter.host || interceptFilter.method || interceptFilter.path)

  const defineTheme: BeforeMount = (monaco) => {
    if (mode === 'dark') {
      monaco.editor.defineTheme('intercept-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: { 'editor.background': '#0d1117' },
      })
    }
  }

  const editorTheme = mode === 'dark' ? 'intercept-dark' : 'vs'

  return (
    <div className="flex flex-col h-full">

      {/* ── Top toolbar ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        {/* Intercept toggle */}
        <button
          onClick={() => toggleIntercept().catch(console.error)}
          className={cn(
            'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-colors',
            interceptEnabled
              ? 'bg-primary/20 text-primary hover:bg-primary/30'
              : 'bg-muted text-muted-foreground hover:bg-muted/80',
          )}
        >
          {interceptEnabled ? <Shield size={13} /> : <ShieldOff size={13} />}
          {interceptEnabled ? 'Intercept ON' : 'Intercept OFF'}
        </button>

        {/* Filter button */}
        <button
          onClick={() => setFilterOpen(true)}
          className={cn(
            'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md font-medium transition-colors border',
            isFilterActive
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground',
          )}
        >
          <Filter size={12} />
          Filter
          {isFilterActive && (
            <span className="bg-primary text-primary-foreground text-[10px] px-1 rounded-full leading-4 font-semibold">
              {[interceptFilter.host, interceptFilter.method, interceptFilter.path].filter(Boolean).length}
            </span>
          )}
        </button>

        {/* Forward all */}
        {queue.length > 0 && (
          <button
            onClick={() => api.intercept.forwardAll().then(fetchQueue).catch(console.error)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors"
          >
            <ChevronsRight size={13} />
            Forward All
          </button>
        )}

        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {queue.length} held
        </span>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">

        {/* Left: queue list */}
        <div className="w-64 flex-shrink-0 border-r border-border overflow-y-auto">
          {queue.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-xs px-4 text-center">
              {interceptEnabled ? 'Waiting for requests…' : 'Intercept is disabled'}
            </div>
          ) : (
            queue.map((req) => (
              <button
                key={req.id}
                onClick={() => setSelectedId(req.id)}
                className={cn(
                  'w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors',
                  selectedId === req.id
                    ? 'bg-primary/10 border-l-2 border-l-primary'
                    : 'hover:bg-muted/30 border-l-2 border-l-transparent',
                )}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <MethodBadge method={req.method} />
                  <span className="text-xs font-mono text-muted-foreground truncate">{req.host}</span>
                </div>
                <div className="text-xs font-mono text-muted-foreground/60 truncate pl-0.5">
                  {req.path || '/'}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Right: editor */}
        <div className="flex-1 flex flex-col min-w-0">
          {selected ? (
            <>
              {/* Editor toolbar */}
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border flex-shrink-0 bg-muted/20">
                <span className="text-xs text-muted-foreground font-mono">#{selected.id}</span>
                <MethodBadge method={selected.method} />
                <span className="text-xs font-mono text-muted-foreground truncate min-w-0">
                  {selected.host}{selected.path}{selected.query ? `?${selected.query}` : ''}
                </span>
                <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => forward(selected.id).catch(console.error)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors font-medium"
                  >
                    <Check size={12} />
                    Forward
                  </button>
                  <button
                    onClick={() => drop(selected.id).catch(console.error)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors font-medium"
                  >
                    <X size={12} />
                    Drop
                  </button>
                </div>
              </div>

              {/* Monaco editor */}
              <div className="flex-1 min-h-0">
                <Editor
                  height="100%"
                  language="plaintext"
                  value={editContent}
                  onChange={(v) => setEditContent(v ?? '')}
                  theme={editorTheme}
                  beforeMount={defineTheme}
                  options={{
                    minimap: { enabled: false },
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    fontSize,
                    fontFamily: 'var(--font-mono, monospace)',
                    padding: { top: 12, bottom: 12 },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    renderLineHighlight: 'line',
                    overviewRulerLanes: 0,
                    lineDecorationsWidth: 6,
                    glyphMargin: false,
                    scrollbar: {
                      verticalScrollbarSize: 8,
                      horizontalScrollbarSize: 8,
                      alwaysConsumeMouseWheel: false,
                    },
                    contextmenu: true,
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <Shield size={28} className="opacity-20" />
              <span className="text-sm">
                {interceptEnabled
                  ? queue.length > 0
                    ? 'Select a request from the queue'
                    : 'Waiting for requests…'
                  : 'Enable intercept to capture requests'}
              </span>
            </div>
          )}
        </div>
      </div>

      <InterceptFilterModal
        isOpen={filterOpen}
        onClose={() => setFilterOpen(false)}
        filter={interceptFilter}
        onApply={applyFilter}
      />
    </div>
  )
}

function buildRawRequest(req: Request): string {
  // Prefer the stored raw bytes (includes body)
  if (req.raw) {
    try {
      return atob(req.raw)
    } catch {
      // fall through to manual build
    }
  }
  // Manual build (fallback, no body)
  let headers: Record<string, string[]> = {}
  try { headers = JSON.parse(req.headers) as Record<string, string[]> } catch { /* ignore */ }

  let raw = `${req.method} ${req.path}${req.query ? '?' + req.query : ''} HTTP/1.1\r\n`
  raw += `Host: ${req.host}\r\n`
  for (const [k, vs] of Object.entries(headers)) {
    if (k.toLowerCase() === 'host') continue
    for (const v of vs) raw += `${k}: ${v}\r\n`
  }
  raw += '\r\n'

  if (req.body) {
    if (typeof req.body === 'string') {
      raw += req.body
    } else if (Array.isArray(req.body)) {
      raw += String.fromCharCode(...(req.body as number[]))
    }
  }

  return raw
}

function safeBase64(str: string): string {
  try {
    return btoa(str)
  } catch {
    // UTF-8 safe fallback
    return btoa(unescape(encodeURIComponent(str)))
  }
}
