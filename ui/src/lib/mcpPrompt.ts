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
  return `The pandorabox MCP server is connected. Start by loading the full packet:
  traffic_get(id=${id}, decoded=true)

Then use action tools as needed:
  replay_request(request_id=${id}, modified_headers={...})
  intruder_start(request_id=${id}, raw_text="...", attack_type="sniper", payloads=[...])`
}

function websocketToolHints(id: number): string {
  return `The pandorabox MCP server is connected. Start by loading the upgrade request:
  traffic_get(id=${id}, decoded=true)

Then inspect WebSocket traffic (frames are stored separately):
  websocket_get_session(request_id=${id})
  websocket_get_frames(request_id=${id}, direction="s2c", limit=200)`
}

export function buildMcpPrompt(req: Request): string {
  const url = buildURL(req)
  const responseLine = formatResponseLine(req)
  const toolHints = isWebSocket(req) ? websocketToolHints(req.id) : httpToolHints(req.id)

  return `PandoraBox MCP — analyze and act on this captured request.

Request #${req.id}
${req.method} ${url}
Response: ${responseLine}

${toolHints}

Your task:

`
}

export function copyMcpPrompt(req: Request): Promise<void> {
  return copyText(buildMcpPrompt(req), 'Copied MCP prompt')
}
