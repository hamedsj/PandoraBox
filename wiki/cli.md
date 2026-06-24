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

## Scope

```bash
pandorabox scope get
pandorabox scope enable
pandorabox scope add-include --host example.com --path /api
pandorabox scope add-exclude --host internal.example.com
pandorabox scope remove-include 1
```

## Match & Replace

```bash
pandorabox matchreplace list
pandorabox matchreplace add --target req-header --match '^User-Agent.*$' --replace 'User-Agent: custom' --regex
pandorabox matchreplace enable 6
pandorabox matchreplace remove 6
```

## Middleware

```bash
pandorabox middleware list
pandorabox middleware add --type request --name "Inject Header" --code-file step.py
pandorabox middleware toggle on
pandorabox middleware remove <node-id>
```

## Converter

```bash
pandorabox converter algorithms
echo -n "hello" | pandorabox converter run --algorithm base64_encode --stdin
pandorabox converter stack list
pandorabox converter stack add --name "Decode" --algorithms base64_decode,url_decode
pandorabox converter stack run <stack-id> --stdin
```

## Organizer

```bash
pandorabox organizer folder create --name "Auth Flows"
pandorabox organizer folder list
pandorabox organizer item add <folder-id> --request-id 47
pandorabox organizer item list <folder-id>
```

## Flows

```bash
pandorabox flows list
pandorabox flows add --name "Login" --steps-file flow-steps.json
pandorabox flows run <flow-id> --var username=admin
```

`flows run` threads variables through `request` and `process` steps the same way the UI does — replaying each request, then handing the response to each `process` step's Python code.

## Intruder

```bash
pandorabox intruder start --request-id 47 --raw-file template.txt --attack-type sniper --payloads-file payloads.json
pandorabox intruder status <job-id>
pandorabox intruder results <job-id>
pandorabox intruder cancel <job-id>
```

`template.txt` is a plain HTTP/1.1 request with injection points wrapped in `§markers§`. `payloads.json` is a JSON array of payload arrays, one per marker.

## Collaborator

```bash
pandorabox collaborator start
pandorabox collaborator poll <session-id>
pandorabox collaborator url <session-id>
pandorabox collaborator stop <session-id>
```

Every command above is reflected live in the running UI over the same WebSocket the browser uses — no polling or refresh needed.

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
