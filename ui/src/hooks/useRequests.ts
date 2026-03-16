import { useEffect } from 'react'
import { api } from '@/api/client'
import { useProxyStore } from '@/store/proxy'

export function useRequests() {
  const { filters, setRequests } = useProxyStore()

  useEffect(() => {
    const params: Record<string, string | number> = {
      limit: filters.useRegex ? 2000 : 200,
    }
    if (filters.search && !filters.useRegex) params.search = filters.search
    if (filters.host) params.host = filters.host
    if (filters.method) params.method = filters.method

    api.requests.list(params).then((r) => setRequests(r.requests || [])).catch(console.error)
  }, [filters, setRequests])
}
