---
name: pandorabox-cli
description: Use when Codex or another LLM agent needs to inspect, search, replay, or manage PandoraBox proxy traffic through compact CLI commands instead of MCP. Trigger for PandoraBox security-analysis tasks involving captured HTTP/HTTPS requests, WebSocket frames, intercept queue actions, replay, project switching, or low-token agent workflows.
---

# PandoraBox CLI

## Overview

Use the local `pandorabox` binary. Prefer terse text output first; request JSON or bodies only when needed.

Default API: `http://localhost:7777/api`. Override with `--api` or `PANDORABOX_API`.

## Workflow

1. Start with `pandorabox status`.
2. List narrowly: `pandorabox traffic list -n 20 --host example.com --method POST`.
3. Fetch one request: `pandorabox traffic get 47 --headers`.
4. Fetch bodies only with a limit: `pandorabox traffic get 47 --body response --max-bytes 4000`.
5. Replay when needed: `pandorabox replay send 47`.
6. Use `--json` only when you must parse structured output.

## Commands

Status:

```bash
pandorabox status
```

Traffic:

```bash
pandorabox traffic list -n 20
pandorabox traffic list --host api.example.com --status-min 500
pandorabox traffic get 47 --headers
pandorabox traffic get 47 --body request --max-bytes 2000
pandorabox traffic ws 47 --direction s2c -n 100 --max-bytes 1000
```

Replay:

```bash
pandorabox replay send 47
pandorabox replay send --file /tmp/request.raw --scheme https
pandorabox replay list -n 10
pandorabox replay get 12 --body --max-bytes 2000
```

Intercept:

```bash
pandorabox intercept status
pandorabox intercept toggle on
pandorabox intercept queue
pandorabox intercept get 47 --max-bytes 4000
pandorabox intercept forward 47
pandorabox intercept drop 47
```

Projects:

```bash
pandorabox project get
pandorabox project recent
pandorabox project open /path/to/project
```

## Token Rules

- Never call `--json` for broad lists unless the user asks for machine-readable output.
- Never fetch response/request bodies until the relevant request ID is known.
- Always use `--max-bytes` when printing bodies, raw packets, or WebSocket payloads.
- Prefer `traffic list` filters over fetching many full requests.
- MCP is legacy/opt-in; do not use it unless the user explicitly asks.
