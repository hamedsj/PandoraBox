import type { Request, ScopeConfig } from '@/api/client'
import type { RequestFilters } from '@/store/proxy'
import { decodeBodyBytes, type RawBody } from '@/lib/httpBodies'
import { isWebSocketRequest } from '@/lib/requestTags'

function bytesToText(body: RawBody): string {
  return decodeBodyBytes(body)
}

/**
 * Per-request cache of the decoded, searchable text fields. Keyed by the
 * Request object reference: when a response arrives, updateRequest replaces the
 * object, so the stale entry is dropped and recomputed (and GC'd) automatically.
 * This keeps live traffic + body-scope search from re-decoding every body on
 * each keystroke/recompute.
 */
interface SearchableFields {
  reqHeaders: string
  reqBody: string
  resHeaders: string
  resBody: string
}

const searchableCache = new WeakMap<Request, SearchableFields>()

function searchableFields(req: Request): SearchableFields {
  let cached = searchableCache.get(req)
  if (!cached) {
    cached = {
      reqHeaders: parseHeaderText(req.headers),
      reqBody: bytesToText(req.body),
      resHeaders: parseHeaderText(req.response?.headers),
      resBody: bytesToText(req.response?.body),
    }
    searchableCache.set(req, cached)
  }
  return cached
}

function parseHeaderText(headers: string | undefined): string {
  if (!headers) return ''
  try {
    const parsed = JSON.parse(headers) as Record<string, string[] | string>
    return Object.entries(parsed)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('\n')
  } catch {
    return headers
  }
}

function splitPatterns(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

function matchesExtension(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false
  const normalizedPath = path.toLowerCase().split('?')[0]
  return patterns.some((pattern) => normalizedPath.endsWith(`.${pattern.replace(/^\./, '')}`))
}

function matchesContains(value: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false
  const normalized = value.toLowerCase()
  return patterns.some((pattern) => normalized.includes(pattern))
}

function matchesSearch(value: string, filters: RequestFilters): boolean {
  if (!filters.search) return false

  if (filters.useRegex) {
    try {
      return new RegExp(filters.search, filters.caseInsensitive ? 'i' : '').test(value)
    } catch {
      return false
    }
  }

  const haystack = filters.caseInsensitive ? value.toLowerCase() : value
  const needle = filters.caseInsensitive ? filters.search.toLowerCase() : filters.search
  return haystack.includes(needle)
}

// ── Scope matching (mirrors internal/proxy/scope.go exactly) ─────────────────

function matchPattern(type: string, pattern: string, value: string): boolean {
  switch (type) {
    case 'exact':    return pattern === value
    case 'contains': return value.includes(pattern)
    case 'wildcard': return wildcardMatch(pattern, value)
    case 'regex': {
      try { return new RegExp(pattern).test(value) } catch { return false }
    }
  }
  return false
}

function wildcardMatch(pattern: string, value: string): boolean {
  // Translate glob pattern to regex (mirrors Go filepath.Match semantics)
  let re = '^'
  for (const ch of pattern) {
    if (ch === '*') re += '.*'
    else if (ch === '?') re += '.'
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  re += '$'
  try { return new RegExp(re).test(value) } catch { return false }
}

export function isInScope(host: string, path: string, scope: ScopeConfig): boolean {
  if (!scope.enabled) return true

  const activeIncludes = scope.include_rules.filter((r) => r.enabled)
  const activeExcludes = scope.exclude_rules.filter((r) => r.enabled)

  const matchesInclude =
    activeIncludes.length === 0 ||
    activeIncludes.some(
      (r) =>
        matchPattern(r.pattern_type, r.host, host) &&
        (r.path === '' || matchPattern(r.pattern_type, r.path, path)),
    )

  if (!matchesInclude) return false

  const matchesExclude = activeExcludes.some(
    (r) =>
      matchPattern(r.pattern_type, r.host, host) &&
      (r.path === '' || matchPattern(r.pattern_type, r.path, path)),
  )

  return !matchesExclude
}

export function isWebSocket(req: Request): boolean {
  return isWebSocketRequest(req)
}

export function countActiveFilters(filters: RequestFilters): number {
  return [
    filters.search,
    filters.host,
    filters.extensionShow,
    filters.extensionHide,
    filters.contentTypeShow,
    filters.contentTypeHide,
    filters.statusCodes.length > 0,
    filters.negativeSearch,
    !filters.caseInsensitive,
    filters.useRegex,
    filters.searchScope.length > 0,
  ].filter(Boolean).length
}

export interface MatchScopes {
  host: boolean
  path: boolean
  query: boolean
  reqHeaders: boolean
  reqBody: boolean
  resHeaders: boolean
  resBody: boolean
}

/**
 * Returns which fields the active search term matched for a request, honouring
 * the configured search scope. Used to highlight matches and to badge matches
 * that occurred in fields not visible in the table (headers/bodies).
 */
export function searchMatchScopes(req: Request, filters: RequestFilters): MatchScopes {
  const empty: MatchScopes = {
    host: false, path: false, query: false,
    reqHeaders: false, reqBody: false, resHeaders: false, resBody: false,
  }
  if (!filters.search) return empty

  const scopeEnabled = (field: string) =>
    filters.searchScope.length === 0 || filters.searchScope.includes(field)
  const fields = searchableFields(req)
  const test = (field: string, value: string) =>
    scopeEnabled(field) && !!value && matchesSearch(value, filters)

  return {
    host: test('host', req.host),
    path: test('path', req.path),
    query: test('query', req.query),
    reqHeaders: test('req.headers', fields.reqHeaders),
    reqBody: test('req.body', fields.reqBody),
    resHeaders: test('res.headers', fields.resHeaders),
    resBody: test('res.body', fields.resBody),
  }
}

export function filterRequests(requests: Request[], filters: RequestFilters, scope?: ScopeConfig): Request[] {
  const showExtensions = splitPatterns(filters.extensionShow)
  const hideExtensions = splitPatterns(filters.extensionHide)
  const showTypes = splitPatterns(filters.contentTypeShow)
  const hideTypes = splitPatterns(filters.contentTypeHide)

  return requests.filter((req) => {
    if (filters.inScopeOnly && scope) {
      if (!isInScope(req.host, req.path, scope)) return false
    }

    if (filters.method && req.method !== filters.method) return false

    if (filters.host && !req.host.toLowerCase().includes(filters.host.toLowerCase())) return false

    if (showExtensions.length > 0 && !matchesExtension(req.path, showExtensions)) return false
    if (hideExtensions.length > 0 && matchesExtension(req.path, hideExtensions)) return false

    if (filters.statusCodes.length > 0) {
      const status = req.response?.status_code
      if (!status) return false
      const matches = filters.statusCodes.some((code) => Math.floor(status / 100) === parseInt(code[0], 10))
      if (!matches) return false
    }

    if (showTypes.length > 0 || hideTypes.length > 0) {
      const responseHeaders = searchableFields(req).resHeaders
      if (showTypes.length > 0 && !matchesContains(responseHeaders, showTypes)) return false
      if (hideTypes.length > 0 && matchesContains(responseHeaders, hideTypes)) return false
    }

    if (filters.search) {
      const scopeEnabled = (field: string) =>
        filters.searchScope.length === 0 || filters.searchScope.includes(field)

      const fields = searchableFields(req)
      const candidates: string[] = []
      if (scopeEnabled('host')) candidates.push(req.host)
      if (scopeEnabled('path')) candidates.push(req.path)
      if (scopeEnabled('query') && req.query) candidates.push(req.query)
      if (scopeEnabled('req.headers')) candidates.push(fields.reqHeaders)
      if (scopeEnabled('req.body')) candidates.push(fields.reqBody)
      if (scopeEnabled('res.headers')) candidates.push(fields.resHeaders)
      if (scopeEnabled('res.body')) candidates.push(fields.resBody)

      const matches = candidates.some((candidate) => candidate && matchesSearch(candidate, filters))
      if (filters.negativeSearch ? matches : !matches) return false
    }

    return true
  })
}
