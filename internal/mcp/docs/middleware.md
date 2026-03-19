# PandoraBox Middleware Authoring Guide

PandoraBox middleware is a Python pipeline that can rewrite HTTP requests, HTTP responses, and WebSocket frames. The runtime keeps a persistent `python3` subprocess and sends packet data into it.

Read `project-schemas` before building the `MiddlewareConfig` object.

## Node Types

Allowed middleware node types:

- `request`
- `response`
- `ws_c2s`
- `ws_s2c`

Each node must define Python `process(packet)`.

## Execution Model

- Middleware only runs when `middleware.enabled` is `true`.
- Only enabled nodes run.
- Nodes are executed in topological order within the same traffic type, based on `edges`.
- If a node raises an exception, PandoraBox logs the traceback and continues with the current packet.
- If `process(packet)` returns `None`, the current packet continues unchanged.
- If `process(packet)` returns a packet object, that returned packet becomes the new packet for downstream nodes.

## HTTP Request Packet

For `type: "request"`, Python receives:

```python
packet.method   # str
packet.url      # str
packet.headers  # dict[str, list[str]]
packet.body     # bytes
```

Template:

```python
def process(packet):
    packet.headers["X-Test"] = ["1"]
    if packet.body:
        packet.body = packet.body.replace(b"foo", b"bar")
    return packet
```

## HTTP Response Packet

For `type: "response"`, Python receives:

```python
packet.status_code  # int
packet.status_text  # str
packet.headers      # dict[str, list[str]]
packet.body         # bytes
```

Template:

```python
def process(packet):
    if packet.status_code == 401:
        packet.status_code = 200
        packet.status_text = "200 OK"
    return packet
```

## WebSocket Frame Packet

For `type: "ws_c2s"` and `type: "ws_s2c"`, Python receives:

```python
packet.direction                  # "ws_c2s" or "ws_s2c"
packet.session_id                 # int
packet.opcode                     # int
packet.fin                        # int
packet.rsv1                       # bool
packet.compressed                 # bool
packet.compression_enabled        # bool
packet.no_context_takeover        # bool
packet.client_no_context_takeover # bool
packet.server_no_context_takeover # bool
packet.payload                    # bytes
```

Notes:

- `opcode 1` is text
- `opcode 2` is binary
- `opcode 0` is continuation
- treat `payload` as raw bytes unless you know the application protocol
- WebSocket middleware rewrites live traffic, not just the stored history

Template:

```python
def process(packet):
    if packet.opcode == 1:
        text = packet.payload.decode("utf-8", errors="ignore")
        text = text.replace("foo", "bar")
        packet.payload = text.encode("utf-8")
    return packet
```

## JSON Shape for MCP

Use `update_middleware` with:

```json
{
  "config_json": "{\"enabled\":true,\"nodes\":[...],\"edges\":[...]}"
}
```

Example config:

```json
{
  "enabled": true,
  "nodes": [
    {
      "id": "req-1",
      "type": "request",
      "name": "Add Header",
      "enabled": true,
      "code": "def process(packet):\n    packet.headers['X-Debug'] = ['1']\n    return packet\n",
      "position": { "x": 80, "y": 120 }
    }
  ],
  "edges": []
}
```

## Practical Rules

- Preserve `bytes` when editing bodies or WS payloads.
- Keep header values as arrays of strings.
- Do not assume compressed or binary data is text.
- If you need protocol-specific decoding, do it in your own Python code.
- Use small focused nodes instead of one giant script.
- Read current config with `get_middleware` before replacing it.
