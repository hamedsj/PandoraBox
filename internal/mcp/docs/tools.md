# PandoraBox MCP Tool Reference

This document describes the current PandoraBox MCP tools and how to use them. For exact JSON shapes used in config fields, read `project-schemas`.

## Documentation Tools

### `list_docs`

Lists built-in documentation topics and their resource URIs.

Use this first when the client needs orientation.

### `get_doc`

Reads one built-in document by topic id.

Arguments:

- `topic` or `id`: one of `overview`, `tools`, `project-schemas`, `middleware`, `flows`

Example:

```json
{
  "topic": "middleware"
}
```

## Proxy Control

### `proxy_status`

Returns:

- whether the proxy is running
- proxy port
- intercept enabled state
- request count
- intercept queue length

### `proxy_start`

Declared purpose: start the proxy.

Current behavior: returns the current running state and port. It does not force-start a stopped proxy.

Optional arguments:

- `port`

### `proxy_stop`

Stops the proxy.

## Request History and Traffic

### `list_requests`

Lists captured HTTP requests.

Arguments:

- `host`
- `method`
- `status_min`
- `status_max`
- `search`
- `content_type` — filter by response Content-Type substring (e.g. `"javascript"`, `"html"`)
- `limit` — default 20; capped at 50 when `include_decoded_body` is true
- `offset`
- `user_id` — filter by team member user ID (team mode only)
- `include_decoded_body` — boolean; if true, adds `decoded_response_body` (plain UTF-8 string, decompressed) to each result

Returns a `requests` array and `total`.

### `search_requests`

Shortcut search over request history.

Arguments:

- `query` required
- `limit`
- `user_id` — filter by team member user ID (team mode only)

### `get_request`

Gets one full request record, including response details if present.

Arguments:

- `id` required
- `decoded` — boolean; if true, adds `decoded_body` (plain UTF-8 string) to both the request and response objects; decompresses gzip/deflate automatically

### `get_websocket_session`

Gets the WebSocket session associated with one captured HTTP upgrade request.

Arguments:

- `request_id` required

Use this after `list_requests` or `get_request` when a request is tagged as WebSocket traffic.

### `get_websocket_frames`

Gets captured WebSocket frames for one session.

Arguments:

- `request_id`
- `session_id`

Provide either:

- `request_id` to resolve the session from the original HTTP upgrade request
- `session_id` if you already know the session id

Returns raw captured frames, including `direction`, `opcode`, `fin`, `payload`, `length`, `truncated`, and `timestamp`.

### `delete_request`

Deletes one captured request and its response.

Arguments:

- `id` required

### `send_request`

Sends a new HTTP request through PandoraBox.

Arguments:

- `method` required
- `url` required
- `body`
- `headers_json`

Example:

```json
{
  "method": "POST",
  "url": "https://example.com/api/login",
  "body": "{\"user\":\"alice\"}",
  "headers_json": "{\"Content-Type\":\"application/json\"}"
}
```

### `replay_request`

Replays a captured request, optionally with modifications.

Arguments:

- `request_id` required
- `modified_url`
- `modified_body`
- `modified_headers_json`

Example:

```json
{
  "request_id": 42,
  "modified_headers_json": "{\"Authorization\":\"Bearer new-token\"}"
}
```

Replay uses the same proxy mutation pipeline as normal traffic, so match-replace and middleware can affect the replayed request and response.

## Intercept Queue

### `intercept_toggle`

Enables or disables HTTP request interception.

Arguments:

- `enabled` required

### `list_intercept_queue`

Lists requests currently held in the intercept queue.

### `get_console_output`

Gets recent console output produced by middleware and flows.

Arguments:

- `source`, optional `middleware` or `flow`
- `limit`, optional max number of recent entries

Use this when the MCP client needs to inspect `print()` output or Python errors emitted by middleware and flow execution.

### `intercept_forward`

Forwards one held request.

Arguments:

- `request_id` required

### `intercept_drop`

Drops one held request.

Arguments:

- `request_id` required

### `intercept_modify`

Modifies and forwards one held request using a base64-encoded raw HTTP packet.

Arguments:

- `request_id` required
- `raw` required, base64-encoded raw HTTP request bytes

## Certificates

### `get_ca_cert`

Returns the PandoraBox CA certificate in PEM format for client trust installation.

## Project and Global Configuration

### `get_project`

Returns the current project config snapshot, including:

- name
- project path
- temp-project flag
- proxy config
- filters
- scope
- match-replace
- middleware
- flows
- MCP settings

### `update_project`

Broad project update tool. Use this when changing multiple project areas together.

Arguments:

- `name`
- `proxy_port`
- `upstream_url`
- `intercept_enabled`
- `filters_json`
- `scope_enabled`
- `scope_include_json`
- `scope_exclude_json`
- `match_replace_json`
- `middleware_json`
- `flows_json`
- `mcp_disabled`
- `mcp_port`

Example:

```json
{
  "scope_enabled": true,
  "scope_include_json": "[{\"enabled\":true,\"pattern_type\":\"contains\",\"host\":\"example.com\",\"path\":\"/api\"}]"
}
```

## Match And Replace

### `get_match_replace`

Returns the current match-replace rules.

### `update_match_replace`

Replaces the current rule set.

Arguments:

- `rules_json` required, JSON array of `MatchReplaceRule`

Read `project-schemas` for the exact object shape.

## Middleware

### `get_middleware`

Returns the current middleware graph config.

### `update_middleware`

Replaces the current middleware graph.

Arguments:

- `config_json` required, JSON `MiddlewareConfig`

Read `middleware` and `project-schemas` before generating this config.

## Flows

### `list_flows`

Lists saved flows from the current project.

### `get_flow`

Gets one flow by id.

Arguments:

- `flow_id` required

### `save_flow`

Creates or updates one flow.

Arguments:

- `flow_json` required, JSON `Flow`

### `delete_flow`

Deletes one flow.

Arguments:

- `flow_id` required

### `run_flow`

Executes one flow by id.

Arguments:

- `flow_id` required
- `variables_json`, optional JSON object of seed variables

Use this when the flow already exists in the project. Read `flows` first if you need to author the flow.

## SiteMap

### `get_sitemap`

Builds a SiteMap tree from captured requests.

Arguments:

- `host`
- `method`
- `search`
- `status_min`
- `status_max`
- `in_scope_only`
- `user_id` — restrict the sitemap to one team member's traffic (team mode only)

This is the MCP-friendly version of the UI SiteMap.

## Response Analysis

These tools work directly on captured response bodies and headers. They are designed for security research workflows: source code review, secret/pattern detection, and header auditing.

### `get_request` with `decoded: true`

When you need to read the response body as plain text, pass `decoded: true` to `get_request`. The result includes an extra `decoded_body` field on both the request and response objects — a UTF-8 string with gzip/deflate decompressed automatically.

```json
{
  "decoded": true
}
```

### `list_requests` with `content_type` and `include_decoded_body`

Filter requests to a specific content type and return bodies inline:

```json
{
  "content_type": "javascript",
  "include_decoded_body": true,
  "limit": 20
}
```

Returns each request with a `decoded_response_body` field — UTF-8 text, decompressed.

### `grep_responses`

Searches response bodies across captured traffic using a regular expression. Supports context lines like `grep -C`.

Arguments:

- `pattern` required — regular expression
- `host` — substring filter on host
- `content_type` — substring filter on Content-Type (e.g. `"javascript"`)
- `context_lines` — lines before/after each match (0–10, default 2)

Returns up to 500 matches:

```json
{
  "matches": [
    {
      "id": 42,
      "host": "api.example.com",
      "path": "/static/app.js",
      "line": 17,
      "column": 5,
      "snippet": "...surrounding lines..."
    }
  ],
  "total": 3
}
```

Example — find hardcoded API keys in JS files:

```json
{
  "pattern": "api[_-]?key\\s*[:=]\\s*['\"][A-Za-z0-9]{20,}",
  "content_type": "javascript",
  "context_lines": 2
}
```

### `export_responses`

Writes response bodies to the local filesystem, organized as `dest_dir/{host}/{path}`. Useful for offline code review or passing to external scanners.

Arguments:

- `dest_dir` required — local path to write files
- `host` — filter by host
- `content_type` — filter by Content-Type substring
- `status_min`, `status_max` — filter by status code range
- `decoded` — decompress gzip/deflate before writing (default `true`)

Returns:

```json
{
  "total_exported": 47,
  "total_skipped": 2,
  "exported": [
    {"id": 12, "host": "app.example.com", "path": "/js/main.js", "local_path": "/tmp/out/app.example.com/js/main.js", "size": 84320}
  ],
  "skipped": [
    {"id": 99, "host": "app.example.com", "path": "/img/logo.png", "reason": "no response"}
  ]
}
```

Example — export all JS for offline review:

```json
{
  "dest_dir": "/tmp/js-review",
  "content_type": "javascript",
  "status_min": 200,
  "status_max": 299
}
```

### `get_response_headers_summary`

Audits response headers across all captured traffic. Returns two views:

1. `by_header` — every distinct header value grouped by header name (up to 100 examples per header)
2. `missing_security_headers` — requests missing one or more security headers

Security headers checked: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-XSS-Protection`.

Arguments:

- `host` — filter by host

Returns:

```json
{
  "security_headers_checked": ["Content-Security-Policy", ...],
  "by_header": {
    "content-security-policy": [{"id": 5, "path": "/", "value": "default-src 'self'"}]
  },
  "missing_security_headers": [
    {"id": 10, "host": "app.example.com", "path": "/dashboard", "missing": ["Content-Security-Policy", "Strict-Transport-Security"]}
  ]
}
```

## Project Switching

### `list_recent_projects`

Lists recently opened projects.

### `open_project`

Opens an existing project by absolute path and switches PandoraBox to it.

Arguments:

- `path` required

### `new_project`

Creates a new project at the given absolute path and switches to it.

Arguments:

- `path` required
- `name`

## Common Patterns

To inspect and then replay a request:

1. `list_requests`
2. `get_request`
3. `replay_request`

To change one feature area safely:

1. `get_middleware` or `list_flows` or `get_match_replace`
2. modify locally
3. `update_middleware` or `save_flow` or `update_match_replace`

To patch several project settings together:

1. `get_project`
2. merge the intended changes
3. `update_project`

## Organizer

The Organizer lets you group captured requests into named, color-coded folders — useful for tracking findings, noting interesting requests, or organizing a pentest by host or vulnerability class.

Folders are nested (tree structure). Items are references to captured requests stored inside a folder.

### `organizer_list_folders`

Lists all folders as a nested tree plus a flat array for easier lookup.

Arguments:

- `include_items` — boolean; if true, each folder includes its items (requests) inline

### `organizer_create_folder`

Creates a new folder.

Arguments:

- `name`
- `color` — one of: `teal`, `blue`, `purple`, `indigo`, `pink`, `red`, `orange`, `yellow`, `green`, `cyan`
- `icon` — one of: `Folder`, `FolderOpen`, `Star`, `Bookmark`, `Flag`, `Target`, `Zap`, `Shield`, `Bug`, `FlaskConical`, `Lock`, `Globe`, `Code`, `Database`, `Server`
- `note` — markdown note for this folder
- `parent_id` — parent folder ID (omit for root)
- `sort_order`

### `organizer_update_folder`

Updates an existing folder.

Arguments:

- `id` required
- `name`
- `color`
- `icon`
- `note`
- `parent_id` — pass `-1` to move folder to root
- `sort_order`

### `organizer_delete_folder`

Deletes a folder and all its descendants.

Arguments:

- `id` required

### `organizer_reorder_folders`

Reorders folders by setting explicit sort positions.

Arguments:

- `updates` required — JSON array of `{"id": <number>, "sort_order": <number>}` objects

Example:

```json
{
  "updates": "[{\"id\":1,\"sort_order\":0},{\"id\":2,\"sort_order\":1}]"
}
```

### `organizer_add_item`

Adds a captured request to a folder.

Arguments:

- `folder_id` required
- `request_id` required
- `note` — optional markdown note for this specific item
- `sort_order`

### `organizer_update_item`

Updates the note or sort order of an existing item.

Arguments:

- `id` required — item ID (not request ID)
- `note`
- `sort_order`

### `organizer_remove_item`

Removes an item from its folder (does not delete the underlying request).

Arguments:

- `id` required — item ID

### `organizer_list_items`

Lists all items (with their full request records) in one folder.

Arguments:

- `folder_id` required

## Intruder

### `intruder_fuzz`

Runs a fuzzing attack on a captured request. Place `§markers§` in the raw HTTP packet to mark injection points, supply payload lists, and choose an attack strategy. Waits for all variants to complete before returning results.

Attack types:

- `sniper` — iterates each marker one at a time through all payloads; uses first payload set; total = markers × payloads
- `battering_ram` — inserts the same payload into every marker simultaneously; uses first payload set; total = payloads
- `pitchfork` — parallel iteration, one set per marker, stops at the shortest set; total = min(set lengths)
- `cluster_bomb` — cartesian product of all sets; total = product(set lengths)

Arguments:

- `request_id` required — ID of the base request (used for host/scheme routing)
- `raw_b64` required — base64-encoded raw HTTP request with `§markers§` at injection points
- `attack_type` — `"sniper"` (default), `"battering_ram"`, `"pitchfork"`, or `"cluster_bomb"`
- `payloads_json` required — JSON array of string arrays, one inner array per marker. For `sniper`/`battering_ram` only the first array is used. Example: `[["admin","root"],["pass1","pass2"]]`
- `concurrency` — max concurrent requests, 1–20, default 5

Returns:

```json
{
  "results": [
    {
      "index": 0,
      "payloads": ["admin"],
      "status": 200,
      "length_bytes": 1024,
      "time_ms": 45,
      "error": ""
    }
  ],
  "total": 10
}
```

Typical workflow:

1. `get_request` to retrieve the original request
2. Decode the `raw` field, insert `§` around injection points, re-encode as base64
3. `intruder_fuzz` with the modified base64 and your payload lists
4. Inspect results for anomalous status codes or response lengths

## Collaborator

Collaborator integrates with interactsh to detect out-of-band interactions (DNS lookups, HTTP callbacks, SMTP, LDAP, etc.) triggered by injected payloads.

### `collaborator_start`

Starts a new Collaborator session. Registers a correlation ID with the interactsh server and returns a unique URL to embed in payloads.

Arguments:

- `server` — interactsh server hostname (default `"oast.pro"`); public options: `oast.pro`, `oast.live`, `oast.site`, `oast.online`, `oast.fun`, `oast.me`

Returns:

```json
{
  "session_id": "<uuid>",
  "url": "<correlationId><nonce>.oast.pro",
  "server": "oast.pro",
  "correlation_id": "<20-char id>"
}
```

Embed the returned `url` in your payloads (e.g. as an SSRF target, in a `Host:` header, in an XXE external entity, etc.).

### `collaborator_poll`

Polls the active session for new out-of-band interactions.

Arguments:

- `session_id` required — session ID returned by `collaborator_start`

Returns:

```json
{
  "interactions": [
    {
      "protocol": "dns",
      "unique-id": "...",
      "full-id": "...",
      "q-type": "A",
      "raw-request": "...",
      "remote-address": "1.2.3.4",
      "timestamp": "2024-01-15T10:00:00Z"
    }
  ],
  "count": 1
}
```

Call this repeatedly after sending payloads to detect callbacks.

### `collaborator_stop`

Stops a Collaborator session and deregisters from the interactsh server.

Arguments:

- `session_id` required

Returns `{"success": true}`.

### `collaborator_generate_url`

Generates a fresh unique test URL for an existing session (same correlation ID, new random nonce). Use this to create distinct per-payload URLs so you can tell which injection point triggered an interaction.

Arguments:

- `session_id` required

Returns `{"url": "<correlationId><newNonce>.oast.pro"}`.

Typical Collaborator workflow:

1. `collaborator_start` → get `session_id` and base `url`
2. For each injection point, call `collaborator_generate_url` to get a unique URL
3. Send payloads containing those URLs (via `replay_request`, `send_request`, or `intruder_fuzz`)
4. `collaborator_poll` to detect which URLs were contacted and by what protocol

## Team Collaboration

These tools manage team sync — connecting to a shared team server, inspecting teammates' traffic, and listing members.

### `team_status`

Returns current team sync state, server URL, and connected members.

Returns:

```json
{
  "connected": true,
  "status": "connected",
  "server_url": "ws://myserver:7778",
  "members": [
    {"user_id": "abc123", "display_name": "Alice", "color": "teal", "online": true}
  ]
}
```

### `team_connect`

Connects this instance to a team server. Credentials are saved for auto-reconnect.

Arguments:

- `server_url` required — WebSocket URL, e.g. `ws://host:7778`
- `password` required
- `display_name` — your visible name to teammates

The connection is asynchronous. Call `team_status` shortly after to confirm `"status": "connected"`.

### `team_disconnect`

Disconnects from the team server and clears saved credentials.

### `list_team_members`

Lists all known team members (online and offline).

### `get_team_member_traffic`

Fetches captured requests for one team member.

Arguments:

- `user_id` required
- `limit` — default 20
- `host` — filter by host

## Team Server Admin

These tools are only available when PandoraBox is running in `--team-server` mode. On a normal client instance they return an error.

### `team_server_status`

Returns server uptime, current config, and connected member count.

### `team_server_list_members`

Lists all members (online and offline) with request counts and last-seen timestamps.

### `team_server_kick_member`

Forcibly disconnects a connected member.

Arguments:

- `user_id` required

### `team_server_update_config`

Updates the server's `pandorabox-server.json`. Port changes take effect after restart.

Arguments:

- `team_name`
- `max_members`
- `team_port` — WebSocket sync port (restart required to take effect)
- `api_port` — REST/UI port (restart required to take effect)

### `team_server_set_password`

Changes the team server password. Existing connections are not dropped; the new password applies on next reconnect.

Arguments:

- `new_password` required — stored as bcrypt hash

### `team_server_export_project`

Exports the server's project data (`project.json` + `pandora.db`) as a base64-encoded ZIP archive.

Returns:

```json
{
  "zip_base64": "<base64>",
  "size_bytes": 204800
}
```

### `team_server_restart`

Gracefully restarts the team server process (re-reads config). All clients will disconnect briefly and auto-reconnect.

### `team_server_migrate_data`

Moves the server's data directory to a new absolute path and updates the config.

Arguments:

- `new_data_dir` required
