# MCP Tool Reference

PandoraBox exposes 20 tools over the Model Context Protocol (MCP) using Server-Sent Events (SSE) transport.

**Endpoint:** `http://localhost:9090/sse`

All tools return JSON. All tools check whether MCP is enabled for the current project and return an error if it is disabled (configurable in Settings → MCP or via `update_project`).

---

## Table of Contents

- [Proxy Control](#proxy-control)
  - [proxy_status](#proxy_status)
  - [proxy_start](#proxy_start)
  - [proxy_stop](#proxy_stop)
- [Traffic](#traffic)
  - [list_requests](#list_requests)
  - [get_request](#get_request)
  - [search_requests](#search_requests)
  - [delete_request](#delete_request)
- [Replay](#replay)
  - [replay_request](#replay_request)
  - [send_request](#send_request)
- [Intercept](#intercept)
  - [intercept_toggle](#intercept_toggle)
  - [list_intercept_queue](#list_intercept_queue)
  - [intercept_forward](#intercept_forward)
  - [intercept_drop](#intercept_drop)
  - [intercept_modify](#intercept_modify)
- [Project & Configuration](#project--configuration)
  - [get_project](#get_project)
  - [update_project](#update_project)
  - [list_recent_projects](#list_recent_projects)
  - [open_project](#open_project)
  - [new_project](#new_project)
- [Certificate](#certificate)
  - [get_ca_cert](#get_ca_cert)

---

## Proxy Control

### proxy_status

Returns the current state of the MITM proxy.

**Parameters:** none

**Returns:**
```json
{
  "running": true,
  "port": 8080,
  "intercept_enabled": false,
  "request_count": 142,
  "queue_length": 0
}
```

| Field | Type | Description |
|---|---|---|
| `running` | bool | Whether the proxy listener is active |
| `port` | int | Port the proxy is listening on |
| `intercept_enabled` | bool | Whether interception is currently on |
| `request_count` | int | Total requests captured in the current project |
| `queue_length` | int | Number of requests currently held in the intercept queue |

---

### proxy_start

Starts the MITM proxy listener. If the proxy is already running, this is a no-op.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `port` | number | No | Override the proxy port for this session |

**Returns:**
```json
{
  "success": true,
  "port": 8080
}
```

---

### proxy_stop

Stops the MITM proxy listener. In-flight connections are closed.

**Parameters:** none

**Returns:**
```json
{ "success": true }
```

---

## Traffic

### list_requests

Lists captured HTTP requests with optional filters and pagination. Returns the most recent requests first.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `host` | string | No | Filter by host (substring match, e.g. `"api.example.com"`) |
| `method` | string | No | Filter by HTTP method (`"GET"`, `"POST"`, etc.) |
| `status_min` | number | No | Minimum response status code (e.g. `400`) |
| `status_max` | number | No | Maximum response status code (e.g. `499`) |
| `search` | string | No | Keyword search across host, path, and query string |
| `limit` | number | No | Maximum number of results to return (default: `20`) |
| `offset` | number | No | Pagination offset (default: `0`) |

**Returns:**
```json
{
  "requests": [
    {
      "id": 47,
      "method": "POST",
      "scheme": "https",
      "host": "api.example.com",
      "path": "/v1/login",
      "query": "",
      "headers": "{\"Content-Type\":[\"application/json\"]}",
      "body": "eyJ1c2VybmFtZSI6ImFkbWluIn0=",
      "timestamp": "2024-01-15T10:28:00Z",
      "tags": "[]",
      "response": {
        "id": 52,
        "request_id": 47,
        "status_code": 200,
        "status_text": "OK",
        "headers": "{\"Content-Type\":[\"application/json\"]}",
        "body": "eyJzdWNjZXNzIjp0cnVlfQ==",
        "duration_ms": 123,
        "size_bytes": 15,
        "timestamp": "2024-01-15T10:28:00Z"
      }
    }
  ],
  "total": 142
}
```

**Notes:**
- `headers` is a JSON string containing `Record<string, string[]>`.
- `body` is base64-encoded when binary, or a plain string for text.
- `response` is `null` if no response has been captured yet.
- `tags` is a JSON array (e.g. `["websocket"]` for WebSocket connections).

**Example — find all 4xx errors on a specific host:**
```
list_requests with host="api.example.com", status_min=400, status_max=499, limit=50
```

---

### get_request

Fetches a single request by ID with full headers and body.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | number | **Yes** | The request ID |

**Returns:** A single request object (same shape as entries in `list_requests`).

**Example:**
```
get_request with id=47
```

---

### search_requests

Full-text keyword search across all captured traffic (host, path, query).

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string | **Yes** | Search keyword |
| `limit` | number | No | Maximum results (default: `20`) |

**Returns:**
```json
{
  "matches": [ /* Request objects */ ],
  "total": 3
}
```

**Example:**
```
search_requests with query="Authorization", limit=10
```

---

### delete_request

Permanently deletes a request and its associated response from the database.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | number | **Yes** | The request ID to delete |

**Returns:**
```json
{ "success": true }
```

---

## Replay

### replay_request

Replays a previously captured request. Optionally override the URL, headers, or body before sending. The original request in the database is not modified — a new Replay record is created.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `request_id` | number | **Yes** | ID of the request to replay |
| `modified_url` | string | No | Override the full URL (e.g. `"https://api.example.com/v2/login"`) |
| `modified_body` | string | No | Override the request body (plain string) |
| `modified_headers_json` | string | No | JSON object of header overrides (e.g. `"{\"X-Custom\": \"value\"}"`) |

**Returns:** A Replay object:
```json
{
  "id": 5,
  "origin_request_id": 47,
  "request_id": 89,
  "response_id": 90,
  "status": "done",
  "error": "",
  "created_at": "2024-01-15T10:35:00Z",
  "request": { /* full request */ },
  "response": { /* full response */ }
}
```

**Example — replay with a different Authorization header:**
```
replay_request with request_id=47, modified_headers_json="{\"Authorization\": \"Bearer newtoken123\"}"
```

**Example — replay against a staging server:**
```
replay_request with request_id=47, modified_url="https://staging.example.com/v1/login"
```

---

### send_request

Sends a completely new HTTP request through the proxy. The request and response are saved to the database.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `method` | string | **Yes** | HTTP method (`"GET"`, `"POST"`, `"PUT"`, `"DELETE"`, etc.) |
| `url` | string | **Yes** | Full target URL (e.g. `"https://api.example.com/users"`) |
| `body` | string | No | Request body |
| `headers_json` | string | No | JSON object of request headers (e.g. `"{\"Content-Type\": \"application/json\"}"`) |

**Returns:** A Replay object (same shape as `replay_request`).

**Example — send a POST with a JSON body:**
```
send_request with method="POST", url="https://api.example.com/users",
  body="{\"username\": \"test\"}",
  headers_json="{\"Content-Type\": \"application/json\", \"Authorization\": \"Bearer token\"}"
```

---

## Intercept

### intercept_toggle

Enables or disables request interception globally.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `enabled` | boolean | **Yes** | `true` to enable, `false` to disable |

**Returns:**
```json
{ "enabled": true }
```

---

### list_intercept_queue

Returns all requests currently held in the intercept queue, waiting for a forward/drop decision.

**Parameters:** none

**Returns:**
```json
{
  "queue": [ /* Request objects */ ]
}
```

---

### intercept_forward

Forwards a held request to the server unchanged. The browser receives the real response.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `request_id` | number | **Yes** | ID of the held request |

**Returns:**
```json
{ "success": true }
```

`success` is `false` if the request was not found in the queue (already resolved or expired).

---

### intercept_drop

Drops a held request. The browser receives a `502 Bad Gateway` response.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `request_id` | number | **Yes** | ID of the held request |

**Returns:**
```json
{ "success": true }
```

---

### intercept_modify

Forwards a held request with a modified raw HTTP packet. Useful for injecting or altering parameters, headers, or the body before the request reaches the server.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `request_id` | number | **Yes** | ID of the held request |
| `raw` | string | **Yes** | Base64-encoded modified raw HTTP request (e.g. `"UEFUQ0ggL2FwaS91c2Vy..."`) |

The `raw` value must be a valid HTTP/1.1 request packet. Use `get_request` to read the original `raw` field, decode it, modify it, and re-encode as base64.

**Returns:**
```json
{ "success": true }
```

**Example workflow:**
```
1. intercept_toggle with enabled=true
2. (make a browser request that gets held)
3. list_intercept_queue  →  find the request_id
4. get_request with id=<id>  →  read the "raw" field
5. decode base64, edit the packet, re-encode
6. intercept_modify with request_id=<id>, raw=<new_base64>
```

---

## Project & Configuration

### get_project

Returns information about the currently active project.

**Parameters:** none

**Returns:**
```json
{
  "name": "My API Tests",
  "path": "/Users/me/projects/api-tests",
  "is_temp": false,
  "proxy": {
    "port": 8080,
    "intercept_enabled": false,
    "upstream_url": ""
  },
  "scope": {
    "enabled": true,
    "include_rules": [
      {
        "enabled": true,
        "pattern_type": "wildcard",
        "host": "*.example.com",
        "path": ""
      }
    ],
    "exclude_rules": []
  },
  "mcp_disabled": false
}
```

---

### update_project

Updates settings for the current project. All parameters are optional — only the fields you provide are changed.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | New project name |
| `proxy_port` | number | No | New proxy listen port (takes effect immediately) |
| `intercept_enabled` | boolean | No | Enable/disable interception |
| `scope_enabled` | boolean | No | Enable/disable scope filtering |
| `scope_include_json` | string | No | JSON array of `ScopeRule` objects replacing the include rules |
| `scope_exclude_json` | string | No | JSON array of `ScopeRule` objects replacing the exclude rules |
| `mcp_disabled` | boolean | No | If `true`, disables all MCP tool access for this project |

**`ScopeRule` object:**
```json
{
  "enabled": true,
  "pattern_type": "wildcard",
  "host": "*.example.com",
  "path": "/api"
}
```

`pattern_type` values: `"exact"`, `"contains"`, `"wildcard"` (glob `*` and `?`), `"regex"`.
`path` can be empty (`""`) to match any path on the host.

**Returns:** Updated project info (same shape as `get_project`).

**Example — restrict scope to a single domain:**
```
update_project with
  scope_enabled=true,
  scope_include_json="[{\"enabled\":true,\"pattern_type\":\"wildcard\",\"host\":\"*.example.com\",\"path\":\"\"}]"
```

**Example — rename project and change port:**
```
update_project with name="Prod Audit", proxy_port=9999
```

---

### list_recent_projects

Lists up to 10 recently opened projects.

**Parameters:** none

**Returns:**
```json
[
  { "path": "/Users/me/projects/api-tests", "name": "API Tests", "exists": true },
  { "path": "/Users/me/projects/old",       "name": "/Users/me/projects/old", "exists": false }
]
```

`exists: false` means the folder was deleted or moved since it was last opened.

---

### open_project

Opens an existing project folder and switches the active project. All subsequent traffic and settings use this project's database and configuration.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `path` | string | **Yes** | Absolute path to the project folder |

**Returns:**
```json
{
  "name": "API Tests",
  "path": "/Users/me/projects/api-tests",
  "is_temp": false
}
```

---

### new_project

Creates a new project folder at the given path and switches to it. The folder is created if it does not exist.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `path` | string | **Yes** | Absolute path for the new project folder |
| `name` | string | No | Project display name (default: `"New Project"`) |

**Returns:**
```json
{
  "name": "Bug Bounty",
  "path": "/Users/me/projects/bug-bounty",
  "is_temp": false
}
```

---

## Certificate

### get_ca_cert

Returns the root CA certificate PEM and platform-specific installation instructions.

**Parameters:** none

**Returns:**
```json
{
  "pem": "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n",
  "instructions": {
    "chrome":  "Settings → Privacy and security → Security → Manage certificates → Import",
    "firefox": "Settings → Privacy & Security → Certificates → View Certificates → Import",
    "macos":   "Double-click the .crt file → Trust → Always Trust for SSL"
  }
}
```

Save the `pem` value to a `.crt` file and follow the instructions for your browser. See the [README CA Certificate Setup section](../README.md#ca-certificate-setup) for full platform-specific steps.
