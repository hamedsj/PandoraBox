export type RawBody = string | number[] | null | undefined

export interface DecodedBody {
  text: string
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

async function decompressBytes(bytes: Uint8Array, encoding: string): Promise<Uint8Array> {
  const normalized = encoding.trim().toLowerCase()
  if (!normalized || normalized === 'identity') return bytes

  if (typeof window !== 'undefined' && window.electron?.decodeBody) {
    const sourceBase64 = btoa(String.fromCharCode(...bytes))
    const result = await window.electron.decodeBody(sourceBase64, normalized)
    if (result.base64) {
      return bodyToBytes(result.base64)
    }
    if (result.error) {
      throw new Error(result.error)
    }
  }

  const encodings = normalized
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  let decoded = bytes
  for (const value of encodings.reverse()) {
    if (value === 'identity') continue

    if (typeof DecompressionStream === 'undefined') {
      throw new Error(`Compressed body decoding is unavailable for ${value} in this environment`)
    }

    let format: CompressionFormat
    if (value === 'gzip' || value === 'x-gzip') {
      format = 'gzip'
    } else if (value === 'deflate') {
      format = 'deflate'
    } else if (value === 'br') {
      throw new Error('Brotli decoding is unavailable in this environment')
    } else if (value === 'zstd') {
      throw new Error('Zstandard decoding is unavailable in this environment')
    } else {
      throw new Error(`Unsupported content-encoding: ${value}`)
    }

    const payload = decoded.buffer.slice(
      decoded.byteOffset,
      decoded.byteOffset + decoded.byteLength
    ) as ArrayBuffer

    const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream(format))
    const decompressed = await new Response(stream).arrayBuffer()
    decoded = new Uint8Array(decompressed)
  }

  return decoded
}

export async function decodeBodyForDisplay(body: RawBody, headers: string | undefined): Promise<DecodedBody> {
  const headerMap = normalizeHeaders(headers)
  const contentType = headerMap['content-type'] || 'application/octet-stream'
  const encoding = headerMap['content-encoding'] || ''
  const rawBytes = bodyToBytes(body)

  if (rawBytes.length === 0) {
    return {
      text: '',
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
        isBinary: true,
        wasCompressed: Boolean(encoding),
        encoding,
        contentType,
      }
    }

    return {
      text: new TextDecoder(charset).decode(decodedBytes),
      isBinary: false,
      wasCompressed: Boolean(encoding),
      encoding,
      contentType,
    }
  } catch (error) {
    if (encoding) {
      return {
        text: '',
        isBinary: false,
        wasCompressed: true,
        encoding,
        contentType,
        error: error instanceof Error ? error.message : 'Failed to decode compressed body',
      }
    }

    return {
      text: looksTextual(contentType) ? new TextDecoder().decode(rawBytes) : hexPreview(rawBytes),
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
