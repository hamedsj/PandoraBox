# Development Guide

## Build Pipeline

```bash
make build
```

This runs three steps in sequence:

1. `npm run build` — TypeScript compilation + Vite production bundle → `ui/dist/`
2. `cp -r ui/dist cmd/pandorabox/dist` — copies the bundle into the Go package
3. `go build -o bin/pandorabox ./cmd/pandorabox` — compiles the binary with the UI embedded

**Always use `make build`**, not `npm run build` alone. The Go binary embeds the UI from `cmd/pandorabox/dist/` via `//go:embed all:dist`. Running only the npm step leaves the binary with a stale bundle.

---

## Development Modes

### UI-only iteration (fastest)

Run in two terminals:

```bash
# Terminal 1 — Go backend (restart manually after Go changes)
make dev-backend
# → go run ./cmd/pandorabox serve

# Terminal 2 — Vite dev server with HMR
make dev-ui
# → vite --config ui/vite.config.ts
```

Vite proxies `/api` and `/ws` to `http://localhost:7777`, so the React app talks to the live Go backend. Open `http://localhost:5173`.

### Electron development

```bash
make dev-electron
# → make build  +  npx electron ui/electron/main.cjs
```

Rebuilds the binary first, then launches Electron pointing at `http://localhost:7777`.

### Full rebuild

After any change to `.go` or `.tsx`/`.ts` files:

```bash
make build
./bin/pandorabox serve
```

---

## Project Structure

```
PandoraBox/
│
├── cmd/pandorabox/
│   ├── main.go          CLI entry point (Cobra: serve, ca export, ca regenerate)
│   └── embed.go         //go:embed all:dist — embeds React bundle
│
├── internal/
│   ├── config/
│   │   └── config.go    CLI flags → Config struct
│   ├── events/
│   │   └── bus.go       In-process pub/sub event bus
│   ├── storage/
│   │   ├── db.go        SQLite init, WAL mode, schema migrations
│   │   ├── models.go    DB structs (Request, Response, Replay, etc.)
│   │   ├── requests.go  CRUD for requests and responses
│   │   ├── replays.go   Replay queue storage
│   │   └── websocket.go WebSocket session + frame storage
│   ├── ca/
│   │   ├── ca.go        Root CA generation, leaf cert signing (ECDSA P-256)
│   │   └── certcache.go sync.Map cache of signed leaf TLS certs
│   ├── proxy/
│   │   ├── proxy.go     Raw TCP listener, goroutine per connection
│   │   ├── handler.go   HTTP vs CONNECT dispatch + WebSocket detection
│   │   ├── mitm.go      TLS impersonation, CONNECT tunnel HTTP/1.1 loop
│   │   ├── transport.go roundTrip: hop-by-hop stripping, body capture, event publishing
│   │   ├── intercept.go Hold queue with per-request decision channels
│   │   ├── scope.go     Include/exclude scope matcher
│   │   └── websocket.go WS upgrade relay + permessage-deflate decompressor
│   ├── api/
│   │   ├── server.go    chi router, CORS, SPA fallback, WS hub
│   │   ├── traffic.go   /api/requests/*
│   │   ├── intercept.go /api/intercept/*
│   │   ├── replay.go    /api/replay/*
│   │   ├── project.go   /api/project/*
│   │   ├── proxy_ctrl.go /api/proxy/*, /api/ca/cert
│   │   ├── ws.go        WebSocket hub (event bus → browser clients)
│   │   ├── ws_frames.go /api/requests/{id}/ws-frames
│   │   └── helpers.go   writeJSON, writeError
│   ├── project/
│   │   ├── project.go   Manager: project.json load/save, TempProject, SaveAs
│   │   └── appconfig.go ~/.pandorabox/config.json: recent projects, last project
│   └── mcp/
│       ├── server.go    MCP SSE server, runtime project/DB injection
│       └── tools.go     20 MCP tools
│
├── ui/
│   ├── electron/
│   │   ├── main.cjs     Electron main process (spawns Go binary, system tray)
│   │   └── preload.cjs  IPC bridge: openFolder, newFolder, decodeBody
│   └── src/
│       ├── App.tsx       React Router routes
│       ├── api/
│       │   └── client.ts Typed fetch wrapper for all /api/* endpoints + TypeScript interfaces
│       ├── hooks/
│       │   ├── useWebSocket.ts  Auto-reconnecting WebSocket, dispatches events to store
│       │   ├── useRequests.ts   Loads initial request list on mount
│       │   └── useKeyboardShortcuts.ts  Shortcut listener
│       ├── store/
│       │   ├── proxy.ts      Zustand: requests, project, filters, intercept/replay queues
│       │   ├── theme.ts      Zustand+persist: dark/light, variants, fonts, accent colors
│       │   ├── workspace.ts  Zustand+persist: inspector position, split percentages
│       │   ├── shortcuts.ts  Zustand+persist: keybindings, enable/disable
│       │   └── replay.ts     Zustand+persist: auto Content-Length toggle
│       ├── lib/
│       │   ├── sitemap.ts        buildSitemapTree, collectRequestIdsUnder, etc.
│       │   ├── sitemapExport.ts  JSON + HAR export logic
│       │   ├── requestFilters.ts filterRequests, countActiveFilters, isInScope
│       │   ├── httpBodies.ts     Body decode (base64 → text/binary detection)
│       │   ├── bodyPresentation.ts Pretty-print JSON/XML/HTML, language detection
│       │   ├── rawHttp.ts        Raw HTTP packet construction for replay
│       │   ├── shortcuts.ts      Shortcut matching and dispatch helpers
│       │   └── utils.ts          cn() Tailwind class merge
│       ├── pages/
│       │   ├── HistoryPage.tsx
│       │   ├── InterceptPage.tsx
│       │   ├── ReplayPage.tsx
│       │   ├── SitemapPage.tsx
│       │   ├── ScopePage.tsx
│       │   └── SettingsPage.tsx
│       └── components/
│           ├── layout/    MainLayout, Sidebar, ProjectSwitcher, RequestWorkspaceLayout
│           ├── history/   RequestTable, FilterModal
│           ├── inspector/ RequestInspector, WSConnectionInspector, WSFramesPanel
│           ├── intercept/ InterceptPanel
│           ├── replay/    ReplayPanel
│           ├── sitemap/   SitemapTree
│           ├── common/    MethodBadge, StatusBadge, CodeViewer
│           └── ui/        Checkbox, and other primitives
│
├── wiki/                  Documentation
├── CLAUDE.md              AI assistant context (build constraints, non-obvious rules)
├── Makefile
├── go.mod
└── go.sum
```

---

## Go Dependencies

| Package | Version | Purpose |
|---|---|---|
| `github.com/go-chi/chi/v5` | v5 | HTTP router for the REST API |
| `github.com/gorilla/websocket` | latest | WebSocket server (hub, frame relay) |
| `github.com/mark3labs/mcp-go` | v0.8.0 | MCP server with SSE transport |
| `github.com/spf13/cobra` | latest | CLI subcommands and flags |
| `modernc.org/sqlite` | latest | Pure Go SQLite (no CGo) |

**MCP API note:** `mcp-go v0.8.0` uses positional constructor: `server.NewSSEServer(s.mcp, baseURLString)`. There is no `server.WithBaseURL(...)` option in this version.

---

## UI Dependencies

| Package | Purpose |
|---|---|
| React 19 | UI framework |
| React Router v7 | Client-side routing |
| Tailwind CSS 3 | Utility-first styling |
| TanStack Table v8 | Request table (virtualized) |
| TanStack Virtual v3 | Row virtualization |
| Monaco Editor | Code editor (intercept, replay, body viewer) |
| Zustand v5 | State management (with `persist` middleware) |
| Radix UI | Accessible primitives |
| Electron 36 | Desktop shell |
| electron-builder 26 | Packaging (DMG, NSIS, AppImage) |
| lucide-react | Icons |

---

## Electron Details

### Main process (`ui/electron/main.cjs`)

- Spawns `bin/pandorabox` (dev) or `resources/pandorabox` (packaged) as a child process.
- Polls `http://localhost:7777/api/proxy/status` every 500 ms (up to 30 attempts) before showing the window.
- Window: 1400×900 px, minimum 900×600. `titleBarStyle: 'default'` — native macOS title bar sits above web content. Do **not** use `hiddenInset` or add a spacer div.
- System tray: Show / Open in Browser / Quit.
- macOS: window close hides to tray (does not quit).
- Background: `#111318`.

### Preload (`ui/electron/preload.cjs`)

Exposes `window.electron` to the renderer:

```ts
window.electron.openFolder()     // opens native folder picker, returns path
window.electron.newFolder()      // opens native "create folder" picker, returns path
window.electron.decodeBody(base64, encoding)  // native body decoding
```

### Packaging targets

| Command | Output |
|---|---|
| `make electron-mac` | `ui/dist-electron/PandoraBox.dmg` + `.zip` |
| `make electron-win` | `ui/dist-electron/PandoraBox Setup.exe` (NSIS) |
| `make electron-linux` | `ui/dist-electron/PandoraBox.AppImage` + `.deb` |

---

## Zustand Stores

### `useProxyStore` (not persisted — session only)

```ts
state:
  status: ProxyStatus | null
  project: ProjectInfo | null
  requests: Request[]              // max 5000, newest-first
  selectedRequestId: number | null
  replayQueue: ReplayQueueItem[]   // max 100
  replayAttentionTick: number
  interceptQueue: Request[]
  filters: RequestFilters          // synced from project.json
  wsFrames: Map<sessionId, WebSocketFrame[]>

actions:
  setStatus, setProject, setRequests
  prependRequest(req)              // adds to front, trims to 5000
  setSelectedRequestId
  setInterceptQueue
  addToReplay, duplicateReplayItem, removeFromReplay, clearReplay
  setFilters, resetFilters
  appendWsFrame, clearWsFrames
```

### `useThemeStore` (persisted: `"pandora-theme"`)

```ts
mode: 'dark' | 'light'
variant: DarkTheme | LightTheme   // 5 dark + 5 light variants
fontFamily: FontFamily             // 9 font options
fontSize: number                   // 10–20px
accentColor: AccentColor           // 10 colors
```

Dark variants: `midnight`, `charcoal`, `slate`, `obsidian`, `deep`
Light variants: `day`, `cream`, `cool`, `paper`, `solar`
Accent colors: `teal`, `blue`, `purple`, `orange`, `red`, `green`, `pink`, `indigo`, `cyan`, `yellow`
Fonts: `system`, `inter`, `source-code`, `jetbrains` (default), `fira-code`, `cascadia`, `ibm-plex`, `roboto-mono`, `monospace`

### `useWorkspaceStore` (persisted: `"pandora-workspace"`)

```ts
inspectorPosition: 'right' | 'bottom'
historyRightSplit: number    // 56%
historyBottomSplit: number   // 58%
sitemapRightSplit: number    // 48%
sitemapBottomSplit: number   // 56%
```

### `useShortcutStore` (persisted: `"pandora-shortcuts"`)

```ts
enabled: boolean
bindings: Record<ShortcutActionId, string>
```

18 actions across 4 groups: Navigation (6), Common (5), Intercept (7), Replay (1).

### `useReplayStore` (persisted: `"pandora-replay"`)

```ts
autoContentLength: boolean   // recalculate Content-Length on body edit
```

---

## WebSocket Event Dispatch (Browser)

`ui/src/hooks/useWebSocket.ts` connects to `ws://localhost:7777/ws` and maps server events to store actions:

| Server Event | Store Action |
|---|---|
| `request.captured` | `prependRequest(req)` |
| `proxy.status` | `setStatus(status)` |
| `project.switched` | `api.project.get()` → `setProject`, `setRequests([])` |
| `websocket.frame` | `appendWsFrame(frame)` |

The connection auto-reconnects with exponential backoff on disconnect.

---

## Adding a New API Endpoint

1. Add the handler function in the appropriate `internal/api/*.go` file.
2. Register the route in `internal/api/server.go`.
3. Add the typed fetch call to `ui/src/api/client.ts`.
4. Run `make build` and test.

## Adding a New MCP Tool

1. Register the tool in `internal/mcp/tools.go` using `s.mcp.AddTool(...)`.
2. Implement the handler method on `*Server`.
3. Document it in `wiki/mcp.md`.
4. Run `make build`.
