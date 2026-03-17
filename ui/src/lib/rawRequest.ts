export interface RawRequestData {
  method: string
  host: string
  path: string
  headers: string
  body: string
}

export function formatRawRequest(req: {
  method: string
  host: string
  path: string
  request_headers?: string
  request_body?: string
}): string {
  const path = req.path || '/'
  const lines: string[] = []
  lines.push(`${req.method} ${path} HTTP/1.1`)
  lines.push(`Host: ${req.host}`)

  if (req.request_headers) {
    try {
      const hdrs = JSON.parse(req.request_headers) as Record<string, string | string[]>
      for (const [k, v] of Object.entries(hdrs)) {
        if (k.toLowerCase() !== 'host') {
          const val = Array.isArray(v) ? v.join(', ') : String(v)
          lines.push(`${k}: ${val}`)
        }
      }
    } catch {
      lines.push(req.request_headers)
    }
  }

  lines.push('')
  if (req.request_body) {
    lines.push(req.request_body)
  }

  return lines.join('\r\n')
}
