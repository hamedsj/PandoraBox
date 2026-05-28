# Contributing to PandoraBox

Thanks for being here. PandoraBox is an open-source MITM proxy with a programmable surface (Python middleware, flows, MCP tools) — every change to it touches one of those areas. This guide explains how to land a change safely.

## Quick start

```bash
git clone https://github.com/hamedsj/PandoraBox.git
cd PandoraBox
make build            # vite build → embed → go build → bin/pandorabox
./bin/pandorabox serve
```

Open `http://localhost:7777` in your browser. The MITM proxy listens on `8080`; configure your browser to use it and install the CA cert from the Launcher page.

## Repository layout

- `cmd/pandorabox/` — CLI entry point + Go embed.
- `internal/` — server packages: `proxy/` (MITM + WebSocket + intercept), `mcp/` (the MCP server + tool registry), `api/` (REST + WS hub), `storage/` (SQLite), `team/`, `bodydecode/`, `ca/`, `events/`, `project/`, `converter/`.
- `ui/` — React + Vite + Electron app. The Vite build is copied into `cmd/pandorabox/dist` and embedded via `//go:embed`.
- `wiki/` — long-form developer docs (architecture, REST API, database, development workflow).
- `internal/mcp/docs/` — embedded MCP topic docs served via `docs_get`. The `tools` topic is auto-generated from the registry — don't edit `tools.md` by hand.

See `wiki/architecture.md` for the system diagram and `CLAUDE.md` for the non-obvious build constraints.

## Branching and commits

- All changes go on `master`. No feature branches required for small fixes.
- Commit messages are **single short one-line summaries**, present-tense imperative. No co-authorship lines, no tool-generated footers. Example: `Fix Monaco scroll restore on tab switch`.
- One logical change per commit. If you need three sentences to describe the diff, split it.

## Build and test

The only required gate is:

```bash
make build      # full pipeline must succeed
make test       # go test ./... — keep new code covered
```

For UI-only work the dev loop is faster:

```bash
make dev-backend   # go run … serve (terminal 1)
make dev-ui        # Vite HMR on :5173 (terminal 2)
```

Vite proxies `/api/*` and `/ws` to the Go backend automatically.

## Adding an MCP tool

**Do not call `s.mcp.AddTool(...)` directly.** All tools go through `s.register(ToolSpec{...})` in `internal/mcp/`. The registry gives you:

- The `mcpEnabled()` gate for free.
- Standardised category + behaviour annotations (read-only / mutating / destructive).
- Auto-generated `docs_get(topic="tools")` entry.
- A structured-result envelope so clients get real JSON, not stringified text.

See existing files in `internal/mcp/` for templates.

## Adding a UI-reactive feature

Every state-changing endpoint publishes onto `s.bus` (or via the helpers in `internal/mcp/events.go`), and the WebSocket hub forwards events to browser clients. Pick or add an event type in `internal/events/bus.go`, publish it on success, and handle it in `ui/src/hooks/useWebSocket.ts`. Without this, the UI will silently lie about state when an MCP/REST client mutates something.

## Style

- Default to no comments. Add one only when the *why* is non-obvious — a constraint, a workaround for a bug, an invariant a reader would miss.
- No emojis in code or files unless explicitly requested.
- Reuse the project's helpers: bodies decode through `internal/bodydecode`, hex dumps through `ui/src/lib/hex.ts`, highlight overlays through `components/common/Highlight.tsx`, body viewers through `components/common/BodyViewer.tsx`. Don't introduce parallel implementations.
- New backend Go files get an SPDX header on the first line: `// SPDX-License-Identifier: Apache-2.0`.

## Filing issues and feature requests

- Bugs: use the *Bug report* template under [Issues → New Issue]. Include OS, PandoraBox version, and the smallest repro you can manage.
- Feature ideas: open a [Discussion](https://github.com/hamedsj/PandoraBox/discussions) first. The *Feature request* issue template is for tracked work; we prefer to scope features in Discussions before opening an issue.
- Security: see `SECURITY.md`. Vulnerabilities in PandoraBox itself are private; misuse reports about a deployment are different — read the file.

## Releasing

Releases are cut manually by the maintainer. See `RELEASING.md`. There is no CI/CD pipeline by design.
