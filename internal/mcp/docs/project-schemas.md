# PandoraBox Project Schemas

This document records the JSON shapes used by PandoraBox MCP tools. These are the shapes accepted by `update_project`, `update_match_replace`, `update_middleware`, and `save_flow`.

It also records a few runtime data shapes that are useful when reading MCP results or writing middleware.

## ProxyConfig

```json
{
  "port": 8080,
  "intercept_enabled": false,
  "upstream_url": ""
}
```

## ScopeRule

```json
{
  "enabled": true,
  "pattern_type": "contains",
  "host": "example.com",
  "path": "/api"
}
```

Rules:

- `pattern_type` is one of `exact`, `contains`, `wildcard`, `regex`
- `path` may be empty to match any path

## ScopeConfig

```json
{
  "enabled": true,
  "include_rules": [],
  "exclude_rules": []
}
```

## FilterConfig

```json
{
  "search": "",
  "method": "",
  "host": "",
  "extensionShow": "",
  "extensionHide": "js,css,png",
  "contentTypeShow": "",
  "contentTypeHide": "",
  "statusCodes": [],
  "negativeSearch": false,
  "caseInsensitive": true,
  "useRegex": false,
  "searchScope": [],
  "inScopeOnly": true
}
```

## MatchReplaceRule

```json
{
  "id": 1,
  "enabled": true,
  "name": "Rewrite bearer token",
  "target": "req-header",
  "is_regex": true,
  "match": "^Authorization: Bearer .*$",
  "replace": "Authorization: Bearer test-token"
}
```

Rules:

- `target` is one of `req-url`, `req-header`, `req-body`, `res-header`, `res-body`

## MiddlewareNodePos

```json
{
  "x": 80,
  "y": 120
}
```

## MiddlewareNode

```json
{
  "id": "node-request-1",
  "type": "request",
  "name": "Rewrite Header",
  "enabled": true,
  "code": "def process(packet):\n    return packet\n",
  "position": {
    "x": 80,
    "y": 120
  }
}
```

Rules:

- `type` is one of `request`, `response`, `ws_c2s`, `ws_s2c`
- `code` must define `process(packet)`
- WebSocket node runtime packets now also expose frame metadata such as `session_id`, `fin`, `rsv1`, `compressed`, and context-takeover flags. That runtime shape is described below.

## MiddlewareEdge

```json
{
  "id": "edge-1",
  "source": "node-request-1",
  "target": "node-request-2"
}
```

Edges are used to topologically order nodes of the same traffic type.

## MiddlewareConfig

```json
{
  "enabled": true,
  "nodes": [],
  "edges": []
}
```

## FlowStep

```json
{
  "id": "step-1",
  "type": "request",
  "name": "Login Request",
  "raw": "R0VUIC8gSFRUUC8xLjENCkhvc3Q6IGV4YW1wbGUuY29tDQoNCg==",
  "code": ""
}
```

Rules:

- `type` is `request` or `process`
- request steps use `raw`
- process steps use `code`
- `raw` is base64-encoded raw HTTP bytes

## Flow

```json
{
  "id": "login-flow",
  "name": "Login Flow",
  "steps": [],
  "variables": {
    "user": "alice"
  }
}
```

`variables` are default seed variables for interpolation and process steps. `run_flow` can add or override them with `variables_json`.

## WebSocketSession Result Shape

`get_websocket_session` returns:

```json
{
  "id": 1,
  "request_id": 161,
  "created_at": "2026-03-17T23:28:47Z",
  "closed_at": null
}
```

## WebSocketFrame Result Shape

`get_websocket_frames` returns frame objects like:

```json
{
  "id": 10,
  "session_id": 1,
  "direction": "c2s",
  "opcode": 2,
  "fin": 1,
  "payload": "base64-or-byte-json-depending-client",
  "length": 105,
  "truncated": false,
  "timestamp": "2026-03-17T23:49:56Z"
}
```

Rules:

- `direction` is `c2s` or `s2c`
- `opcode` is the WebSocket frame opcode
- `payload` is the stored raw frame payload bytes
- `length` is the original payload size before any truncation
- `truncated` indicates capture truncation

## Console Output Result Shape

`get_console_output` returns entries like:

```json
{
  "source": "middleware",
  "text": "decoded frame metadata ...",
  "timestamp": "2026-03-19T12:34:56.123456Z"
}
```

Rules:

- `source` is `middleware` or `flow`
- entries are stored in-memory, not in the project database
- `get_console_output(limit=...)` returns recent entries only

## WebSocket Middleware Runtime Packet Shape

For WebSocket middleware nodes, the Python `packet` object exposes:

```python
packet.direction                  # "ws_c2s" or "ws_s2c"
packet.session_id                 # int
packet.opcode                     # int
packet.fin                        # int
packet.rsv1                       # bool
packet.compressed                 # bool
packet.compression_enabled        # bool
packet.no_context_takeover        # bool
packet.client_no_context_takeover # bool
packet.server_no_context_takeover # bool
packet.payload                    # bytes
```

## Project Config Snapshot

`get_project` returns an object that includes at least these top-level fields:

```json
{
  "name": "Project Name",
  "path": "/absolute/project/path",
  "is_temp": false,
  "proxy": {},
  "filters": {},
  "scope": {},
  "match_replace": [],
  "middleware": {},
  "flows": [],
  "mcp_disabled": false,
  "mcp_port": 19090
}
```

When using `update_project`, you only send the fields you want to change. Nested config fields are passed as stringified JSON arguments at the MCP layer.
