import { create } from 'zustand'
import type { Request, ProxyStatus } from '@/api/client'

interface RequestFilters {
  // Toolbar (live)
  search: string
  method: string

  // Modal (staged, applied on confirm)
  host: string
  pathExtension: string
  contentType: string
  statusCodes: string[]   // e.g. ['2xx', '4xx'] — empty means all

  // Search options
  negativeSearch: boolean
  caseInsensitive: boolean
  useRegex: boolean
  searchScope: string[]   // e.g. ['host', 'path'] — empty means all fields
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
  statusCodes: [],
  negativeSearch: false,
  caseInsensitive: true,
  useRegex: false,
  searchScope: [],
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
