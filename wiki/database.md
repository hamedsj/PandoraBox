# Database Schema

PandoraBox uses SQLite with WAL (Write-Ahead Logging) mode for concurrent read performance. The database file is `pandora.db` inside the project folder.

Driver: `modernc.org/sqlite` (pure Go, no CGo).

---

## Tables

### `requests`

Stores every captured HTTP request.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment request ID |
| `method` | TEXT | HTTP method (`GET`, `POST`, etc.) |
| `scheme` | TEXT | `http` or `https` |
| `host` | TEXT | Target host (e.g. `api.example.com`) |
| `path` | TEXT | URL path (e.g. `/v1/login`) |
| `query` | TEXT | Query string without leading `?` |
| `headers` | TEXT | JSON — `Record<string, string[]>` |
| `body` | BLOB | Raw request body bytes (`null` if no body) |
| `raw` | BLOB | Raw HTTP/1.1 request packet bytes |
| `timestamp` | TEXT | ISO 8601 timestamp |
| `tags` | TEXT | JSON array (e.g. `["websocket"]`) |

**Indices:**
- `idx_req_host(host)` — fast host filtering
- `idx_req_ts(timestamp DESC)` — newest-first ordering

---

### `responses`

Stores the HTTP response for a captured request. One-to-one with `requests`.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `request_id` | INTEGER FK | References `requests.id` |
| `status_code` | INTEGER | HTTP status code (e.g. `200`) |
| `status_text` | TEXT | HTTP status text (e.g. `OK`) |
| `headers` | TEXT | JSON — `Record<string, string[]>` |
| `body` | BLOB | Raw response body bytes |
| `raw` | BLOB | Raw HTTP/1.1 response packet bytes |
| `duration_ms` | INTEGER | Round-trip time in milliseconds |
| `size_bytes` | INTEGER | Uncompressed response body size |
| `timestamp` | TEXT | ISO 8601 timestamp |

---

### `replays`

Records replay operations — either replaying an existing request or sending a new one.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `origin_request_id` | INTEGER | Source request ID (`null` for fresh sends) |
| `request_id` | INTEGER FK | The actual request sent (new row in `requests`) |
| `response_id` | INTEGER | The response received (`null` while pending) |
| `status` | TEXT | `pending`, `done`, or `error` |
| `error` | TEXT | Error message if `status = error` |
| `created_at` | TEXT | ISO 8601 timestamp |

---

### `intercept_queue`

Tracks requests held for interception. Entries are written when a request is held and updated when a decision is made.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `request_id` | INTEGER FK | References `requests.id` |
| `state` | TEXT | `held`, `forwarded`, `dropped`, or `modified` |
| `modified_raw` | BLOB | Replacement raw HTTP packet (only for `modified` state) |
| `created_at` | TEXT | ISO 8601 timestamp when held |
| `resolved_at` | TEXT | ISO 8601 timestamp when decision made (`null` while held) |

---

### `websocket_sessions`

One row per WebSocket connection, linked to the HTTP upgrade request.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `request_id` | INTEGER FK | The HTTP upgrade request in `requests` |
| `created_at` | TEXT | ISO 8601 timestamp of upgrade |
| `closed_at` | TEXT | ISO 8601 timestamp when closed (`null` while open) |

**Index:** `idx_ws_sessions_req(request_id)`

---

### `websocket_frames`

Individual WebSocket frames captured during a session.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `session_id` | INTEGER FK | References `websocket_sessions.id` |
| `direction` | TEXT | `c2s` (client→server) or `s2c` (server→client) |
| `opcode` | INTEGER | `1` = text, `2` = binary, `8` = close, `9` = ping, `10` = pong |
| `fin` | INTEGER | `1` if this is the final fragment, `0` otherwise |
| `payload` | BLOB | Unmasked, decompressed frame payload (≤ 1 MB) |
| `length` | INTEGER | Original payload size before any truncation |
| `truncated` | INTEGER | `1` if the payload was truncated (> 1 MB) |
| `timestamp` | TEXT | ISO 8601 capture timestamp |

**Index:** `idx_ws_frames_session(session_id)`

---

## PRAGMA Settings

Applied on every connection open:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

WAL mode allows one writer and multiple concurrent readers without blocking, which is important since the proxy, API, and MCP server all access the database simultaneously.

---

## Schema Migrations

Migrations run automatically on startup in `internal/storage/db.go`. They are sequential and additive — no destructive changes. A `schema_version` table tracks the applied version.

To inspect the live schema:

```bash
sqlite3 pandora.db .schema
```
