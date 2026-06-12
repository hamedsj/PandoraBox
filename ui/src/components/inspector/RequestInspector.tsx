import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useProxyStore } from '@/store/proxy'
import { useReplayQueueStore } from '@/store/replayQueue'
import { useConverterStore } from '@/store/converter'
import { api } from '@/api/client'
import type { Request, ScopeRule } from '@/api/client'
import { MethodBadge } from '@/components/common/MethodBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { BodyViewer } from '@/components/common/BodyViewer'
import { AddToFlowModal } from '@/components/flows/AddToFlowModal'
import { AddToOrganizerModal } from '@/components/organizer/AddToOrganizerModal'
import { X, Copy, PanelBottomOpen, PanelRightOpen, Highlighter, RotateCcw, Trash2, GitBranch, FolderPlus, Target, Link, Terminal, Code2, Crosshair, Search, Regex, CaseSensitive } from 'lucide-react'
import { copyURL, copyRawRequest, copyAsCurl, copyAsFetch } from '@/lib/copyRequest'
import { displayHost } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { decodeBodyBytes, decodeBodyForDisplay, type DecodedBody, type RawBody } from '@/lib/httpBodies'
import { HeadersView } from '@/components/common/HeadersView'
import { buildHighlightRegex, type HighlightSpec } from '@/components/common/Highlight'
import { useWorkspaceStore } from '@/store/workspace'
import { parseRequestTags, REQUEST_TAG_HIGHLIGHTED } from '@/lib/requestTags'
import { toast } from 'sonner'
import { useIntruderStore } from '@/store/intruder'

function buildExcludeRule(kind: 'entirely' | 'host' | 'path' | 'subpath', req: Request): ScopeRule {
  function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
  switch (kind) {
    case 'entirely': return { enabled: true, pattern_type: 'exact', host: req.host, path: req.path }
    case 'host':     return { enabled: true, pattern_type: 'exact', host: req.host, path: '' }
    case 'path':     return { enabled: true, pattern_type: 'regex', host: '.*', path: `^${escapeRegex(req.path)}$` }
    case 'subpath':  return { enabled: true, pattern_type: 'regex', host: `^${escapeRegex(req.host)}$`, path: `^${escapeRegex(req.path)}` }
  }
}

export function RequestInspector({ edge = 'left' }: { edge?: 'left' | 'top' | 'none' }) {
  const { selectedRequestId, setSelectedRequestId } = useProxyStore()
  const inspectorPosition = useWorkspaceStore((state) => state.inspectorPosition)
  const setInspectorPosition = useWorkspaceStore((state) => state.setInspectorPosition)
  const bodyMode = useWorkspaceStore((state) => state.inspectorBodyMode)
  const setBodyMode = useWorkspaceStore((state) => state.setInspectorBodyMode)
  const messageSplit = useWorkspaceStore((state) => state.inspectorMessageSplit)
  const setMessageSplit = useWorkspaceStore((state) => state.setInspectorMessageSplit)
  const project = useProxyStore((s) => s.project)
  const setProject = useProxyStore((s) => s.setProject)
  const replayQueue = useReplayQueueStore((s) => s.replayQueue)
  const filters = useProxyStore((s) => s.filters)
  const addToReplay = useReplayQueueStore((s) => s.addToReplay)
  const removeRequestFromReplay = useReplayQueueStore((s) => s.removeRequestFromReplay)
  const updateRequest = useProxyStore((s) => s.updateRequest)

  const [req, setReq] = useState<Request | null>(null)
  const [requestBody, setRequestBody] = useState<DecodedBody | null>(null)
  const [responseBody, setResponseBody] = useState<DecodedBody | null>(null)
  const [selectedText, setSelectedText] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [findTerm, setFindTerm] = useState('')
  const [findCaseSensitive, setFindCaseSensitive] = useState(false)
  const [findRegex, setFindRegex] = useState(false)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const splitContainerRef = useRef<HTMLDivElement | null>(null)
  const splitDragging = useRef(false)

  // Opens the find bar and focuses it. Bound to Ctrl/Cmd+F (see CodeViewer +
  // the container key handler) so it replaces Monaco's built-in find widget.
  const openFind = useCallback(() => {
    setFindOpen(true)
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [])

  function handleInspectorKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      openFind()
    }
  }

  const onSplitMouseDown = useCallback(() => {
    splitDragging.current = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }, [])

  const onSplitMouseMove = useCallback((event: ReactMouseEvent) => {
    if (!splitDragging.current || !splitContainerRef.current) return
    const rect = splitContainerRef.current.getBoundingClientRect()
    const next = ((event.clientX - rect.left) / rect.width) * 100
    setMessageSplit(Math.min(75, Math.max(25, next)))
  }, [setMessageSplit])

  const onSplitMouseUp = useCallback(() => {
    splitDragging.current = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }, [])

  const navigate = useNavigate()
  const sendToConverter = useConverterStore((s) => s.sendToConverter)
  const { open: contextMenuOpen, openMenu, close: closeContextMenu, menuRef } = useContextMenu()
  const [addToFlowOpen, setAddToFlowOpen] = useState(false)
  const [addToOrganizerOpen, setAddToOrganizerOpen] = useState(false)

  useEffect(() => {
    if (!selectedRequestId) {
      setReq(null)
      setRequestBody(null)
      setResponseBody(null)
      return
    }
    api.requests.get(selectedRequestId).then(setReq).catch(console.error)
  }, [selectedRequestId])

  useEffect(() => {
    if (!req) {
      setRequestBody(null)
      setResponseBody(null)
      setSelectedText('')
      return
    }

    let cancelled = false
    decodeBodyForDisplay(req.body, req.headers).then((body) => {
      if (!cancelled) setRequestBody(body)
    })
    decodeBodyForDisplay(req.response?.body, req.response?.headers).then((body) => {
      if (!cancelled) setResponseBody(body)
    })

    return () => {
      cancelled = true
    }
  }, [req])

  const highlighted = req ? parseRequestTags(req).includes(REQUEST_TAG_HIGHLIGHTED) : false
  const inReplay = req ? replayQueue.some((e) => e.request.id === req.id) : false

  // Reflect the active history search so the matched term is highlighted and
  // revealed in the opened request/response.
  const highlightSpec = useMemo<HighlightSpec | null>(() => {
    if (!filters.search || filters.negativeSearch) return null
    return { term: filters.search, caseInsensitive: filters.caseInsensitive, useRegex: filters.useRegex }
  }, [filters.search, filters.negativeSearch, filters.caseInsensitive, filters.useRegex])

  function handleContextMenu(e: React.MouseEvent) {
    if (!req) return
    const selection = window.getSelection()?.toString()?.trim() ?? ''
    if (selection) setSelectedText(selection.slice(0, 25000))
    openMenu(e)
  }

  useEffect(() => {
    const onCodeViewerSelection = (event: Event) => {
      const custom = event as CustomEvent<{ text: string } | null>
      const text = custom.detail?.text?.trim() ?? ''
      if (text) setSelectedText(text.slice(0, 25000))
    }
    window.addEventListener('pandora:converter-selection', onCodeViewerSelection as EventListener)
    return () => window.removeEventListener('pandora:converter-selection', onCodeViewerSelection as EventListener)
  }, [])

  async function handleToggleHighlight() {
    if (!req) return
    const tags = parseRequestTags(req)
    const next = highlighted
      ? tags.filter((t) => t !== REQUEST_TAG_HIGHLIGHTED)
      : [...tags, REQUEST_TAG_HIGHLIGHTED]
    try {
      const updated = await api.requests.updateTags(req.id, next)
      updateRequest(updated)
      setReq(updated)
    } catch {
      toast.error('Failed to update highlight')
    }
  }

  async function addExcludeRule(kind: 'entirely' | 'host' | 'path' | 'subpath') {
    if (!req) return
    const scope = project?.scope ?? { enabled: false, include_rules: [], exclude_rules: [] }
    const rule = buildExcludeRule(kind, req)
    try {
      const updated = await api.project.update({ scope: { ...scope, exclude_rules: [...scope.exclude_rules, rule] } })
      setProject(updated)
      toast.success('Scope rule added')
    } catch {
      toast.error('Failed to update scope')
    }
  }

  if (!req) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select a request to inspect
      </div>
    )
  }

  const headers = tryParseHeaders(req.headers)
  const respHeaders = req.response ? tryParseHeaders(req.response.headers) : {}

  // Find-in-message: searches headers + body in both panes. When the find bar
  // is empty it falls back to the active history search highlight.
  const findSpec: HighlightSpec | null = findTerm
    ? { term: findTerm, caseInsensitive: !findCaseSensitive, useRegex: findRegex }
    : null
  const effectiveHighlight = findSpec ?? highlightSpec
  const findMatchCount = (() => {
    const re = buildHighlightRegex(findSpec)
    if (!re) return 0
    const parts: string[] = [
      headersToText(headers),
      requestBody?.text ?? '',
      headersToText(respHeaders),
      responseBody?.text ?? '',
    ]
    let count = 0
    for (const p of parts) {
      const m = p.match(re)
      if (m) count += m.length
    }
    return count
  })()

  function copyRequest() {
    navigator.clipboard
      .writeText(buildRawRequest(req!))
      .then(() => toast.success('Copied raw request'))
      .catch(() => toast.error('Copy failed'))
  }

  return (
    <div
      className={cn(
        'flex h-full flex-col bg-card',
        edge === 'left' && 'border-l border-border',
        edge === 'top' && 'border-t border-border'
      )}
      onContextMenu={handleContextMenu}
      onKeyDown={handleInspectorKeyDown}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <MethodBadge method={req.method} />
        {highlighted && <span className="h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.6)] flex-shrink-0" />}
        <span className="font-mono text-xs text-muted-foreground flex-1 truncate">
          {req.scheme}://{displayHost(req.host, req.scheme)}{req.path}
          {req.query ? <span className="text-muted-foreground/60">?{req.query}</span> : null}
        </span>
        <button
          onClick={() => (findOpen ? setFindOpen(false) : openFind())}
          title="Find in request/response (⌘F)"
          className={cn(
            'p-1 transition-colors',
            findOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Search size={14} />
        </button>
        <button
          onClick={() => setInspectorPosition(inspectorPosition === 'right' ? 'bottom' : 'right')}
          title={inspectorPosition === 'right' ? 'Move viewer to bottom' : 'Move viewer to side'}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          {inspectorPosition === 'right' ? <PanelBottomOpen size={14} /> : <PanelRightOpen size={14} />}
        </button>
        <button
          onClick={copyRequest}
          title="Copy raw request"
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Copy size={14} />
        </button>
        <button
          onClick={() => setSelectedRequestId(null)}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Find bar */}
      {findOpen && (
        <div className="flex items-center gap-1.5 border-b border-border bg-card px-3 py-1.5">
          <Search size={13} className="shrink-0 text-muted-foreground" />
          <input
            ref={findInputRef}
            autoFocus
            value={findTerm}
            onChange={(e) => setFindTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setFindTerm(''); setFindOpen(false) } }}
            placeholder="Find in headers and body…"
            spellCheck={false}
            className={cn(
              'flex-1 bg-transparent py-0.5 text-xs placeholder:text-muted-foreground focus:outline-none',
              findRegex && 'font-mono',
            )}
          />
          {findTerm && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {findMatchCount} {findMatchCount === 1 ? 'match' : 'matches'}
            </span>
          )}
          <button
            onClick={() => setFindCaseSensitive((v) => !v)}
            title={findCaseSensitive ? 'Case-sensitive' : 'Case-insensitive'}
            className={cn('rounded p-1 transition-colors', findCaseSensitive ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground')}
          >
            <CaseSensitive size={13} />
          </button>
          <button
            onClick={() => setFindRegex((v) => !v)}
            title="Regular expression"
            className={cn('rounded p-1 transition-colors', findRegex ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground')}
          >
            <Regex size={13} />
          </button>
          <button
            onClick={() => { setFindTerm(''); setFindOpen(false) }}
            title="Close find"
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Split request / response panes */}
      <div
        ref={splitContainerRef}
        className="flex min-h-0 flex-1 flex-row"
        onMouseMove={onSplitMouseMove}
        onMouseUp={onSplitMouseUp}
        onMouseLeave={onSplitMouseUp}
      >
        <div
          style={{ width: `${messageSplit}%` }}
          className="flex min-h-0 min-w-0 flex-col"
        >
          <div className="flex shrink-0 items-center border-b border-border bg-muted/20 px-3 py-1.5">
            <span className="text-xs font-medium text-primary">Request</span>
          </div>
          <div className="min-w-0 flex-1 space-y-3 overflow-auto p-3">
            <HeadersView headers={headers} highlight={effectiveHighlight} />
            {requestBody && (
              <BodyViewer
                body={requestBody}
                highlight={effectiveHighlight}
                onRequestFind={openFind}
                mode={bodyMode}
                onModeChange={setBodyMode}
                viewStateKey={`insp-req-${req.id}`}
              />
            )}
          </div>
        </div>

        <div
          className="w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60"
          onMouseDown={onSplitMouseDown}
        />

        <div
          style={{ width: `${100 - messageSplit}%` }}
          className="flex min-h-0 min-w-0 flex-col"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5">
            <span className="text-xs font-medium text-emerald-400">Response</span>
            {req.response ? (
              <>
                <StatusBadge code={req.response.status_code} />
                <span className="text-muted-foreground font-mono text-[11px]">{req.response.status_text}</span>
                <span className="ml-auto text-muted-foreground text-[11px]">
                  {req.response.duration_ms}ms · {formatBytes(req.response.size_bytes)}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground text-[11px]">No response</span>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-3 overflow-auto p-3">
            {req.response ? (
              <>
                <HeadersView headers={respHeaders} highlight={effectiveHighlight} />
                {responseBody && (
                  <BodyViewer
                    body={responseBody}
                    highlight={effectiveHighlight}
                    onRequestFind={openFind}
                    mode={bodyMode}
                    onModeChange={setBodyMode}
                    viewStateKey={`insp-res-${req.id}`}
                  />
                )}
              </>
            ) : (
              <div className="text-muted-foreground text-sm">No response captured for this request.</div>
            )}
          </div>
        </div>
      </div>

      {/* Context menu */}
      {contextMenuOpen && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[240px] rounded-lg border border-border bg-card py-1 shadow-lg"
          style={{ left: 0, top: 0 }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        >
          <button
            onClick={() => { handleToggleHighlight(); closeContextMenu() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
          >
            <Highlighter size={14} className={highlighted ? 'text-amber-300' : undefined} />
            {highlighted ? 'Remove highlight' : 'Highlight in history'}
          </button>

          {inReplay ? (
            <button
              onClick={() => { removeRequestFromReplay(req.id); closeContextMenu() }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
            >
              <Trash2 size={14} />
              Remove from Replay
            </button>
          ) : (
            <button
              onClick={() => { addToReplay(req); closeContextMenu() }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
            >
              <RotateCcw size={14} />
              Send to Replay
            </button>
          )}

          <button
            onClick={() => { useIntruderStore.getState().addSession(req); navigate('/intruder'); closeContextMenu() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
          >
            <Crosshair size={14} />
            Send to Intruder
          </button>

          <button
            onClick={() => { setAddToFlowOpen(true); closeContextMenu() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
          >
            <GitBranch size={14} />
            Send to Flow
          </button>

          <button
            onClick={() => { setAddToOrganizerOpen(true); closeContextMenu() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
          >
            <FolderPlus size={14} />
            Add to Organizer
          </button>

          {selectedText && (
            <button
              onClick={() => {
                sendToConverter(selectedText)
                navigate('/converter')
                closeContextMenu()
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
            >
              <RotateCcw size={14} />
              Send Selection to Converter
            </button>
          )}

          <div className="my-1 border-t border-border" />

          <div className="px-3 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Copy
            </span>
          </div>

          <button onClick={() => { copyURL(req); closeContextMenu() }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted">
            <Link size={14} />Copy URL
          </button>
          <button onClick={() => { copyRawRequest(req); closeContextMenu() }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted">
            <Copy size={14} />Copy Raw Request
          </button>
          <button onClick={() => { copyAsCurl(req); closeContextMenu() }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted">
            <Terminal size={14} />Copy as cURL
          </button>
          <button onClick={() => { copyAsFetch(req); closeContextMenu() }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted">
            <Code2 size={14} />Copy as fetch()
          </button>

          <div className="my-1 border-t border-border" />

          <div className="px-3 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Remove from Scope
            </span>
          </div>

          {([
            { kind: 'entirely', label: 'Remove entirely',  desc: 'exact host + exact path' },
            { kind: 'host',     label: 'Remove host',      desc: 'exact host, any path' },
            { kind: 'path',     label: 'Remove path',      desc: 'exact path, any host' },
            { kind: 'subpath',  label: 'Remove sub-path',  desc: 'exact host, path + all sub-paths' },
          ] as const).map(({ kind, label, desc }) => (
            <button
              key={kind}
              onClick={() => { addExcludeRule(kind).catch(console.error); closeContextMenu() }}
              className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted"
            >
              <Target size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <div className="text-sm">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Sub-modals */}
      <AddToFlowModal
        open={addToFlowOpen}
        request={req}
        onClose={() => setAddToFlowOpen(false)}
      />
      <AddToOrganizerModal
        open={addToOrganizerOpen}
        requestId={req.id}
        onClose={() => setAddToOrganizerOpen(false)}
      />
    </div>
  )
}


function tryParseHeaders(h: string): Record<string, string[]> {
  try { return JSON.parse(h) as Record<string, string[]> } catch { return {} }
}

function headersToText(h: Record<string, string[]>): string {
  return Object.entries(h).map(([k, vs]) => `${k}: ${vs.join(', ')}`).join('\n')
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

function buildRawRequest(req: Request): string {
  const headers = tryParseHeaders(req.headers)
  let raw = `${req.method} ${req.path}${req.query ? '?' + req.query : ''} HTTP/1.1\r\n`
  raw += `Host: ${displayHost(req.host, req.scheme)}\r\n`
  for (const [k, vs] of Object.entries(headers)) {
    if (k.toLowerCase() === 'host') continue
    for (const v of vs) raw += `${k}: ${v}\r\n`
  }
  raw += '\r\n'
  if (req.body) raw += decodeBodyBytes(req.body as RawBody)
  return raw
}
