import { create } from 'zustand'
import type { Request, ProxyStatus, ProjectInfo, FilterConfig, WebSocketFrame } from '@/api/client'

export type { FilterConfig }

export type RequestFilters = FilterConfig

export interface ReplayQueueItem {
  queueId: number
  request: Request
}

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
  replayQueue: ReplayQueueItem[]
  replayAttentionTick: number
  addToReplay: (req: Request) => void
  duplicateReplayItem: (queueId: number) => void
  removeFromReplay: (queueId: number) => void
  removeRequestFromReplay: (requestId: number) => void
  clearReplay: () => void

  // Intercept
  interceptQueue: Request[]
  setInterceptQueue: (queue: Request[]) => void

  // Filters (sourced from project.json, not localStorage)
  filters: RequestFilters
  setFilters: (f: Partial<RequestFilters>) => void
  resetFilters: () => void

  // WebSocket frames keyed by session_id
  wsFrames: Map<number, WebSocketFrame[]>
  appendWsFrame: (frame: WebSocketFrame) => void
  clearWsFrames: (sessionId: number) => void
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
  inScopeOnly: true,
}

export const useProxyStore = create<ProxyStore>((set) => ({
  status: null,
  setStatus: (s) => set({ status: s }),

  project: null,
  setProject: (p) => set((state) => ({
    project: p,
    // Reset filters only when switching to a different project (path changed or initial load).
    // Same-project updates (scope rules, settings, etc.) must not wipe the user's active filters.
    ...(state.project?.path !== p.path ? { filters: p.filters } : {}),
  })),

  requests: [],
  selectedRequestId: null,
  setRequests: (requests) => set({ requests }),
  prependRequest: (req) =>
    set((state) => ({ requests: [req, ...state.requests].slice(0, 5000) })),
  setSelectedRequestId: (id) => set({ selectedRequestId: id }),

  replayQueue: [],
  replayAttentionTick: 0,
  addToReplay: (req) =>
    set((state) => {
      if (state.replayQueue.find((entry) => entry.request.id === req.id)) {
        return { replayAttentionTick: state.replayAttentionTick + 1 }
      }
      const nextQueueId = state.replayQueue.reduce((max, entry) => Math.max(max, entry.queueId), 0) + 1
      return {
        replayQueue: [{ queueId: nextQueueId, request: req }, ...state.replayQueue].slice(0, 100),
        replayAttentionTick: state.replayAttentionTick + 1,
      }
    }),
  duplicateReplayItem: (queueId) =>
    set((state) => {
      const source = state.replayQueue.find((entry) => entry.queueId === queueId)
      if (!source) return state
      const nextQueueId = state.replayQueue.reduce((max, entry) => Math.max(max, entry.queueId), 0) + 1
      return {
        replayQueue: [{ queueId: nextQueueId, request: source.request }, ...state.replayQueue].slice(0, 100),
        replayAttentionTick: state.replayAttentionTick + 1,
      }
    }),
  removeFromReplay: (queueId) =>
    set((state) => ({ replayQueue: state.replayQueue.filter((entry) => entry.queueId !== queueId) })),
  removeRequestFromReplay: (requestId) =>
    set((state) => ({ replayQueue: state.replayQueue.filter((entry) => entry.request.id !== requestId) })),
  clearReplay: () => set({ replayQueue: [] }),

  interceptQueue: [],
  setInterceptQueue: (queue) => set({ interceptQueue: queue }),

  filters: defaultFilters,
  setFilters: (f) => set((state) => ({ filters: { ...state.filters, ...f } })),
  resetFilters: () => set({ filters: defaultFilters }),

  wsFrames: new Map(),
  appendWsFrame: (frame) =>
    set((state) => {
      const existing = state.wsFrames.get(frame.session_id) ?? []
      const updated = new Map(state.wsFrames)
      updated.set(frame.session_id, [...existing, frame])
      return { wsFrames: updated }
    }),
  clearWsFrames: (sessionId) =>
    set((state) => {
      const updated = new Map(state.wsFrames)
      updated.delete(sessionId)
      return { wsFrames: updated }
    }),
}))
