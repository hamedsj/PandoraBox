import { useEffect, useState } from 'react'
import { X, Loader2, AlertCircle } from 'lucide-react'
import { api } from '@/api/client'
import type { Replay } from '@/api/client'
import { StatusBadge } from '@/components/common/StatusBadge'
import { MethodBadge } from '@/components/common/MethodBadge'
import { CodeViewer } from '@/components/common/CodeViewer'
import { displayHost } from '@/lib/utils'
import { decodeBodyForDisplay, type DecodedBody } from '@/lib/httpBodies'
import { presentBody, type BodyPresentation } from '@/lib/bodyPresentation'
import type { AttackResult } from '@/store/intruder'

type Tab = 'request' | 'response'

interface Props {
  result: AttackResult
  markerCount: number
  onClose: () => void
}

function parseHeadersToText(raw: string | undefined): string {
  if (!raw) return ''
  try {
    const obj = JSON.parse(raw) as Record<string, string | string[]>
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\n')
  } catch {
    return raw
  }
}

export function ResultInspectorPanel({ result, markerCount, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('response')
  const [replay, setReplay] = useState<Replay | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [reqBody, setReqBody] = useState<BodyPresentation | null>(null)
  const [resBody, setResBody] = useState<BodyPresentation | null>(null)

  // Fetch replay when result changes
  useEffect(() => {
    setReplay(null)
    setReqBody(null)
    setResBody(null)

    if (result.replayId == null) {
      setFetchError(result.error ?? 'No replay data for this result.')
      setLoading(false)
      return
    }

    setLoading(true)
    setFetchError(null)

    api.replay.get(result.replayId)
      .then((r) => {
        setReplay(r)
        setLoading(false)
      })
      .catch((e: Error) => {
        setFetchError(e.message ?? 'Failed to load replay')
        setLoading(false)
      })
  }, [result.replayId])

  // Decode request body
  useEffect(() => {
    if (!replay?.request) { setReqBody(null); return }
    decodeBodyForDisplay(replay.request.body, replay.request.headers).then((decoded) => {
      setReqBody(presentBody(decoded))
    })
  }, [replay?.request])

  // Decode response body
  useEffect(() => {
    if (!replay?.response) { setResBody(null); return }
    decodeBodyForDisplay(replay.response.body, replay.response.headers).then((decoded) => {
      setResBody(presentBody(decoded))
    })
  }, [replay?.response])

  const req = replay?.request ?? null
  const res = replay?.response ?? null
  const reqHeadersText = req ? `Host: ${displayHost(req.host, req.scheme)}\n${parseHeadersToText(req.headers)}`.trim() : ''
  const resHeadersText = parseHeadersToText(res?.headers)

  return (
    <div className="flex flex-col h-full border-l border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-start justify-between gap-2 px-3 py-2.5 border-b border-border">
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          {/* Payload chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground shrink-0">#{result.index + 1}</span>
            {result.payloads.slice(0, Math.max(markerCount, 1)).map((p, i) => (
              <span
                key={i}
                title={p}
                className="inline-block font-mono text-xs bg-amber-400/15 text-amber-300 border border-amber-400/20 rounded px-1.5 py-0.5 max-w-[180px] truncate"
              >
                {markerCount > 1 && <span className="opacity-50 mr-0.5">{i + 1}:</span>}
                {p || <span className="opacity-40 italic">empty</span>}
              </span>
            ))}
          </div>
          {/* Stats */}
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground flex-wrap">
            {result.status != null && <StatusBadge code={result.status} />}
            {result.length != null && <span>{result.length.toLocaleString()}B</span>}
            <span className="text-zinc-600">·</span>
            <span>{result.time}ms</span>
            {req && (
              <span className="font-mono text-zinc-500 truncate max-w-[200px]" title={`${displayHost(req.host, req.scheme)}${req.path}`}>
                {displayHost(req.host, req.scheme)}{req.path}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 mt-0.5 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex border-b border-border px-1">
        {(['request', 'response'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-medium border-b-2 capitalize transition-colors ${
              tab === t
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
            {t === 'response' && res && (
              <span className={`ml-1.5 text-[10px] font-mono px-1 rounded ${
                res.status_code >= 500 ? 'bg-red-500/20 text-red-400' :
                res.status_code >= 400 ? 'bg-orange-500/20 text-orange-400' :
                res.status_code >= 300 ? 'bg-blue-500/20 text-blue-400' :
                'bg-emerald-500/20 text-emerald-400'
              }`}>{res.status_code}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">

        {loading && (
          <div className="flex items-center justify-center gap-2 h-32 text-muted-foreground text-sm">
            <Loader2 size={15} className="animate-spin" />
            Loading…
          </div>
        )}

        {!loading && fetchError && (
          <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
            <AlertCircle size={20} className="text-red-400" />
            <p className="text-sm text-red-400">{fetchError}</p>
          </div>
        )}

        {/* REQUEST TAB */}
        {!loading && !fetchError && tab === 'request' && (
          req ? (
            <div className="flex flex-col">
              {/* Request line */}
              <div className="px-3 py-2.5 border-b border-border/50 flex items-center gap-2 bg-background/30">
                <MethodBadge method={req.method} />
                <span className="font-mono text-xs text-foreground truncate">
                  {req.path}{req.query ? `?${req.query}` : ''}
                </span>
                <span className="ml-auto text-xs text-zinc-500 font-mono shrink-0">HTTP/1.1</span>
              </div>
              {/* Headers */}
              <div className="px-3 pt-3 pb-2">
                <SectionLabel>Headers</SectionLabel>
                <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all leading-[1.7] select-text">{reqHeadersText}</pre>
              </div>
              {/* Body */}
              {reqBody?.text ? (
                <div className="px-3 pt-1 pb-4">
                  <SectionLabel extra={reqBody.label}>Body</SectionLabel>
                  <CodeViewer value={reqBody.text} language={reqBody.language} autoHeight maxHeight={400} minHeight={60} />
                </div>
              ) : (
                <div className="px-3 pt-1 pb-3">
                  <SectionLabel>Body</SectionLabel>
                  <span className="text-xs text-muted-foreground italic">No body</span>
                </div>
              )}
            </div>
          ) : (
            <EmptyState>No request data available</EmptyState>
          )
        )}

        {/* RESPONSE TAB */}
        {!loading && !fetchError && tab === 'response' && (
          res ? (
            <div className="flex flex-col">
              {/* Status line */}
              <div className="px-3 py-2.5 border-b border-border/50 flex items-center gap-2 bg-background/30">
                <StatusBadge code={res.status_code} />
                <span className="text-xs text-muted-foreground font-mono">{res.status_text}</span>
                <span className="ml-auto text-xs text-zinc-500 shrink-0">{res.duration_ms}ms · {res.size_bytes.toLocaleString()}B</span>
              </div>
              {/* Headers */}
              <div className="px-3 pt-3 pb-2">
                <SectionLabel>Headers</SectionLabel>
                <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all leading-[1.7] select-text">{resHeadersText}</pre>
              </div>
              {/* Body */}
              {resBody?.text ? (
                <div className="px-3 pt-1 pb-4">
                  <SectionLabel extra={resBody.label}>Body</SectionLabel>
                  <CodeViewer value={resBody.text} language={resBody.language} autoHeight maxHeight={500} minHeight={80} />
                </div>
              ) : (
                <div className="px-3 pt-1 pb-3">
                  <SectionLabel>Body</SectionLabel>
                  <span className="text-xs text-muted-foreground italic">No body</span>
                </div>
              )}
            </div>
          ) : (
            <EmptyState>No response data available</EmptyState>
          )
        )}
      </div>
    </div>
  )
}

function SectionLabel({ children, extra }: { children: React.ReactNode; extra?: string }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
      {children}
      {extra && <span className="ml-1.5 normal-case font-normal text-primary">{extra}</span>}
    </p>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
      {children}
    </div>
  )
}
