---
name: pandorabox-cli
description: Use when Codex or another LLM agent needs to inspect, search, replay, or manage PandoraBox proxy traffic through compact CLI commands instead of MCP. Trigger for PandoraBox security-analysis tasks involving captured HTTP/HTTPS requests, WebSocket frames, intercept queue actions, replay, project switching, scope, match & replace, middleware, converter stacks, organizer folders, flows, Intruder fuzzing, Collaborator OOB sessions, or low-token agent workflows.
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

Scope:

```bash
pandorabox scope get
pandorabox scope add-include --host example.com
pandorabox scope enable
```

Match & Replace:

```bash
pandorabox matchreplace list
pandorabox matchreplace add --target req-header --match '^User-Agent.*$' --replace 'User-Agent: custom' --regex
```

Middleware:

```bash
pandorabox middleware list
pandorabox middleware add --type request --name "Inject Header" --code-file step.py
```

Converter:

```bash
pandorabox converter algorithms
echo -n "data" | pandorabox converter run --algorithm base64_encode --stdin
pandorabox converter stack list
```

Organizer:

```bash
pandorabox organizer folder list
pandorabox organizer folder create --name "Auth Flows"
pandorabox organizer item add <folder-id> --request-id 47
```

Flows (chains of HTTP requests + Python steps, variables threaded through):

```bash
pandorabox flows list
pandorabox flows run <flow-id> --var username=admin
```

Intruder (marker-driven fuzzing — wrap injection points in `§markers§`):

```bash
pandorabox intruder start --request-id 47 --raw-file template.txt --attack-type sniper --payloads-file payloads.json
pandorabox intruder status <job-id>
pandorabox intruder results <job-id>
```

Collaborator (out-of-band DNS/HTTP/SMTP interaction capture):

```bash
pandorabox collaborator start
pandorabox collaborator poll <session-id>
```

Every command above appears live in the running UI immediately — no separate "sync" step needed.

## Token Rules

- Never call `--json` for broad lists unless the user asks for machine-readable output.
- Never fetch response/request bodies until the relevant request ID is known.
- Always use `--max-bytes` when printing bodies, raw packets, or WebSocket payloads.
- Prefer `traffic list` filters over fetching many full requests.
- MCP is legacy/opt-in; do not use it unless the user explicitly asks.
