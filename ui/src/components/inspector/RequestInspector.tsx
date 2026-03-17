import { useEffect, useState } from 'react'
import { useProxyStore } from '@/store/proxy'
import { api } from '@/api/client'
import type { Request } from '@/api/client'
import { MethodBadge } from '@/components/common/MethodBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { CodeViewer } from '@/components/common/CodeViewer'
import { X, Copy, PanelBottomOpen, PanelRightOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { decodeBodyBytes, decodeBodyForDisplay, type DecodedBody, type RawBody } from '@/lib/httpBodies'
import { presentBody } from '@/lib/bodyPresentation'
import { useWorkspaceStore } from '@/store/workspace'

type Tab = 'request' | 'response'

export function RequestInspector({ edge = 'left' }: { edge?: 'left' | 'top' | 'none' }) {
  const { selectedRequestId, setSelectedRequestId } = useProxyStore()
  const inspectorPosition = useWorkspaceStore((state) => state.inspectorPosition)
  const setInspectorPosition = useWorkspaceStore((state) => state.setInspectorPosition)
  const [req, setReq] = useState<Request | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('request')
  const [copiedMsg, setCopiedMsg] = useState('')
  const [requestBody, setRequestBody] = useState<DecodedBody | null>(null)
  const [responseBody, setResponseBody] = useState<DecodedBody | null>(null)

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
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <MethodBadge method={req.method} />
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
