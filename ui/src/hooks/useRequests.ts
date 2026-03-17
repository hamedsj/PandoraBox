import { useEffect } from 'react'
import { api } from '@/api/client'
import { useProxyStore } from '@/store/proxy'

export function useRequests() {
  const setRequests = useProxyStore((s) => s.setRequests)
  // Only fields the server can filter natively (exact/LIKE on indexed columns).
  // Search is intentionally excluded: the server only checks host/path/query, but the
  // client-side filterRequests also checks headers and bodies. Passing search to the
  // server would pre-filter out valid matches before the client ever sees them.
  const host   = useProxyStore((s) => s.filters.host)
  const method = useProxyStore((s) => s.filters.method)

  useEffect(() => {
    let cancelled = false

    async function loadAllRequests() {
      const pageSize = 500
      const params: Record<string, string | number> = {}
      if (host)   params.host   = host
      if (method) params.method = method

      const firstPage = await api.requests.list({ ...params, limit: pageSize, offset: 0 })
      if (cancelled) return

      const requests = [...(firstPage.requests || [])]
      const total = firstPage.total || requests.length

      for (let offset = requests.length; offset < total; offset += pageSize) {
        const page = await api.requests.list({ ...params, limit: pageSize, offset })
        if (cancelled) return
        requests.push(...(page.requests || []))
      }

      if (!cancelled) setRequests(requests)
    }

    loadAllRequests().catch(console.error)
    return () => { cancelled = true }
  }, [host, method, setRequests])
}
