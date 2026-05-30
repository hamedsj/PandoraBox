import type { Request } from '@/api/client'

export function getRawRequestText(request: Pick<Request, 'raw' | 'method' | 'path' | 'query' | 'host' | 'headers' | 'body'>): string {
  if (request.raw) {
    return decodeBase64ToText(request.raw)
  }
  return buildRawRequest(request)
}

export function encodeRawRequest(raw: string): string {
  const bytes = new TextEncoder().encode(raw)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

export function applyAutomaticContentLength(raw: string): string {
  const separator = raw.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n'
  const headerLineBreak = separator === '\r\n\r\n' ? '\r\n' : '\n'
  const splitIndex = raw.indexOf(separator)
  const headerText = splitIndex >= 0 ? raw.slice(0, splitIndex) : raw
  const bodyText = splitIndex >= 0 ? raw.slice(splitIndex + separator.length) : ''
  const headerLines = headerText.split(headerLineBreak)

  if (headerLines.length === 0 || !headerLines[0]) {
    return raw
  }

  // A chunked request frames its own body; never inject Content-Length there.
  const isChunked = headerLines.some(
    (line, i) => i > 0 && /^transfer-encoding\s*:/i.test(line) && /chunked/i.test(line),
  )
  if (isChunked) {
    return raw
  }

  const contentLength = new TextEncoder().encode(bodyText).length
  let found = false
  const nextHeaders = headerLines.map((line, index) => {
    if (index === 0) return line
    if (/^content-length\s*:/i.test(line)) {
      found = true
      // Always reflect the real body length, including 0 for an emptied body.
      return `Content-Length: ${contentLength}`
    }
    return line
  })

  // Add the header only when there is a body to describe; a bodyless GET should
  // not gain a Content-Length: 0.
  if (!found && splitIndex >= 0 && bodyText.length > 0) {
    nextHeaders.push(`Content-Length: ${contentLength}`)
  }

  return `${nextHeaders.join(headerLineBreak)}${separator}${bodyText}`
}

function buildRawRequest(request: Pick<Request, 'method' | 'path' | 'query' | 'host' | 'headers' | 'body'>): string {
  const headers = tryParseHeaders(request.headers)
  let raw = `${request.method} ${request.path}${request.query ? `?${request.query}` : ''} HTTP/1.1\r\n`
  raw += `Host: ${request.host}\r\n`
  for (const [key, values] of Object.entries(headers)) {
    if (key.toLowerCase() === 'host') continue
    for (const value of values) {
      raw += `${key}: ${value}\r\n`
    }
  }
  raw += '\r\n'
  if (request.body) {
    raw += typeof request.body === 'string' ? decodeBase64ToText(request.body) : new TextDecoder().decode(Uint8Array.from(request.body))
  }
  return raw
}

function tryParseHeaders(headers: string): Record<string, string[]> {
  try {
    return JSON.parse(headers) as Record<string, string[]>
  } catch {
    return {}
  }
}

function decodeBase64ToText(base64: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}
