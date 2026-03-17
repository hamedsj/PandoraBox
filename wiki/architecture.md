# Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Electron Shell  (ui/electron/main.cjs)                          │
│  Spawns Go binary, polls /api/proxy/status, system tray          │
└───────────────────────────┬──────────────────────────────────────┘
                            │ child process
┌───────────────────────────▼──────────────────────────────────────┐
│  Go Binary  (bin/pandorabox)                                   │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │  MITM Proxy     │  │  REST API        │  │  MCP Server    │  │
│  │  :8080 (TCP)    │  │  + WebSocket     │  │  SSE :9090     │  │
│  │                 │  │  :7777 (HTTP)    │  │                │  │
│  └────────┬────────┘  └────────┬─────────┘  └───────┬────────┘  │
│           │                   │                     │           │
│           └───────────────────┼─────────────────────┘           │
│                               │                                  │
│  ┌────────────────────────────▼─────────────────────────────┐    │
│  │  Event Bus  (internal/events)                            │    │
│  │  In-process pub/sub; buffered per-subscriber channels    │    │
│  └────────────────────────────┬─────────────────────────────┘    │
│                               │                                  │
│  ┌────────────────────────────▼─────────────────────────────┐    │
│  │  SQLite  (pandora.db, WAL mode, modernc.org/sqlite)        │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
         ↑ HTTP proxy
┌────────┴────────┐
│  Browser /      │
│  System Proxy   │
└─────────────────┘
```

## Port Map

| Port | Service | Description |
|------|---------|-------------|
| 8080 | MITM Proxy | Raw TCP listener. Configure your browser/system to use this. |
| 7777 | REST API + WebSocket + UI | All `/api/*` endpoints, `/ws` WebSocket, and the embedded React SPA. |
| 9090 | MCP SSE | Claude Desktop connects here (`http://localhost:9090/sse`). |

All ports are configurable via CLI flags (`--proxy-port`, `--api-port`, `--mcp-port`).

---

## Data Flow

### HTTPS request (normal path)

```
Browser → CONNECT example.com:443 → Proxy
  Proxy → 200 Connection Established
  Browser → TLS ClientHello
  Proxy → forge TLS cert for example.com (CA-signed, cached)
  Browser ↔ Proxy [TLS tunnel established]
  Browser → GET /api/v1/users HTTP/1.1
  Proxy → strips hop-by-hop headers
  Proxy → checks intercept filter → hold if match
  Proxy → forwards to real example.com over TLS
  Proxy → buffers full response body
  Proxy → saves Request + Response to SQLite
  Proxy → publishes request.captured + response.received to event bus
  Event Bus → WebSocket hub → browser UI (real-time update)
  Proxy → returns response to browser
```

### Intercepted request

```
... (same as above until intercept check) ...
  Proxy → request matches intercept filter
  Proxy → saves to intercept_queue, blocks goroutine on decision channel
  UI → GET /api/intercept/queue → displays request
  User → Forward / Drop / Modify
  Proxy → unblocks, sends decision
  ... (continues normal path or drops)
```

### WebSocket upgrade

```
Browser → GET /chat HTTP/1.1 + Upgrade: websocket
  Proxy → detects Upgrade header
  Proxy → saves upgrade request to DB with tags: ["websocket"]
  Proxy → completes WS handshake with both sides
  Two goroutines: c2s relay + s2c relay
  Each frame: decompress (permessage-deflate) → save to DB → publish event
  UI → live frame streaming via WebSocket event bus
```

---

## Go Package Map

### `cmd/pandorabox`

- `main.go` — Cobra CLI. Wires config, storage, CA, proxy, API, MCP. Subcommands: `serve`, `ca export`, `ca regenerate`.
- `embed.go` — `//go:embed all:dist` embeds the compiled React bundle into the binary.

### `internal/config`

- `config.go` — `Config{ProxyPort, APIPort, MCPPort, DBPath, ProjectPath}` parsed from CLI flags.

### `internal/events`

- `bus.go` — In-process pub/sub event bus. Each subscriber gets a buffered channel; slow consumers drop events rather than blocking the proxy goroutine.

### `internal/storage`

- `db.go` — Opens SQLite with WAL mode, runs schema migrations on startup.
- `models.go` — All DB structs: `Request`, `Response`, `Replay`, `InterceptEntry`, `WebSocketSession`, `WebSocketFrame`.
- `requests.go` — `ListRequests` (filter by host/method/status/search/limit/offset), `GetRequest`, `SaveRequest`, `SaveResponse`, `DeleteRequest`, `CountRequests`.
- `replays.go` — `SaveReplay`, `UpdateReplay`, `GetReplay`.
- `websocket.go` — `SaveWebSocketSession`, `CloseWebSocketSession`, `GetWebSocketSession`, `SaveWebSocketFrame`, `ListWebSocketFrames`.

### `internal/ca`

- `ca.go` — ECDSA P-256 root CA. `Load` generates if missing. `Regenerate` replaces the key pair. `SignLeaf` produces a short-lived cert for a given hostname.

  **Chrome TLS requirements:** Both the root CA and every leaf cert must have `SubjectKeyId` (SHA-1 of DER-encoded public key) and `AuthorityKeyId`. Missing these causes the "Not Secure" warning even when the CA is installed.

- `certcache.go` — `sync.Map` cache of signed leaf `tls.Certificate` values, keyed by hostname. Avoids re-signing on every connection.

### `internal/proxy`

- `proxy.go` — Raw `net.Listener` on the proxy port. One goroutine per connection. Dispatches to `handleHTTP` or `handleCONNECT` based on first request method.
- `handler.go` — `handleHTTP`: plain HTTP proxy with WebSocket upgrade detection. `handleCONNECT`: sends `200 Connection Established`, then hands off to MITM.
- `mitm.go` — TLS impersonation inside a CONNECT tunnel. Forges a cert for the target host, negotiates TLS with the browser, then runs an HTTP/1.1 loop. `NextProtos: ["http/1.1"]` prevents Chrome from attempting HTTP/2 framing. Uses `continue` (not `return`) on per-request errors to keep the tunnel alive for sub-resources.
- `transport.go` — `roundTrip`: captures the request and response, strips hop-by-hop headers (RFC 7230 §6.1: `Connection`, `Keep-Alive`, `Transfer-Encoding`, `Upgrade`, `Proxy-*`), buffers the full response body, sets explicit `ContentLength`, clears `TransferEncoding`, saves to DB, publishes events.
- `intercept.go` — In-memory hold queue. Each intercepted request blocks its goroutine on a per-request decision channel. `Resolve` sends a `Forward`, `Drop`, or `Modify` decision.
- `scope.go` — `ScopeChecker` with include/exclude rule lists. Pattern types: `exact`, `contains`, `wildcard` (glob), `regex`. Out-of-scope requests are forwarded transparently — no storage, no events.
- `websocket.go` — WS upgrade handler. Bidirectional relay with per-direction `wsDecompressor` for `permessage-deflate` (stateful, carries 32 KB LZ77 context dictionary between messages).

### `internal/api`

- `server.go` — chi router, CORS middleware, SPA fallback (unknown paths → `index.html`), WebSocket hub startup.
- `traffic.go` — `GET /api/requests`, `GET /api/requests/{id}`, `DELETE /api/requests/{id}`, `GET /api/requests/{id}/ws-frames`.
- `intercept.go` — Intercept queue list, toggle, forward, forward-all, drop, modify, filter get/set.
- `replay.go` — `POST /api/replay`, `GET /api/replay/{id}`.
- `project.go` — Project get/update/save-as/recent/open/new. `SwitchProject` atomically swaps the active DB and broadcasts a `project.switched` event.
- `proxy_ctrl.go` — Proxy status, start, stop, config update, CA cert download.
- `ws.go` — WebSocket hub. Subscribes to the event bus and fans out JSON events to all connected browser clients.
- `ws_frames.go` — `GET /api/requests/{id}/ws-frames` — returns `{session, frames}`.
- `helpers.go` — `writeJSON`, `writeError` — consistent JSON response helpers.

### `internal/project`

- `project.go` — `Manager`: loads/saves `project.json`, `TempProject()`, `SaveAs(path)`, `CreateProject(path, name)`, `OpenProject(path)`.
- `appconfig.go` — `~/.pandorabox/config.json`: recent projects (10-item MRU), last opened project.

### `internal/mcp`

- `server.go` — SSE MCP server using `github.com/mark3labs/mcp-go v0.8.0`. Exposes `SetProject()`, `SetDB()`, `SetSwitchProjectFn()` for runtime project switching.
- `tools.go` — 20 MCP tools. See [mcp.md](mcp.md) for full documentation.

---

## Key Technical Decisions

### Why raw TCP (`net.Listener`) instead of `net/http.Server`?

HTTP `CONNECT` tunneling requires reading the raw TCP stream before any HTTP framing — `net/http.Server` doesn't expose the underlying `net.Conn` at the right moment. A raw `net.Listener` gives full control over the connection lifecycle.

### Why `modernc.org/sqlite` (pure Go)?

No CGo dependency means `go build` produces a single self-contained binary. Cross-compilation to any target works without a C toolchain.

### Why embed path `cmd/pandorabox/dist`?

Go's `//go:embed` directive does not allow `..` path traversal. The Makefile copies `ui/dist` → `cmd/pandorabox/dist` at build time so the embed directive can reference a sibling path. Never change this pattern.

### ALPN negotiation (`NextProtos: ["http/1.1"]`)

Without this, Chrome may attempt HTTP/2 (`h2`) framing through the CONNECT tunnel. Since the proxy speaks HTTP/1.1, this causes framing errors and broken connections.

### Hop-by-hop header stripping

Headers listed in the `Connection` field, plus `Connection`, `Keep-Alive`, `TE`, `Trailers`, `Transfer-Encoding`, `Upgrade`, and `Proxy-*`, must not be forwarded per RFC 7230 §6.1. The proxy strips them on both the request and response paths. It also explicitly sets `ContentLength` and clears `TransferEncoding` after buffering the full body, ensuring correct framing to the browser.

### CONNECT tunnel error handling: `continue` vs `return`

When an upstream request fails inside the MITM loop (network error, timeout, etc.), the proxy uses `continue` to stay in the loop and handle the next request on the same tunnel. `return` is only used when `resp.Close || clientReq.Close` signals that the connection is done. This keeps the tunnel alive for sub-resources (CSS, JS, images) that Chrome fetches on the same connection.

### WebSocket `permessage-deflate`

The stateful decompressor (`wsDecompressor`) uses `flate.Resetter` to reset the reader source between messages without discarding the DEFLATE state. The last 32 KB of decompressed output is fed back as an LZ77 dictionary on each reset, implementing context takeover correctly. `io.ErrUnexpectedEOF` after the sync flush bytes (`0x00 0x00 0xff 0xff`) is expected and ignored.
