# PitokMonitor

A programmable MITM proxy — intercept, inspect, replay, and script HTTP/HTTPS traffic — with a built-in MCP server for Claude Desktop integration.

```
┌──────────────────────────────────────────────┐
│  Browser / System Proxy  →  :8080 (MITM)     │
│                               ↓              │
│             Go binary   (bin/pitokmonitor)    │
│  REST API + WebSocket :7777  │  MCP :9090    │
│                ↓                             │
│         React UI / Electron                  │
└──────────────────────────────────────────────┘
```

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [CA Certificate Setup](#ca-certificate-setup)
4. [Proxy Configuration](#proxy-configuration)
5. [Running PitokMonitor](#running-pitokmonitor)
6. [UI Overview](#ui-overview)
7. [MCP Server — Claude Desktop Integration](#mcp-server--claude-desktop-integration)
8. [Projects](#projects)
9. [CLI Reference](#cli-reference)
10. [Building from Source](#building-from-source)
11. [Further Documentation](#further-documentation)

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Go | 1.23+ | No C compiler needed — pure Go SQLite |
| Node.js | 18+ | Only needed for building from source |
| npm | 9+ | Bundled with Node.js |

Runs on macOS, Linux, and Windows.

---

## Installation

### Option A — Run the pre-built binary

```bash
./bin/pitokmonitor serve
```

Open `http://localhost:7777` in your browser.

### Option B — Build from source

```bash
git clone <repo>
cd PitokMonitor
make build
./bin/pitokmonitor serve
```

`make build` runs `npm run build` → copies the React bundle → `go build`. See [Building from Source](#building-from-source) for details.

### Option C — Electron desktop app

```bash
# Development
make dev-electron

# Package a distributable
make electron-mac    # → ui/dist-electron/PitokMonitor.dmg
make electron-win    # → ui/dist-electron/PitokMonitor Setup.exe
make electron-linux  # → ui/dist-electron/PitokMonitor.AppImage
```

---

## CA Certificate Setup

PitokMonitor generates a root CA at `~/.pitokmonitor/ca.crt` on first run. You must install and trust this certificate so your browser accepts the intercepted TLS connections.

### macOS (Chrome / Safari)

```bash
# Export the CA cert
./bin/pitokmonitor ca export > pitok-ca.crt

# Install into the System keychain (requires sudo)
sudo security add-trusted-cert \
  -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  pitok-ca.crt

# Fully restart Chrome
open -a "Google Chrome" --args --restart
# or visit chrome://restart
```

> Install into **System** keychain, not Login. After trusting, Chrome must be fully restarted — closing and reopening the window is not enough.

### macOS (Firefox)

Firefox manages its own certificate store.

1. Open **Firefox → Settings → Privacy & Security → Certificates → View Certificates**
2. Click **Import** and select `pitok-ca.crt`
3. Check **"Trust this CA to identify websites"** and click OK

### Linux (Chrome / Chromium)

```bash
# Ubuntu / Debian
sudo apt install libnss3-tools
certutil -d sql:$HOME/.pki/nssdb -A -t "CT,," -n "PitokMonitor CA" -i pitok-ca.crt

# Arch
sudo trust anchor --store pitok-ca.crt
```

Then restart Chrome.

### Windows (Chrome / Edge)

```powershell
# Export the cert first
.\bin\pitokmonitor.exe ca export > pitok-ca.crt

# Import via PowerShell (run as Administrator)
Import-Certificate -FilePath "pitok-ca.crt" -CertStoreLocation Cert:\LocalMachine\Root
```

Or double-click the `.crt` file → Install Certificate → Local Machine → Trusted Root Certification Authorities.

### Regenerating the CA

```bash
./bin/pitokmonitor ca regenerate
```

This invalidates all previously signed leaf certificates. Reinstall the new CA in your browser after regenerating.

---

## Proxy Configuration

Set your browser or operating system to use HTTP proxy at `127.0.0.1:8080`.

### Browser-level (recommended for testing)

**Chrome (via extension):** Use an extension like SwitchyOmega and point it at `127.0.0.1:8080`.

**Firefox:** Settings → General → Network Settings → Manual proxy → HTTP Proxy: `127.0.0.1`, Port: `8080`. Check "Use this proxy server for all protocols".

### System-level (captures all traffic)

**macOS:**
```
System Settings → Network → Wi-Fi/Ethernet → Details → Proxies
→ Web Proxy (HTTP): 127.0.0.1 : 8080
→ Secure Web Proxy (HTTPS): 127.0.0.1 : 8080
```

**Linux (GNOME):**
```
Settings → Network → Network Proxy → Manual
HTTP Proxy: 127.0.0.1  Port: 8080
HTTPS Proxy: 127.0.0.1  Port: 8080
```

**Command-line tools:**
```bash
export http_proxy=http://127.0.0.1:8080
export https_proxy=http://127.0.0.1:8080
curl https://example.com
```

---

## Running PitokMonitor

```bash
# Default: proxy :8080, API+UI :7777, MCP :9090
./bin/pitokmonitor serve

# Custom ports
./bin/pitokmonitor serve \
  --proxy-port 8888 \
  --api-port 7777 \
  --mcp-port 9090

# Specify database location
./bin/pitokmonitor serve --db /path/to/pitok.db

# Specify a project folder to open on startup
./bin/pitokmonitor serve --project /path/to/myproject
```

The web UI is available at `http://localhost:7777` once running.

---

## UI Overview

| Page | Route | Purpose |
|---|---|---|
| **History** | `/history` | Browsable, filterable table of all captured requests. Click a row to inspect headers and body. |
| **Intercept** | `/intercept` | Hold, inspect, modify, forward, or drop requests in real time. |
| **Replay** | `/replay` | Re-send any captured request with full raw-packet editing. |
| **SiteMap** | `/sitemap` | Tree view of traffic organized by host and path. Multi-select and export. |
| **Scope** | `/scope` | Define include/exclude rules to limit which hosts are captured. |
| **Settings** | `/settings` | Theme, fonts, keyboard shortcuts, CA certificate, proxy port, MCP toggle. |

### History

- Virtualized table, handles thousands of rows without slowdown.
- **Filters** (toolbar button or `Ctrl+F`): search by keyword (plain, regex, negative), host, method, status code, file extension, content-type. Multiple content-type chips can be selected together.
- Right-click any row → **Send to Replay**.
- WebSocket connections appear in a separate tab; click to view live frames with direction, opcode, and decoded payload.

### Intercept

- Toggle interception on/off from the toolbar or via keyboard shortcut.
- Optionally filter by host, method, or path — only matching requests are held.
- Per-request actions: **Forward** (send as-is), **Drop** (return 502 to browser), **Edit** (Monaco editor for raw packet editing) then **Modify & Forward**.
- **Forward All** clears the entire queue at once.

### Replay

- Click **Send to Replay** from History or SiteMap to load a request into the queue.
- Edit the raw HTTP packet in Monaco (full syntax highlighting).
- **Auto Content-Length** toggle automatically recalculates `Content-Length` when the body changes.
- Results (status code, headers, body) appear inline after sending.

### SiteMap

- Tree: host → path segments → request leaves. Each leaf shows method, status, size, and duration.
- Leaves prefer 2xx responses — if multiple requests hit the same route, the 2xx one is shown.
- **Checkboxes** on every row and branch node. Selecting a branch cascades to all leaves.
- **Export** selected requests as JSON or HAR (compatible with Burp Suite / browser DevTools).

### Scope

Four pattern types: `exact`, `contains`, `wildcard` (glob `*`), `regex`. Define include and exclude rules independently. Out-of-scope traffic is forwarded transparently with no storage overhead.

---

## MCP Server — Claude Desktop Integration

PitokMonitor exposes an MCP (Model Context Protocol) server over SSE at `http://localhost:9090/sse`. Connect Claude Desktop to it and Claude can inspect traffic, replay requests, manage scope, and control the proxy — all through natural language.

### Connecting Claude Desktop

Add the following to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "pitokmonitor": {
      "url": "http://localhost:9090/sse"
    }
  }
}
```

Restart Claude Desktop. You should see PitokMonitor listed under connected tools.

### Disabling MCP per project

In Settings → MCP, you can disable MCP access for the current project. This prevents Claude from reading or modifying traffic in sensitive projects.

### Available MCP Tools

PitokMonitor provides 20 tools. Full parameter documentation is in [wiki/mcp.md](wiki/mcp.md).

**Proxy control**
- `proxy_status` — current running state, port, request count, queue length
- `proxy_start` — start the proxy listener
- `proxy_stop` — stop the proxy listener

**Traffic**
- `list_requests` — list captured requests with filters (host, method, status, search, pagination)
- `get_request` — fetch a single request with full headers and body
- `search_requests` — keyword search across all traffic
- `delete_request` — delete a request and its response

**Replay**
- `replay_request` — replay a captured request, optionally modifying URL, headers, or body
- `send_request` — send a brand-new HTTP request through the proxy

**Intercept**
- `intercept_toggle` — enable or disable interception
- `list_intercept_queue` — list all currently held requests
- `intercept_forward` — forward a held request unchanged
- `intercept_drop` — drop a held request (browser gets 502)
- `intercept_modify` — forward with a modified raw HTTP packet (base64)

**Project & configuration**
- `get_project` — current project name, path, proxy config, scope settings
- `update_project` — update name, port, intercept state, scope rules
- `list_recent_projects` — list recently opened projects
- `open_project` — switch to an existing project folder
- `new_project` — create and switch to a new project

**Certificate**
- `get_ca_cert` — retrieve the CA certificate PEM and installation instructions

### Example Claude prompts

```
"Show me all POST requests to api.example.com from the last session."

"Turn on interception, then forward everything except requests to /admin."

"Replay request #47 but change the Authorization header to Bearer abc123."

"Set scope to only capture *.example.com and disable MCP for this project."

"What's the response body of the most recent 500 error?"
```

---

## Projects

PitokMonitor organizes traffic and settings into **projects**. Each project is a folder on disk containing:

```
myproject/
├── project.json   # proxy port, scope rules, filters, MCP flag
└── pitok.db       # SQLite traffic database
```

- On first launch, a temporary project is created automatically.
- Use **File → New Project** or **File → Open Project** to switch.
- **Save As** copies the current project to a new folder.
- Recent projects (up to 10) appear in the project switcher dropdown.
- Project settings (scope, filters, proxy port) are saved per-project. Theme and keyboard shortcuts are global (saved in `localStorage`).

---

## CLI Reference

```
pitokmonitor serve [flags]
  --proxy-port int   MITM proxy listen port (default 8080)
  --api-port   int   REST API + WebSocket + UI port (default 7777)
  --mcp-port   int   MCP SSE server port (default 9090)
  --db         path  SQLite database path (default: inside project folder)
  --project    path  Project folder to open on startup

pitokmonitor ca export
  Print the CA certificate PEM to stdout.

pitokmonitor ca regenerate
  Regenerate the root CA. All previously signed leaf certs are invalidated.
  You must reinstall the new CA in your browser.
```

---

## Building from Source

```bash
# Full build (required after any Go or UI change)
make build
# = npm run build  →  cp -r ui/dist cmd/pitokmonitor/dist  →  go build -o bin/pitokmonitor

# Development: hot-reload UI, manually restart backend
make dev-backend   # Go binary on :7777 (serves embedded UI)
make dev-ui        # Vite dev server with HMR (proxies /api + /ws to :7777)

# Electron development
make dev-electron

# Package Electron
make electron-mac
make electron-win
make electron-linux
```

> **Important:** Always use `make build`, not `npm run build` alone. The Go binary embeds the React bundle from `cmd/pitokmonitor/dist/`. The Makefile copies `ui/dist` there after the npm build. Running only `npm run build` will leave the binary with a stale UI.

---

## Further Documentation

| Document | Contents |
|---|---|
| [wiki/features.md](wiki/features.md) | Complete feature guide: every UI page, every option, how to use everything |
| [wiki/architecture.md](wiki/architecture.md) | System architecture, Go package map, data flow, key technical decisions |
| [wiki/api.md](wiki/api.md) | Complete REST API reference, request/response shapes, WebSocket events |
| [wiki/mcp.md](wiki/mcp.md) | Full MCP tool reference with parameters, return types, and examples |
| [wiki/development.md](wiki/development.md) | Development workflow, project structure, build pipeline internals |
| [wiki/database.md](wiki/database.md) | SQLite schema reference |
| [CLAUDE.md](CLAUDE.md) | AI assistant context (build constraints, non-obvious rules) |
