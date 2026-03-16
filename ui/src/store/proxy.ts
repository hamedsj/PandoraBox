import { create } from 'zustand'
import type { Request, ProxyStatus, ProjectInfo, FilterConfig } from '@/api/client'

export type { FilterConfig }

export type RequestFilters = FilterConfig

const defaultHiddenExtensions = [
  'js',
  'gif',
  'jpg',
  'png',
  'css',
  'woff',
  'woff2',
  'svg',
  'json',
  'map',
  'fnt',
  'ogg',
  'jpeg',
  'img',
  'exe',
  'mp4',
  'flv',
  'pdf',
  'doc',
  'ogv',
  'webm',
  'wmv',
  'webp',
  'mov',
  'mp3',
  'm4a',
  'm4p',
  'ppt',
  'pptx',
  'scss',
  'tif',
  'tiff',
  'ttf',
  'otf',
  'bmp',
  'ico',
  'eot',
  'htc',
  'swf',
  'rtf',
  'image',
  'rf',
  'txt',
  'ml',
  'ip',
] as const

export const defaultHiddenExtensionsCSV = defaultHiddenExtensions.join(', ')

interface ProxyStore {
  // Status
  status: ProxyStatus | null
  setStatus: (s: ProxyStatus) => void

  // Project
  project: ProjectInfo | null
  setProject: (p: ProjectInfo) => void

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

  // Filters (sourced from project.json, not localStorage)
  filters: RequestFilters
  setFilters: (f: Partial<RequestFilters>) => void
  resetFilters: () => void
}

export const defaultFilters: RequestFilters = {
  search: '',
  method: '',
  host: '',
  extensionShow: '',
  extensionHide: defaultHiddenExtensionsCSV,
  contentTypeShow: '',
  contentTypeHide: '',
  statusCodes: [],
  negativeSearch: false,
  caseInsensitive: true,
  useRegex: false,
  searchScope: [],
}

export const useProxyStore = create<ProxyStore>((set) => ({
  status: null,
  setStatus: (s) => set({ status: s }),

  project: null,
  setProject: (p) => set({ project: p, filters: p.filters }),

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
