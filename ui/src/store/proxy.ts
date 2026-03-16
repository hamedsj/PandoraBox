import { create } from 'zustand'
import type { Request, ProxyStatus } from '@/api/client'

interface RequestFilters {
  // Basic filters
  search: string
  method: string
  host: string

  // Advanced filters
  pathExtension: string
  contentType: string

  // Search options
  negativeSearch: boolean
  caseInsensitive: boolean
  useRegex: boolean
  searchScope: 'all' | 'host' | 'path' | 'query' | 'headers' | 'body'
}

interface ProxyStore {
  // Status
  status: ProxyStatus | null
  setStatus: (s: ProxyStatus) => void

  // Traffic
  requests: Request[]
  selectedRequestId: number | null
  setRequests: (reqs: Request[]) => void
  prependRequest: (req: Request) => void
  setSelectedRequestId: (id: number | null) => void

  // Replay queue (requests explicitly sent to replay)
  replayQueue: Request[]
  addToReplay: (req: Request) => void
  removeFromReplay: (id: number) => void
  clearReplay: () => void

  // Intercept
  interceptQueue: Request[]
  setInterceptQueue: (queue: Request[]) => void

  // Filters
  filters: RequestFilters
  setFilters: (f: Partial<RequestFilters>) => void
  resetFilters: () => void
}

const defaultFilters: RequestFilters = {
  search: '',
  method: '',
  host: '',
  pathExtension: '',
  contentType: '',
  negativeSearch: false,
  caseInsensitive: true,
  useRegex: false,
  searchScope: 'all',
}

export const useProxyStore = create<ProxyStore>((set) => ({
  status: null,
  setStatus: (s) => set({ status: s }),

  requests: [],
  selectedRequestId: null,
  setRequests: (requests) => set({ requests }),
  prependRequest: (req) =>
    set((state) => ({ requests: [req, ...state.requests].slice(0, 5000) })),
  setSelectedRequestId: (id) => set({ selectedRequestId: id }),

  replayQueue: [],
  addToReplay: (req) =>
    set((state) => {
      if (state.replayQueue.find((r) => r.id === req.id)) {
        return state
      }
      return { replayQueue: [req, ...state.replayQueue].slice(0, 100) }
    }),
  removeFromReplay: (id) =>
    set((state) => ({ replayQueue: state.replayQueue.filter((r) => r.id !== id) })),
  clearReplay: () => set({ replayQueue: [] }),

  interceptQueue: [],
  setInterceptQueue: (queue) => set({ interceptQueue: queue }),

  filters: defaultFilters,
  setFilters: (f) => set((state) => ({ filters: { ...state.filters, ...f } })),
  resetFilters: () => set({ filters: defaultFilters }),
}))
