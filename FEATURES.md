# PitokMonitor — Complete Feature & Architecture Reference

> Generated 2026-03-17. Use this to resume development without re-exploring the codebase.

---

## Ports

| Port | Service |
|------|---------|
| 8080 | MITM proxy listener |
| 7777 | REST API + WebSocket event stream + embedded React UI |
| 9090 | MCP SSE server (Claude Desktop) |

---

## Build Pipeline

```bash
make build          # npm run build → cp ui/dist → cmd/pitokmonitor/dist → go build
make dev-backend    # go run ./cmd/pitokmonitor serve  (API on :7777)
make dev-ui         # Vite HMR dev server  (proxies /api + /ws → :7777)
make dev-electron   # go build + npx electron .
make electron-mac / electron-win / electron-linux
```

**Critical constraint:** `//go:embed dist` in `cmd/pitokmonitor/embed.go` can only reference
`cmd/pitokmonitor/dist/` (no `..` allowed). The Makefile copies `ui/dist` there.
Always run `make build` — `npm run build` alone does NOT update the binary.

---

## CLI Commands

```
pitokmonitor serve              # start everything (flags: --proxy-port, --api-port, --mcp-port, --db, --project)
pitokmonitor ca export          # print CA certificate PEM
pitokmonitor ca regenerate      # regenerate root CA (invalidates all leaf certs)
```

---

## Go Package Map

### `cmd/pitokmonitor`
- `main.go` — Cobra CLI; wires all subsystems
- `embed.go` — `//go:embed dist`

### `internal/config`
- `config.go` — `Config{ProxyPort, APIPort, MCPPort, DBPath}` from CLI flags

### `internal/events`
- `bus.go` — in-process pub/sub; buffered channels per subscriber, drop-on-full

### `internal/storage`
- `models.go` — all DB structs (Request, Response, Replay, InterceptEntry, WebSocketSession, WebSocketFrame)
- `db.go` — SQLite connection, WAL mode, schema migration
- `requests.go` — ListRequests (host/method/status/search/limit/offset), GetRequest, SaveRequest, SaveResponse, DeleteRequest, CountRequests
- `replays.go` — SaveReplay, UpdateReplay, GetReplay
- `websocket.go` — SaveWebSocketSession, CloseWebSocketSession, GetWebSocketSession, SaveWebSocketFrame, ListWebSocketFrames

### `internal/ca`
- `ca.go` — ECDSA P-256 root CA; Load (generates if missing), Regenerate, SignLeaf
  - All certs must have SubjectKeyId + AuthorityKeyId (Chrome requirement)
- `certcache.go` — `sync.Map` cache of signed leaf certs by hostname

### `internal/proxy`
- `proxy.go` — TCP listener, goroutine-per-connection, dispatches HTTP vs CONNECT
- `handler.go` — `handleHTTP` (plain HTTP proxy + WS upgrade detection), `handleCONNECT` (HTTPS tunnel)
- `mitm.go` — TLS impersonation in CONNECT tunnel; `NextProtos: ["http/1.1"]` required; `continue` (not `return`) on per-request errors
- `transport.go` — `roundTrip`: captures request/response, strips hop-by-hop headers, runs intercept queue, saves to DB, publishes events; re-frames body (explicit ContentLength, nil TransferEncoding)
- `intercept.go` — Hold queue; decision channel per request; filter by host/method/path substring
- `scope.go` — `ScopeChecker`: include/exclude rules; pattern types: exact, contains, wildcard, regex
- `websocket.go` — WS upgrade handler; bidirectional frame relay + capture (1 MB/frame); permessage-deflate decompression (stateful per-direction `wsDecompressor` with `flate.Resetter` + 32 KB LZ77 dict rollover)

### `internal/api`
- `server.go` — chi router, CORS, SPA fallback, WebSocket hub
- `traffic.go` — request/response list + get + delete + ws-frames
- `intercept.go` — queue list, toggle, forward, forward-all, drop, modify, filter get/set
- `replay.go` — create replay, get replay
- `project.go` — get/update/save-as/recent/open/new project; `SwitchProject` atomically swaps DB
- `proxy_ctrl.go` — status, start, stop, config, CA cert download
- `ws.go` — WebSocket hub; subscribes to event bus, broadcasts to all UI clients
- `helpers.go` — `writeJSON`, `writeError`
- `ws_frames.go` — `getWebSocketFrames`: returns `{session, frames}` for a request_id

### `internal/project`
- `project.go` — `Manager`; project.json load/save; `TempProject()`, `SaveAs(path)`
- `appconfig.go` — `~/.pitokmonitor/config.json`; RecentProjects (10-item MRU), LastProject

### `internal/mcp`
- `server.go` — SSE MCP server; `SetProject()`, `SetDB()`, `SetSwitchProjectFn()`
- `tools.go` — 20 tools (see MCP Tools section)

---

## Database Schema

### `requests`
```
id, method, scheme (http|https), host, path, query,
headers (JSON), body (BLOB), raw (BLOB), timestamp,
tags (JSON array e.g. ["websocket"])
```
Indices: `idx_req_host(host)`, `idx_req_ts(timestamp DESC)`

### `responses`
```
id, request_id FK, status_code, status_text,
headers (JSON), body (BLOB), raw (BLOB),
duration_ms, size_bytes, timestamp
```

### `replays`
```
id, origin_request_id (nullable FK), request_id FK,
response_id (nullable FK), status (pending|done|error),
error (nullable), created_at
```

### `intercept_queue`
```
id, request_id FK, state (held|forwarded|dropped|modified),
modified_raw (nullable BLOB), created_at, resolved_at (nullable)
```

### `websocket_sessions`
```
id, request_id FK, created_at, closed_at (nullable)
```
Index: `idx_ws_sessions_req(request_id)`

### `websocket_frames`
```
id, session_id FK, direction (c2s|s2c),
opcode (1=text,2=binary,8=close,9=ping,10=pong),
fin (0|1), payload (BLOB, base64 in JSON),
length (original size, pre-truncation),
truncated (0|1), timestamp
```
Index: `idx_ws_frames_session(session_id)`

---

## Event Bus Types

| Event | Data | Fired When |
|-------|------|------------|
| `request.captured` | `*storage.Request` (with Response) | HTTP request saved to DB |
| `response.received` | `*storage.Response` | HTTP response received |
| `intercept.held` | `{request_id}` | Request held for interception |
| `intercept.resolved` | `{request_id, action}` | Forward/drop/modify decision |
| `proxy.status` | `{running, port, intercept_enabled, request_count, queue_length}` | Proxy start/stop |
| `project.switched` | `{path, name}` | `SwitchProject()` called |
| `websocket.frame` | `*storage.WebSocketFrame` | WS frame captured |
| `websocket.session.opened` | `{session_id, request_id}` | WS upgrade completed |
| `websocket.session.closed` | `{session_id, request_id}` | WS connection closed |

---

## All API Endpoints

### Proxy Control
```
GET    /api/proxy/status              → {running, port, intercept_enabled, request_count, queue_length}
POST   /api/proxy/start               → {success, port}
POST   /api/proxy/stop                → {success}
PUT    /api/proxy/config              → {success}  body: {port, intercept_enabled}
GET    /api/ca/cert                   → PEM file download
```

### Traffic
```
GET    /api/requests                  → {requests: [...], total: N}
                                        query: host, method, search, status_min, status_max, limit, offset
GET    /api/requests/{id}             → Request (with Response nested)
DELETE /api/requests/{id}             → {success}
GET    /api/requests/{id}/ws-frames   → {session: WebSocketSession|null, frames: WebSocketFrame[]}
```

### Intercept
```
GET    /api/intercept/queue           → {queue: Request[]}
PUT    /api/intercept/toggle          → {enabled: bool}   body: {enabled}
POST   /api/intercept/forward/{id}    → {success}
POST   /api/intercept/forward-all     → {forwarded: N}
POST   /api/intercept/drop/{id}       → {success}
POST   /api/intercept/modify/{id}     → {success}         body: {raw: base64}
GET    /api/intercept/filter          → {host, method, path}
PUT    /api/intercept/filter          → {host, method, path}
```

### Replay
```
POST   /api/replay                    → Replay   body: {request_id, modified_url?, modified_headers?, modified_body?, raw?}
GET    /api/replay/{id}               → Replay (with Request + Response nested)
```

### Project
```
GET    /api/project                   → ProjectInfo
PUT    /api/project                   → ProjectInfo   body: {name?, proxy?, filters?, scope?, mcp_disabled?}
POST   /api/project/save-as           → ProjectInfo   body: {path}
GET    /api/project/recent            → RecentProject[]
POST   /api/project/open              → ProjectInfo   body: {path}
POST   /api/project/new               → ProjectInfo   body: {path, name?}
```

### WebSocket (event stream)
```
GET    /ws                            → WebSocket upgrade; server pushes JSON events
```

---

## Proxy Features

### HTTP & HTTPS MITM
- Raw TCP listener on :8080
- Plain HTTP: forward + capture
- HTTPS: CONNECT → 200 → TLS impersonation with CA-signed leaf cert (cached per hostname)
- Hop-by-hop headers stripped on both request + response (RFC 7230 §6.1): Connection, Keep-Alive, TE, Trailers, Transfer-Encoding, Upgrade, Proxy-*
- Response body fully buffered; `ContentLength` set explicitly; `TransferEncoding` cleared
- `NextProtos: ["http/1.1"]` on leaf TLS config (prevents HTTP/2 framing from browser)
- CONNECT tunnel: `continue` on per-request errors (keep tunnel alive), `return` only on `resp.Close || req.Close`

### Scope
- Include rules: if any enabled, request host/path must match at least one
- Exclude rules: request must not match any enabled rule
- Pattern types: exact (==), contains (substring), wildcard (`filepath.Match`), regex
- Out-of-scope: fast-path bypass — no storage, no intercept, no events

### Intercept
- Filter: host (substring), method (exact, case-insensitive), path (substring)
- Matching requests blocked in goroutine, waiting on decision channel
- Decisions: forward (unchanged), drop (return 502), modify (replace raw packet base64)
- `forward-all` endpoint resolves entire queue at once

### Replay
- Source: existing request_id or fresh POST body
- Overrides: modified_url, modified_headers (JSON), modified_body, or full raw (base64 HTTP packet)
- Sends through real HTTP transport, saves new Request + Response to DB
- Status polling: Replay record status field: pending → done | error

### WebSocket
- Detected via `Upgrade: websocket` header (case-insensitive) on both plain HTTP and CONNECT paths
- Upgrade request saved to DB with `tags: ["websocket"]`
- Bidirectional frame relay (two goroutines: c2s, s2c)
- Frame capture: opcode, fin, direction, unmasked payload (≤1 MB), original length, truncated flag
- **permessage-deflate decompression**: stateful `wsDecompressor` per direction
  - Uses `flate.Resetter` to reset reader source between messages (preserves DEFLATE state)
  - Carries last 32 KB of decompressed output as LZ77 dictionary for context takeover
  - RSV1 bit in frame header triggers decompression
  - `io.ErrUnexpectedEOF` after sync flush is expected/ignored
- Out-of-scope: bidirectional `io.Copy` pass-through, no storage

---

## MCP Tools (20 total, port 9090, SSE transport)

### Proxy Control
| Tool | Parameters | Returns |
|------|-----------|---------|
| `proxy_status` | — | `{running, port, intercept_enabled, request_count, queue_length}` |
| `proxy_start` | — | `{success, port}` |
| `proxy_stop` | — | `{success}` |

### Request Management
| Tool | Parameters | Returns |
|------|-----------|---------|
| `list_requests` | host, method, status_min, status_max, search, limit, offset | Request[] |
| `get_request` | id | Request + Response |
| `search_requests` | query, limit | Request[] |
| `delete_request` | id | `{success}` |
| `replay_request` | request_id, modified_url?, modified_body?, modified_headers_json? | Replay |
| `send_request` | method, url, body?, headers_json? | Replay |

### Intercept Control
| Tool | Parameters | Returns |
|------|-----------|---------|
| `intercept_toggle` | enabled | `{enabled}` |
| `intercept_forward` | request_id | `{success}` |
| `intercept_drop` | request_id | `{success}` |
| `intercept_modify` | request_id, raw (base64) | `{success}` |
| `list_intercept_queue` | — | Request[] |

### Project & Info
| Tool | Parameters | Returns |
|------|-----------|---------|
| `get_ca_cert` | — | PEM string |
| `get_project` | — | ProjectInfo |
| `update_project` | name?, proxy_port?, intercept_enabled?, scope_enabled?, scope_include_json?, scope_exclude_json?, mcp_disabled? | ProjectInfo |
| `list_recent_projects` | — | RecentProject[] |
| `open_project` | path | ProjectInfo |
| `new_project` | path, name? | ProjectInfo |

---

## UI Pages & Routes

| Route | Page | Component |
|-------|------|-----------|
| `/history` | History | RequestTable + RequestInspector or WSConnectionInspector |
| `/intercept` | Intercept | InterceptPanel |
| `/replay` | Replay | ReplayPanel |
| `/sitemap` | Sitemap | SitemapTree + RequestInspector |
| `/scope` | Scope | ScopePage |
| `/settings` | Settings | Tabs: Appearance, Shortcuts, Certificate, Proxy, MCP |
| `/` | — | redirect → /history |

---

## UI Component Inventory

### Layout
- `MainLayout` — sidebar + outlet
- `Sidebar` — nav links + ProjectSwitcher
- `ProjectSwitcher` — recent projects dropdown, New/Open dialogs
- `RequestWorkspaceLayout` — resizable split between list and inspector (right or bottom)

### History
- `RequestTable` — TanStack Virtual virtualized table; columns: method, host, path, status, size, duration; right-click → "Send to Replay"; HTTP tab + WebSocket tab
- `FilterModal` — search (regex/plain/negative/case-insensitive), method, host, status range, extension hide/show, content-type hide/show
- `RequestInspector` — Request tab (headers + body), Response tab (status + headers + body); position toggle (right/bottom); copy raw button
- `WSConnectionInspector` — fetches ws-frames for selected request, renders WSFramesPanel
- `WSFramesPanel` — chat-style frame list; live updates from store; filters (direction, type, search); auto-scroll with "scroll to latest" button; click to expand; hex dump for binary frames

### Intercept
- `InterceptPanel` — queue list; per-item: Forward, Drop, Edit (Monaco), Modify+Forward; global toggle; filter inputs

### Replay
- `ReplayPanel` — queue; per-item: edit raw (Monaco), send, duplicate, remove; auto Content-Length toggle

### Sitemap
- `SitemapTree` — host → path tree; filtered; click selects in History

### Common
- `MethodBadge` — colored per HTTP method
- `StatusBadge` — colored per status class (2xx/3xx/4xx/5xx)
- `CodeViewer` — Monaco read-only viewer with language detection
- `ThemeProvider` — injects CSS custom properties from theme store

---

## Zustand Stores

### `useProxyStore` (not persisted)
```ts
// State
status: ProxyStatus | null
project: ProjectInfo | null
requests: Request[]              // max 5000, newest-first
selectedRequestId: number | null
replayQueue: ReplayQueueItem[]   // max 100
replayAttentionTick: number
interceptQueue: Request[]
filters: RequestFilters          // sourced from project.json
wsFrames: Map<session_id, WebSocketFrame[]>

// Actions
setStatus, setProject, setRequests
prependRequest(req)              // adds front, trims to 5000
setSelectedRequestId
setInterceptQueue
addToReplay(req), duplicateReplayItem, removeFromReplay, removeRequestFromReplay, clearReplay
setFilters, resetFilters
appendWsFrame(frame), clearWsFrames(sessionId)
```

### `useThemeStore` (persisted: "pitok-theme")
```ts
mode: 'dark' | 'light'
variant: DarkTheme | LightTheme  // 5 dark + 5 light
fontFamily: FontFamily            // 9 options, JetBrains Mono default
fontSize: number                  // 10-20px, default 13
accentColor: AccentColor          // 10 colors, teal default
```
Dark variants: midnight, charcoal, slate, obsidian, deep
Light variants: day, cream, cool, paper, solar
Accent colors: teal, blue, purple, orange, red, green, pink, indigo, cyan, yellow
Font families: system, inter, source-code, jetbrains, fira-code, cascadia, ibm-plex, roboto-mono, monospace

### `useWorkspaceStore` (persisted: "pitok-workspace")
```ts
inspectorPosition: 'right' | 'bottom'
historyRightSplit: number    // default 56%
historyBottomSplit: number   // default 58%
sitemapRightSplit: number    // default 48%
sitemapBottomSplit: number   // default 56%
```

### `useShortcutStore` (persisted: "pitok-shortcuts")
```ts
enabled: boolean
bindings: Record<ShortcutActionId, string>
```
18 actions across groups: Navigation (6), Common (5), Intercept (7), Replay (1)
Key bindings: Ctrl+I (intercept), Ctrl+H (history), Ctrl+R (replay), etc.

### `useReplayStore` (persisted: "pitok-replay")
```ts
autoContentLength: boolean  // recalculate Content-Length on body edit
```

---

## WebSocket Event Handling (Browser)

File: `ui/src/hooks/useWebSocket.ts`

| Server Event | Action |
|-------------|--------|
| `request.captured` | `prependRequest(req)` |
| `proxy.status` | `setStatus(status)` |
| `project.switched` | `api.project.get()` → `setProject`, `setRequests([])` |
| `websocket.frame` | `appendWsFrame(frame)` |

---

## Settings

### Appearance (theme store, persisted localStorage)
- Mode, variant, font family, font size, accent color (see store above)

### Inspector (workspace store, persisted localStorage)
- Position: right | bottom
- Split percentages per page × position combination

### Shortcuts (shortcut store, persisted localStorage)
- 18 bindings, enable/disable all, reset to defaults

### Replay (replay store, persisted localStorage)
- Auto Content-Length toggle

### Project settings (project.json, per-project)
- Proxy port, intercept enabled
- Scope: enabled, include rules, exclude rules
- Filters: search, method, host, extension/content-type show/hide, status codes, regex/negative/case-insensitive flags, searchScope
- MCP disabled flag

### CA Certificate
- Stored at `~/.pitokmonitor/ca.crt` + `ca.key`
- Download via `/api/ca/cert`
- Regenerate via CLI `pitokmonitor ca regenerate`

---

## Electron (Desktop App)

- Main process: `ui/electron/main.cjs`
- Preload: `ui/electron/preload.cjs`
- Spawns Go binary (`resources/pitokmonitor` packaged, `../../bin/pitokmonitor` dev)
- Waits for API health at http://localhost:7777/api/proxy/status (30 × 500ms)
- Window: 1400×900 min 900×600, dark bg `#111318`, `titleBarStyle: 'default'` (native macOS title bar — no spacer div)
- System tray: Show / Open in Browser / Quit
- macOS: hide on window close (don't quit)
- Preload exposes `window.electron`: `openFolder()`, `newFolder()`, `decodeBody(base64, encoding)`
- Packaging: macOS DMG+ZIP, Windows NSIS, Linux AppImage+deb

---

## WSFramesPanel Frame Decoding Logic

```
frame.opcode === 1 (TEXT)
  → UTF-8 decode (replacement chars for invalid bytes)
  → try JSON prettify on expand

frame.opcode === 2 (BINARY) or 0 (CONT)
  → UTF-8 decode
  → if ≥50% replacement chars → hex dump (xxd-style: offset + hex + |ASCII|)
  → otherwise show as UTF-8 text

hex dump format:
  0000  81 a4 74 79 70 65 ...  |..type..|
```

On expand: hex dumps labelled with "hex dump" badge; JSON-prettify only runs on non-hex content.

---

## Known Issues / In-Progress

### WebSocket Payload Decoding (incomplete)
- permessage-deflate with context takeover: stateful decompressor implemented (should work)
- Connections without permessage-deflate: application-level binary protocol (e.g. MessagePack on miro.com) cannot be decoded without protocol knowledge; hex dump mode makes bytes visible
- SQLITE_BUSY errors appear under high WS frame load — frame writes contend with HTTP request writes; not yet fixed

### What's Confirmed Working
- HTTP + HTTPS MITM interception
- Intercept queue (hold/forward/drop/modify)
- Replay with raw editing
- Scope rules (include/exclude, all pattern types)
- WebSocket session capture + live frame streaming
- permessage-deflate decompression (stateful context takeover)
- All MCP tools
- Project management (multi-project, recent projects, temp project)
- Theme system (10 variants, 9 fonts, 10 accents)
- Shortcut rebinding
- Electron packaging

---

## File Locations Quick Reference

```
cmd/pitokmonitor/
  main.go, embed.go

internal/
  config/config.go
  events/bus.go
  storage/db.go, models.go, requests.go, replays.go, websocket.go
  ca/ca.go, certcache.go
  proxy/proxy.go, handler.go, mitm.go, transport.go, intercept.go, scope.go, websocket.go
  api/server.go, traffic.go, intercept.go, replay.go, project.go, proxy_ctrl.go, ws.go, ws_frames.go, helpers.go
  project/project.go, appconfig.go
  mcp/server.go, tools.go

ui/src/
  api/client.ts                           # all API calls + TypeScript interfaces
  store/proxy.ts, theme.ts, workspace.ts, shortcuts.ts, replay.ts
  hooks/useWebSocket.ts
  pages/HistoryPage.tsx, InterceptPage.tsx, ReplayPage.tsx, SitemapPage.tsx, ScopePage.tsx, SettingsPage.tsx
  components/
    layout/MainLayout.tsx, Sidebar.tsx, RequestWorkspaceLayout.tsx
    history/RequestTable.tsx, FilterModal.tsx
    inspector/RequestInspector.tsx, WSConnectionInspector.tsx, WSFramesPanel.tsx
    intercept/InterceptPanel.tsx
    replay/ReplayPanel.tsx
    sitemap/SitemapTree.tsx
    scope/ScopePage.tsx (inline)
    settings/SettingsPage.tsx (inline tabs)
    common/MethodBadge.tsx, StatusBadge.tsx, CodeViewer.tsx
  lib/
    httpBodies.ts        # body decode/detect helpers
    bodyPresentation.ts  # format body for display (JSON/XML/HTML/binary)
    requestFilters.ts    # isWebSocket(), filter application logic
    utils.ts             # cn() tailwind class merge

ui/electron/main.cjs, preload.cjs
Makefile
CLAUDE.md                               # AI context (constraints, non-obvious rules)
```
