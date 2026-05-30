import { useEffect, useRef, useState } from 'react'
import Editor, { type BeforeMount } from '@monaco-editor/react'
import { registerHttpLanguage, httpTokenRules } from '@/lib/httpLanguage'
import { detectGraphQLPacket } from '@/lib/graphql'
import { GraphQLEditorPanel } from '@/components/graphql/GraphQLEditorPanel'
import { api } from '@/api/client'
import type { InterceptFilter, InterceptQueueItem } from '@/api/client'
import { decodeBodyForDisplay } from '@/lib/httpBodies'
import { applyAutomaticContentLength, getRawRequestText } from '@/lib/rawHttp'
import { useProxyStore } from '@/store/proxy'
import { useReplayQueueStore } from '@/store/replayQueue'
import { useThemeStore } from '@/store/theme'
import { MethodBadge } from '@/components/common/MethodBadge'
import { InterceptFilterModal } from './InterceptFilterModal'
import { Shield, ShieldOff, Check, X, Filter, ChevronsRight, Trash2 } from 'lucide-react'
import { cn, displayHost } from '@/lib/utils'
import { subscribeShortcutAction } from '@/lib/shortcuts'
import { useNavigate } from 'react-router-dom'

export function InterceptPanel() {
  const navigate = useNavigate()
  const status = useProxyStore((s) => s.status)
  const addToReplay = useReplayQueueStore((s) => s.addToReplay)
  const mode = useThemeStore((s) => s.mode)
  const fontSize = useThemeStore((s) => s.fontSize)

  // Queue is the source of truth in the store so it stays live with intercept
  // events from MCP/REST. Local writes prime the store too.
  const queue = useProxyStore((s) => s.interceptQueue)
  const setInterceptQueueStore = useProxyStore((s) => s.setInterceptQueue)
  const setQueue = (next: InterceptQueueItem[]) => setInterceptQueueStore(next)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [responseViewTab, setResponseViewTab] = useState<'packet' | 'request'>('packet')
  const [editContent, setEditContent] = useState('')
  const [baseContent, setBaseContent] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [interceptFilter, setInterceptFilter] = useState<InterceptFilter>({ host: '', method: '', path: '', packet: 'both' })

  const editContentRef = useRef(editContent)
  useEffect(() => { editContentRef.current = editContent }, [editContent])
  const baseContentRef = useRef(baseContent)
  useEffect(() => { baseContentRef.current = baseContent }, [baseContent])
  const loadedPacketSigRef = useRef('')

  const interceptEnabled = status?.intercept_enabled ?? false
  const selected = queue.find((q) => q.request_id === selectedId) ?? null

  // Load filter on mount
  useEffect(() => {
    api.intercept.getFilter().then((f) => setInterceptFilter(normalizeFilter(f))).catch(console.error)
  }, [])

  async function fetchQueue() {
    const r = await api.intercept.queue()
    setQueue(r.queue || [])
  }

  // Initial fetch only; subsequent updates flow through the global WebSocket
  // listener (intercept.held / intercept.resolved), so no polling is needed.
  useEffect(() => {
    fetchQueue().catch(console.error)
  }, [])

  // Auto-select the first request when the queue goes from empty to non-empty
  useEffect(() => {
    if (selectedId === null && queue.length > 0) {
      setSelectedId(queue[0].request_id)
    }
  }, [queue, selectedId])

  // Keep selection valid as queue changes from polling/external actions.
  useEffect(() => {
    if (selectedId === null) return
    if (queue.length === 0) {
      setSelectedId(null)
      return
    }
    if (!queue.some((q) => q.request_id === selectedId)) {
      setSelectedId(queue[0].request_id)
    }
  }, [queue, selectedId])

  useEffect(() => {
    setResponseViewTab('packet')
  }, [selectedId, selected?.kind])

  // Populate editor when selection changes
  useEffect(() => {
    let cancelled = false

    async function loadEditorContent() {
      if (selectedId === null) {
        loadedPacketSigRef.current = ''
        setBaseContent('')
        setEditContent('')
        return
      }

      const item = queue.find((q) => q.request_id === selectedId)
      if (!item) return
      const requestRaw = getRawRequestText(item.request)
      const sig = `${item.kind}:${item.request_id}:${item.raw}:${requestRaw}:${responseViewTab}`
      if (loadedPacketSigRef.current === sig) return

      const content = await buildEditorPacket(item, responseViewTab)
      if (cancelled) return
      loadedPacketSigRef.current = sig
      setBaseContent(content)
      setEditContent(content)
    }

    loadEditorContent().catch(console.error)

    return () => {
      cancelled = true
    }
    // refresh on queue updates, but don't clobber edits for unchanged packet
  }, [queue, selectedId, responseViewTab])

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
        const idx = queue.findIndex((q) => q.request_id === selectedId)
        const next = queue[idx <= 0 ? 0 : idx - 1]
        if (next) setSelectedId(next.request_id)
        return
      }
      if (actionId === 'intercept.selectNext') {
        if (queue.length === 0) return
        const idx = queue.findIndex((q) => q.request_id === selectedId)
        const next = queue[idx < 0 ? 0 : Math.min(queue.length - 1, idx + 1)]
        if (next) setSelectedId(next.request_id)
        return
      }
      if (!selected) return
      if (actionId === 'common.sendSelectedToReplay') {
        addToReplay(selected.request)
        navigate('/replay')
      } else if (actionId === 'intercept.forwardSelected' || actionId === 'intercept.applyAndForward') {
        forward(selected.request_id).catch(console.error)
      } else if (actionId === 'intercept.dropSelected') {
        drop(selected.request_id).catch(console.error)
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
          if (currentEdit !== baseContentRef.current) {
            await api.intercept.modify(currentId, safeBase64(currentEdit))
          }
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

  function pickNext(resolvedId: number, currentQueue: InterceptQueueItem[]): number | null {
    const idx = currentQueue.findIndex((q) => q.request_id === resolvedId)
    const remaining = currentQueue.filter((q) => q.request_id !== resolvedId)
    if (remaining.length === 0) return null
    // prefer the item that was after the resolved one; fall back to the last item
    const next = remaining[Math.min(idx, remaining.length - 1)]
    return next?.request_id ?? null
  }

  async function forward(id: number) {
    const content = selected?.kind === 'request'
      ? applyAutomaticContentLength(editContentRef.current)
      : editContentRef.current
    const isSelected = selected?.request_id === id
    const canEditHeldPacket = selected?.kind !== 'response' || responseViewTab === 'packet'
    const shouldModify = Boolean(isSelected && canEditHeldPacket && content !== baseContentRef.current)
    if (shouldModify) {
      await api.intercept.modify(id, safeBase64(content))
    } else {
      await api.intercept.forward(id)
    }
    const updated = await api.intercept.queue()
    const newQueue = updated.queue || []
    setQueue(newQueue)
    setSelectedId(pickNext(id, queue))
  }

  async function drop(id: number) {
    await api.intercept.drop(id)
    const updated = await api.intercept.queue()
    const newQueue = updated.queue || []
    setQueue(newQueue)
    setSelectedId(pickNext(id, queue))
  }

  async function applyFilter(f: InterceptFilter) {
    const normalized = normalizeFilter(f)
    await api.intercept.setFilter(normalized)
    setInterceptFilter(normalized)
    setFilterOpen(false)
  }

  const isFilterActive = !!(interceptFilter.host || interceptFilter.method || interceptFilter.path || interceptFilter.packet !== 'both')

  const defineTheme: BeforeMount = (monaco) => {
    registerHttpLanguage(monaco)
    monaco.editor.defineTheme('intercept-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: httpTokenRules('dark'),
      colors: { 'editor.background': '#0d1117' },
    })
    monaco.editor.defineTheme('intercept-light', {
      base: 'vs',
      inherit: true,
      rules: httpTokenRules('light'),
      colors: {},
    })
  }

  const editorTheme = mode === 'dark' ? 'intercept-dark' : 'intercept-light'
  const showingReadOnlyRequest = selected?.kind === 'response' && responseViewTab === 'request'
  const hasGraphQLEditor = selected ? Boolean(detectGraphQLPacket(editContent)) : false

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
              {[interceptFilter.host, interceptFilter.method, interceptFilter.path, interceptFilter.packet !== 'both' ? 'packet' : ''].filter(Boolean).length}
            </span>
          )}
        </button>

        {/* Forward all / Drop all */}
        {queue.length > 0 && (
          <>
            <button
              onClick={() => api.intercept.forwardAll().then(fetchQueue).catch(console.error)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors"
            >
              <ChevronsRight size={13} />
              Forward All
            </button>
            <button
              onClick={() => api.intercept.dropAll().then(() => { setSelectedId(null); return fetchQueue() }).catch(console.error)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 transition-colors"
            >
              <Trash2 size={13} />
              Drop All
            </button>
          </>
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
              {interceptEnabled ? 'Waiting for packets…' : 'Intercept is disabled'}
            </div>
          ) : (
            queue.map((item) => (
              <button
                key={`${item.kind}:${item.request_id}`}
                onClick={() => setSelectedId(item.request_id)}
                className={cn(
                  'w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors',
                  selectedId === item.request_id
                    ? 'bg-primary/10 border-l-2 border-l-primary'
                    : 'hover:bg-muted/30 border-l-2 border-l-transparent',
                )}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <MethodBadge method={item.kind === 'response' ? 'RESP' : item.request.method} />
                  <span className="text-xs font-mono text-muted-foreground truncate">{displayHost(item.request.host, item.request.scheme)}</span>
                </div>
                <div className="text-xs font-mono text-muted-foreground/60 truncate pl-0.5">
                  {item.request.path || '/'}
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
                {selected.kind === 'response' && (
                  <div className="flex items-center gap-1 mr-1">
                    <button
                      onClick={() => setResponseViewTab('request')}
                      className={cn(
                        'px-2 py-0.5 rounded text-xs font-medium border transition-colors',
                        responseViewTab === 'request'
                          ? 'bg-primary/20 border-primary text-primary'
                          : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground',
                      )}
                    >
                      Request
                    </button>
                    <button
                      onClick={() => setResponseViewTab('packet')}
                      className={cn(
                        'px-2 py-0.5 rounded text-xs font-medium border transition-colors',
                        responseViewTab === 'packet'
                          ? 'bg-primary/20 border-primary text-primary'
                          : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground',
                      )}
                    >
                      Response
                    </button>
                  </div>
                )}
                <span className="text-xs text-muted-foreground font-mono">#{selected.request_id}</span>
                <MethodBadge method={selected.kind === 'response' ? 'RESP' : selected.request.method} />
                <span className="text-xs font-mono text-muted-foreground truncate min-w-0">
                  {displayHost(selected.request.host, selected.request.scheme)}{selected.request.path}{selected.request.query ? `?${selected.request.query}` : ''}
                </span>
                <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => forward(selected.request_id).catch(console.error)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors font-medium"
                  >
                    <Check size={12} />
                    Forward
                  </button>
                  <button
                    onClick={() => drop(selected.request_id).catch(console.error)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors font-medium"
                  >
                    <X size={12} />
                    Drop
                  </button>
                </div>
              </div>

              {/* Monaco editor */}
              <div className="flex-1 min-h-0 flex flex-col">
                {hasGraphQLEditor ? (
                  <div className="flex-1 min-h-0 overflow-auto bg-card/30 p-3">
                    <GraphQLEditorPanel
                      rawPacket={editContent}
                      onChange={setEditContent}
                      readOnly={showingReadOnlyRequest}
                      includeFullPacket
                    />
                  </div>
                ) : (
                  <div className="flex-1 min-h-[320px]">
                    <Editor
                      height="100%"
                      language="http-request"
                      value={editContent}
                      onChange={(v) => setEditContent(v ?? '')}
                      theme={editorTheme}
                      beforeMount={defineTheme}
                      options={{
                        minimap: { enabled: false },
                        lineNumbers: 'on',
                        wordWrap: 'on',
                        readOnly: showingReadOnlyRequest,
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
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <Shield size={28} className="opacity-20" />
              <span className="text-sm">
                {interceptEnabled
                  ? queue.length > 0
                    ? 'Select a packet from the queue'
                    : 'Waiting for packets…'
                  : 'Enable intercept to capture packets'}
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

function base64ToBytes(raw: string): Uint8Array {
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function fromBase64(raw: string): string {
  try {
    return new TextDecoder().decode(base64ToBytes(raw))
  } catch {
    try {
      return atob(raw)
    } catch {
      return ''
    }
  }
}

function splitHttpMessage(bytes: Uint8Array): { head: Uint8Array; body: Uint8Array } {
  for (let i = 0; i <= bytes.length - 4; i += 1) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      return { head: bytes.slice(0, i), body: bytes.slice(i + 4) }
    }
  }
  for (let i = 0; i <= bytes.length - 2; i += 1) {
    if (bytes[i] === 10 && bytes[i + 1] === 10) {
      return { head: bytes.slice(0, i), body: bytes.slice(i + 2) }
    }
  }
  return { head: bytes, body: new Uint8Array() }
}

function parseHeaderMap(headText: string): { statusLine: string; headerLines: string[]; headersJSON: string } {
  const lines = headText.split(/\r?\n/)
  const statusLine = lines[0] ?? ''
  const headerLines = lines.slice(1)
  const headers: Record<string, string[]> = {}

  for (const line of headerLines) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const name = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!name) continue
    if (!headers[name]) headers[name] = []
    headers[name].push(value)
  }

  return { statusLine, headerLines, headersJSON: JSON.stringify(headers) }
}

async function buildEditorPacket(item: InterceptQueueItem, responseViewTab: 'packet' | 'request'): Promise<string> {
  if (item.kind === 'response' && responseViewTab === 'request') {
    return getRawRequestText(item.request)
  }

  const rawText = fromBase64(item.raw)
  if (item.kind !== 'response') return rawText

  try {
    const bytes = base64ToBytes(item.raw)
    const { head, body } = splitHttpMessage(bytes)
    const headText = new TextDecoder().decode(head)
    const { statusLine, headerLines, headersJSON } = parseHeaderMap(headText)
    const decoded = await decodeBodyForDisplay(Array.from(body), headersJSON)

    // Keep opaque/binary responses untouched in editor.
    if (decoded.isBinary || decoded.error || !decoded.wasCompressed) return rawText

    const filteredHeaders = headerLines.filter((line) => {
      const lower = line.toLowerCase()
      return !lower.startsWith('content-encoding:') &&
        !lower.startsWith('content-length:') &&
        !lower.startsWith('transfer-encoding:')
    })
    const decodedLength = new TextEncoder().encode(decoded.text).length
    filteredHeaders.push(`Content-Length: ${decodedLength}`)
    filteredHeaders.push('X-PandoraBox-Decoded: true')
    return `${statusLine}\r\n${filteredHeaders.join('\r\n')}\r\n\r\n${decoded.text}`
  } catch {
    return rawText
  }
}

function safeBase64(str: string): string {
  try {
    const bytes = new TextEncoder().encode(str)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  } catch {
    return btoa(str)
  }
}

function normalizeFilter(filter: InterceptFilter): InterceptFilter {
  const packet = filter.packet === 'request' || filter.packet === 'response' ? filter.packet : 'both'
  return {
    host: filter.host ?? '',
    method: filter.method ?? '',
    path: filter.path ?? '',
    packet,
  }
}
