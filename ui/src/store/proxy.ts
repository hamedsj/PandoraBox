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

function sameJSON(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function mergeProject(current: ProjectInfo | null, next: ProjectInfo): ProjectInfo {
  if (!current || current.path !== next.path) {
    return next
  }

  return {
    ...next,
    proxy: sameJSON(current.proxy, next.proxy) ? current.proxy : next.proxy,
    filters: sameJSON(current.filters, next.filters) ? current.filters : next.filters,
    scope: sameJSON(current.scope, next.scope) ? current.scope : next.scope,
    mcp_status: sameJSON(current.mcp_status, next.mcp_status) ? current.mcp_status : next.mcp_status,
    match_replace: sameJSON(current.match_replace, next.match_replace) ? current.match_replace : next.match_replace,
    middleware: sameJSON(current.middleware, next.middleware) ? current.middleware : next.middleware,
    flows: sameJSON(current.flows, next.flows) ? current.flows : next.flows,
  }
}

interface ProxyStore {
  // Status
  status: ProxyStatus | null
  setStatus: (s: ProxyStatus) => void

  // Project
  project: ProjectInfo | null
  setProject: (p: ProjectInfo) => void
  syncProject: (p: ProjectInfo) => void

  // Traffic
  requests: Request[]
  selectedRequestId: number | null
  setRequests: (reqs: Request[]) => void
  prependRequest: (req: Request) => void
  updateRequest: (req: Request) => void
  removeRequest: (id: number) => void
  removeRequests: (ids: number[]) => void
  clearRequests: () => void
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
    project: mergeProject(state.project, p),
    // Reset filters only when switching to a different project (path changed or initial load).
    // Same-project updates (scope rules, settings, etc.) must not wipe the user's active filters.
    ...(state.project?.path !== p.path ? { filters: p.filters } : {}),
  })),
  syncProject: (p) => set((state) => ({
    project: mergeProject(state.project, p),
    ...(state.project?.path !== p.path ? { filters: p.filters } : {}),
  })),

  requests: [],
  selectedRequestId: null,
  setRequests: (requests) => set({ requests }),
  prependRequest: (req) =>
    set((state) => ({ requests: [req, ...state.requests].slice(0, 5000) })),
  updateRequest: (req) =>
    set((state) => ({
      requests: state.requests.map((existing) => existing.id === req.id ? req : existing),
    })),
  removeRequest: (id) =>
    set((state) => ({
      requests: state.requests.filter((req) => req.id !== id),
      selectedRequestId: state.selectedRequestId === id ? null : state.selectedRequestId,
    })),
  removeRequests: (ids) =>
    set((state) => {
      const idSet = new Set(ids)
      return {
        requests: state.requests.filter((req) => !idSet.has(req.id)),
        selectedRequestId: state.selectedRequestId != null && idSet.has(state.selectedRequestId) ? null : state.selectedRequestId,
      }
    }),
  clearRequests: () => set({ requests: [], selectedRequestId: null, wsFrames: new Map() }),
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
