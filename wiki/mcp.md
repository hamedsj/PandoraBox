# MCP Tool Reference

> **The authoritative tool reference lives inside the running PandoraBox MCP server.** This wiki page only describes setup and points at the canonical docs.

## Getting the up-to-date docs

The tool list, argument schemas, and behaviour annotations all come from the live registry — they are guaranteed not to drift. To read them, connect any MCP client and call:

```
docs_list           # list every documentation topic
docs_get(topic="tools")           # full tool reference (auto-generated)
docs_get(topic="overview")        # operating model + conventions
docs_get(topic="project-schemas") # exact JSON shapes for config-shaped args
docs_get(topic="middleware")      # writing Python middleware nodes
docs_get(topic="flows")           # writing flows
docs_get(topic="coding-api")      # calling tools from scripts via REST
```

The same documents are also exposed as MCP resources at `docs://pandorabox/{topic}`.

The deprecated aliases `list_docs` / `get_doc` still work.

---

## Connection

PandoraBox exposes MCP over two HTTP transports on a single port (default `9090`):

| Transport | URL | Status |
|-----------|-----|--------|
| **Streamable HTTP** (preferred) | `http://localhost:9090/mcp` | Recommended for Claude Code, Claude Desktop, Codex, Gemini, Qwen |
| Legacy SSE | `http://localhost:9090/sse` (+ `/message`) | Kept for older clients only |

The port is configurable per project (`update_project(mcp_port=...)`) and via the `--mcp-port` CLI flag.

The MCP server only accepts requests from `localhost` / `127.0.0.1` / `::1` to avoid exposing the surface to other machines.

## Disabling MCP for a project

Set `mcp_disabled: true` in the project config, or call `update_project(mcp_disabled=true)`. Every tool then refuses with a clear error pointing at how to re-enable it. The disable check is enforced uniformly at the registry boundary — no tool can bypass it.

## Tool naming

Tool names follow `category_verb_object` (`traffic_list`, `proxy_start`, `flow_save`, …). The old verb-first names (`list_requests`, `proxy_start`, `save_flow`, `get_doc`, …) are still registered as **deprecated aliases**; their descriptions in `tools/list` say so, and their schemas are identical. Update your prompts to the new names at your convenience.

## Argument conventions

- **Native nested JSON.** Object and array arguments are declared with `mcp.WithObject` / `mcp.WithArray` and accept normal nested JSON. The pre-existing `*_json` stringified forms (e.g. `headers_json`, `scope_include_json`, `payloads_json`) still work for back-compat.
- **Numbers.** All `_id` arguments are JSON numbers; the server extracts them as `int64` safely.
- **Booleans.** The `decoded` flag means the same thing everywhere and defaults to `true` (the bodies you want are decompressed by default).
- **Destructive ops.** Bulk delete tools support `dry_run=true` to preview, and require `confirm=true` above safety thresholds. Team-server operations that affect every connected client (restart, password change, data-dir migration) require explicit `confirm=true` too.

## Hints

Every tool carries the MCP `annotations` block. Clients that surface these (Claude Desktop, Codex, etc.) show a warning chip on destructive tools, mark read-only tools as safe to call freely, and highlight the ones that talk to external networks (collaborator, replay).

## Bug reports & contributions

The tool reference is generated from `internal/mcp/registry.go` walking the `ToolSpec` registrations. If a description is wrong, fix it at the `s.register(ToolSpec{...})` call site — no other file needs to change.
