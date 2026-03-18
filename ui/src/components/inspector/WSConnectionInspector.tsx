import { useEffect, useState } from 'react'
import { useProxyStore } from '@/store/proxy'
import { api } from '@/api/client'
import type { WebSocketSession, WebSocketFrame } from '@/api/client'
import { WSFramesPanel } from './WSFramesPanel'

export function WSConnectionInspector() {
  const selectedRequestId = useProxyStore((s) => s.selectedRequestId)
  const [wsData, setWsData] = useState<{
    session: WebSocketSession | null
    frames: WebSocketFrame[] | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedRequestId) {
      setWsData(null)
      setError(null)
      return
    }
    let cancelled = false
    setWsData(null)
    setError(null)
    api.requests.wsFrames(selectedRequestId)
      .then((data) => {
        if (!cancelled) {
          setWsData(data)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load WebSocket frames')
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedRequestId])

  if (!selectedRequestId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select a connection to view frames
      </div>
    )
  }

  if (!wsData) {
    if (error) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground text-xs px-4 text-center">
          {error}
        </div>
      )
    }
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        Loading frames…
      </div>
    )
  }

  return (
    <WSFramesPanel
      session={wsData.session}
      initialFrames={wsData.frames}
    />
  )
}
