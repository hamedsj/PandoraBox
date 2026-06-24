# CLAUDE.md — PandoraBox

Context for AI assistants (Claude Code) working on this project.

## What this project is

PandoraBox is a programmable MITM proxy (like Burp Suite / Caido) with a compact REST-backed CLI for Claude/LLM agent integration. The legacy MCP server still exists for compatibility but is opt-in. The user is the primary owner. Other engineers may be brought in to implement specific features.

## Build pipeline — always use `make build`

After ANY change to Go or React files, the full pipeline must run:

```bash
make build
# = npm run build  →  cp -r ui/dist cmd/pandorabox/dist  →  go build -o bin/pandorabox
```

**Critical:** `//go:embed dist` in `cmd/pandorabox/embed.go` embeds `cmd/pandorabox/dist` (not `ui/dist`). Running only `npm run build` will NOT update the running binary. Always run `make build`.

## Development modes

```bash
make dev-backend   # Go binary serves embedded UI on :7777
make dev-ui        # Vite HMR dev server (proxies /api + /ws to :7777)
make dev-electron  # Builds Go binary then launches Electron
```

For UI-only iteration: run `make dev-backend` in one terminal, `make dev-ui` in another. Vite's proxy config handles API calls transparently.

## Key non-obvious constraints

### Embed path restriction
`//go:embed all:../../ui/dist` is INVALID — Go doesn't allow `..` in embed paths. The Makefile copies `ui/dist` → `cmd/pandorabox/dist`. Never change this pattern.

### Chrome TLS trust
Root CA and every leaf cert MUST have `SubjectKeyId` (SHA-1 of DER-encoded PKIX public key) and `AuthorityKeyId`. Missing these causes Chrome "Not Secure" even when CA is installed.

### Hop-by-hop headers
`internal/proxy/transport.go` strips `Connection`, `Keep-Alive`, `Transfer-Encoding`, `Upgrade`, `Proxy-*` headers per RFC 7230 §6.1 — on BOTH request and response. This is required; without it, CDNs and servers reject the forwarded request.

### Response framing
After buffering the full response body, the code explicitly sets:
- `resp.ContentLength = int64(len(respBodyBytes))`
- `resp.TransferEncoding = nil`

This prevents `resp.Write()` from emitting a body length that doesn't match reality.

### ALPN
`NextProtos: []string{"http/1.1"}` must be set on the forged TLS config. Without it, Chrome may attempt HTTP/2 framing through the CONNECT tunnel, causing framing errors.

### CONNECT tunnel lifetime
When an upstream request fails inside the MITM loop, use `continue` (not `return`) to keep the tunnel alive for subsequent sub-resources on the same connection. Only `return` when `resp.Close || clientReq.Close`.

### Electron macOS traffic lights
`titleBarStyle: 'default'` in `ui/electron/main.cjs`. This is the native macOS title bar — it sits physically above the web content. Do NOT use `hiddenInset` or `trafficLightPosition`. No spacer div or macOS detection logic is needed in the sidebar.

## Ports
- 8080 — MITM proxy listener
- 7777 — REST API + WebSocket + embedded React UI
- 9090 — legacy MCP server when `serve --enable-mcp` is used

## Go dependencies
- `github.com/go-chi/chi/v5` — HTTP router for API
- `github.com/gorilla/websocket` — WebSocket hub
- `github.com/mark3labs/mcp-go` — legacy MCP compatibility server
- `github.com/spf13/cobra` — CLI subcommands
- `modernc.org/sqlite` — Pure Go SQLite (no CGo, single-binary)

## UI dependencies
- React 19, React Router v7, Tailwind CSS 3
- TanStack Table v8 + TanStack Virtual v3
- Monaco Editor (request/response inspector)
- Zustand v5 (state management, with `persist` for theme)
- Radix UI (accessible primitives)
- Electron 36 + electron-builder 26

## Agent CLI notes

The default agent interface is the `pandorabox` CLI (`internal/agentcli`): `status`, `traffic`, `replay`, `intercept`, `project`, `scope`, `matchreplace`, `middleware`, `converter`, `organizer`, `flows`, `intruder`, `collaborator` subcommands talking to the local REST API. Output is terse text by default; `--json` is explicit. Every mutation is reflected live in the running UI over the same WebSocket the browser uses. Add new agent workflows here first, not as MCP tools.

Intruder and Collaborator are implemented twice on purpose: `internal/intruder`/`internal/collaborator` back the REST API/CLI, while `internal/mcp/intruder.go`/`internal/mcp/collaborator_tools.go` back the legacy MCP tools of the same name. They were intentionally **not** unified — keeping legacy MCP untouched was a deliberate risk/scope tradeoff, not an oversight. Do not merge them without checking with the user first.

## Legacy MCP server notes

MCP is opt-in: start it with `pandorabox serve --enable-mcp`. `github.com/mark3labs/mcp-go` API: use positional `server.NewSSEServer(s.mcp, baseURLString)` — there is no `server.WithBaseURL(...)` option in this version.

## Docs

- `wiki/architecture.md` — system architecture, Go package map, data flow, key technical decisions
- `wiki/api.md` — complete REST API + WebSocket event reference
- `wiki/cli.md` — compact CLI reference for agents
- `wiki/mcp.md` — legacy MCP compatibility notes
- `wiki/development.md` — dev workflow, project structure, Zustand stores
- `wiki/database.md` — SQLite schema reference
