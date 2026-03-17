# PitokMonitor

A programmable MITM proxy (inspired by Burp Suite / Caido) with a built-in MCP server for AI integration via Claude Desktop.

## Overview

PitokMonitor intercepts, inspects, replays, and modifies HTTP/HTTPS traffic. It supports named projects, persisted history filters, regex-based search in the History view, scope rules for include/exclude capture logic, a SiteMap tree for browsing in-scope traffic by host and path, customizable keyboard shortcuts, decoded request/response body inspection, and a raw-packet Replay editor. It ships as a single Go binary (with React UI embedded) wrapped in an Electron desktop application.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Electron Shell (ui/electron/main.cjs)                  │
│  Spawns Go binary as child process, polls readiness     │
└───────────────────┬─────────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────────┐
│  Go Binary  (bin/pitokmonitor)                          │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ MITM Proxy  │  │ REST API +   │  │ MCP Server    │  │
│  │ :8080       │  │ WebSocket    │  │ SSE :9090     │  │
│  │ (raw TCP)   │  │ :7777        │  │ (Claude AI)   │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ SQLite DB (pitok.db, WAL mode)                  │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Port Map

| Port | Service | Description |
|------|---------|-------------|
| 8080 | MITM Proxy | Configure your browser/system to use this as HTTP proxy |
| 7777 | REST API + WebSocket | Web UI and programmatic API |
| 9090 | MCP SSE | Claude Desktop integration endpoint |

---

## Prerequisites

- **Go** 1.23+
- **Node.js** 18+ with npm
- **macOS / Linux / Windows**

No C compiler needed — `modernc.org/sqlite` is pure Go.

---

## Quick Start

### 1. Install the CA Certificate

On first run, PitokMonitor generates a root CA at `~/.pitokmonitor/ca.crt`.

```bash
# Export the CA cert
./bin/pitokmonitor ca export

# macOS: install into System keychain (NOT Login) and set "Always Trust"
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.pitokmonitor/ca.crt

# After installing, fully restart Chrome (chrome://restart)
```

### 2. Build

```bash
make build
# Runs: npm run build → copies ui/dist → go build
# Output: bin/pitokmonitor
```

### 3. Run

**Web mode** (Go binary, UI at http://localhost:7777):
```bash
./bin/pitokmonitor serve
```

**Electron desktop app** (development):
```bash
make dev-electron
```

**Package Electron app** (distributable):
```bash
make electron-mac    # → ui/dist-electron/PitokMonitor.dmg
make electron-win    # → ui/dist-electron/PitokMonitor Setup.exe
make electron-linux  # → ui/dist-electron/PitokMonitor.AppImage
```

### 4. Configure Proxy

Set your browser or system to use HTTP proxy: `127.0.0.1:8080`

---

## Development Workflow

```bash
# Terminal 1: Go backend (hot-reload manually)
make dev-backend

# Terminal 2: Vite dev server (HMR, proxies /api + /ws to :7777)
make dev-ui

# Full rebuild after Go or UI changes:
make build
```

> **Important:** After any UI change, always run `make build` (not just `npm run build`) so that `ui/dist` is copied into `cmd/pitokmonitor/dist` and re-embedded in the Go binary.

---

## Project Structure

```
PitokMonitor/
├── cmd/pitokmonitor/
│   ├── main.go          # CLI entry point (cobra: serve, ca export, ca regenerate)
│   └── embed.go         # //go:embed dist — embeds React UI into binary
│
├── internal/
│   ├── config/          # CLI flags → Config struct
│   ├── ca/              # Root CA generation + leaf cert signing (ECDSA P-256)
│   │   ├── ca.go        # Generate, Load, SignLeaf, Regenerate
│   │   └── certcache.go # sync.Map cache of leaf TLS certs
│   ├── proxy/           # MITM proxy engine
│   │   ├── proxy.go     # Raw TCP listener, one goroutine per connection
│   │   ├── handler.go   # Routes CONNECT vs plain HTTP
│   │   ├── mitm.go      # TLS interception, forged certs, HTTP/1.1 tunnel
│   │   ├── transport.go # HTTP roundtrip: captures req/resp, strips hop-by-hop headers
│   │   ├── intercept.go # Hold/forward/drop queue with decision channels
│   │   └── scope.go     # Include/exclude scope matcher for traffic capture
│   ├── api/             # chi HTTP router
│   │   ├── server.go    # Router setup, CORS, SPA fallback
│   │   ├── proxy_ctrl.go # /api/proxy/start|stop|status|config
│   │   ├── traffic.go   # /api/requests/* (list, get, delete)
│   │   ├── intercept.go # /api/intercept/* (list, forward, drop, modify)
│   │   ├── replay.go    # /api/replay/* (raw packet replay)
│   │   ├── project.go   # /api/project/* (open, create, update, save-as, recent)
│   │   ├── ws.go        # WebSocket hub (broadcasts event bus to all clients)
│   │   ├── static.go    # Serves embedded React UI
│   │   └── helpers.go   # JSON response helpers
│   ├── project/         # Project workspaces, persisted app config, scope/filter settings
│   │   ├── project.go   # project.json loading/saving, temp project reset, save-as
│   │   └── appconfig.go # recent projects + last opened project
│   ├── storage/         # SQLite persistence (modernc.org/sqlite, WAL mode)
│   │   ├── db.go        # Schema migrations, PRAGMA setup
│   │   ├── models.go    # Request, Response, Replay, InterceptEntry structs
│   │   ├── requests.go  # CRUD for requests + responses
│   │   └── replays.go   # Replay queue storage
│   ├── events/
│   │   └── bus.go       # In-process pub/sub event bus
│   └── mcp/
│       ├── server.go    # MCP SSE server
│       └── tools.go     # 13 MCP tools for Claude Desktop
│
├── ui/
│   ├── electron/
│   │   ├── main.cjs     # Electron main process (spawns Go binary, system tray, body decode)
│   │   └── preload.cjs  # Safe IPC bridge for native dialogs + body decode
│   ├── src/
│   │   ├── App.tsx       # React Router: /intercept, /history, /scope, /sitemap, /replay, /settings
│   │   ├── api/client.ts # Typed fetch wrapper for all /api endpoints
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts  # Auto-reconnecting WebSocket to /ws
│   │   │   ├── useRequests.ts
│   │   │   └── useKeyboardShortcuts.ts
│   │   ├── lib/
│   │   │   ├── shortcuts.ts       # Shortcut matching / dispatch helpers
│   │   │   ├── httpBodies.ts      # Request/response body decode helpers
│   │   │   ├── bodyPresentation.ts # Pretty formatting + language detection
│   │   │   └── rawHttp.ts         # Raw request construction + replay helpers
│   │   ├── store/
│   │   │   ├── proxy.ts      # Zustand: requests, current project, filters, replay/intercept queues
│   │   │   ├── theme.ts      # Zustand+persist: dark/light modes, fonts, accent colors
│   │   │   ├── shortcuts.ts  # Persisted keymap + enable/disable
│   │   │   ├── replay.ts     # Replay editor settings (auto Content-Length)
│   │   │   └── workspace.ts  # Inspector placement + workspace layout prefs
│   │   ├── pages/
│   │   │   ├── HistoryPage.tsx    # Request table + movable inspector
│   │   │   ├── InterceptPage.tsx  # InterceptPanel (forward/drop/modify)
│   │   │   ├── ScopePage.tsx      # Scope editor for include/exclude rules
│   │   │   ├── SitemapPage.tsx    # Tree view of in-scope traffic with shared filters
│   │   │   ├── ReplayPage.tsx     # ReplayPanel (queue + raw packet editor + results)
│   │   │   └── SettingsPage.tsx   # Appearance, shortcuts, replay, CA cert instructions
│   │   └── components/
│   │       ├── layout/    # MainLayout, Sidebar, ProjectSwitcher, RequestWorkspaceLayout
│   │       ├── history/   # RequestTable, regex-capable FilterModal
│   │       ├── inspector/ # RequestInspector with decoded body viewer
│   │       ├── intercept/ # InterceptPanel
│   │       ├── sitemap/   # SitemapTree
│   │       ├── replay/    # ReplayPanel
│   │       ├── common/    # MethodBadge, StatusBadge, CodeViewer
│   │       └── ThemeProvider.tsx  # Injects CSS variables from theme store
│   ├── vite.config.ts    # Dev proxy: /api + /ws → localhost:7777
│   └── package.json      # electron-builder config, npm scripts
│
├── bin/pitokmonitor      # Built binary (gitignored)
├── pitok.db              # SQLite database (gitignored)
├── Makefile
└── go.mod
```

---

## Key Technical Decisions

### Why raw TCP listener (not `net/http.Server`)?
HTTP `CONNECT` method tunneling requires reading the raw TCP stream before any HTTP parsing — `net/http.Server` doesn't expose this. The proxy uses `net.Listen` and dispatches per-connection goroutines.

### Why `modernc.org/sqlite`?
Pure Go, no CGo — enables `go build` to produce a single binary without a C toolchain. Cross-compilation works out of the box.

### Why embed path `cmd/pitokmonitor/dist`?
Go's `//go:embed` doesn't allow `..` path traversal. The Makefile copies `ui/dist` → `cmd/pitokmonitor/dist` at build time so the embed directive can use a sibling-relative path.

### Chrome TLS trust (`SubjectKeyIdentifier` + `AuthorityKeyIdentifier`)
Chrome enforces RFC 5280 compliance. Both the root CA and every leaf cert must have `SubjectKeyId` (SHA-1 of DER-encoded public key) and `AuthorityKeyId` set. Missing these causes the "Not Secure" warning even when the CA is installed.

### Hop-by-hop header stripping
Per RFC 7230 §6.1, headers like `Connection`, `Transfer-Encoding`, `Keep-Alive`, etc. must not be forwarded. The proxy strips them in `internal/proxy/transport.go` on both request and response paths, and normalises `ContentLength` after buffering the full body.

### ALPN negotiation
`NextProtos: []string{"http/1.1"}` in the forged TLS config prevents Chrome from attempting HTTP/2 framing through the CONNECT tunnel (which would cause framing errors since the proxy speaks HTTP/1.1).

---

## REST API Reference

Base URL: `http://localhost:7777`

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/proxy/status | Proxy running state + request count |
| POST | /api/proxy/start | Start proxy listener |
| POST | /api/proxy/stop | Stop proxy listener |
| GET | /api/requests | List requests (supports filter params) |
| GET | /api/requests/{id} | Get single request + response |
| DELETE | /api/requests/{id} | Delete request |
| GET | /api/intercept | List held requests |
| POST | /api/intercept/{id}/forward | Forward held request |
| POST | /api/intercept/{id}/drop | Drop held request |
| POST | /api/intercept/{id}/modify | Forward with modified raw bytes |
| GET | /api/intercept/toggle | Toggle intercept on/off |
| POST | /api/replay | Replay a captured request from a raw packet |
| GET | /api/replay/{id} | Get replay result |
| GET | /api/ca/cert | Download CA certificate (PEM) |
| GET | /api/project | Get current project config |
| PUT | /api/project | Update project name, proxy, filters, or scope |
| POST | /api/project/save-as | Save current project into a new folder |
| GET | /api/project/recent | List recent projects |
| POST | /api/project/open | Open an existing project folder |
| POST | /api/project/new | Create and open a new project |
| GET | /ws | WebSocket connection for real-time events |

### WebSocket Events

Events pushed as JSON to all connected clients:

| Type | Payload |
|------|---------|
| `request.captured` | Request object |
| `response.received` | Response object |
| `intercept.held` | Held request |
| `intercept.resolved` | Resolution (forward/drop) |
| `proxy.status` | Running state change |
| `project.switched` | Active project changed |

---

## MCP Tools (Claude Desktop)

Connect Claude Desktop to `http://localhost:9090/sse`.

| Tool | Description |
|------|-------------|
| `proxy_status` | Get proxy state and request count |
| `proxy_start` | Start the proxy |
| `proxy_stop` | Stop the proxy |
| `list_requests` | List captured requests with filters |
| `get_request` | Get full request + response by ID |
| `search_requests` | Full-text search across traffic |
| `replay_request` | Replay a captured request |
| `send_request` | Send a custom HTTP request |
| `intercept_toggle` | Toggle interception on/off |
| `intercept_forward` | Forward a held request |
| `intercept_drop` | Drop a held request |
| `get_ca_cert` | Get the CA certificate PEM |

---

## CA Certificate Management

```bash
# Export CA cert to stdout
./bin/pitokmonitor ca export

# Regenerate CA (invalidates all previously signed leaf certs)
./bin/pitokmonitor ca regenerate
```

CA files stored at: `~/.pitokmonitor/ca.crt` and `~/.pitokmonitor/ca.key`

**Chrome install steps (macOS):**
1. Export: `./bin/pitokmonitor ca export > pitok-ca.crt`
2. Open Keychain Access → drag cert to **System** keychain (not Login)
3. Double-click cert → Trust → "Always Trust"
4. Fully restart Chrome: `chrome://restart`

---

## Planned Features (Phase 6)

- [x] Upstream proxy chaining
- [x] WebSocket traffic support
- [x] MCP parity + per-project MCP toggle
- ~~Auto-update via electron-updater~~
