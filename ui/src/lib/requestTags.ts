import type { Request } from '@/api/client'

export const REQUEST_TAG_HIGHLIGHTED = 'highlighted'
export const REQUEST_TAG_WEBSOCKET = 'websocket'

export function parseRequestTags(input: Pick<Request, 'tags'> | string | null | undefined): string[] {
  const raw = typeof input === 'string' ? input : input?.tags
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    return []
  }
}

export function hasRequestTag(req: Pick<Request, 'tags'>, tag: string): boolean {
  return parseRequestTags(req).includes(tag)
}

export function isHighlightedRequest(req: Pick<Request, 'tags'>): boolean {
  return hasRequestTag(req, REQUEST_TAG_HIGHLIGHTED)
}

export function isWebSocketRequest(req: Pick<Request, 'tags'>): boolean {
  return hasRequestTag(req, REQUEST_TAG_WEBSOCKET)
}

export function stringifyRequestTags(tags: string[]): string {
  return JSON.stringify(Array.from(new Set(tags)))
}
