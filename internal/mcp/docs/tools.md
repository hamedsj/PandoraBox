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
- `limit`
- `offset`

Returns a `requests` array and `total`.

### `search_requests`

Shortcut search over request history.

Arguments:

- `query` required
- `limit`

### `get_request`

Gets one full request record, including response details if present.

Arguments:

- `id` required

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

This is the MCP-friendly version of the UI SiteMap.

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
