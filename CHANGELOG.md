# Changelog

All notable changes to PandoraBox will be documented in this file.

The format is based on Keep a Changelog, and this project follows semantic
versioning for public releases.

## [1.0.0] - 2026-05-28

First public release.

### Added

- Programmable HTTP/HTTPS MITM proxy with intercept, replay, scope, sitemap,
  match-and-replace, Python middleware, flows, Intruder, Collaborator, and team
  synchronization.
- Electron and embedded web UI modes backed by the same Go binary.
- MCP server over streamable HTTP with legacy SSE compatibility, live generated
  tool documentation, and project-level MCP access controls.
- Request and response inspection with decoded body views, raw views, hex views,
  syntax highlighting, and WebSocket frame capture.
- Local SQLite project storage with importable project configuration files.
