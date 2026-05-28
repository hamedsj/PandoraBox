# PandoraBox MCP Overview

PandoraBox exposes its automation surface through MCP tools. This document describes the operating model and conventions; the full tool reference is auto-generated from the registrations and lives at `docs_get(topic="tools")`.

## Discovery order

1. `docs_list` — list documentation topics.
2. `docs_get(topic="tools")` — full tool reference, generated live from the registry.
3. `docs_get(topic="project-schemas")` — exact JSON shapes for config-shaped arguments.
4. `docs_get(topic="coding-api")` — calling PandoraBox from scripts via REST.
5. `docs_get(topic="middleware")` — Python middleware node API.
6. `docs_get(topic="flows")` — flow execution model and steps.

The same documents are also available as MCP resources at `docs://pandorabox/{topic}`.

Deprecated aliases `list_docs` / `get_doc` still work.

## Operating model

- State lives in the **current project**. Most tools read from / write to it.
- `project_get` returns the current configuration snapshot.
- `project_update` is the omnibus config mutator. It accepts native nested objects, e.g. `scope_include: [...]`. The legacy `*_json` stringified forms (e.g. `scope_include_json`) still work alongside.
- Feature-specific mutators (`match_replace_update`, `middleware_update`, `flow_save`) are preferred when editing one area at a time.
- WebSocket frames are stored separately from the HTTP upgrade request — use the `websocket_*` tools.
- Console output from middleware and flows is event-driven; read it through `console_get_output`, which supports cursor pagination via `since_id`.

## Tool naming

Names follow `category_verb_object`:

| Category | Examples |
|---|---|
| Proxy | `proxy_status`, `proxy_start`, `proxy_stop` |
| Traffic | `traffic_list`, `traffic_get`, `traffic_search`, `traffic_delete`, `traffic_delete_bulk`, `traffic_delete_by_host` |
| WebSocket | `websocket_get_session`, `websocket_get_frames` |
| Intercept | `intercept_toggle`, `intercept_list_queue`, `intercept_forward`, `intercept_drop`, `intercept_modify`, `intercept_get_editable` |
| Replay | `replay_request`, `send_request` |
| Project | `project_get`, `project_update`, `project_rename`, `project_list_recent`, `project_open`, `project_new` |
| Sitemap | `sitemap_get` |
| Flow | `flow_list`, `flow_get`, `flow_save`, `flow_delete`, `flow_run` |
| Match & Replace | `match_replace_get`, `match_replace_update` |
| Middleware | `middleware_get`, `middleware_update` |
| Converter | `converter_list_algorithms`, `converter_transform`, `converter_get_stacks`, `converter_save_stacks`, `converter_run_stack` |
| Organizer | `organizer_*` (folders + items) |
| Intruder | `intruder_fuzz` (sync), `intruder_start`/`intruder_status`/`intruder_results`/`intruder_cancel` (async) |
| Collaborator | `collaborator_start`, `collaborator_poll`, `collaborator_stop`, `collaborator_generate_url` |
| Team | `team_status`, `team_connect`, `team_disconnect`, `team_list_members`, `team_get_member_traffic` |
| Team Server | `team_server_*` (server mode only) |
| Analysis | `analysis_export_responses`, `analysis_grep_responses`, `analysis_response_headers_summary` |
| Console | `console_get_output` |
| Certificate | `ca_get` |

The original verb-first names (`list_requests`, `get_request`, `save_flow`, etc.) are kept as **deprecated aliases** and still work.

## Argument conventions

### Nested objects and arrays

Object/array arguments use native JSON:

```json
{
  "headers": {"Authorization": "Bearer token"},
  "scope_include": [{"enabled": true, "pattern_type": "wildcard", "host": "*.example.com"}]
}
```

The legacy stringified forms (`headers_json`, `scope_include_json`, …) still work for older callers:

```json
{ "headers_json": "{\"Authorization\":\"Bearer token\"}" }
```

### IDs and numbers

- Request, response, WebSocket session, organizer folder/item IDs are JSON numbers.
- The server extracts them as `int64`, so IDs above 2^53 do not truncate.

### Booleans

- `decoded` (on `traffic_get`, `replay_request`, `send_request`, `analysis_export_responses`) is one concept with one default: **true**. Pass `decoded=false` only when you want raw, undecompressed bytes.

### Destructive operations

- Bulk delete tools (`traffic_delete_bulk`, `traffic_delete_by_host`) accept `dry_run=true` to preview the count without deleting.
- `traffic_delete_bulk` requires `confirm=true` above 5000 rows.
- `team_server_restart`, `team_server_set_password`, `team_server_migrate_data` require `confirm=true` because their effect is server-wide.

## Output shape

- Successful results return native JSON, transported as MCP **structured content** plus a compact text fallback. Clients see real JSON objects, not stringified-and-reparsed text.
- All envelopes are uniform: list tools return `{requests, total}` / `{matches, total}` / `{entries, count}`; mutate tools return `{success: true, ...}` (or `{success: false, reason: "..."}` with a machine-readable reason).
- Decoded bodies appear once as `decoded_body` (on the request/response object) and once as `decoded_response_body` at the top of the augmented envelope. The previous duplicate `readable_*` fields have been removed.

## Practical guidance

- Use `traffic_get` before `replay_request` if you need to inspect the original packet first.
- Use `websocket_get_frames` instead of trying to infer socket traffic from the upgrade request alone. It supports cursor pagination via `after_id` and filters by `direction` / `opcode`.
- Use `console_get_output(source=..., since_id=...)` when middleware or flow behaviour is unclear, and poll incrementally.
- Use `project_get` before `project_update` if you want to patch current config safely instead of overwriting fields blindly.
- Use `intercept_get_editable(request_id)` to fetch a held packet as text ready to edit before calling `intercept_modify(request_id, raw_text=...)`.
- For non-trivial intruder runs use `intruder_start` → `intruder_status` → `intruder_results` instead of the blocking `intruder_fuzz`.

## Client setup

PandoraBox serves MCP at `http://localhost:<mcp_port>/mcp` (Streamable HTTP). A legacy SSE endpoint exists at `/sse` for older clients. The in-app Settings page contains copy-paste setup snippets for common clients (Claude Desktop, Claude Code, Codex, Gemini, Qwen).

## Versioning and compatibility

The server is liberal about the `Mcp-Protocol-Version` header: any value is accepted, and the server advertises the version it implements during `initialize`. This avoids the "newer client → silent rejection" failure mode.
