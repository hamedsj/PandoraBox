import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { api } from '@/api/client'
import type { Replay, Response } from '@/api/client'
import { useReplayStore } from '@/store/replay'
import { useReplayQueueStore } from '@/store/replayQueue'
import { MethodBadge } from '@/components/common/MethodBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { CodeViewer } from '@/components/common/CodeViewer'
import { GraphQLEditorPanel } from '@/components/graphql/GraphQLEditorPanel'
import { Send, RotateCcw, Trash2, Plus, FileCode2, ChevronLeft, ChevronRight, CopyPlus, Paperclip, X } from 'lucide-react'
import { subscribeShortcutAction } from '@/lib/shortcuts'
import { decodeBodyForDisplay, type DecodedBody } from '@/lib/httpBodies'
import { presentBody } from '@/lib/bodyPresentation'
import { applyAutomaticContentLength, encodeRawRequest } from '@/lib/rawHttp'
import { detectGraphQLPacket } from '@/lib/graphql'
import { cn, displayHost } from '@/lib/utils'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useConverterStore } from '@/store/converter'
import { useNavigate } from 'react-router-dom'
import { copyText } from '@/lib/clipboard'

export function ReplayPanel() {
  const navigate = useNavigate()
  const replayQueue = useReplayQueueStore((s) => s.replayQueue)
  const removeFromReplay = useReplayQueueStore((s) => s.removeFromReplay)
  const duplicateReplayItem = useReplayQueueStore((s) => s.duplicateReplayItem)
  const clearReplay = useReplayQueueStore((s) => s.clearReplay)
  const updatePacket = useReplayQueueStore((s) => s.updatePacket)
  const setScheme = useReplayQueueStore((s) => s.setScheme)
  const recordSend = useReplayQueueStore((s) => s.recordSend)
  const setHistoryIndex = useReplayQueueStore((s) => s.setHistoryIndex)
  // Responses live on each history entry (in memory) so they survive leaving the
  // Replay page and the back/forward arrows restore the matching response.
  const errors = useReplayQueueStore((s) => s.errors)
  const setError = useReplayQueueStore((s) => s.setError)
  const clearError = useReplayQueueStore((s) => s.clearError)
  // Selection lives in the store (in-memory) so returning to this page re-opens
  // the same request alongside its response.
  const selectedQueueId = useReplayQueueStore((s) => s.selectedQueueId)
  const setSelectedQueueId = useReplayQueueStore((s) => s.setSelectedQueueId)
  const autoContentLength = useReplayStore((state) => state.autoContentLength)
  const sendToConverter = useConverterStore((state) => state.sendToConverter)
  const { open: contextMenuOpen, openMenu, close: closeContextMenu, menuRef } = useContextMenu()

  const [loading, setLoading] = useState(false)
  const [menuSelection, setMenuSelection] = useState('')
  const [decodedReplayBody, setDecodedReplayBody] = useState<DecodedBody | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastMonacoSelectionRef = useRef<{ text: string; at: number } | null>(null)

  const selectedEntry = replayQueue.find((entry) => entry.queueId === selectedQueueId) ?? null
  const selectedReq = selectedEntry?.request ?? null
  const rawRequest = selectedEntry?.packet ?? ''
  const scheme = selectedEntry?.scheme ?? 'http'
  const history = selectedEntry?.history
  // The response for the packet currently in view comes from its history entry,
  // so navigating the back/forward arrows shows the matching response.
  const replay = history ? history.entries[history.index]?.result ?? null : null
  // A server-side failure is carried on the Replay itself; a client-side failure
  // (thrown fetch, cancellation) lives in the transient errors map.
  const liveError = selectedQueueId != null ? errors[selectedQueueId] ?? '' : ''
  const sendError = (replay?.status === 'error' ? replay.error || 'Replay failed' : '') || liveError

  const replayPresentation = decodedReplayBody ? presentBody(decodedReplayBody) : null
  const replayPacketText = useMemo(() => {
    if (!replay?.response) return ''
    return buildRawResponsePacket(replay.response, replayPresentation?.text ?? decodeResponseBodyFallback(replay.response.body))
  }, [replay?.response, replayPresentation?.text])
  const canGoBack = Boolean(history && history.index > 0)
  const canGoForward = Boolean(history && history.index < history.entries.length - 1)
  const hasGraphQLRequest = useMemo(() => Boolean(detectGraphQLPacket(rawRequest)), [rawRequest])

  function setRawRequest(next: string) {
    if (selectedQueueId == null) return
    updatePacket(selectedQueueId, next)
  }

  async function sendReplay() {
    if (!selectedEntry) return
    const id = selectedEntry.queueId

    let packet = selectedEntry.packet
    if (autoContentLength) {
      const next = applyAutomaticContentLength(packet)
      if (next !== packet) {
        updatePacket(id, next)
        packet = next
      }
    }

    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    clearError(id)

    try {
      const result = await api.replay.create(
        { request_id: selectedEntry.request.id, raw: encodeRawRequest(packet), scheme: selectedEntry.scheme },
        controller.signal,
      )
      // Records the packet + its response (done or server-side error) as the
      // current history entry, so the arrows can return to it later.
      recordSend(id, packet, result)
    } catch (error) {
      if (controller.signal.aborted) {
        setError(id, 'Replay cancelled')
      } else {
        console.error(error)
        setError(id, error instanceof Error ? error.message : 'Failed to replay request')
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  function cancelReplay() {
    abortRef.current?.abort()
  }

  function handleRemoveEntry(queueId: number) {
    // removeFromReplay also drops this entry's stored result/error.
    removeFromReplay(queueId)
    if (selectedQueueId === queueId) {
      setSelectedQueueId(null)
      setDecodedReplayBody(null)
    }
  }

  async function insertFileAtCursor(file: File) {
    const content = await file.text()
    const target = editorRef.current
    if (!target) {
      setRawRequest(rawRequest + content)
      return
    }
    const model = target.getModel()
    const selection = target.getSelection()
    if (!model || !selection) {
      setRawRequest(rawRequest + content)
      return
    }
    target.executeEdits('insert-file', [{ range: selection, text: content, forceMoveMarkers: true }])
    setRawRequest(model.getValue())
    target.focus()
  }

  function handleInsertFileClick() {
    fileInputRef.current?.click()
  }

  useEffect(() => {
    return subscribeShortcutAction((actionId) => {
      if (actionId === 'common.closeCurrent' || actionId === 'common.escape') {
        setSelectedQueueId(null)
        return
      }
      if (actionId === 'replay.send' && selectedEntry && !loading) {
        sendReplay().catch(console.error)
      }
    })
  }, [selectedEntry, loading, autoContentLength])

  useEffect(() => {
    if (!replay?.response) {
      setDecodedReplayBody(null)
      return
    }
    let cancelled = false
    decodeBodyForDisplay(replay.response.body, replay.response.headers).then((body) => {
      if (!cancelled) setDecodedReplayBody(body)
    })
    return () => {
      cancelled = true
    }
  }, [replay])

  useEffect(() => {
    const onCodeViewerSelection = (event: Event) => {
      const custom = event as CustomEvent<{ text: string; x: number; y: number } | null>
      const detail = custom.detail
      if (!detail?.text?.trim()) return
      lastMonacoSelectionRef.current = { text: detail.text, at: Date.now() }
    }
    window.addEventListener('pandora:converter-selection', onCodeViewerSelection as EventListener)
    return () => {
      window.removeEventListener('pandora:converter-selection', onCodeViewerSelection as EventListener)
    }
  }, [])

  const headerSubtitle = useMemo(() => {
    if (!selectedReq) return ''
    return `${displayHost(selectedReq.host, selectedReq.scheme)}${selectedReq.path}${selectedReq.query ? `?${selectedReq.query}` : ''}`
  }, [selectedReq])

  const readRequestSelection = () => {
    const editor = editorRef.current
    const model = editor?.getModel()
    const selection = editor?.getSelection()
    if (!model || !selection || selection.isEmpty()) return ''
    return model.getValueInRange(selection)
  }

  const readResponseSelection = () => {
    const latest = lastMonacoSelectionRef.current
    if (latest && Date.now() - latest.at < 5000 && latest.text.trim()) return latest.text
    return ''
  }

  const handleRequestContextMenuCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    const selectedText = readRequestSelection()
    if (!selectedText.trim()) return
    setMenuSelection(selectedText.slice(0, 25000))
    openMenu(event)
  }

  const handleResponseContextMenuCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    const selectedText = readResponseSelection()
    if (!selectedText.trim()) return
    setMenuSelection(selectedText.slice(0, 25000))
    openMenu(event)
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-72 flex flex-col border-r border-border bg-card/70">
        <div className="px-3 py-2 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground font-medium">Replay Queue</div>
            <button
              onClick={clearReplay}
              disabled={replayQueue.length === 0}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              title="Clear all"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {replayQueue.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground p-3 text-center">
              <RotateCcw className="mb-2 opacity-30" size={32} />
              <p className="text-sm mb-2">No requests in replay queue</p>
              <p className="text-xs">Send requests from History to Replay</p>
            </div>
          ) : (
            replayQueue.map((entry) => (
              <div
                key={entry.queueId}
                onClick={() => setSelectedQueueId(entry.queueId)}
                className={cn(
                  'px-3 py-2 border-b border-border/50 cursor-pointer transition-colors',
                  selectedQueueId === entry.queueId ? 'bg-primary/10' : 'hover:bg-muted/30'
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <MethodBadge method={entry.request.method} />
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      #{entry.queueId}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        duplicateReplayItem(entry.queueId)
                      }}
                      className="p-1 rounded hover:bg-muted-50 transition-colors"
                      title="Duplicate request"
                    >
                      <CopyPlus size={12} className="text-muted-foreground hover:text-primary" />
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        handleRemoveEntry(entry.queueId)
                      }}
                      className="p-1 rounded hover:bg-muted-50 transition-colors"
                      title="Remove from queue"
                    >
                      <Trash2 size={12} className="text-muted-foreground hover:text-red-400" />
                    </button>
                  </div>
                </div>
                <div className="text-xs font-mono text-foreground truncate">{displayHost(entry.request.host, entry.request.scheme)}{entry.request.path}</div>
                {entry.request.query && (
                  <div className="mt-1 text-[11px] font-mono text-muted-foreground truncate">?{entry.request.query}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
        {selectedReq ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) return
                insertFileAtCursor(file).catch(console.error)
                event.target.value = ''
              }}
            />
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <MethodBadge method={selectedReq.method} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Raw Request Editor</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{headerSubtitle}</div>
                </div>
              </div>

              {/* Scheme selector — lets a replay be flipped between HTTP and HTTPS. */}
              <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
                {(['http', 'https'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => selectedQueueId != null && setScheme(selectedQueueId, s)}
                    className={cn(
                      'rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors',
                      scheme === s ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div className="hidden rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground md:block">
                Content-Length {autoContentLength ? 'auto' : 'manual'}
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
                <button
                  onClick={() => selectedQueueId != null && history && setHistoryIndex(selectedQueueId, history.index - 1)}
                  disabled={!canGoBack}
                  className="rounded-md px-2 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
                  title="Previous sent packet"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => selectedQueueId != null && history && setHistoryIndex(selectedQueueId, history.index + 1)}
                  disabled={!canGoForward}
                  className="rounded-md px-2 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
                  title="Next sent packet"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              <button
                onClick={handleInsertFileClick}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Paperclip size={12} />
                Insert File
              </button>
              {loading ? (
                <button
                  onClick={cancelReplay}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20"
                >
                  <X size={12} />
                  Cancel
                </button>
              ) : (
                <button
                  onClick={() => { sendReplay().catch(console.error) }}
                  disabled={!rawRequest.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary/20 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/30 disabled:opacity-50"
                >
                  <Send size={12} />
                  Send
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <div className="border-b border-border bg-card/40 px-4 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  <span>Editable Packet</span>
                  <span className="rounded-full border border-border px-2 py-0.5 normal-case tracking-normal">
                    Edit method, target, headers, and body directly
                  </span>
                  {history && history.entries.length > 1 && (
                    <span className="rounded-full border border-border px-2 py-0.5 normal-case tracking-normal">
                      Packet {history.index + 1} / {history.entries.length}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-4 p-4">
                {hasGraphQLRequest ? (
                  <GraphQLEditorPanel
                    rawPacket={rawRequest}
                    onChange={(next) => setRawRequest(next)}
                    includeFullPacket
                  />
                ) : (
                  <div onContextMenuCapture={handleRequestContextMenuCapture}>
                    <CodeViewer
                      value={rawRequest}
                      language="http-request"
                      readOnly={false}
                      onChange={(value) => setRawRequest(value)}
                      onEditorMount={(editor) => { editorRef.current = editor }}
                      contextMenu={false}
                      autoHeight={false}
                      maxHeight={460}
                    />
                  </div>
                )}
              </div>

              {(sendError || replay) && (
                <div className="border-t border-border bg-card/30 px-4 py-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    <FileCode2 size={14} className="text-primary" />
                    Replay Result
                  </div>

                  {sendError && (
                    <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                      {sendError}
                    </div>
                  )}

                  {replay?.response ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge code={replay.response.status_code} />
                        <span className="text-xs font-mono text-muted-foreground">{replay.response.duration_ms}ms</span>
                        {decodedReplayBody && (
                          <span className="text-xs font-mono text-muted-foreground">{decodedReplayBody.contentType}</span>
                        )}
                        {replayPresentation && (
                          <span className="text-xs font-mono text-muted-foreground">{replayPresentation.label}</span>
                        )}
                      </div>

                      {decodedReplayBody?.error && (
                        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                          {decodedReplayBody.error}
                        </div>
                      )}

                      <div onContextMenuCapture={handleResponseContextMenuCapture}>
                        <CodeViewer
                          value={replayPacketText}
                          language="http-request"
                          maxHeight={900}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Plus className="mb-2 opacity-30" size={32} />
            <p className="text-sm">Select a request from the queue</p>
            <p className="text-xs mt-1">Edit the full raw packet and replay it.</p>
          </div>
        )}
      </div>

      {contextMenuOpen && menuSelection && (
        <div
          ref={menuRef}
          className="fixed z-[70] min-w-[220px] rounded-md border border-border bg-popover shadow-xl py-1"
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
        >
          <button
            className="w-full text-left px-3 py-2 text-xs hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              copyText(menuSelection, 'Copied selection')
              closeContextMenu()
            }}
          >
            Copy Selection
          </button>
          <button
            className="w-full text-left px-3 py-2 text-xs hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              sendToConverter(menuSelection)
              navigate('/converter')
              closeContextMenu()
            }}
          >
            Send Selection to Converter
          </button>
        </div>
      )}
    </div>
  )
}

function buildRawResponsePacket(response: Response, bodyText: string): string {
  const proto = response.proto?.trim() || 'HTTP/1.1'
  const statusText = response.status_text?.trim() || ''
  const lines: string[] = [`${proto} ${response.status_code} ${statusText}`.trimEnd()]
  const headers = parseHeaders(response.headers)
  for (const [name, values] of Object.entries(headers)) {
    for (const value of values) {
      lines.push(`${name}: ${value}`)
    }
  }
  return `${lines.join('\r\n')}\r\n\r\n${bodyText}`
}

function parseHeaders(raw: string): Record<string, string[]> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string[]> = {}
    for (const [name, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        out[name] = value.map((v) => String(v))
      } else if (value != null) {
        out[name] = [String(value)]
      }
    }
    return out
  } catch {
    return {}
  }
}

function decodeResponseBodyFallback(body: Response['body']): string {
  if (!body) return ''
  if (Array.isArray(body)) {
    return new TextDecoder().decode(Uint8Array.from(body))
  }
  try {
    const binary = atob(body)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return body
  }
}
