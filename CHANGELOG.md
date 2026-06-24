# Changelog

All notable changes to PandoraBox will be documented in this file.

The format is based on Keep a Changelog, and this project follows semantic
versioning for public releases.

## [1.3.0] - 2026-06-24

### Added

- The `pandorabox` CLI now covers every feature the app has, not just traffic/replay/intercept: `scope`, `matchreplace`, `middleware`, `converter`, `organizer`, `flows`, `intruder`, and `collaborator` command groups. See `wiki/cli.md` for the full reference.
- `flows run <id>` executes a flow's HTTP-request and Python-process steps in order, threading variables through exactly like the UI does.
- `intruder start/status/results/cancel` runs marker-driven fuzzing attacks (sniper/battering_ram/pitchfork/cluster_bomb) from the terminal, with live progress visible in the Intruder panel.
- `collaborator start/poll/stop/url` runs out-of-band (interactsh) sessions from the terminal, with interactions visible live in the Collaborator panel.
- Every CLI mutation is reflected live in the running UI over the same WebSocket the browser uses — no separate sync step.

### Fixed

- `project.updated` WebSocket events were missing the `converter` field entirely, which silently wiped the Converter page's stack list to empty on any unrelated project change (scope, match & replace, etc.) — from the browser or the CLI. Now included.

## [1.2.2] - 2026-06-24

### Changed

- Settings → **Agent CLI** now leads with **Terminal Command** and **Agent Skill** (the things most agents need first); legacy MCP access/status moved to the bottom of the tab.
- **Agent Skill** now has a copyable install prompt — paste it into Codex, Claude Code, or another coding agent so it clones the skill from the repo into `/tmp`, installs it, and cleans up after itself.

### Fixed

- The app icon's rounded-square background filled the entire canvas edge-to-edge, making it visibly larger than neighboring app icons in the Dock/taskbar. Rescaled to the standard ~80% live-area margin so it matches other apps' icon size.

## [1.2.1] - 2026-06-24

### Added

- Settings → **Agent CLI** now has an **Install Command** button that symlinks the bundled `pandorabox` binary onto your shell's `PATH` (`/usr/local/bin` on macOS/Linux, a `PATH` entry on Windows). Previously the CLI shipped inside the app bundle but wasn't reachable from a terminal after installing.

### Fixed

- The app icon (dock icon on macOS, taskbar icon on Windows, AppImage/deb icon on Linux) rendered with the logo far too small relative to the rounded-square background. Regenerated `icon.png`/`icon.icns`/`icon.ico` from the trimmed logo so the glyph fills the icon properly.

## [1.2.0] - 2026-06-24

### Added

- Compact, REST-backed agent CLI (`pandorabox status|traffic|replay|intercept|project`) — a low-token alternative to MCP for driving PandoraBox from Codex or any LLM agent. Output is terse text by default; pass `--json` for structured output.
- Repository skill at `skills/pandorabox-cli/` so Codex-style agents discover and prefer the CLI workflow automatically.
- `wiki/cli.md` documents the full command reference.
- Electron windows now set an explicit app identity (dock icon on macOS, taskbar icon + AppUserModelID on Windows).

### Changed

- The legacy MCP server is now opt-in: start it with `pandorabox serve --enable-mcp`. Settings → **Agent CLI** (formerly **MCP**) shows the compact CLI commands first, with legacy MCP endpoint/setup info still available underneath.

## [1.1.0] - 2026-06-06

### Added

- Separate **App Font Size** and **Editor Font Size** controls in Settings → Typography. App size scales all UI text (sidebar, tables, panels); editor size scales Monaco request/response editors independently. Both settings are persisted.
- App font size now takes effect immediately across the whole UI by setting the root element font size, making all Tailwind rem-based utilities scale correctly. Default app font size raised to 14 px.

### Fixed

- Sitemap tree is now collapsed by default on first load.
- Raw response packet in Replay and History no longer duplicates the status code (`HTTP/2.0 200 200 OK` → `HTTP/2.0 200 OK`). Root cause: Go's `resp.Status` includes the code; backend now stores only the reason phrase via `http.StatusText`.

---

## [1.0.0] - 2026-06-01

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
- Replay queue persists per project across reloads, with an HTTP/HTTPS scheme
  switch, a Cancel button for in-flight sends, and an editable raw-packet history.
- The launcher's recent-projects list has a per-entry remove control that drops a
  project from the list without deleting its files.

### Fixed

- Replay traffic is now stored self-contained and no longer leaks into History,
  the SiteMap, or request counts; existing projects are migrated and cleaned on
  first launch. Match-and-replace and middleware now apply to every replay, and
  concurrent replays no longer wedge the server.
- Replay responses now survive leaving and returning to the Replay page, and the
  back/forward arrows restore each sent packet together with the response it
  produced.
- The selection-to-Converter popup now tracks a changed selection and dismisses
  on deselect instead of leaving a stale popup, while staying open when you click
  into it.
- Closing the launcher before opening a project now quits the app instead of
  leaving it running with no visible window.
