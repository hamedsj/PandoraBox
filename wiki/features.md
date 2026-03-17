# Features Guide

A complete reference for every feature in PitokMonitor — how it works and how to use it.

---

## Table of Contents

1. [History](#history)
2. [Intercept](#intercept)
3. [Replay](#replay)
4. [SiteMap](#sitemap)
5. [Scope](#scope)
6. [Request Inspector](#request-inspector)
7. [WebSocket Inspector](#websocket-inspector)
8. [Filters](#filters)
9. [Projects](#projects)
10. [Settings — Appearance](#settings--appearance)
11. [Settings — Keyboard Shortcuts](#settings--keyboard-shortcuts)
12. [Settings — Certificate](#settings--certificate)
13. [Settings — Proxy](#settings--proxy)
14. [Settings — MCP](#settings--mcp)

---

## History

**Route:** `/history`

The History page shows every HTTP request captured by the proxy in a scrollable, filterable table. It is the primary workspace for reviewing traffic.

### Request Table

The table uses virtual rendering — it can display thousands of rows without performance degradation. Columns:

| Column | Description |
|---|---|
| Method | HTTP method badge (color-coded) |
| Host | Target hostname |
| Path | URL path |
| Status | Response status code badge (color-coded by class) |
| Size | Response body size |
| Duration | Round-trip time in milliseconds |

- Click any row to open it in the **Request Inspector** panel on the right or bottom.
- **Right-click** any row for a context menu → **Send to Replay**.
- The table auto-updates in real time as new requests arrive through the proxy — no manual refresh needed.

### HTTP vs WebSocket Tabs

The table has two tabs above it:

- **HTTP** — all plain HTTP and HTTPS requests (default)
- **WebSocket** — all WebSocket upgrade connections, shown separately

Switching to the WebSocket tab replaces the inspector with the **WebSocket Inspector** when a connection is selected.

### Inspector Position

The inspector panel can be positioned to the **right** (side-by-side) or **bottom** (stacked). Toggle this in Settings → Appearance, or from the inspector panel's own toolbar. A drag handle between the panels lets you resize the split.

### Sending to Replay

Three ways to send a request to the Replay queue:

1. Right-click a row → **Send to Replay**
2. Select a request and press `Ctrl+R` / `Cmd+R`
3. Click the **Send to Replay** button inside the Request Inspector

---

## Intercept

**Route:** `/intercept`

The Intercept page lets you hold HTTP requests in real time, inspect them, optionally modify them, and then forward or drop them. This is the core tool for testing how an application reacts to tampered requests.

### Enabling / Disabling Interception

- **Toggle button** in the top toolbar — click to flip the state.
- **Keyboard shortcut:** `Ctrl+Shift+I` / `Cmd+Shift+I`
- When interception is on, the toggle glows green and a live badge shows the queue depth.
- Interception state is saved per project in `project.json`.

### Intercept Filter

By default, all in-scope requests are held. You can narrow this with the filter inputs below the toggle:

| Filter | Behavior |
|---|---|
| **Host** | Substring match — e.g. `api.` holds only requests to hosts containing "api." |
| **Method** | Exact match (case-insensitive) — e.g. `POST` |
| **Path** | Substring match — e.g. `/admin` |

All three filters are ANDed. Empty fields match everything.

### The Hold Queue

Each held request appears as a card in the queue. Selecting a card shows the full request in the editor panel on the right.

### Per-Request Actions

With a request selected:

| Action | Button | Shortcut | Description |
|---|---|---|---|
| **Forward** | Forward | `Ctrl+Shift+F` | Send the request to the server unchanged |
| **Drop** | Drop | `Ctrl+Shift+D` | Discard the request; browser gets `502 Bad Gateway` |
| **Edit** | Edit | `Ctrl+Shift+M` | Open the raw HTTP packet in Monaco editor |
| **Modify & Forward** | (after editing) | `Ctrl+Enter` | Send the edited packet to the server |

### Raw Packet Editor

Clicking **Edit** opens a Monaco editor pre-populated with the raw HTTP/1.1 request text:

```
POST /api/login HTTP/1.1
Host: api.example.com
Content-Type: application/json
Content-Length: 35

{"username":"admin","password":"x"}
```

Edit any part of the packet — method, path, headers, or body. Then press `Ctrl+Enter` / `Cmd+Enter` (or click **Modify & Forward**) to send the modified version.

### Navigating the Queue

- `Alt+↑` / `Alt+↓` — move between queued requests
- **Forward All** button — resolves the entire queue at once, forwarding every held request

---

## Replay

**Route:** `/replay`

The Replay page lets you re-send any captured request — either from History or built from scratch — with full raw packet editing.

### Building the Queue

The replay queue is a list of requests ready to be sent. Add items by:

- Right-clicking in History → **Send to Replay**
- Pressing `Ctrl+R` / `Cmd+R` with a request selected in History or Intercept
- Using the **Duplicate** button on an existing replay item (to try variations)

### The Raw Packet Editor

Each queue item has a full Monaco editor showing the raw HTTP/1.1 request:

```
GET /api/users?page=2 HTTP/1.1
Host: api.example.com
Authorization: Bearer eyJhbGc...
```

You can edit anything — method, URL, headers, body. The editor has syntax highlighting and full keyboard navigation.

### Sending

- Click the **Send** button on a queue item, or
- Press `Ctrl+Enter` / `Cmd+Enter` while focused in the editor

The response appears inline below the request card after the server replies.

### Auto Content-Length

When enabled (Settings → Proxy → Replay Editor), PitokMonitor automatically recalculates the `Content-Length` header whenever you change the body. This prevents `400 Bad Request` errors from content-length mismatches. Toggle it per session in Settings; the preference is persisted.

### Duplicate

The **Duplicate** button clones a queue item so you can modify one copy while keeping the original. Useful for A/B testing two versions of a request.

### Remove

The **×** button removes a single item from the queue. **Clear All** empties the entire queue.

### Results

After sending, the result shows:

- Status code and status text
- Response headers
- Response body (decoded, with syntax highlighting)
- Duration and size

Failed requests (network errors, timeouts) show an error badge.

---

## SiteMap

**Route:** `/sitemap`

The SiteMap provides a tree view of all captured traffic organized by host and path. It gives a structural overview of an application's API surface — like a sitemap for an HTTP target.

### The Tree

The tree is organized as:

```
▼ api.example.com          (8 req)
  ▼ /api
    ▼ /users
        POST  200  request #47
        GET   200  request #44
    ▼ /admin
        POST  403  request #12
  ▼ /auth
      POST  200  request #91
▼ static.example.com       (3 req)
```

- **Host nodes** (globe icon) — one per distinct hostname
- **Segment nodes** (folder icon) — one per path segment
- **Request leaves** (file icon) — one per unique `method + path` combination

Each node shows a count badge: `N req` for total captured requests and `N rsp` for those with a recorded response.

### Deduplication

Each unique route (`scheme://host/path`) shows only one representative request leaf. When multiple requests hit the same route:
- If any has a **2xx** response, the most recent 2xx is shown (preferred)
- Otherwise, the most recent request by ID is shown
- The occurrence count badge shows how many times the route was seen (e.g. `5x`)

### Expanding and Collapsing

- Click any host or segment node to toggle it open/closed
- **Expand Hosts** button — opens all top-level host nodes
- **Collapse All** button — closes everything

### Selecting and Inspecting

Clicking a request leaf (the row body, not the checkbox) selects it and opens it in the Request Inspector panel — the same inspector used in History.

### Filters

The SiteMap shares the same filter system as History (host, method, status, content-type, extension, search). Click the **Filters** button or press `Ctrl+F` / `Cmd+F` to open the filter modal. The tree rebuilds automatically as filters change.

The **In Scope** badge in the tree view header means the tree only shows requests that pass the current scope and filter settings.

### Multi-Select and Export

The SiteMap supports selecting multiple requests for bulk export.

**Selecting:**
- Each request leaf and each branch node has a **checkbox** on its left side.
- Clicking a branch checkbox selects or deselects all request leaves under that branch.
- Branch checkboxes show an **indeterminate** state (–) when some but not all leaves are selected.
- **Select All** — selects every visible request (respects current filters)
- **Clear** — deselects everything (appears when anything is selected)

**Exporting:**
When one or more requests are selected, an **Export N** dropdown appears:

- **Export as JSON** — PitokMonitor's own JSON format with base64-encoded bodies. Useful for scripting or archival.
- **Export as HAR** — HTTP Archive 1.2 format. Import into Burp Suite, browser DevTools, or other HTTP analysis tools.

The export fetches full request + response data (including bodies) for each selected ID, then triggers a file download. Filename format: `pitok-export-YYYY-MM-DDTHH-MM-SS.{json|har}`.

**JSON export format:**
```json
{
  "version": "1",
  "tool": "PitokMonitor",
  "exported_at": "2024-01-15T10:30:00Z",
  "count": 2,
  "entries": [
    {
      "id": 47,
      "timestamp": "...",
      "request": {
        "method": "POST",
        "scheme": "https",
        "host": "api.example.com",
        "path": "/v1/login",
        "query": "",
        "headers": { "Content-Type": ["application/json"] },
        "body_b64": "eyJ1c2VybmFtZSI6ImFkbWluIn0="
      },
      "response": {
        "status_code": 200,
        "status_text": "OK",
        "headers": { "Content-Type": ["application/json"] },
        "body_b64": "eyJzdWNjZXNzIjp0cnVlfQ==",
        "duration_ms": 123,
        "size_bytes": 15
      }
    }
  ]
}
```

### Stats Cards

Above the tree, four stat cards show at a glance:
- **Hosts** — distinct domains in the filtered tree
- **Routes** — unique host + path combinations
- **Requests** — total captured requests currently visible
- **Responses** — requests that have a recorded response

---

## Scope

**Route:** `/scope`

The Scope page defines which hosts and paths are intercepted and stored. Out-of-scope requests are forwarded transparently — they appear in no tables, trigger no events, and produce no database entries.

### Enable / Disable Scope

The scope toggle at the top of the page turns scoping on or off globally. When off, all traffic is captured regardless of rules. The current state is shown in the SiteMap header badge.

### Include Rules

Include rules define what IS captured. If any include rules are enabled:
- A request must match **at least one** include rule to be captured.
- If no include rules are enabled, all traffic is included.

### Exclude Rules

Exclude rules define what is NOT captured. A request matching any enabled exclude rule is rejected — even if it also matches an include rule. Excludes take priority.

### Rule Format

Each rule has:

| Field | Description |
|---|---|
| **Enabled** | Toggle to activate/deactivate the rule without deleting it |
| **Pattern Type** | How the host and path patterns are matched |
| **Host** | Pattern to match against the request hostname |
| **Path** | Pattern to match against the URL path (empty = any path) |

### Pattern Types

| Type | Description | Example |
|---|---|---|
| `exact` | Full string equality | `api.example.com` |
| `contains` | Substring match | `example` matches `api.example.com` |
| `wildcard` | Glob matching (`*` = any, `?` = one char) | `*.example.com` |
| `regex` | Full regular expression | `^api\d+\.example\.com$` |

### Common Scope Patterns

**Capture a single domain and all subdomains:**
- Include: host = `*.example.com`, type = `wildcard`, path = (empty)

**Exclude static assets:**
- Exclude: host = `*.example.com`, type = `wildcard`, path = `/static`, type = `contains`

**Target a specific API prefix only:**
- Include: host = `api.example.com`, type = `exact`, path = `/v2/`, type = `contains`

---

## Request Inspector

The Request Inspector appears in History, Replay, Intercept, and SiteMap whenever a request is selected. It shows the full details of a single HTTP exchange.

### Tabs

**Request tab:**
- HTTP method, scheme, host, full path + query
- Request headers (decoded from JSON storage format)
- Request body (decoded, syntax-highlighted)

**Response tab:**
- Status code and status text
- Response headers
- Response body (decoded, syntax-highlighted)
- Duration and size

### Body Rendering

Bodies are decoded intelligently:
- **JSON** — pretty-printed with syntax highlighting
- **XML / HTML** — pretty-printed
- **Binary** — shown as a hex dump (`0000  4e 6f 74 20 46 6f 75 6e  |Not Foun|`)
- **Plain text** — shown as-is

The language is auto-detected from the `Content-Type` header.

### Raw View

The **Copy Raw** button copies the raw HTTP/1.1 packet to the clipboard (base64-decoded from the `raw` field in the database).

### Inspector Position

Toggle between **right** (side-by-side) and **bottom** (stacked) using the layout icon in the inspector toolbar. The split position is draggable and saved per layout per page.

---

## WebSocket Inspector

When a WebSocket connection is selected in the History page (WebSocket tab), the inspector shows the **WebSocket frame viewer**.

### Frame List

Frames are displayed in a chat-style layout:
- **Client → Server** frames (c2s) appear on the right
- **Server → Client** frames (s2c) appear on the left

Each frame shows:
- Direction arrow and timestamp
- Opcode badge: `text`, `binary`, `ping`, `pong`, `close`
- Decoded payload (text frames decoded as UTF-8; binary frames shown as hex dump if non-printable)
- Original byte length (may differ from display if truncated > 1 MB)

### Expanding Frames

Click any frame to expand it and see the full payload. JSON text frames are pretty-printed on expand.

### Filtering

The frame viewer has its own filter controls:
- **Direction** — show only c2s or s2c frames
- **Type** — show only text or binary frames
- **Search** — keyword search across decoded payloads

### Live Updates

While the WebSocket connection is still open, new frames appear in real time via the WebSocket event stream. A **Scroll to Latest** button appears when you're scrolled up and new frames arrive.

### permessage-deflate

PitokMonitor decompresses `permessage-deflate` compressed frames automatically, including stateful context takeover. The decoded (uncompressed) payload is stored and shown in the UI.

---

## Filters

Filters are shared between History and SiteMap. They are opened via the **Filters** button or `Ctrl+F` / `Cmd+F`. Filters are saved per project in `project.json`.

The filter modal has three tabs:

### Search Tab

**Search Term** — keyword to search for in the selected scope fields.

Options:
- **Case Sensitive** — match exact case (default: case-insensitive)
- **Use Regex** — treat the search term as a regular expression. A syntax error indicator appears if the regex is invalid.
- **Invert Results** — show only requests that do NOT match the search term.

**Scope** — which parts of the request/response to search:

| Field | Description |
|---|---|
| Host | Request hostname |
| Path | URL path |
| Query | Query string |
| Req Headers | Request headers |
| Req Body | Request body |
| Res Headers | Response headers |
| Res Body | Response body |

If no scope fields are selected, all fields are searched. Select specific fields to narrow the search.

### Request Tab

| Filter | Description |
|---|---|
| **Only show in-scope items** | Toggle to show only requests that match the current Scope rules |
| **Host** | Substring match on the request hostname |
| **File Extension — Only Show** | Show only requests whose path ends with one of the listed extensions (comma-separated, e.g. `php, json`) |
| **File Extension — Hide** | Hide requests whose path ends with the listed extensions (e.g. `js, css, png, woff`) |

The Only Show and Hide extension filters are mutually exclusive — enabling one disables the other.

### Response Tab

**Status Code** — click one or more status class chips to filter by response status:

| Chip | Matches |
|---|---|
| `1xx` | Informational (100–199) |
| `2xx` | Success (200–299) |
| `3xx` | Redirect (300–399) |
| `4xx` | Client error (400–499) |
| `5xx` | Server error (500–599) |

Multiple chips can be active simultaneously (OR logic).

**Content-Type** — quick-select chips for common content types. Multiple chips can be active simultaneously:

| Chip | Matches |
|---|---|
| JSON | `application/json` |
| HTML | `text/html` |
| JS | `text/javascript` |
| CSS | `text/css` |
| XML | `xml` (matches application/xml, text/xml) |
| Form | `application/x-www-form-urlencoded` |
| Image | `image/` (matches any image type) |
| Protobuf | `protobuf` |

The chips populate the **Only Show** text field. You can also type directly into the field (comma-separated values for multiple patterns). The **Hide** field works the same way but excludes matching responses.

Both content-type filters use substring matching against response headers, so partial values like `xml` match multiple content types.

### Applying and Resetting

- **Apply** (or `Cmd+Enter` / `Ctrl+Enter`) — applies filters and closes the modal
- **Cancel** — discards changes and closes
- **Reset All** — clears every filter back to defaults
- The tab bar shows a count badge for active filters per tab

---

## Projects

PitokMonitor stores all traffic and settings in **projects**. Each project is a folder on disk containing a `project.json` config file and a `pitok.db` SQLite database.

### Project Switcher

The project switcher is in the sidebar (bottom area). Click it to see:
- The current project name and path
- A list of up to 10 recent projects
- **New Project** — creates a new project folder
- **Open Project** — opens a file browser to select an existing project folder
- **Save As** — copies the current project to a new location

### Default (Temp) Project

On first launch, a temporary project is created automatically at `~/.pitokmonitor/temp/`. This project resets on each launch. To persist your work, use **Save As** to save it to a named location.

### Per-Project Settings

Each project independently stores:
- Proxy port and intercept enabled state
- Scope rules (include/exclude)
- Traffic filters (search, host, status, content-type, etc.)
- MCP enabled/disabled flag

### Global Settings

The following are global (not per-project), stored in `localStorage`:
- Theme (mode, variant, accent color, font, font size)
- Inspector position (right/bottom)
- Split ratios per page
- Keyboard shortcut bindings

---

## Settings — Appearance

**Route:** `/settings` → Appearance tab

### Theme Mode

Switch between **Dark** and **Light** mode. Changes apply immediately.

### Theme Style

5 variants per mode:

| Mode | Variants |
|---|---|
| Dark | Midnight, Charcoal, Slate, Obsidian, Deep |
| Light | Day, Cream, Cool, Paper, Solar |

Each variant shows a color swatch preview.

### Accent Color

10 accent colors: **Teal** (default), Blue, Purple, Indigo, Pink, Red, Orange, Yellow, Green, Cyan.

The accent color is used for primary buttons, active states, highlights, and focus rings throughout the UI.

### Typography

**Font Size** — slider from 10px to 20px (default: 13px). Click preset values (10, 12, 14, 16, 18, 20) for quick selection.

**Font Family** — 9 options:

| Font | Description |
|---|---|
| System UI | OS default font |
| Inter | Clean sans-serif |
| Source Code Pro | Optimized for code |
| JetBrains Mono | Popular dev font (default) |
| Fira Code | Supports ligatures |
| Cascadia Code | Microsoft's font |
| IBM Plex Mono | IBM open source |
| Roboto Mono | Google's monospace |
| Monospace | Browser default monospace |

A live **preview** panel below the font options shows a sample text block in the selected font and size.

---

## Settings — Keyboard Shortcuts

**Route:** `/settings` → Shortcuts tab

All shortcuts are customizable. The shortcut system can be enabled or disabled globally.

### Default Bindings

(`Mod` = `Cmd` on macOS, `Ctrl` on Windows/Linux)

**Navigation**

| Action | Default | Description |
|---|---|---|
| Go to Intercept | `Alt+1` | Open the Intercept page |
| Go to History | `Alt+2` | Open the History page |
| Go to Scope | `Alt+3` | Open the Scope page |
| Go to SiteMap | `Alt+4` | Open the SiteMap page |
| Go to Replay | `Alt+5` | Open the Replay page |
| Go to Settings | `Alt+6` | Open the Settings page |

**Common**

| Action | Default | Description |
|---|---|---|
| Open Filters | `Mod+F` | Open the filter modal (History / SiteMap) |
| Close Current | `Mod+W` | Close the currently open request, editor, or modal |
| Send Selected To Replay | `Mod+R` | Send selected request to Replay queue |
| Cancel Current Context | `Escape` | Close active modal or clear selection |

**Intercept**

| Action | Default | Description |
|---|---|---|
| Toggle Intercept | `Mod+Shift+I` | Enable or disable interception |
| Forward Selected | `Mod+Shift+F` | Forward the selected held request |
| Drop Selected | `Mod+Shift+D` | Drop the selected held request |
| Toggle Edit Mode | `Mod+Shift+M` | Open the raw editor for the selected request |
| Apply Changes & Forward | `Mod+Enter` | Send the modified packet upstream |
| Select Previous | `Alt+↑` | Move to previous held request |
| Select Next | `Alt+↓` | Move to next held request |

**Replay**

| Action | Default | Description |
|---|---|---|
| Send Replay | `Mod+Enter` | Send the selected replay request |

### Customizing Shortcuts

1. Click the binding button next to any action (shows the current binding or "Unassigned").
2. The button switches to **"Press keys..."** mode.
3. Press the desired key combination.
4. The new binding is saved immediately.
5. Press `Escape` to cancel without saving.
6. Press `Backspace` or `Delete` in capture mode to clear the binding (unassign).

Click **Reset Defaults** to restore all bindings to their defaults.

---

## Settings — Certificate

**Route:** `/settings` → Certificate tab

### Downloading the CA Certificate

Click **Download CA Certificate** to save `pitokmonitor-ca.crt` to disk. This is the root certificate that PitokMonitor uses to sign forged TLS certificates for intercepted HTTPS connections.

### Installing by Browser / OS

The tab shows step-by-step expandable instructions for:

- **macOS (Chrome / Edge / Safari)** — System keychain, Always Trust
- **Firefox (all platforms)** — Authorities import in Firefox's own cert store
- **Windows (Chrome / Edge)** — Local Machine, Trusted Root Certification Authorities
- **Linux (Chrome)** — `chrome://settings/certificates` Authorities import

**Important macOS note:** Install into the **System** keychain, not the Login keychain. After trusting, fully restart Chrome (not just close and reopen the window — use `chrome://restart`).

### Regenerating the CA

Run `./bin/pitokmonitor ca regenerate` from the terminal. This creates a new CA key pair. All previously signed leaf certificates are invalidated. You must re-download and re-install the new certificate.

---

## Settings — Proxy

**Route:** `/settings` → Proxy tab

### HTTP/HTTPS Proxy Address

The proxy always listens on `127.0.0.1:8080` (or the configured port). The address is shown with a **Copy** button. Configure your browser or OS to use this as its HTTP and HTTPS proxy.

### Upstream Proxy

Route all outbound traffic through a parent proxy — useful when chaining PitokMonitor behind a corporate proxy or another tool.

Supported URL formats:
```
http://127.0.0.1:8888
http://user:pass@proxy.corp.com:8080
socks5://127.0.0.1:1080
socks5://user:pass@socks.corp.com:1080
```

Leave empty to connect directly. Changes are saved per project and take effect immediately.

### Replay Editor — Auto Content-Length

Toggle whether PitokMonitor automatically recalculates the `Content-Length` header when the body is edited in the Replay editor. Default: **on**. Saved globally (not per project).

---

## Settings — MCP

**Route:** `/settings` → MCP tab

### Enable / Disable MCP Access

Toggle whether Claude Desktop (or any MCP client) can access the current project. When disabled, all MCP tool calls return an error. Useful for projects containing sensitive data you don't want an AI to read.

This flag is **per project** — different projects can have MCP enabled or disabled independently.

### SSE Endpoint

The MCP server listens at `http://localhost:9090/sse`. A **Copy** button copies the URL.

### Claude Desktop Config Snippet

A pre-formatted JSON block ready to paste into `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pitokmonitor": {
      "url": "http://localhost:9090/sse"
    }
  }
}
```

A **Copy** button copies the full snippet.

For full MCP tool documentation, see [mcp.md](mcp.md).
