# PandoraBox MCP Overview

PandoraBox exposes its automation surface through MCP tools. The important rule is that nested structures are usually passed as JSON strings, not nested MCP objects.

Recommended discovery order:

1. Call `list_docs`.
2. Read `get_doc(topic="tools")`.
3. Read `get_doc(topic="project-schemas")` before sending complex config.
4. Read `get_doc(topic="middleware")` before writing middleware code.
5. Read `get_doc(topic="flows")` before writing or running flows.

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
- Flows use string IDs.
- Flow request steps store raw HTTP as base64 in `flow.steps[].raw`.
- Middleware request/response bodies and WebSocket payloads are bytes. The runtime transports them as base64 under the hood, then presents them to Python as `bytes`.

## Practical Guidance

- Use `get_request` before `replay_request` if you need to inspect the original packet first.
- Use `get_project` before `update_project` if you want to patch current config safely instead of replacing fields blindly.
- Use `get_doc(topic="project-schemas")` before building `middleware_json`, `flows_json`, or scope rules.
- Treat WebSocket payloads as binary unless you know they are text.
