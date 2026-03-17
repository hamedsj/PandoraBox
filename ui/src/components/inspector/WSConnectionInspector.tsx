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

  useEffect(() => {
    if (!selectedRequestId) {
      setWsData(null)
      return
    }
    setWsData(null)
    api.requests.wsFrames(selectedRequestId).then(setWsData).catch(console.error)
  }, [selectedRequestId])

  if (!selectedRequestId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select a connection to view frames
      </div>
    )
  }

  if (!wsData) {
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
