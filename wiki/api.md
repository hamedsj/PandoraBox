# REST API Reference

Base URL: `http://localhost:7777`

All endpoints return JSON. Error responses use HTTP 4xx/5xx with a plain-text body describing the error.

---

## Table of Contents

- [Proxy Control](#proxy-control)
- [Traffic](#traffic)
- [Intercept](#intercept)
- [Replay](#replay)
- [Project](#project)
- [Certificate](#certificate)
- [WebSocket Event Stream](#websocket-event-stream)

---

## Proxy Control

### `GET /api/proxy/status`

Returns the current proxy state.

**Response:**
```json
{
  "running": true,
  "port": 8080,
  "intercept_enabled": false,
  "request_count": 142,
  "queue_length": 0
}
```

---

### `POST /api/proxy/start`

Starts the MITM proxy listener. No-op if already running.

**Response:**
```json
{ "success": true, "port": 8080 }
```

---

### `POST /api/proxy/stop`

Stops the MITM proxy listener.

**Response:**
```json
{ "success": true }
```

---

### `PUT /api/proxy/config`

Updates proxy runtime configuration.

**Request body:**
```json
{
  "port": 8080,
  "intercept_enabled": true
}
```

All fields are optional. Changes take effect immediately.

**Response:**
```json
{ "success": true }
```

---

### `GET /api/ca/cert`

Downloads the root CA certificate as a PEM file.

**Response:** `Content-Type: application/x-pem-file`, raw PEM bytes.

---

## Traffic

### `GET /api/requests`

Lists captured requests. Returns newest first.

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `host` | string | Substring match on host |
| `method` | string | Exact match on HTTP method |
| `search` | string | Keyword search in host, path, query |
| `status_min` | int | Minimum response status code |
| `status_max` | int | Maximum response status code |
| `limit` | int | Max results (default: 50) |
| `offset` | int | Pagination offset (default: 0) |

**Response:**
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
      "raw": null,
      "timestamp": "2024-01-15T10:28:00Z",
      "tags": "[]",
      "response": {
        "id": 52,
        "request_id": 47,
        "status_code": 200,
        "status_text": "OK",
        "headers": "{\"Content-Type\":[\"application/json\"]}",
        "body": "eyJzdWNjZXNzIjp0cnVlfQ==",
        "raw": null,
        "duration_ms": 123,
        "size_bytes": 15,
        "timestamp": "2024-01-15T10:28:00Z"
      }
    }
  ],
  "total": 142
}
```

**Field notes:**
- `headers`: JSON string — `Record<string, string[]>` (header name → array of values).
- `body`: base64 string for binary bodies, plain string for text. `null` if no body.
- `raw`: base64-encoded raw HTTP packet (may be `null` for older captures).
- `tags`: JSON array — `["websocket"]` for WebSocket upgrade requests.
- `response`: `null` if the response has not been captured yet.

---

### `GET /api/requests/{id}`

Fetches a single request with its full response.

**Response:** Single request object (same shape as entries in `/api/requests`).

**Error:** `404` if not found.

---

### `DELETE /api/requests/{id}`

Permanently deletes a request and its associated response.

**Response:**
```json
{ "success": true }
```

---

### `GET /api/requests/{id}/ws-frames`

Returns the WebSocket session and frames for a WebSocket upgrade request.

**Response:**
```json
{
  "session": {
    "id": 3,
    "request_id": 47,
    "created_at": "2024-01-15T10:28:00Z",
    "closed_at": null
  },
  "frames": [
    {
      "id": 1,
      "session_id": 3,
      "direction": "c2s",
      "opcode": 1,
      "fin": 1,
      "payload": "SGVsbG8=",
      "length": 5,
      "truncated": false,
      "timestamp": "2024-01-15T10:28:01Z"
    }
  ]
}
```

`session` and `frames` are `null` if the request is not a WebSocket connection.

**Frame opcodes:** `1` = text, `2` = binary, `8` = close, `9` = ping, `10` = pong.
**`direction`:** `"c2s"` = client to server, `"s2c"` = server to client.
**`payload`:** base64-encoded unmasked frame payload. May be truncated (> 1 MB frames).

---

## Intercept

### `GET /api/intercept/queue`

Lists all requests currently held in the intercept queue.

**Response:**
```json
{ "queue": [ /* Request objects */ ] }
```

---

### `PUT /api/intercept/toggle`

Enables or disables interception globally.

**Request body:**
```json
{ "enabled": true }
```

**Response:**
```json
{ "enabled": true }
```

---

### `POST /api/intercept/forward/{id}`

Forwards a held request unchanged.

**Response:**
```json
{ "success": true }
```

---

### `POST /api/intercept/forward-all`

Forwards all currently held requests at once.

**Response:**
```json
{ "forwarded": 5 }
```

---

### `POST /api/intercept/drop/{id}`

Drops a held request. The browser receives `502 Bad Gateway`.

**Response:**
```json
{ "success": true }
```

---

### `POST /api/intercept/modify/{id}`

Forwards a held request with a modified raw HTTP packet.

**Request body:**
```json
{ "raw": "<base64-encoded raw HTTP request>" }
```

**Response:**
```json
{ "success": true }
```

---

### `GET /api/intercept/filter`

Returns the current intercept filter configuration.

**Response:**
```json
{
  "host": "api.example.com",
  "method": "POST",
  "path": "/admin"
}
```

Empty strings mean "no filter on this field".

---

### `PUT /api/intercept/filter`

Updates the intercept filter. Only requests matching all non-empty fields are held.

**Request body:**
```json
{
  "host": "api.example.com",
  "method": "",
  "path": ""
}
```

**Response:** Updated filter (same shape as `GET /api/intercept/filter`).

---

## Replay

### `POST /api/replay`

Replays an existing request or sends a new one. Creates a Replay record in the database.

**Request body:**
```json
{
  "request_id": 47,
  "modified_url": "https://staging.example.com/v1/login",
  "modified_headers": { "X-Custom": "value" },
  "modified_body": [/* byte array */],
  "raw": "<base64 raw HTTP packet>"
}
```

All fields except `request_id` are optional. If `raw` is provided, it overrides everything. If only `request_id` is provided, the request is replayed as-is.

**Response:**
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

`status` values: `"pending"` → `"done"` | `"error"`.

---

### `GET /api/replay/{id}`

Fetches a replay result with the associated request and response.

**Response:** Replay object (same shape as `POST /api/replay` response).

---

## Project

### `GET /api/project`

Returns the current project configuration.

**Response:**
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
  "filters": {
    "search": "",
    "method": "",
    "host": "",
    "extensionShow": "",
    "extensionHide": "",
    "contentTypeShow": "",
    "contentTypeHide": "",
    "statusCodes": [],
    "negativeSearch": false,
    "caseInsensitive": true,
    "useRegex": false,
    "searchScope": [],
    "inScopeOnly": false
  },
  "scope": {
    "enabled": false,
    "include_rules": [],
    "exclude_rules": []
  },
  "mcp_disabled": false
}
```

---

### `PUT /api/project`

Updates current project settings. All fields are optional.

**Request body:**
```json
{
  "name": "New Name",
  "proxy": { "port": 8080, "intercept_enabled": true, "upstream_url": "" },
  "filters": { /* FilterConfig */ },
  "scope": { /* ScopeConfig */ },
  "mcp_disabled": false
}
```

**Response:** Updated ProjectInfo (same shape as `GET /api/project`).

---

### `POST /api/project/save-as`

Copies the current project to a new folder.

**Request body:**
```json
{ "path": "/Users/me/projects/backup", "name": "Backup" }
```

**Response:** The new ProjectInfo.

---

### `GET /api/project/recent`

Lists recently opened projects (up to 10).

**Response:**
```json
[
  { "path": "/Users/me/projects/api-tests", "name": "API Tests", "exists": true },
  { "path": "/old/path", "name": "/old/path", "exists": false }
]
```

---

### `POST /api/project/open`

Opens an existing project folder and switches to it.

**Request body:**
```json
{ "path": "/Users/me/projects/api-tests" }
```

**Response:** ProjectInfo for the opened project.

---

### `POST /api/project/new`

Creates a new project and switches to it.

**Request body:**
```json
{ "path": "/Users/me/projects/new-project", "name": "New Project" }
```

**Response:** ProjectInfo for the new project.

---

## Certificate

### `GET /api/ca/cert`

Downloads the root CA certificate.

**Response:** Raw PEM bytes with `Content-Type: application/x-pem-file` and `Content-Disposition: attachment; filename="pitok-ca.crt"`.

---

## WebSocket Event Stream

### `GET /ws`

Upgrades to a WebSocket connection. The server pushes real-time JSON events to all connected clients.

**Event envelope:**
```json
{ "type": "event.type", "data": { /* payload */ } }
```

### Event Types

#### `request.captured`

Fired when a new HTTP request (and its response) is saved to the database.

```json
{
  "type": "request.captured",
  "data": { /* full Request object with nested Response */ }
}
```

#### `response.received`

Fired when a response is saved. (Also fires alongside `request.captured`.)

```json
{
  "type": "response.received",
  "data": { /* Response object */ }
}
```

#### `intercept.held`

Fired when a request is placed in the intercept queue.

```json
{
  "type": "intercept.held",
  "data": { "request_id": 47 }
}
```

#### `intercept.resolved`

Fired when an intercept decision is made (forward, drop, or modify).

```json
{
  "type": "intercept.resolved",
  "data": { "request_id": 47, "action": "forward" }
}
```

#### `proxy.status`

Fired when the proxy starts or stops.

```json
{
  "type": "proxy.status",
  "data": {
    "running": true,
    "port": 8080,
    "intercept_enabled": false,
    "request_count": 143,
    "queue_length": 0
  }
}
```

#### `project.switched`

Fired when the active project is changed.

```json
{
  "type": "project.switched",
  "data": { "path": "/Users/me/projects/new", "name": "New Project" }
}
```

#### `websocket.frame`

Fired when a WebSocket frame is captured.

```json
{
  "type": "websocket.frame",
  "data": {
    "id": 10,
    "session_id": 3,
    "direction": "s2c",
    "opcode": 1,
    "fin": 1,
    "payload": "eyJ0eXBlIjoibWVzc2FnZSJ9",
    "length": 20,
    "truncated": false,
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

#### `websocket.session.opened`

Fired when a WebSocket upgrade is completed.

```json
{
  "type": "websocket.session.opened",
  "data": { "session_id": 3, "request_id": 47 }
}
```

#### `websocket.session.closed`

Fired when a WebSocket connection is closed by either side.

```json
{
  "type": "websocket.session.closed",
  "data": { "session_id": 3, "request_id": 47 }
}
```
