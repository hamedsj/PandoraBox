# AGENTS.md — PandoraBox

Context for AI assistants (Codex) working on this project.

## What this project is

PandoraBox is a programmable MITM proxy (like Burp Suite / Caido) with an MCP server for Codex Desktop integration. The user is the primary owner. Other engineers may be brought in to implement specific features.

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
- 9090 — MCP SSE server

## Go dependencies
- `github.com/go-chi/chi/v5` — HTTP router for API
- `github.com/gorilla/websocket` — WebSocket hub
- `github.com/mark3labs/mcp-go v0.8.0` — MCP server (SSE transport)
- `github.com/spf13/cobra` — CLI subcommands
- `modernc.org/sqlite` — Pure Go SQLite (no CGo, single-binary)

## UI dependencies
- React 19, React Router v7, Tailwind CSS 3
- TanStack Table v8 + TanStack Virtual v3
- Monaco Editor (request/response inspector)
- Zustand v5 (state management, with `persist` for theme)
- Radix UI (accessible primitives)
- Electron 36 + electron-builder 26

## MCP server notes

`github.com/mark3labs/mcp-go v0.8.0` API: use positional `server.NewSSEServer(s.mcp, baseURLString)` — there is no `server.WithBaseURL(...)` option in this version.

## Docs

- `wiki/architecture.md` — system architecture, Go package map, data flow, key technical decisions
- `wiki/api.md` — complete REST API + WebSocket event reference
- `wiki/mcp.md` — full MCP tool reference with parameters and examples
- `wiki/development.md` — dev workflow, project structure, Zustand stores
- `wiki/database.md` — SQLite schema reference
