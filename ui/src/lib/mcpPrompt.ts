import type { Request } from '@/api/client'
import { copyText } from '@/lib/clipboard'
import { buildURL } from '@/lib/copyRequest'
import { isWebSocket } from '@/lib/requestFilters'

function formatResponseLine(req: Request): string {
  if (isWebSocket(req)) return 'WebSocket upgrade'
  const resp = req.response
  if (!resp) return '—'
  return `${resp.status_code} ${resp.status_text}`
}

function httpToolHints(id: number): string {
  return `Use the compact PandoraBox CLI. Start with bounded metadata:
  pandorabox traffic get ${id} --headers

Fetch bodies only when needed:
  pandorabox traffic get ${id} --body response --max-bytes 4000

Replay the request:
  pandorabox replay send ${id}`
}

function websocketToolHints(id: number): string {
  return `Use the compact PandoraBox CLI. Start by loading the upgrade request:
  pandorabox traffic get ${id} --headers

Then inspect WebSocket frames:
  pandorabox traffic ws ${id} --direction s2c -n 200 --max-bytes 1000`
}

export function buildMcpPrompt(req: Request): string {
  const url = buildURL(req)
  const responseLine = formatResponseLine(req)
  const toolHints = isWebSocket(req) ? websocketToolHints(req.id) : httpToolHints(req.id)

  return `PandoraBox CLI — analyze and act on this captured request.

Request #${req.id}
${req.method} ${url}
Response: ${responseLine}

${toolHints}

Your task:

`
}

export function copyMcpPrompt(req: Request): Promise<void> {
  return copyText(buildMcpPrompt(req), 'Copied CLI prompt')
}
