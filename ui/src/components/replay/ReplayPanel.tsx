import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { api } from '@/api/client'
import type { Replay, Request, Response } from '@/api/client'
import { useProxyStore, type ReplayQueueItem } from '@/store/proxy'
import { useReplayStore } from '@/store/replay'
import { MethodBadge } from '@/components/common/MethodBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { CodeViewer } from '@/components/common/CodeViewer'
import { GraphQLEditorPanel } from '@/components/graphql/GraphQLEditorPanel'
import { Send, RotateCcw, Trash2, Plus, FileCode2, ChevronLeft, ChevronRight, CopyPlus, Paperclip } from 'lucide-react'
import { subscribeShortcutAction } from '@/lib/shortcuts'
import { decodeBodyForDisplay, type DecodedBody } from '@/lib/httpBodies'
import { presentBody } from '@/lib/bodyPresentation'
import { applyAutomaticContentLength, encodeRawRequest, getRawRequestText } from '@/lib/rawHttp'
import { detectGraphQLPacket } from '@/lib/graphql'
import { cn, displayHost } from '@/lib/utils'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useConverterStore } from '@/store/converter'
import { useNavigate } from 'react-router-dom'

export function ReplayPanel() {
  const navigate = useNavigate()
  const { replayQueue, removeFromReplay, duplicateReplayItem, clearReplay } = useProxyStore()
  const autoContentLength = useReplayStore((state) => state.autoContentLength)
  const sendToConverter = useConverterStore((state) => state.sendToConverter)
  const { open: contextMenuOpen, openMenu, close: closeContextMenu, menuRef } = useContextMenu()

  const [selectedQueueId, setSelectedQueueId] = useState<number | null>(null)
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null)
  const [rawRequest, setRawRequest] = useState('')
  const [replay, setReplay] = useState<Replay | null>(null)
  const [loading, setLoading] = useState(false)
  const [requestLoading, setRequestLoading] = useState(false)
  const [sendError, setSendError] = useState('')
  const [menuSelection, setMenuSelection] = useState('')
  const [decodedReplayBody, setDecodedReplayBody] = useState<DecodedBody | null>(null)
  const [packetHistory, setPacketHistory] = useState<Record<number, { entries: string[]; index: number }>>({})
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const lastMonacoSelectionRef = useRef<{ text: string; at: number } | null>(null)

  const selectedEntry = replayQueue.find((entry) => entry.queueId === selectedQueueId) ?? null
  const selectedReq = selectedEntry?.request ?? null
  const replayPresentation = decodedReplayBody ? presentBody(decodedReplayBody) : null
  const replayPacketText = useMemo(() => {
    if (!replay?.response) return ''
    return buildRawResponsePacket(replay.response, replayPresentation?.text ?? decodeResponseBodyFallback(replay.response.body))
  }, [replay?.response, replayPresentation?.text])
  const selectedHistory = selectedQueueId != null ? packetHistory[selectedQueueId] : undefined
  const canGoBack = Boolean(selectedHistory && selectedHistory.index > 0)
  const canGoForward = Boolean(selectedHistory && selectedHistory.index < selectedHistory.entries.length - 1)
  const hasGraphQLRequest = useMemo(() => Boolean(detectGraphQLPacket(rawRequest)), [rawRequest])

  async function sendReplay() {
    if (!selectedEntry) return

    const nextRaw = autoContentLength ? applyAutomaticContentLength(rawRequest) : rawRequest
    if (nextRaw !== rawRequest) {
      setRawRequest(nextRaw)
    }

    setLoading(true)
    setSendError('')
    try {
      const result = await api.replay.create({
        request_id: selectedEntry.request.id,
        raw: encodeRawRequest(nextRaw),
      })
      setReplay(result)
      setPacketHistory((current) => {
        const existing = current[selectedEntry.queueId] ?? { entries: [nextRaw], index: 0 }
        const visibleEntries = existing.entries.slice(0, existing.index + 1)
        const lastEntry = visibleEntries[visibleEntries.length - 1]
        const entries = lastEntry === nextRaw ? visibleEntries : [...visibleEntries, nextRaw]
        return {
          ...current,
          [selectedEntry.queueId]: {
            entries,
            index: entries.length - 1,
          },
        }
      })
    } catch (error) {
      console.error(error)
      setSendError(error instanceof Error ? error.message : 'Failed to replay request')
    } finally {
      setLoading(false)
    }
  }

  function navigateHistory(direction: -1 | 1) {
    if (!selectedQueueId) return
    setPacketHistory((current) => {
      const history = current[selectedQueueId]
      if (!history) return current
      const nextIndex = history.index + direction
      if (nextIndex < 0 || nextIndex >= history.entries.length) return current
      setRawRequest(history.entries[nextIndex])
      setSendError('')
      return {
        ...current,
        [selectedQueueId]: {
          ...history,
          index: nextIndex,
        },
      }
    })
  }

  function handleRemoveEntry(queueId: number) {
    removeFromReplay(queueId)
    setPacketHistory((current) => {
      const next = { ...current }
      delete next[queueId]
      return next
    })
    if (selectedQueueId === queueId) {
      setSelectedQueueId(null)
      setSelectedRequest(null)
      setRawRequest('')
      setReplay(null)
      setDecodedReplayBody(null)
      setSendError('')
    }
  }

  async function insertFileAtCursor(file: File) {
    const content = await file.text()
    const target = editorRef.current
    if (!target) {
      setRawRequest((current) => current + content)
      setSendError('')
      return
    }
    const model = target.getModel()
    const selection = target.getSelection()
    if (!model || !selection) {
      setRawRequest((current) => current + content)
      setSendError('')
      return
    }
    target.executeEdits('insert-file', [{ range: selection, text: content, forceMoveMarkers: true }])
    setRawRequest(model.getValue())
    setSendError('')
    target.focus()
  }

  function handleInsertFileClick() {
    fileInputRef.current?.click()
  }

  useEffect(() => {
    if (!selectedEntry) {
      setSelectedRequest(null)
      setRawRequest('')
      setReplay(null)
      setDecodedReplayBody(null)
      setSendError('')
      return
    }

    let cancelled = false
    setRequestLoading(true)
    setSendError('')
    api.requests.get(selectedEntry.request.id)
      .then((request) => {
        if (cancelled) return
        const initialRaw = getRawRequestText(request)
        setSelectedRequest(request)
        setPacketHistory((current) => {
          const existing = current[selectedEntry.queueId]
          if (existing) {
            const safeIndex = Math.min(existing.index, existing.entries.length - 1)
            setRawRequest(existing.entries[safeIndex] ?? initialRaw)
            return current
          }
          setRawRequest(initialRaw)
          return {
            ...current,
            [selectedEntry.queueId]: {
              entries: [initialRaw],
              index: 0,
            },
          }
        })
        setReplay(selectedEntry.replay ?? null)
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) {
          setSendError(error instanceof Error ? error.message : 'Failed to load request')
        }
      })
      .finally(() => {
        if (!cancelled) setRequestLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedEntry])

  useEffect(() => {
    return subscribeShortcutAction((actionId) => {
      if (actionId === 'common.closeCurrent' || actionId === 'common.escape') {
        setSelectedQueueId(null)
        setReplay(null)
        return
      }

      if (actionId === 'replay.send' && selectedEntry) {
        sendReplay().catch(console.error)
      }
    })
  }, [selectedEntry, rawRequest, autoContentLength])

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
              <div className="hidden rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground md:block">
                Content-Length {autoContentLength ? 'auto' : 'manual'}
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
                <button
                  onClick={() => navigateHistory(-1)}
                  disabled={!selectedRequest || requestLoading || !canGoBack}
                  className="rounded-md px-2 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
                  title="Previous sent packet"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => navigateHistory(1)}
                  disabled={!selectedRequest || requestLoading || !canGoForward}
                  className="rounded-md px-2 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
                  title="Next sent packet"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              <button
                onClick={handleInsertFileClick}
                disabled={requestLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                <Paperclip size={12} />
                Insert File
              </button>
              <button
                onClick={() => { sendReplay().catch(console.error) }}
                disabled={loading || requestLoading || !rawRequest.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-primary/20 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/30 disabled:opacity-50"
              >
                <Send size={12} />
                {loading ? 'Sending...' : 'Send'}
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <div className="border-b border-border bg-card/40 px-4 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  <span>Editable Packet</span>
                  <span className="rounded-full border border-border px-2 py-0.5 normal-case tracking-normal">
                    Edit method, target, headers, and body directly
                  </span>
                  {selectedHistory && (
                    <span className="rounded-full border border-border px-2 py-0.5 normal-case tracking-normal">
                      Packet {selectedHistory.index + 1} / {selectedHistory.entries.length}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-4 p-4">
                {requestLoading ? (
                  <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-5 py-10 text-sm text-muted-foreground">
                    Loading request packet...
                  </div>
                ) : (
                  <>
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
                  </>
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
                  ) : replay?.error ? (
                    <div className="text-sm text-red-400">{replay.error}</div>
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
              navigator.clipboard.writeText(menuSelection).catch(() => {})
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
  const statusText = response.status_text?.trim() || 'OK'
  const lines: string[] = [`HTTP/1.1 ${response.status_code} ${statusText}`]
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
