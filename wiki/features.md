# Features Guide

A complete reference for every feature in PandoraBox.

---

## Table of Contents

1. [History](#history)
2. [Intercept](#intercept)
3. [Replay](#replay)
4. [Intruder](#intruder)
5. [SiteMap](#sitemap)
6. [Scope](#scope)
7. [Match & Replace](#match--replace)
8. [Middleware](#middleware)
9. [Flows](#flows)
10. [Organizer](#organizer)
11. [Converter](#converter)
12. [Collaborator](#collaborator)
13. [Team Sync](#team-sync)
14. [Request Inspector](#request-inspector)
15. [WebSocket Inspector](#websocket-inspector)
16. [Filters](#filters)
17. [Projects](#projects)
18. [Settings — Appearance](#settings--appearance)
19. [Settings — Keyboard Shortcuts](#settings--keyboard-shortcuts)
20. [Settings — Certificate](#settings--certificate)
21. [Settings — Proxy](#settings--proxy)
22. [Settings — Agent CLI](#settings--agent-cli)

---

## History

**Route:** `/history`

The History page shows every HTTP request captured by the proxy in a scrollable, virtualised table. It is the primary workspace for reviewing traffic.

### Request Table

The table uses virtual rendering — it handles thousands of rows without performance degradation. Columns:

| Column | Description |
|---|---|
| Method | HTTP method badge (color-coded) |
| Host | Target hostname |
| Path | URL path |
| Status | Response status code badge (color-coded by class) |
| Size | Response body size |
| Duration | Round-trip time in milliseconds |

- Click any row to open it in the **Request Inspector** panel.
- **Right-click** any row for a context menu: Send to Replay, Send to Intruder, Copy URL, Copy as cURL, Delete, and more.
- The table auto-updates in real time as new requests arrive — no manual refresh needed.

### HTTP vs WebSocket Tabs

- **HTTP** — all HTTP and HTTPS requests (default)
- **WebSocket** — WebSocket upgrade connections shown separately

### Inspector Position

Toggle between **right** (side-by-side) and **bottom** (stacked) from the inspector toolbar. The divider is draggable.

### Sending Requests Elsewhere

- Right-click → **Send to Replay**
- Right-click → **Send to Intruder**
- Keyboard: `Ctrl+R` / `Cmd+R` to send to Replay

### Clearing Traffic

Click **Clear All** in the toolbar, or use `POST /api/requests/clear`. This permanently deletes all captured requests and responses for the current project.

---

## Intercept

**Route:** `/intercept`

The Intercept page holds HTTP requests in real time so you can inspect, modify, forward, or drop them before they reach the server.

### Enabling / Disabling

- **Toggle button** in the toolbar — click to flip the state
- **Keyboard:** `Ctrl+Shift+I` / `Cmd+Shift+I`
- When on, the toggle glows green and a live counter shows the queue depth
- The state is saved per project

### Intercept Filter

Narrows which in-scope requests are held:

| Filter | Behavior |
|---|---|
| Host | Substring match |
| Method | Exact match (case-insensitive) |
| Path | Substring match |

All three fields are ANDed. Empty fields match everything.

### Per-Request Actions

| Action | Shortcut | Description |
|---|---|---|
| Forward | `Ctrl+Shift+F` | Send the request upstream unchanged |
| Drop | `Ctrl+Shift+D` | Discard — browser receives `502 Bad Gateway` |
| Edit | `Ctrl+Shift+M` | Open raw packet in Monaco editor |
| Modify & Forward | `Ctrl+Enter` | Send the edited packet upstream |
| Forward All | — | Resolve the entire queue at once |
| Drop All | — | Discard every queued request at once |

### Raw Packet Editor

Edit the full raw HTTP/1.1 packet — method, path, headers, body — and forward the modified version. Any header can be added, changed, or deleted.

### Queue Navigation

- `Alt+↑` / `Alt+↓` — move between queued requests

---

## Replay

**Route:** `/replay`

The Replay page lets you re-send any captured request — or build one from scratch — with full raw packet editing.

### Building the Queue

Add items by:

- Right-clicking in History → **Send to Replay**
- Pressing `Ctrl+R` / `Cmd+R` with a request selected
- Clicking **Duplicate** on an existing item (for A/B testing)

The queue persists per project across page reloads. Response results are also persisted per history entry — navigating back to a previous send with the arrow buttons restores its response.

### Raw Packet Editor

Full Monaco editor showing the raw HTTP request. Edit method, URL, headers, body freely.

**HTTPS vs HTTP scheme toggle** — switch between `https://` and `http://` per item without editing the raw packet.

### Sending

- **Send** button on the item card
- `Ctrl+Enter` / `Cmd+Enter` while the editor is focused
- A **Cancel** button appears while the request is in flight

### Auto Content-Length

When enabled (Settings → Proxy), PandoraBox automatically recalculates `Content-Length` when the body changes. Prevents `400 Bad Request` from length mismatches.

### Navigation History

Each queue item maintains a per-item history of previous sends. The back (`←`) and forward (`→`) arrow buttons step through that history, restoring both the raw packet and the response for each historical send.

### Results

After sending, the response shows:

- Status code, protocol, and reason phrase
- Response headers
- Decoded response body with syntax highlighting
- Duration and size

---

## Intruder

**Route:** `/intruder`

Intruder automates parameterised fuzzing of HTTP requests. It supports multiple attack types and payload sources, and presents results in a sortable table.

### Sessions

Each "Send to Intruder" creates a new session tab. Sessions are independent — you can run multiple attacks simultaneously. Each session retains its raw request template, attack config, and results.

### Marking Positions

In the raw packet editor, wrap the part of the request you want to fuzz with `§` markers:

```
POST /login HTTP/1.1
Host: example.com
Content-Type: application/json

{"username":"§admin§","password":"§password§"}
```

Each `§...§` pair is one position. The text between the markers is the default value shown in the editor.

### Attack Types

| Type | Behaviour |
|---|---|
| **Sniper** | One position at a time. Each payload is placed into each position in turn while others keep their default value. Total requests = positions × payloads. |
| **Battering Ram** | The same payload is inserted into all positions simultaneously. Total requests = payloads. |
| **Pitchfork** | Parallel iteration. Each position gets its own payload set. The Nth request uses the Nth payload from each set. Stops when the shortest set is exhausted. |

### Payload Sources

Each position (for Sniper / Pitchfork) or the single shared set (Battering Ram) can use one of three source types:

**Simple List** — a newline-separated list of values. Paste directly or import a `.txt`/`.csv` wordlist file.

**Numbers** — generate a numeric sequence:
- From / To / Step (supports both ascending and descending)
- e.g. `from=1, to=10, step=1` → `1, 2, 3, … 10`

**Brute Force** — generate all combinations of a character set:
- Charset (e.g. `abcdefghijklmnopqrstuvwxyz0123456789`)
- Min length / Max length
- Total count is shown before starting (can be very large)

### Running an Attack

Click **Start Attack**. A configuration modal lets you set:
- Attack type
- Payload sets (one per position for Pitchfork, one shared for Sniper/Battering Ram)
- Concurrency (number of parallel requests)

While running, a progress bar and live counter update as requests complete. Click **Cancel** to stop early.

### Results Table

Results appear in real time as each request completes. Columns:

| Column | Description |
|---|---|
| # | Request index |
| Payload | The payload value(s) used |
| Status | Response status code |
| Size | Response body size |
| Duration | Round-trip time |

Click any result row to inspect the full request and response in the panel below. Results are sortable by any column — sort by size or status to surface anomalies quickly.

### Filtering Results

The results table has its own filter bar:
- Filter by status code range
- Filter by response size range
- Search across payloads

---

## SiteMap

**Route:** `/sitemap`

The SiteMap provides a tree view of all captured traffic organised by host and path. It is a structural overview of the application's HTTP surface.

### The Tree

```
▼ api.example.com          (8 req)
  ▼ /api
    ▼ /users
        POST  200  request #47
        GET   200  request #44
    ▼ /admin
        POST  403  request #12
▼ static.example.com       (3 req)
```

Nodes: **host** (globe icon), **path segment** (folder icon), **request leaf** (file icon).

The tree is **collapsed by default**. Click any node to expand it.

### Deduplication

Each unique route (`method + host + path`) shows one representative leaf. When multiple requests hit the same route, the most recent 2xx is preferred; otherwise the latest by ID. An occurrence badge shows how many times the route was seen (`5x`).

### Expanding and Collapsing

- Click any node to toggle
- **Expand Hosts** — opens all top-level host nodes
- **Collapse All** — closes everything

### Multi-Select and Export

Checkboxes on every node. Branch checkboxes select/deselect all leaves beneath them (indeterminate state when partially selected). **Export N** dropdown appears when items are selected:

- **Export as JSON** — PandoraBox JSON format with base64-encoded bodies
- **Export as HAR** — HTTP Archive 1.2 (importable in Burp, browser DevTools, etc.)

### Deleting from SiteMap

Trash icon on each node deletes all requests under it. Bulk delete via checkbox selection. Deletes are permanent and cascade to responses, replay records, and WebSocket frames.

### Stats

Four cards above the tree: **Hosts**, **Routes**, **Requests**, **Responses**.

---

## Scope

**Route:** `/scope`

Scope defines which traffic is captured and stored. Out-of-scope requests are forwarded transparently — no storage, no events, no UI entries.

### Enable / Disable

The global toggle turns scoping on or off. When off, all traffic is captured.

### Include Rules

If any include rules are enabled, a request must match at least one to be captured. No include rules = everything is included.

### Exclude Rules

A request matching any enabled exclude rule is rejected — even if it also matches an include rule. Excludes always win.

### Rule Format

| Field | Description |
|---|---|
| Enabled | Toggle without deleting |
| Pattern Type | `exact` / `contains` / `wildcard` / `regex` |
| Host | Pattern against the request hostname |
| Path | Pattern against the URL path (empty = any path) |

### Pattern Types

| Type | Behaviour | Example |
|---|---|---|
| `exact` | Full equality | `api.example.com` |
| `contains` | Substring | `example` matches `api.example.com` |
| `wildcard` | Glob (`*` = any, `?` = one char) | `*.example.com` |
| `regex` | Full regular expression | `^api\d+\.example\.com$` |

---

## Match & Replace

**Route:** `/match-replace`

Match & Replace rules automatically transform requests and responses passing through the proxy. They run on every captured request/response before storage and before the response is returned to the browser.

### Rule Fields

| Field | Description |
|---|---|
| Enabled | Toggle the rule without deleting it |
| Name | Human-readable label (optional) |
| Target | What to match against (see below) |
| Match | The pattern to look for |
| Replace | The replacement text (empty = delete the match) |
| Is Regex | Treat Match as a Go regular expression |

### Targets

| Target | Applies to |
|---|---|
| `req-url` | The full request URL (method + path + query) |
| `req-header` | Request headers — each header line (`Name: value`) |
| `req-body` | Request body (decoded bytes) |
| `res-header` | Response headers — each header line |
| `res-body` | Response body (decoded bytes) |

### Matching Behaviour

- **Plain string** — literal substring match and replace
- **Regex** — Go `regexp` syntax. Capture groups can be referenced in the replacement as `$1`, `$2`, etc. An empty replacement deletes the matched text.

For header targets, the rule is applied to each header line individually in `Name: value` format. To delete a header entirely, match the full line pattern with regex and replace with an empty string.

### Built-in Presets (disabled by default)

Five pre-configured rules ship with every project:

| Name | Target | Effect |
|---|---|---|
| Require non-cached response | `req-header` | Removes `If-Modified-Since` headers |
| Require non-cached response | `req-header` | Removes `If-None-Match` headers |
| Emulate Firefox User-Agent | `req-header` | Replaces `User-Agent` with Firefox 128 |
| Ignore Cookies | `res-header` | Removes `Set-Cookie` headers |
| Hide Referer header | `req-header` | Removes `Referer` header |

### Rule Order

Rules are applied in the order they appear in the list. Use drag-and-drop to reorder. The result of one rule is the input to the next, so rules compose.

---

## Middleware

**Route:** `/middleware`

Middleware is a Python pipeline that intercepts and can rewrite HTTP requests, HTTP responses, and WebSocket frames as they pass through the proxy in real time. The runtime keeps a persistent `python3` subprocess and streams packet data into it.

### Architecture

The middleware canvas shows nodes and edges. Nodes are Python scripts; edges define execution order within the same traffic type. Nodes are evaluated in topological order.

```
[Request Node A] → [Request Node B]
[Response Node C]
[WS Client→Server Node D]
```

### Node Types

| Type | Traffic |
|---|---|
| `request` | Outbound HTTP requests (before sending upstream) |
| `response` | Inbound HTTP responses (before returning to browser) |
| `ws_c2s` | WebSocket frames from client to server |
| `ws_s2c` | WebSocket frames from server to client |

### Writing a Node

Each node must define a `process(packet)` function. If it returns `None`, the packet passes through unchanged. If it returns a packet object, that becomes the modified packet.

**HTTP Request node:**

```python
def process(packet):
    # packet.method   → str
    # packet.url      → str
    # packet.headers  → dict[str, list[str]]
    # packet.body     → bytes

    # Add a debug header
    packet.headers["X-Debug"] = ["1"]

    # Rewrite the body
    if packet.body:
        packet.body = packet.body.replace(b"staging", b"production")

    return packet
```

**HTTP Response node:**

```python
def process(packet):
    # packet.status_code  → int
    # packet.status_text  → str
    # packet.headers      → dict[str, list[str]]
    # packet.body         → bytes

    # Bypass a 401 to inspect the response body
    if packet.status_code == 401:
        packet.status_code = 200
        packet.status_text = "OK"

    return packet
```

**WebSocket frame node:**

```python
def process(packet):
    # packet.direction   → "ws_c2s" | "ws_s2c"
    # packet.opcode      → int (1=text, 2=binary, 8=close, 9=ping, 10=pong)
    # packet.payload     → bytes

    if packet.opcode == 1:
        text = packet.payload.decode("utf-8", errors="ignore")
        text = text.replace("old_value", "new_value")
        packet.payload = text.encode("utf-8")

    return packet
```

### Execution Rules

- Middleware only runs when the global **Enabled** toggle is on
- Only **enabled** nodes execute
- If a node raises an exception, the error is logged to the Console and the original packet continues unchanged
- WebSocket middleware rewrites live traffic — changes affect frames in transit, not just the stored history

### Console Output

`print()` statements in middleware code go to the **Console** panel (accessible from the sidebar). Each line is a console event with a timestamp and `source=middleware`. Useful for debugging packet contents.

---

## Flows

**Route:** `/flows`

Flows are project-stored multi-step automations. Each flow chains HTTP request replays with Python post-processing steps. Variables extracted from one step's response are injected into subsequent request templates.

### Flow Structure

A flow has a list of ordered steps and a variables dictionary. Variables are interpolated into request steps using `{{variable_name}}` syntax.

```
Step 1 (request): POST /api/login  → extracts token
Step 2 (process): parse JSON, store token in {{auth_token}}
Step 3 (request): GET /api/profile  → uses Authorization: Bearer {{auth_token}}
```

### Step Types

**Request step** — replays a raw HTTP packet:

```http
POST /api/login HTTP/1.1
Host: api.example.com
Content-Type: application/json

{"username":"{{username}}","password":"{{password}}"}
```

The raw packet is base64-encoded in the flow definition. Variable interpolation is performed at runtime before sending. PandoraBox replays the resulting request through the full proxy pipeline (scope, match-and-replace, middleware all apply).

**Process step** — runs a Python function:

```python
import json

def process(ctx):
    # ctx.response.status   → int
    # ctx.response.headers  → dict[str, str]
    # ctx.response.body     → str
    # ctx.variables         → dict[str, str]

    data = json.loads(ctx.response.body or "{}")
    token = data.get("access_token", "")
    return {"variables": {"auth_token": token}}
```

Returning `None` is equivalent to returning an empty variables dict. Variables returned by a process step are merged into the flow's variable map for all subsequent steps.

### Console Output

`print()` statements in process step code appear in the **Console** panel with `source=flow`.

### Creating and Running Flows

The Flows page has a visual step editor. Add steps with the `+` button, choose the type, and edit the content in the panel. Use the **Run** button to execute the flow from the beginning. Seed variable overrides can be provided at run time.

Steps can also be created and run via MCP: `flow_save` to create/update, `flow_run` to execute with optional variable overrides.

### Practical Patterns

**Login → extract token → use token:**

1. Request step: `POST /api/login` with `{{username}}` and `{{password}}`
2. Process step: parse the JSON response and extract `access_token`
3. Request step: `GET /api/protected` with `Authorization: Bearer {{access_token}}`

**CSRF token flow:**

1. Request step: `GET /login` (fetches the page)
2. Process step: extract the CSRF token from the HTML body using a regex
3. Request step: `POST /login` with the extracted CSRF token in the body

---

## Organizer

**Route:** `/organizer`

The Organizer is a folder-based notebook for grouping and annotating captured requests. It is independent of History — adding a request to a folder does not affect the original capture.

### Folders

Create folders with the **+ New Folder** button. Folders can be renamed, reordered by drag-and-drop, and deleted (this removes the folder and its items but not the underlying requests from History).

Each folder shows the item count and a short description (editable inline).

### Adding Requests

Right-click any request in History or SiteMap → **Add to Organizer** → select the target folder. A request can appear in multiple folders simultaneously.

### Items

Each item in a folder shows:
- The request method, host, and path
- A freeform **note** field — written in Markdown, rendered in a preview panel
- The full Request Inspector (same view as History)

### Notes

Click the note area on any item to open a Monaco editor for writing Markdown. Switch to the **Preview** tab to see the rendered output. Notes are saved automatically. Useful for recording findings, payloads that worked, or analysis steps.

### Reordering

Items within a folder can be reordered by drag-and-drop. Folder order can also be reordered.

---

## Converter

**Route:** `/converter`

The Converter is an encoding/decoding/hashing tool built into PandoraBox. It supports single-step transformations and chained stacks.

### Single Transform

Paste any text into the input box, select an algorithm, and the output appears immediately.

### Built-in Algorithms

| Category | Algorithms |
|---|---|
| **Encode** | Base64 Encode, URL Encode, Hex Encode, HTML Escape |
| **Decode** | Base64 Decode, URL Decode, Hex Decode, HTML Unescape |
| **Hash** | MD5, SHA1, SHA256, SHA512 |
| **Transform** | JSON Pretty, JSON Minify, ROT13 |
| **Extended** | Additional algorithms from [Boop](https://boop.okat.best/) scripts, if Boop is installed |

### Stacks

A **stack** is a saved sequence of algorithm steps applied in order. The output of each step is the input to the next.

**Example stack — decode a JWT payload:**
1. Split on `.` (take the second segment) — or paste manually
2. Base64 Decode
3. JSON Pretty

Create a stack with **+ New Stack**, add steps, and name it. Stacks are saved per project in `project.json`. Run a saved stack by name from the dropdown, or inline by clicking **Run Stack**.

### From the Request Inspector

The Converter is also accessible from the Request Inspector's body context menu: select any text, right-click → **Send to Converter**.

---

## Collaborator

**Route:** `/collaborator`

The Collaborator feature provides out-of-band (OOB) interaction detection — useful for finding server-side request forgery (SSRF), blind injection, XXE, and similar vulnerabilities where the payload effect is not visible in the HTTP response.

### How It Works

PandoraBox starts a Collaborator session by connecting to a configurable interaction server (default: Burp Collaborator, or any compatible OOB service). The server provides a unique subdomain. Inject that subdomain into a target parameter. When the target server makes a DNS lookup or HTTP/HTTPS request to that subdomain, the Collaborator server records the interaction and PandoraBox polls for it.

### Starting a Session

Via the UI: click **New Session** and enter a Collaborator server address.

Via MCP: `collaborator_start(server="...")` returns a `session_id` and a generated payload URL (`collaborator_generate_url`). The MCP client can then inject the URL into requests and poll for interactions with `collaborator_poll(session_id=...)`.

### Viewing Interactions

Each interaction shows:
- Type: `dns`, `http`, or `https`
- Timestamp
- The full DNS query or HTTP request details
- Source IP

Sessions created via MCP are visible in the UI on the Collaborator page alongside manually started sessions.

### Polling

The UI polls automatically every few seconds while a session is selected. MCP-based workflows use `collaborator_poll` explicitly.

---

## Team Sync

**Route:** `/settings` → Team tab (client) or **admin panel** (server mode)

Team Sync allows multiple PandoraBox instances to share captured traffic and organizer state in real time over a WebSocket connection to a shared team server.

### Client Mode

Any PandoraBox instance can connect to a team server:

1. Go to the Team tab in Settings (or the sidebar's Team section)
2. Enter the server URL and password
3. Click **Connect**

Once connected:
- New traffic captured by any member appears in your History in real time
- Organizer folder/item changes are synced to all members
- The member list shows who is currently connected

### Server Mode

Run PandoraBox as a team server with the `--server` CLI flag. The server mode enables the admin panel:

- **Members** — list currently connected users, kick a member
- **Config** — set the server password, listening port, data directory
- **Export** — download the shared project database
- **Restart / Migrate** — manage the server process

Server-mode traffic is stored in the server's own database. All clients receive the same traffic feed.

### What Syncs

| Feature | Synced |
|---|---|
| New HTTP requests + responses | ✓ |
| WebSocket frames | ✓ |
| Organizer folders and items | ✓ |
| Project config (scope, filters, etc.) | ✓ (server → clients) |
| Intercept state | ✗ (per-client) |
| Replay queue | ✗ (per-client) |

---

## Request Inspector

The Request Inspector appears in History, Replay, Intercept, SiteMap, and Organizer whenever a request is selected. It shows the full details of a single HTTP exchange.

### Tabs

**Request tab:**
- Method, scheme, host, full path + query
- Request headers
- Request body (decoded, syntax-highlighted)

**Response tab:**
- Status code, protocol, reason phrase
- Response headers
- Response body (decoded, syntax-highlighted)
- Duration and response size

### Body Views

Three views for each body:

| View | Description |
|---|---|
| **Pretty** | Auto-decoded and formatted (JSON pretty-print, XML indent, etc.) with syntax highlighting |
| **Raw** | The raw bytes as-is (still decoded from any transfer encoding) |
| **Hex** | Hexdump: `0000  4e 6f 74 20 46 6f 75 6e  │Not Foun│` |

The language is auto-detected from `Content-Type`.

### Body Decoding

Bodies are decoded transparently from their transfer encoding:
- `gzip` — decompressed
- `deflate` — decompressed
- `br` (Brotli) — decompressed
- `zstd` — decompressed
- `chunked` — assembled

### Context Menu (right-click in body)

- Copy selected text
- Copy full body
- Copy as base64
- Send selection to Converter
- Copy as cURL (on request side)

### Inspector Position

Toggle between **right** (side-by-side) and **bottom** (stacked) using the layout icon in the toolbar. The divider is draggable and position is saved per page.

---

## WebSocket Inspector

When a WebSocket connection is selected in History (WebSocket tab), the inspector shows the frame viewer.

### Frame List

Chat-style layout:
- **Client → Server** (c2s) on the right
- **Server → Client** (s2c) on the left

Each frame shows: direction, timestamp, opcode badge (`text` / `binary` / `ping` / `pong` / `close`), and payload preview.

### Expanding Frames

Click any frame to expand its full payload. JSON text frames are pretty-printed on expand.

### Filtering

- Direction: c2s only / s2c only / both
- Type: text / binary
- Search: keyword search across decoded payloads

### Live Updates

New frames appear in real time while the connection is open. A **Scroll to Latest** button appears when scrolled away from the bottom.

### permessage-deflate

PandoraBox automatically decompresses `permessage-deflate` frames, including stateful context takeover. The decoded payload is stored and shown.

---

## Filters

Shared between History and SiteMap. Open with the **Filters** button or `Ctrl+F` / `Cmd+F`. Saved per project.

### Search Tab

| Option | Description |
|---|---|
| Search Term | Keyword to search |
| Case Sensitive | Default: insensitive |
| Use Regex | Treat term as a regular expression |
| Invert Results | Show only non-matching requests |
| Scope fields | Host, Path, Query, Req Headers, Req Body, Res Headers, Res Body |

### Request Tab

| Filter | Description |
|---|---|
| In-scope only | Show only requests matching Scope rules |
| Host | Substring match on hostname |
| Extension — Only Show | Show only paths ending with these extensions (e.g. `php, json`) |
| Extension — Hide | Hide paths ending with these extensions (e.g. `js, css, png, woff`) |

### Response Tab

**Status Code chips:** `1xx`, `2xx`, `3xx`, `4xx`, `5xx` — multi-select, OR logic.

**Content-Type chips:** JSON, HTML, JS, CSS, XML, Form, Image, Protobuf — multi-select.

Both chips populate text fields that also accept manual comma-separated values for custom patterns.

### Applying

- **Apply** or `Cmd+Enter` — applies and closes
- **Cancel** — discards changes
- **Reset All** — clears every filter

---

## Projects

PandoraBox stores all traffic and settings in **projects**. Each project is a directory on disk with a `project.json` config file and a `pandora.db` SQLite database.

### Launcher

On startup, the launcher modal shows:
- **Temporary Project** — resets on each launch; good for one-off exploration
- **Recent Projects** — last 10 opened projects; click the `×` on any entry to remove it from the list without deleting files
- **New Project** — creates a new folder with a fresh database
- **Open Project** — file browser to open an existing project folder

### Per-Project State

| What | Where |
|---|---|
| All captured traffic | `pandora.db` |
| Proxy port, intercept state | `project.json` → `proxy` |
| Scope rules | `project.json` → `scope` |
| Traffic filters | `project.json` → `filters` |
| Match & Replace rules | `project.json` → `match_replace` |
| Middleware config + node code | `project.json` → `middleware` |
| Flows + step code | `project.json` → `flows` |
| Converter stacks | `project.json` → `converter` |
| Legacy MCP enabled/disabled | `project.json` → `mcp_disabled` |
| Legacy MCP port | `project.json` → `mcp_port` |

### Global State (not per-project)

Stored in `localStorage`:
- Theme (mode, variant, accent, font, font sizes)
- Inspector position and split ratios
- Keyboard shortcut bindings
- Replay auto-content-length preference

### Save As

**Save As** copies the current project (both `project.json` and `pandora.db`) to a new path. The current session switches to the copy.

---

## Settings — Appearance

**Route:** `/settings` → Appearance tab

### Theme Mode

**Dark** or **Light**. Changes apply immediately.

### Theme Style

5 variants per mode:

| Mode | Variants |
|---|---|
| Dark | Midnight, Charcoal, Slate, Obsidian, Deep |
| Light | Day, Cream, Cool, Paper, Solar |

### Accent Color

10 options: Teal, Blue, Purple, Indigo, Pink, Red, Orange, Yellow, Green, Cyan.

Used for primary buttons, active states, focus rings, and highlights.

### Typography

**App Font Size** — slider from 10px to 20px (default: 14px). Scales all UI text — sidebar, tables, panels — by setting the root `font-size` so all Tailwind rem utilities scale proportionally. Quick-pick buttons: 10, 12, 14, 16, 18, 20.

**Editor Font Size** — slider from 10px to 20px (default: 13px). Scales Monaco editors (request/response inspector, intercept editor, middleware node editor, note editor) independently of the app font. Same quick-pick buttons.

**Font Family** — 9 options:

| Font | Notes |
|---|---|
| System UI | OS default |
| Inter | Clean sans-serif |
| Source Code Pro | Code-optimised |
| JetBrains Mono | Popular dev font (default) |
| Fira Code | Supports ligatures |
| Cascadia Code | Microsoft open source |
| IBM Plex Mono | IBM open source |
| Roboto Mono | Google monospace |
| Monospace | Browser default |

A **preview** panel shows sample text in the selected font and editor size.

---

## Settings — Keyboard Shortcuts

**Route:** `/settings` → Shortcuts tab

All bindings are customisable. The shortcut system can be disabled globally.

(`Mod` = `Cmd` on macOS, `Ctrl` on Windows/Linux)

### Default Bindings

**Navigation**

| Action | Default |
|---|---|
| Go to Intercept | `Alt+1` |
| Go to History | `Alt+2` |
| Go to Scope | `Alt+3` |
| Go to SiteMap | `Alt+4` |
| Go to Replay | `Alt+5` |
| Go to Settings | `Alt+6` |

**Common**

| Action | Default |
|---|---|
| Open Filters | `Mod+F` |
| Close Current | `Mod+W` |
| Send to Replay | `Mod+R` |
| Cancel / Escape | `Escape` |

**Intercept**

| Action | Default |
|---|---|
| Toggle Intercept | `Mod+Shift+I` |
| Forward Selected | `Mod+Shift+F` |
| Drop Selected | `Mod+Shift+D` |
| Toggle Edit Mode | `Mod+Shift+M` |
| Apply & Forward | `Mod+Enter` |
| Previous Request | `Alt+↑` |
| Next Request | `Alt+↓` |

**Replay**

| Action | Default |
|---|---|
| Send Replay | `Mod+Enter` |

### Customising

1. Click the binding button next to any action
2. Press the desired key combination
3. Binding saves immediately
4. Press `Escape` to cancel, `Backspace` / `Delete` to unassign

**Reset Defaults** restores all bindings.

---

## Settings — Certificate

**Route:** `/settings` → Certificate tab

### Download

Click **Download CA Certificate** to save `pandorabox-ca.crt`. This is the root certificate PandoraBox uses to sign forged TLS certificates for intercepted HTTPS connections.

### Installing

Step-by-step instructions in the UI for:

- **macOS (Chrome / Edge / Safari)** — System Keychain → Always Trust
- **Firefox** — Authorities import in Firefox's own cert store
- **Windows (Chrome / Edge)** — Trusted Root Certification Authorities (Local Machine)
- **Linux (Chrome)** — `chrome://settings/certificates` Authorities import
- **iOS** — Profile install + Settings → Trust
- **Android** — User certificates or system trust

**macOS note:** Install into the **System** keychain, not Login. After trusting, restart Chrome with `chrome://restart`.

### Regenerating the CA

```bash
./bin/pandorabox ca regenerate
```

Generates a new key pair. All previously signed leaf certificates are invalidated. Re-download and reinstall the new certificate.

---

## Settings — Proxy

**Route:** `/settings` → Proxy tab

### Proxy Address

The proxy listens on `127.0.0.1:8080` by default. The address is shown with a **Copy** button. Configure your browser or OS to use this as its HTTP and HTTPS proxy.

### Port

The proxy port is configurable per project. Change it here; the proxy restarts on the new port immediately.

### Upstream Proxy

Chain all outbound traffic through a parent proxy:

```
http://127.0.0.1:8888
http://user:pass@proxy.corp.com:8080
socks5://127.0.0.1:1080
socks5://user:pass@socks.corp.com:1080
```

Leave empty for direct connections. Changes take effect immediately.

### Auto Content-Length (Replay)

Automatically recalculates `Content-Length` when the replay editor body changes. Default: on. Saved globally.

---

## Settings — Agent CLI

**Route:** `/settings` → Agent CLI tab

### Compact CLI

The tab shows the preferred agent workflow:

```bash
pandorabox status
pandorabox traffic list -n 20
pandorabox traffic get 47 --headers
pandorabox traffic get 47 --body response --max-bytes 2000
pandorabox replay send 47
pandorabox intercept queue
```

The CLI talks to the local REST API and prints terse text by default. Use `--json` only when an agent needs structured output.

### Agent Skill

The repository includes `skills/pandorabox-cli/SKILL.md`, a concise Codex-style skill that tells agents to list first, fetch one request, and only print bodies with explicit byte limits.

### Legacy MCP

MCP is compatibility-only and is not started by default. Start it explicitly:

```bash
pandorabox serve --enable-mcp
```

The per-project toggle controls whether legacy MCP clients may use the project tools after they connect.

Legacy endpoints:

| Transport | URL |
|---|---|
| Streamable HTTP (recommended) | `http://localhost:9090/mcp` |
| Legacy SSE | `http://localhost:9090/sse` |

The port is configurable per project.
