import { useEffect, useState } from 'react'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useProxyStore } from '@/store/proxy'
import { api } from '@/api/client'
import type { Request, ScopeRule } from '@/api/client'
import { MethodBadge } from '@/components/common/MethodBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { CodeViewer } from '@/components/common/CodeViewer'
import { AddToFlowModal } from '@/components/flows/AddToFlowModal'
import { AddToOrganizerModal } from '@/components/organizer/AddToOrganizerModal'
import { X, Copy, PanelBottomOpen, PanelRightOpen, Highlighter, RotateCcw, Trash2, GitBranch, FolderPlus, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import { decodeBodyBytes, decodeBodyForDisplay, type DecodedBody, type RawBody } from '@/lib/httpBodies'
import { presentBody } from '@/lib/bodyPresentation'
import { useWorkspaceStore } from '@/store/workspace'
import { parseRequestTags, REQUEST_TAG_HIGHLIGHTED } from '@/lib/requestTags'
import { toast } from 'sonner'

type Tab = 'request' | 'response'

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
  const project = useProxyStore((s) => s.project)
  const setProject = useProxyStore((s) => s.setProject)
  const replayQueue = useProxyStore((s) => s.replayQueue)
  const addToReplay = useProxyStore((s) => s.addToReplay)
  const removeRequestFromReplay = useProxyStore((s) => s.removeRequestFromReplay)
  const updateRequest = useProxyStore((s) => s.updateRequest)

  const [req, setReq] = useState<Request | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('request')
  const [copiedMsg, setCopiedMsg] = useState('')
  const [requestBody, setRequestBody] = useState<DecodedBody | null>(null)
  const [responseBody, setResponseBody] = useState<DecodedBody | null>(null)

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
      return
    }

    setActiveTab('request')

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

  function handleContextMenu(e: React.MouseEvent) {
    if (!req) return
    openMenu(e)
  }

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

  function copyRaw() {
    const raw = buildRawRequest(req!)
    navigator.clipboard.writeText(raw).catch(console.error)
    setCopiedMsg('Copied!')
    setTimeout(() => setCopiedMsg(''), 2000)
  }

  return (
    <div
      className={cn(
        'flex h-full flex-col bg-card',
        edge === 'left' && 'border-l border-border',
        edge === 'top' && 'border-t border-border'
      )}
      onContextMenu={handleContextMenu}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <MethodBadge method={req.method} />
        {highlighted && <span className="h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.6)] flex-shrink-0" />}
        <span className="font-mono text-xs text-muted-foreground flex-1 truncate">
          {req.scheme}://{req.host}{req.path}
          {req.query ? <span className="text-muted-foreground/60">?{req.query}</span> : null}
        </span>
        <button
          onClick={() => setInspectorPosition(inspectorPosition === 'right' ? 'bottom' : 'right')}
          title={inspectorPosition === 'right' ? 'Move viewer to bottom' : 'Move viewer to side'}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          {inspectorPosition === 'right' ? <PanelBottomOpen size={14} /> : <PanelRightOpen size={14} />}
        </button>
        <button
          onClick={copyRaw}
          title="Copy raw request"
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Copy size={14} />
        </button>
        {copiedMsg && <span className="text-xs text-primary">{copiedMsg}</span>}
        <button
          onClick={() => setSelectedRequestId(null)}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(['request', 'response'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2 text-xs font-medium capitalize transition-colors',
              activeTab === tab
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab}
            {tab === 'response' && req.response && (
              <StatusBadge code={req.response.status_code} />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {activeTab === 'request' ? (
          <>
            <HeadersPanel headers={headers} />
            {requestBody && <BodySection title="Body" body={requestBody} />}
          </>
        ) : req.response ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <StatusBadge code={req.response.status_code} />
              <span className="text-muted-foreground font-mono text-xs">{req.response.status_text}</span>
              <span className="ml-auto text-muted-foreground text-xs">{req.response.duration_ms}ms · {formatBytes(req.response.size_bytes)}</span>
            </div>
            <HeadersPanel headers={respHeaders} />
            {responseBody && <BodySection title="Body" body={responseBody} />}
          </>
        ) : (
          <div className="text-muted-foreground text-sm">No response</div>
        )}
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

function HeadersPanel({ headers }: { headers: Record<string, string[]> }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground font-medium mb-2 uppercase tracking-wide">Headers</div>
      <div className="space-y-1">
        {Object.entries(headers).map(([k, vs]) => (
          <div key={k} className="font-mono text-xs">
            <span className="text-primary">{k}</span>
            <span className="text-muted-foreground">: </span>
            <span className="text-foreground">{vs.join(', ')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BodySection({ title, body }: { title: string; body: DecodedBody }) {
  const presentation = presentBody(body)
  const isEmpty = presentation.text.trim().length === 0

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">{title}</span>
        <span className="rounded-full border border-border px-2 py-0.5 font-mono">
          {body.contentType}
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 font-mono">
          {presentation.label}
        </span>
        {body.wasCompressed && (
          <span className="rounded-full border border-border px-2 py-0.5 font-mono">
            decoded {body.encoding || 'compressed'}
          </span>
        )}
        {body.isBinary && (
          <span className="rounded-full border border-border px-2 py-0.5 font-mono">
            binary preview
          </span>
        )}
      </div>
      {body.error && (
        <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {body.error}
        </div>
      )}
      {presentation.formatted && (
        <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-primary/80">
          prettified view
        </div>
      )}
      {isEmpty ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
          Empty body
        </div>
      ) : (
        <CodeViewer
          value={presentation.text}
          language={presentation.language}
          maxHeight={2000}
        />
      )}
    </div>
  )
}

function tryParseHeaders(h: string): Record<string, string[]> {
  try { return JSON.parse(h) as Record<string, string[]> } catch { return {} }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

function buildRawRequest(req: Request): string {
  const headers = tryParseHeaders(req.headers)
  let raw = `${req.method} ${req.path}${req.query ? '?' + req.query : ''} HTTP/1.1\r\n`
  raw += `Host: ${req.host}\r\n`
  for (const [k, vs] of Object.entries(headers)) {
    if (k.toLowerCase() === 'host') continue
    for (const v of vs) raw += `${k}: ${v}\r\n`
  }
  raw += '\r\n'
  if (req.body) raw += decodeBodyBytes(req.body as RawBody)
  return raw
}
