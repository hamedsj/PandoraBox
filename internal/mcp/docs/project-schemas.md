# PandoraBox Project Schemas

This document records the JSON shapes used by PandoraBox MCP tools. These are the shapes accepted by `update_project`, `update_match_replace`, `update_middleware`, and `save_flow`.

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
