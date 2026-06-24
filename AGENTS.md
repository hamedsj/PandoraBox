# AGENTS.md — PandoraBox

Context for AI assistants (Codex) working on this project.

## What this project is

PandoraBox is a programmable MITM proxy (like Burp Suite / Caido) with a compact REST-backed CLI for Codex/LLM agent integration. The legacy MCP server still exists for compatibility but is opt-in. The user is the primary owner. Other engineers may be brought in to implement specific features.

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

The default agent interface is the `pandorabox` CLI:

```bash
pandorabox status
pandorabox traffic list -n 20
pandorabox traffic get 47 --headers
pandorabox traffic get 47 --body response --max-bytes 4000
pandorabox replay send 47
pandorabox intercept queue
```

Default output is intentionally terse to save tokens. Use `--json` only when machine-readable output is required. Use `--max-bytes` whenever printing bodies, raw packets, or WebSocket payloads.

## Legacy MCP server notes

MCP is no longer the default integration path. Start it explicitly with `pandorabox serve --enable-mcp`. Do not add new agent workflows only as MCP tools; add compact CLI/API support first.

## Docs

- `wiki/architecture.md` — system architecture, Go package map, data flow, key technical decisions
- `wiki/api.md` — complete REST API + WebSocket event reference
- `wiki/cli.md` — compact CLI reference for agents
- `wiki/mcp.md` — legacy MCP compatibility notes
- `wiki/development.md` — dev workflow, project structure, Zustand stores
- `wiki/database.md` — SQLite schema reference
