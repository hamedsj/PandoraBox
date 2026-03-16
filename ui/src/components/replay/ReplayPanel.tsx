import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { Replay } from '@/api/client'
import { useProxyStore } from '@/store/proxy'
import { MethodBadge } from '@/components/common/MethodBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Send, RotateCcw, Trash2, Plus } from 'lucide-react'
import { subscribeShortcutAction } from '@/lib/shortcuts'

export function ReplayPanel() {
  const { replayQueue, removeFromReplay, clearReplay } = useProxyStore()
  const [selectedReqId, setSelectedReqId] = useState<number | null>(null)
  const [modifiedUrl, setModifiedUrl] = useState('')
  const [modifiedBody, setModifiedBody] = useState('')
  const [replay, setReplay] = useState<Replay | null>(null)
  const [loading, setLoading] = useState(false)

  const selectedReq = replayQueue.find((r) => r.id === selectedReqId)

  async function sendReplay() {
    if (!selectedReqId) return
    setLoading(true)
    try {
      const r = await api.replay.create({
        request_id: selectedReqId,
        modified_url: modifiedUrl || undefined,
        modified_body: modifiedBody ? Array.from(new TextEncoder().encode(modifiedBody)) : undefined,
      })
      setReplay(r)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  function handleRemoveRequest() {
    if (!selectedReqId) return
    removeFromReplay(selectedReqId)
    setSelectedReqId(null)
    setReplay(null)
    setModifiedUrl('')
    setModifiedBody('')
  }

  useEffect(() => {
    return subscribeShortcutAction((actionId) => {
      if (actionId === 'common.closeCurrent' || actionId === 'common.escape') {
        setSelectedReqId(null)
        setReplay(null)
        return
      }

      if (actionId === 'replay.send' && selectedReqId) {
        sendReplay().catch(console.error)
      }
    })
  }, [selectedReqId, modifiedUrl, modifiedBody])

  return (
    <div className="flex h-full">
      {/* Left: Request picker */}
      <div className="w-72 flex flex-col border-r border-border">
        <div className="px-3 py-2 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground font-medium">
              Replay Queue
            </div>
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
            replayQueue.map((req) => (
              <div
                key={req.id}
                onClick={() => {
                  setSelectedReqId(req.id)
                  setModifiedUrl(`${req.scheme}://${req.host}${req.path}${req.query ? '?' + req.query : ''}`)
                  setModifiedBody('')
                  setReplay(null)
                }}
                className={`px-3 py-2 border-b border-border/50 cursor-pointer transition-colors ${
                  selectedReqId === req.id ? 'bg-primary/10' : 'hover:bg-muted/30'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <MethodBadge method={req.method} />
                    {req.response && <StatusBadge code={req.response.status_code} />}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFromReplay(req.id)
                      if (selectedReqId === req.id) {
                        setSelectedReqId(null)
                        setReplay(null)
                        setModifiedUrl('')
                        setModifiedBody('')
                      }
                    }}
                    className="p-1 rounded hover:bg-muted-50 transition-colors"
                    title="Remove from queue"
                  >
                    <Trash2 size={12} className="text-muted-foreground hover:text-red-400" />
                  </button>
                </div>
                <div className="text-xs font-mono text-muted-foreground truncate">{req.host}{req.path}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: Editor + Response */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedReq ? (
          <>
            {/* URL bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <MethodBadge method={selectedReq.method} />
              <input
                className="flex-1 font-mono text-xs bg-input border border-border rounded px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                value={modifiedUrl}
                onChange={(e) => setModifiedUrl(e.target.value)}
              />
              <button
                onClick={() => { sendReplay().catch(console.error) }}
                disabled={loading}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 transition-colors font-medium"
              >
                <Send size={12} />
                {loading ? 'Sending...' : 'Send'}
              </button>
            </div>

            {/* Body editor */}
            <div className="px-3 py-2 border-b border-border">
              <div className="text-xs text-muted-foreground mb-1.5">Body (optional override)</div>
              <textarea
                className="w-full h-24 font-mono text-xs bg-background border border-border rounded p-2 text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Leave empty to use original body"
                value={modifiedBody}
                onChange={(e) => setModifiedBody(e.target.value)}
              />
            </div>

            {/* Response */}
            {replay && (
              <div className="flex-1 overflow-auto p-3">
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">Response</div>
                {replay.response ? (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <StatusBadge code={replay.response.status_code} />
                      <span className="text-xs font-mono text-muted-foreground">{replay.response.duration_ms}ms</span>
                    </div>
                    <pre className="font-mono text-xs bg-background rounded p-3 text-foreground overflow-auto whitespace-pre-wrap break-all">
                      {replay.response.body
                        ? new TextDecoder().decode(new Uint8Array(replay.response.body))
                        : '(empty body)'}
                    </pre>
                  </>
                ) : (
                  <div className="text-sm text-red-400">{replay.error || 'Error'}</div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Plus className="mb-2 opacity-30" size={32} />
            <p className="text-sm">Select a request from the queue</p>
            <p className="text-xs mt-1">or send requests from History to Replay</p>
          </div>
        )}
      </div>
    </div>
  )
}
