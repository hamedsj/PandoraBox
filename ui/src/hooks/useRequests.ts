import { useEffect } from 'react'
import { api } from '@/api/client'
import { useProxyStore } from '@/store/proxy'

export function useRequests() {
  const { filters, setRequests } = useProxyStore()

  useEffect(() => {
    let cancelled = false

    async function loadAllRequests() {
      const pageSize = 500
      const params: Record<string, string | number> = {}
      if (filters.search && !filters.useRegex) params.search = filters.search
      if (filters.host) params.host = filters.host
      if (filters.method) params.method = filters.method

      const firstPage = await api.requests.list({ ...params, limit: pageSize, offset: 0 })
      if (cancelled) return

      const requests = [...(firstPage.requests || [])]
      const total = firstPage.total || requests.length

      for (let offset = requests.length; offset < total; offset += pageSize) {
        const page = await api.requests.list({ ...params, limit: pageSize, offset })
        if (cancelled) return
        requests.push(...(page.requests || []))
      }

      if (!cancelled) {
        setRequests(requests)
      }
    }

    loadAllRequests().catch(console.error)

    return () => {
      cancelled = true
    }
  }, [filters, setRequests])
}
