const BASE = '/api'

export interface FilterConfig {
  search: string
  method: string
  host: string
  extensionShow: string
  extensionHide: string
  contentTypeShow: string
  contentTypeHide: string
  statusCodes: string[]
  negativeSearch: boolean
  caseInsensitive: boolean
  useRegex: boolean
  searchScope: string[]
}

export interface ScopeRule {
  enabled: boolean
  pattern_type: 'exact' | 'contains' | 'wildcard' | 'regex'
  host: string
  path: string
}

export interface ScopeConfig {
  enabled: boolean
  include_rules: ScopeRule[]
  exclude_rules: ScopeRule[]
}

export interface ProjectInfo {
  name: string
  path: string
  is_temp: boolean
  proxy: { port: number; intercept_enabled: boolean }
  filters: FilterConfig
  scope: ScopeConfig
}

export interface RecentProject {
  path: string
  name: string
  exists: boolean
}

export interface Request {
  id: number
  method: string
  scheme: string
  host: string
  path: string
  query: string
  headers: string
  body: number[] | null
  timestamp: string
  tags: string
  response?: Response
}

export interface Response {
  id: number
  request_id: number
  status_code: number
  status_text: string
  headers: string
  body: number[] | null
  duration_ms: number
  size_bytes: number
  timestamp: string
}

export interface Replay {
  id: number
  origin_request_id: number | null
  request_id: number
  response_id: number | null
  status: string
  error: string
  created_at: string
  request?: Request
  response?: Response
}

export interface ProxyStatus {
  running: boolean
  port: number
  intercept_enabled: boolean
  request_count: number
  queue_length: number
}

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    })
  }
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

export const api = {
  proxy: {
    status: () => get<ProxyStatus>('/proxy/status'),
    start: () => post<{ success: boolean; port: number }>('/proxy/start'),
    stop: () => post<{ success: boolean }>('/proxy/stop'),
    config: (body: { intercept_enabled?: boolean }) => put('/proxy/config', body),
  },
  requests: {
    list: (params?: {
      host?: string
      method?: string
      search?: string
      status_min?: number
      status_max?: number
      limit?: number
      offset?: number
    }) => get<{ requests: Request[]; total: number }>('/requests', params as Record<string, string | number>),
    get: (id: number) => get<Request>(`/requests/${id}`),
    delete: (id: number) => del(`/requests/${id}`),
  },
  intercept: {
    queue: () => get<{ queue: Request[] }>('/intercept/queue'),
    toggle: (enabled: boolean) => put<{ enabled: boolean }>('/intercept/toggle', { enabled }),
    forward: (id: number) => post<{ success: boolean }>(`/intercept/forward/${id}`),
    drop: (id: number) => post<{ success: boolean }>(`/intercept/drop/${id}`),
    modify: (id: number, raw: string) => post<{ success: boolean }>(`/intercept/modify/${id}`, { raw }),
  },
  replay: {
    create: (body: {
      request_id: number
      modified_headers?: Record<string, string>
      modified_body?: number[]
      modified_url?: string
    }) => post<Replay>('/replay', body),
    get: (id: number) => get<Replay>(`/replay/${id}`),
  },
  ca: {
    certUrl: () => BASE + '/ca/cert',
  },
  project: {
    get: () => get<ProjectInfo>('/project'),
    update: (body: { name?: string; proxy?: ProjectInfo['proxy']; filters?: FilterConfig; scope?: ScopeConfig }) =>
      put<ProjectInfo>('/project', body),
    saveAs: (path: string, name?: string) => post<ProjectInfo>('/project/save-as', { path, name }),
    recent: () => get<RecentProject[]>('/project/recent'),
    open: (path: string) => post<ProjectInfo>('/project/open', { path }),
    new: (path: string, name: string) => post<ProjectInfo>('/project/new', { path, name }),
  },
}
