import type { Request } from '@/api/client'

function bodyToBase64(body: string | number[] | null | undefined): string | null {
  if (body == null) return null
  if (typeof body === 'string') return body
  // number[] → base64
  const bytes = new Uint8Array(body)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function parseHeaders(h: string): Record<string, string[]> {
  try {
    const parsed = JSON.parse(h)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    // ignore
  }
  return {}
}

function isoTimestamp(): string {
  return new Date().toISOString()
}

function exportFilename(format: 'json' | 'har'): string {
  const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '')
  return `pandora-export-${ts}.${format}`
}

function buildJsonExport(requests: Request[]): object {
  return {
    version: '1',
    tool: 'PandoraBox',
    exported_at: isoTimestamp(),
    count: requests.length,
    entries: requests.map((req) => {
      const entry: Record<string, unknown> = {
        id: req.id,
        timestamp: req.timestamp,
        request: {
          method: req.method,
          scheme: req.scheme,
          host: req.host,
          path: req.path,
          query: req.query ?? '',
          headers: parseHeaders(req.headers),
          body_b64: bodyToBase64(req.body),
        },
      }
      if (req.response) {
        entry.response = {
          status_code: req.response.status_code,
          status_text: req.response.status_text,
          headers: parseHeaders(req.response.headers),
          body_b64: bodyToBase64(req.response.body),
          duration_ms: req.response.duration_ms,
          size_bytes: req.response.size_bytes,
        }
      }
      return entry
    }),
  }
}

function headersToHar(h: string): Array<{ name: string; value: string }> {
  const parsed = parseHeaders(h)
  const result: Array<{ name: string; value: string }> = []
  for (const [name, values] of Object.entries(parsed)) {
    for (const value of values) {
      result.push({ name, value })
    }
  }
  return result
}

function buildHarExport(requests: Request[]): object {
  return {
    log: {
      version: '1.2',
      creator: { name: 'PandoraBox', version: '1.0' },
      entries: requests.map((req) => {
        const url = `${req.scheme}://${req.host}${req.path || '/'}${req.query ? '?' + req.query : ''}`
        const reqBody = bodyToBase64(req.body)
        const entry: Record<string, unknown> = {
          startedDateTime: req.timestamp,
          time: req.response?.duration_ms ?? 0,
          request: {
            method: req.method,
            url,
            httpVersion: 'HTTP/1.1',
            headers: headersToHar(req.headers),
            queryString: req.query
              ? req.query.split('&').map((pair) => {
                  const [name, ...rest] = pair.split('=')
                  return { name: decodeURIComponent(name), value: decodeURIComponent(rest.join('=')) }
                })
              : [],
            cookies: [],
            headersSize: -1,
            bodySize: reqBody ? atob(reqBody).length : 0,
            ...(reqBody != null
              ? {
                  postData: {
                    mimeType: parseHeaders(req.headers)['Content-Type']?.[0] ?? 'application/octet-stream',
                    text: reqBody,
                    encoding: 'base64',
                  },
                }
              : {}),
          },
        }

        if (req.response) {
          const resBody = bodyToBase64(req.response.body)
          entry.response = {
            status: req.response.status_code,
            statusText: req.response.status_text,
            httpVersion: 'HTTP/1.1',
            headers: headersToHar(req.response.headers),
            cookies: [],
            content: {
              size: req.response.size_bytes,
              mimeType: parseHeaders(req.response.headers)['Content-Type']?.[0] ?? 'application/octet-stream',
              ...(resBody != null ? { text: resBody, encoding: 'base64' } : {}),
            },
            redirectURL: '',
            headersSize: -1,
            bodySize: req.response.size_bytes,
          }
        } else {
          entry.response = {
            status: 0,
            statusText: '',
            httpVersion: 'HTTP/1.1',
            headers: [],
            cookies: [],
            content: { size: 0, mimeType: '' },
            redirectURL: '',
            headersSize: -1,
            bodySize: -1,
          }
        }

        entry.cache = {}
        entry.timings = { send: 0, wait: req.response?.duration_ms ?? 0, receive: 0 }

        return entry
      }),
    },
  }
}

function downloadBlob(data: object, filename: string): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function exportSelected(
  ids: number[],
  format: 'json' | 'har',
  apiGet: (id: number) => Promise<Request>
): Promise<void> {
  const requests = await Promise.all(ids.map((id) => apiGet(id)))
  const data = format === 'har' ? buildHarExport(requests) : buildJsonExport(requests)
  downloadBlob(data, exportFilename(format))
}
