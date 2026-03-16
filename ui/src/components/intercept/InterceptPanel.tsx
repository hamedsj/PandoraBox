import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { Request } from '@/api/client'
import { useProxyStore } from '@/store/proxy'
import { MethodBadge } from '@/components/common/MethodBadge'
import { Shield, ShieldOff, Check, X, Edit3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { subscribeShortcutAction } from '@/lib/shortcuts'

export function InterceptPanel() {
  const status = useProxyStore((s) => s.status)
  const [queue, setQueue] = useState<Request[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editing, setEditing] = useState(false)

  const interceptEnabled = status?.intercept_enabled ?? false

  async function fetchQueue() {
    const r = await api.intercept.queue()
    setQueue(r.queue || [])
  }

  useEffect(() => {
    fetchQueue().catch(console.error)
    const t = setInterval(() => { fetchQueue().catch(console.error) }, 1000)
    return () => clearInterval(t)
  }, [])

  const selected = queue.find((r) => r.id === selectedId)

  useEffect(() => {
    return subscribeShortcutAction((actionId) => {
      if (actionId === 'common.closeCurrent' || actionId === 'common.escape') {
        setSelectedId(null)
        setEditing(false)
        return
      }

      if (actionId === 'intercept.toggleEnabled') {
        toggleIntercept().catch(console.error)
        return
      }

      if (actionId === 'intercept.selectPrev') {
        if (queue.length === 0) return
        const currentIndex = queue.findIndex((request) => request.id === selectedId)
        const nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1
        const request = queue[nextIndex]
        if (request) {
          setSelectedId(request.id)
          setEditing(false)
          setEditContent(buildRawRequest(request))
        }
        return
      }

      if (actionId === 'intercept.selectNext') {
        if (queue.length === 0) return
        const currentIndex = queue.findIndex((request) => request.id === selectedId)
        const nextIndex = currentIndex < 0 ? 0 : Math.min(queue.length - 1, currentIndex + 1)
        const request = queue[nextIndex]
        if (request) {
          setSelectedId(request.id)
          setEditing(false)
          setEditContent(buildRawRequest(request))
        }
        return
      }

      if (!selected) return

      if (actionId === 'intercept.toggleEditMode') {
        setEditing((value) => !value)
      } else if (actionId === 'intercept.forwardSelected') {
        forward(selected.id).catch(console.error)
      } else if (actionId === 'intercept.dropSelected') {
        drop(selected.id).catch(console.error)
      } else if (actionId === 'intercept.applyAndForward' && editing) {
        forward(selected.id).catch(console.error)
      }
    })
  }, [editing, queue, selected, selectedId])

  async function toggleIntercept() {
    await api.intercept.toggle(!interceptEnabled)
    const s = await api.proxy.status()
    useProxyStore.getState().setStatus(s)
  }

  async function forward(id: number) {
    if (editing && editContent) {
      const raw = btoa(editContent)
      await api.intercept.modify(id, raw)
    } else {
      await api.intercept.forward(id)
    }
    setSelectedId(null)
    setEditing(false)
    await fetchQueue()
  }

  async function drop(id: number) {
    await api.intercept.drop(id)
    setSelectedId(null)
    setEditing(false)
    await fetchQueue()
  }

  return (
    <div className="flex h-full">
      {/* Left: Queue list */}
      <div className="w-72 flex flex-col border-r border-border">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <button
            onClick={() => { toggleIntercept().catch(console.error) }}
            className={cn(
              'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-colors',
              interceptEnabled
                ? 'bg-primary/20 text-primary hover:bg-primary/30'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {interceptEnabled ? <Shield size={13} /> : <ShieldOff size={13} />}
            {interceptEnabled ? 'Intercept ON' : 'Intercept OFF'}
          </button>
          <span className="ml-auto text-xs text-muted-foreground">{queue.length} held</span>
        </div>

        <div className="flex-1 overflow-auto">
          {queue.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              {interceptEnabled ? 'Waiting for requests...' : 'Intercept is disabled'}
            </div>
          ) : (
            queue.map((req) => (
              <div
                key={req.id}
                onClick={() => {
                  setSelectedId(req.id)
                  setEditing(false)
                  setEditContent(buildRawRequest(req))
                }}
                className={cn(
                  'px-3 py-2 border-b border-border/50 cursor-pointer transition-colors',
                  selectedId === req.id ? 'bg-primary/10' : 'hover:bg-muted/30'
                )}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <MethodBadge method={req.method} />
                  <span className="text-xs font-mono text-muted-foreground truncate">{req.host}</span>
                </div>
                <div className="text-xs font-mono text-muted-foreground/70 truncate">{req.path}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: Editor */}
      <div className="flex-1 flex flex-col">
        {selected ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <span className="text-xs text-muted-foreground">Request #{selected.id}</span>
              <button
                onClick={() => setEditing(!editing)}
                className={cn(
                  'ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors',
                  editing ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground'
                )}
              >
                <Edit3 size={12} />
                {editing ? 'Editing' : 'Edit'}
              </button>
              <button
                onClick={() => { forward(selected.id).catch(console.error) }}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
              >
                <Check size={12} /> Forward
              </button>
              <button
                onClick={() => { drop(selected.id).catch(console.error) }}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
              >
                <X size={12} /> Drop
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              {editing ? (
                <textarea
                  className="w-full h-full font-mono text-xs bg-background border border-border rounded p-3 text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
              ) : (
                <pre className="font-mono text-xs text-foreground whitespace-pre-wrap break-all">
                  {buildRawRequest(selected)}
                </pre>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Select a request from the queue
          </div>
        )}
      </div>
    </div>
  )
}

function buildRawRequest(req: Request): string {
  let headers: Record<string, string[]> = {}
  try { headers = JSON.parse(req.headers) as Record<string, string[]> } catch { /* ignore */ }
  let raw = `${req.method} ${req.path}${req.query ? '?' + req.query : ''} HTTP/1.1\r\n`
  raw += `Host: ${req.host}\r\n`
  for (const [k, vs] of Object.entries(headers)) {
    if (k.toLowerCase() === 'host') continue
    for (const v of vs) raw += `${k}: ${v}\r\n`
  }
  raw += '\r\n'
  return raw
}
