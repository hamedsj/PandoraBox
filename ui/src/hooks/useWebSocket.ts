import { useEffect, useRef, useCallback } from 'react'
import { useProxyStore } from '@/store/proxy'
import { api } from '@/api/client'
import type { Request, ProxyStatus } from '@/api/client'

interface WSEvent {
  type: string
  data: unknown
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const { prependRequest, setStatus, setProject, setRequests } = useProxyStore()

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
    } else if (evt.type === 'project.switched') {
      api.project.get().then((p) => {
        setProject(p)
        setRequests([])
      }).catch(console.error)
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
