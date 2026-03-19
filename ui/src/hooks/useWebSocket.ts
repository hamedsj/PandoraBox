import { useEffect, useRef, useCallback } from 'react'
import { useProxyStore } from '@/store/proxy'
import { useFlowsStore } from '@/store/flows'
import { useConsoleStore } from '@/store/console'
import { api } from '@/api/client'
import type { Request, ProxyStatus, WebSocketFrame } from '@/api/client'

interface WSEvent {
  type: string
  data: unknown
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const { prependRequest, removeRequest, setStatus, syncProject, setRequests, appendWsFrame } = useProxyStore()
  const setFlows = useFlowsStore((s) => s.setFlows)

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[WS] Connected')
    }

    ws.onmessage = (e) => {
      try {
        const evt: WSEvent = JSON.parse(e.data as string)
        handleEvent(evt)
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      console.log('[WS] Disconnected, reconnecting in 2s...')
      reconnectTimer.current = setTimeout(connect, 2000)
    }

    ws.onerror = () => ws.close()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleEvent(evt: WSEvent) {
    if (evt.type === 'request.captured') {
      const req = evt.data as Request
      if (req?.id) {
        prependRequest(req)
      }
    } else if (evt.type === 'proxy.status') {
      const status = evt.data as ProxyStatus
      setStatus(status)
    } else if (evt.type === 'project.updated') {
      const project = evt.data as import('@/api/client').ProjectInfo
      syncProject(project)
      setFlows(project.flows ?? [])
    } else if (evt.type === 'project.switched') {
      api.project.get().then((p) => {
        syncProject(p)
        setRequests([])
        setFlows(p.flows ?? [])
      }).catch(console.error)
    } else if (evt.type === 'websocket.frame') {
      appendWsFrame(evt.data as WebSocketFrame)
    } else if (evt.type === 'request.deleted') {
      const data = evt.data as { id?: number }
      if (typeof data?.id === 'number') {
        removeRequest(data.id)
      }
    } else if (evt.type === 'console.output') {
      useConsoleStore.getState().append(evt.data as { source: 'middleware' | 'flow'; text: string; timestamp: string })
    }
  }

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])
}
