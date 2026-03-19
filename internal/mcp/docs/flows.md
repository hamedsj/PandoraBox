# PandoraBox Flow Authoring Guide

PandoraBox flows are project-stored automations made of ordered steps. Each step is either a raw HTTP request replay or a Python post-processing step.

Read `project-schemas` before building the `Flow` object.

## Flow Structure

A flow looks like this:

```json
{
  "id": "login-flow",
  "name": "Login Flow",
  "variables": {
    "username": "alice"
  },
  "steps": [
    {
      "id": "step-request-1",
      "type": "request",
      "name": "Login Request",
      "raw": "R0VUIC8gSFRUUC8xLjENCkhvc3Q6IGV4YW1wbGUuY29tDQoNCg=="
    },
    {
      "id": "step-process-1",
      "type": "process",
      "name": "Extract Token",
      "code": "def process(ctx):\n    return {\"variables\": {\"token\": \"demo\"}}\n"
    }
  ]
}
```

## Request Steps

Request steps use `raw`, which is base64-encoded raw HTTP bytes.

The decoded content should be a full raw HTTP request, for example:

```http
POST /api/login HTTP/1.1
Host: example.com
Content-Type: application/json

{"user":"{{username}}","password":"{{password}}"}
```

Variables use `{{name}}` interpolation.

Runtime behavior:

- PandoraBox base64-decodes `raw`
- replaces `{{variable}}` tokens using flow variables
- replays the resulting raw request through the proxy pipeline
- stores the replay result as the latest response for the next process step

`run_flow` also accepts `variables_json` to override or add seed variables.

## Process Steps

Process steps execute Python with `process(ctx)`.

Python receives:

```python
ctx.response.status   # int
ctx.response.headers  # dict[str, str]
ctx.response.body     # str
ctx.variables         # dict[str, str]
```

Return shape:

```python
{"variables": {"token": "value"}}
```

If `process(ctx)` returns `None`, PandoraBox treats it like an empty result.

Template:

```python
import json

def process(ctx):
    data = json.loads(ctx.response.body or "{}")
    token = data.get("token", "")
    return {"variables": {"token": token}}
```

## Saving and Running Flows

To create or update a flow:

```json
{
  "flow_json": "{\"id\":\"login-flow\",\"name\":\"Login Flow\",\"steps\":[...],\"variables\":{\"username\":\"alice\"}}"
}
```

Use `save_flow` to persist the flow, then `run_flow` to execute it:

```json
{
  "flow_id": "login-flow",
  "variables_json": "{\"password\":\"secret\"}"
}
```

## Practical Rules

- Use stable step ids so tooling can track results by step.
- Keep raw HTTP request steps valid and complete.
- Prefer process steps for extracting tokens, IDs, and other dynamic values.
- Assume response bodies are strings in process steps.
- When extracting structured data, decode it in Python yourself, for example with `json.loads`.
- Read the existing flow with `get_flow` before overwriting it.
