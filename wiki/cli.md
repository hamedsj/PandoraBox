# Agent CLI

PandoraBox agents should use the local CLI before MCP. The CLI talks to the running REST API and prints compact text by default.

Default API: `http://localhost:7777/api`

Override:

```bash
PANDORABOX_API=http://localhost:7777/api pandorabox status
pandorabox status --api http://localhost:7777/api
```

## Core Commands

```bash
pandorabox status
pandorabox traffic list -n 20
pandorabox traffic list --host api.example.com --method POST
pandorabox traffic get 47 --headers
pandorabox traffic get 47 --body response --max-bytes 4000
pandorabox traffic ws 47 --direction s2c -n 100 --max-bytes 1000
pandorabox replay send 47
pandorabox replay send --file /tmp/request.raw --scheme https
pandorabox intercept status
pandorabox intercept queue
pandorabox intercept forward 47
pandorabox project get
```

## Output Rules

- Text output is optimized for low context use.
- `--json` returns API JSON for scripts and structured parsing.
- Body/raw/frame commands are bounded by `--max-bytes`.
- Broad lists are capped; use filters first, then fetch one item.

## Legacy MCP

MCP is compatibility-only. Start it with:

```bash
pandorabox serve --enable-mcp
```

Do not prefer MCP for new agent workflows unless the user explicitly asks for it.
