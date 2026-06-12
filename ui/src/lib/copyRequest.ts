import type { Request } from '@/api/client'
import { copyText } from '@/lib/clipboard'
import { decodeBodyBytes, type RawBody } from '@/lib/httpBodies'
import { displayHost } from '@/lib/utils'

// Headers that are set automatically by clients — skip in generated snippets
const SKIP_HEADERS = new Set([
  'content-length', 'transfer-encoding', 'connection',
  'keep-alive', 'upgrade', 'proxy-connection',
])

function parseHeaders(raw: string): Record<string, string[]> {
  try { return JSON.parse(raw) as Record<string, string[]> } catch { return {} }
}

export function buildURL(req: Request): string {
  return `${req.scheme}://${displayHost(req.host, req.scheme)}${req.path}${req.query ? '?' + req.query : ''}`
}

function getBody(req: Request): string {
  if (!req.body) return ''
  return decodeBodyBytes(req.body as RawBody)
}

export function copyURL(req: Request): Promise<void> {
  return copyText(buildURL(req), 'Copied URL')
}

export function buildRawHTTP(req: Request): string {
  const headers = parseHeaders(req.headers)
  let raw = `${req.method} ${req.path}${req.query ? '?' + req.query : ''} HTTP/1.1\r\n`
  raw += `Host: ${displayHost(req.host, req.scheme)}\r\n`
  for (const [k, vs] of Object.entries(headers)) {
    if (k.toLowerCase() === 'host') continue
    for (const v of vs) raw += `${k}: ${v}\r\n`
  }
  raw += '\r\n'
  raw += getBody(req)
  return raw
}

export function copyRawRequest(req: Request): Promise<void> {
  return copyText(buildRawHTTP(req), 'Copied raw request')
}

export function copyAsCurl(req: Request): Promise<void> {
  const headers = parseHeaders(req.headers)
  const url = buildURL(req)
  const body = getBody(req)

  const parts: string[] = [`curl '${url}'`]

  if (req.method !== 'GET') {
    parts.push(`-X ${req.method}`)
  }

  for (const [k, vs] of Object.entries(headers)) {
    const lower = k.toLowerCase()
    if (lower === 'host' || SKIP_HEADERS.has(lower)) continue
    for (const v of vs) {
      parts.push(`-H '${k}: ${v.replace(/'/g, "'\\''")}'`)
    }
  }

  if (body) {
    // Use $'...' quoting to safely embed special chars
    const escaped = body.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    parts.push(`--data-binary $'${escaped}'`)
  }

  return copyText(parts.join(' \\\n  '), 'Copied cURL command')
}

export function copyAsFetch(req: Request): Promise<void> {
  const headers = parseHeaders(req.headers)
  const url = buildURL(req)
  const body = getBody(req)

  const headerEntries: string[] = []
  for (const [k, vs] of Object.entries(headers)) {
    const lower = k.toLowerCase()
    if (lower === 'host' || SKIP_HEADERS.has(lower)) continue
    for (const v of vs) {
      headerEntries.push(`    '${k}': '${v.replace(/'/g, "\\'")}'`)
    }
  }

  const lines: string[] = [`await fetch('${url}', {`]
  lines.push(`  method: '${req.method}',`)

  if (headerEntries.length > 0) {
    lines.push('  headers: {')
    lines.push(headerEntries.join(',\n'))
    lines.push('  },')
  }

  if (body) {
    lines.push(`  body: ${JSON.stringify(body)},`)
  }

  lines.push('})')

  return copyText(lines.join('\n'), 'Copied fetch() snippet')
}
