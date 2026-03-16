import { create } from 'zustand'
import type { Request, ProxyStatus } from '@/api/client'

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
  filters: {
    search: string
    host: string
    method: string
  }
  setFilters: (f: Partial<ProxyStore['filters']>) => void
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

  // Replay queue
  replayQueue: [],
  addToReplay: (req) =>
    set((state) => {
      // Don't add duplicates
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

  filters: { search: '', host: '', method: '' },
  setFilters: (f) => set((state) => ({ filters: { ...state.filters, ...f } })),
}))
