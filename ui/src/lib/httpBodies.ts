import { api } from '@/api/client'

export type RawBody = string | number[] | null | undefined

export interface DecodedBody {
  text: string
  /** Exact decoded (decompressed) bytes — source of truth for Raw and Hex views. */
  bytes: Uint8Array
  isBinary: boolean
  wasCompressed: boolean
  encoding: string
  contentType: string
  error?: string
}

function normalizeHeaders(headers: string | undefined): Record<string, string> {
  if (!headers) return {}
  try {
    const parsed = JSON.parse(headers) as Record<string, string[] | string>
    const normalized: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
    }
    return normalized
  } catch {
    return {}
  }
}

function bodyToBytes(body: RawBody): Uint8Array {
  if (!body) return new Uint8Array()
  if (Array.isArray(body)) return Uint8Array.from(body)

  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function parseCharset(contentType: string): string {
  const match = contentType.match(/charset=([^;]+)/i)
  return match?.[1]?.trim() || 'utf-8'
}

function looksTextual(contentType: string): boolean {
  const value = contentType.toLowerCase()
  return (
    value.startsWith('text/') ||
    value.includes('json') ||
    value.includes('xml') ||
    value.includes('javascript') ||
    value.includes('form-urlencoded') ||
    value.includes('svg') ||
    value.includes('graphql')
  )
}

function hexPreview(bytes: Uint8Array, limit = 256): string {
  const slice = bytes.slice(0, limit)
  const rows: string[] = []
  for (let i = 0; i < slice.length; i += 16) {
    const chunk = Array.from(slice.slice(i, i + 16))
    rows.push(chunk.map((byte) => byte.toString(16).padStart(2, '0')).join(' '))
  }
  return rows.join('\n')
}

/** Chunked base64 encode — safe for large bodies (avoids stack overflow from
 *  spreading every byte into String.fromCharCode). */
function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function inflateStream(bytes: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const payload = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream(format))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decompressBytes(bytes: Uint8Array, encoding: string): Promise<Uint8Array> {
  const normalized = encoding.trim().toLowerCase()
  if (!normalized || normalized === 'identity') return bytes

  // Electron ships the native Go decoders for every encoding.
  if (typeof window !== 'undefined' && window.electron?.decodeBody) {
    const result = await window.electron.decodeBody(bytesToBase64(bytes), normalized)
    if (result.error) throw new Error(result.error)
    if (result.base64 != null) return bodyToBytes(result.base64)
  }

  const encodings = normalized.split(',').map((value) => value.trim()).filter(Boolean)

  // Fast path: gzip is reliably decodable in-browser with no network round-trip.
  // Brotli, zstd, deflate variants and unknown encodings are delegated to the Go
  // backend (/api/decode), which decodes every Content-Encoding the proxy emits.
  const browserOnly = encodings.every((v) => v === 'identity' || v === 'gzip' || v === 'x-gzip')
  if (browserOnly && typeof DecompressionStream !== 'undefined') {
    try {
      let decoded = bytes
      for (const value of [...encodings].reverse()) {
        if (value === 'identity') continue
        decoded = await inflateStream(decoded, 'gzip')
      }
      return decoded
    } catch {
      // Fall through to the server decoder.
    }
  }

  const { base64 } = await api.decode(bytesToBase64(bytes), normalized)
  return bodyToBytes(base64)
}

export async function decodeBodyForDisplay(body: RawBody, headers: string | undefined): Promise<DecodedBody> {
  const headerMap = normalizeHeaders(headers)
  const contentType = headerMap['content-type'] || 'application/octet-stream'
  const encoding = headerMap['content-encoding'] || ''
  const rawBytes = bodyToBytes(body)

  if (rawBytes.length === 0) {
    return {
      text: '',
      bytes: rawBytes,
      isBinary: false,
      wasCompressed: false,
      encoding,
      contentType,
    }
  }

  try {
    const decodedBytes = await decompressBytes(rawBytes, encoding)
    const charset = parseCharset(contentType)
    const textual = looksTextual(contentType)

    if (!textual) {
      return {
        text: hexPreview(decodedBytes),
        bytes: decodedBytes,
        isBinary: true,
        wasCompressed: Boolean(encoding),
        encoding,
        contentType,
      }
    }

    return {
      text: new TextDecoder(charset).decode(decodedBytes),
      bytes: decodedBytes,
      isBinary: false,
      wasCompressed: Boolean(encoding),
      encoding,
      contentType,
    }
  } catch (error) {
    if (encoding) {
      return {
        text: '',
        bytes: new Uint8Array(),
        isBinary: false,
        wasCompressed: true,
        encoding,
        contentType,
        error: error instanceof Error ? error.message : 'Failed to decode compressed body',
      }
    }

    return {
      text: looksTextual(contentType) ? new TextDecoder().decode(rawBytes) : hexPreview(rawBytes),
      bytes: rawBytes,
      isBinary: !looksTextual(contentType),
      wasCompressed: Boolean(encoding),
      encoding,
      contentType,
      error: error instanceof Error ? error.message : 'Failed to decode body',
    }
  }
}

export function decodeBodyBytes(body: RawBody): string {
  const bytes = bodyToBytes(body)
  try {
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}
