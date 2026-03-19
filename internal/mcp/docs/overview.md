# PandoraBox MCP Overview

PandoraBox exposes its automation surface through MCP tools. The important rule is that nested structures are usually passed as JSON strings, not nested MCP objects.

Recommended discovery order:

1. Call `list_docs`.
2. Read `get_doc(topic="tools")`.
3. Read `get_doc(topic="project-schemas")` before sending complex config.
4. Read `get_doc(topic="middleware")` before writing middleware code.
5. Read `get_doc(topic="flows")` before writing or running flows.
6. If you need live debugging output, use `get_console_output`.

The same documentation is also exposed as MCP resources:

- `docs://pandorabox/overview`
- `docs://pandorabox/tools`
- `docs://pandorabox/project-schemas`
- `docs://pandorabox/middleware`
- `docs://pandorabox/flows`

## Operating Model

- PandoraBox stores most state in the current project.
- Mutating tools usually persist changes immediately.
- `get_project` returns the current project config snapshot.
- `update_project` is the broad config tool when you need to change multiple settings at once.
- Feature-specific tools such as `update_middleware`, `update_match_replace`, and `save_flow` are better when editing one area at a time.
- WebSocket frames are stored separately from the original HTTP upgrade request and are accessed through dedicated WebSocket MCP tools.
- Console output from middleware and flows is event-driven and is exposed through `get_console_output`.

## Important Argument Conventions

Simple scalar fields are normal MCP arguments:

- `request_id: 123`
- `enabled: true`
- `url: "https://example.com"`

Nested objects and arrays are usually stringified JSON:

- `headers_json`
- `filters_json`
- `scope_include_json`
- `scope_exclude_json`
- `match_replace_json`
- `middleware_json`
- `flows_json`
- `rules_json`
- `config_json`
- `variables_json`

Example:

```json
{
  "headers_json": "{\"Authorization\":\"Bearer token\",\"X-Test\":\"1\"}"
}
```

## IDs and Encodings

- Request history items use numeric IDs.
- WebSocket sessions use numeric IDs.
- Flows use string IDs.
- Flow request steps store raw HTTP as base64 in `flow.steps[].raw`.
- Middleware request/response bodies and WebSocket payloads are bytes. The runtime transports them as base64 under the hood, then presents them to Python as `bytes`.
- MCP returns stored WebSocket frame payloads as raw captured bytes in the JSON result.

## High-Value MCP Workflows

- Inspect one captured WebSocket conversation:
  1. `list_requests`
  2. `get_websocket_session(request_id=...)`
  3. `get_websocket_frames(request_id=...)`
- Debug middleware or flow code:
  1. run the action that triggers your Python code
  2. call `get_console_output(source="middleware")` or `get_console_output(source="flow")`
- Patch project config safely:
  1. `get_project`
  2. change only the fields you intend
  3. call `update_project`

## Client Setup

PandoraBox serves MCP over Streamable HTTP at `http://localhost:<mcp_port>/mcp`.

- Prefer the primary HTTP endpoint for Claude Code, Gemini, Codex, and Qwen.
- The older SSE compatibility endpoint still exists at `/sse`, but it is not the preferred target for new clients.
- The in-app Settings page contains copyable setup snippets for common clients.

## Practical Guidance

- Use `get_request` before `replay_request` if you need to inspect the original packet first.
- Use `get_websocket_frames` instead of trying to infer socket traffic from the upgrade request alone.
- Use `get_console_output` when middleware or flow behavior is unclear.
- Use `get_project` before `update_project` if you want to patch current config safely instead of replacing fields blindly.
- Use `get_doc(topic="project-schemas")` before building `middleware_json`, `flows_json`, or scope rules.
- Treat WebSocket payloads as binary unless you know they are text.
