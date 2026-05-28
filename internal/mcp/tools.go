// Package mcp — tools.go: the main tool registrations.
//
// Every PandoraBox MCP tool is declared here as a ToolSpec and dispatched
// through internal/mcp/registry.go. The naming convention is
// `category_verb_object` (e.g. `traffic_list`, `proxy_start`). The original
// names (`list_requests`, etc.) are preserved as deprecated aliases so existing
// MCP clients keep working without changes.
package mcp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/hamedsj5/pandorabox/internal/events"
	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/hamedsj5/pandorabox/internal/proxy"
	"github.com/hamedsj5/pandorabox/internal/storage"
	"github.com/mark3labs/mcp-go/mcp"
)

// registerTools installs every "core" tool (proxy, traffic, intercept, replay,
// project, sitemap, websocket, ca, docs). Subsystems with their own files
// (organizer, intruder, etc.) register themselves through the same `s.register`
// entry point.
func (s *Server) registerTools() {
	// ── Docs ────────────────────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:     "docs_list",
		Aliases:  []string{"list_docs"},
		Category: CatDocs,
		Behavior: BehaviorReadOnly,
		Summary:  "List built-in PandoraBox documentation topics.",
		Description: "Returns the topics that can be read with `docs_get`. Call this first when you need orientation. " +
			"Topics: overview, tools, project-schemas, coding-api, middleware, flows.",
		Handler: s.toolListDocs,
	})

	s.register(ToolSpec{
		Name:     "docs_get",
		Aliases:  []string{"get_doc"},
		Category: CatDocs,
		Behavior: BehaviorReadOnly,
		Summary:  "Read one built-in documentation topic.",
		Description: "Returns the full Markdown text of one PandoraBox documentation topic. " +
			"Use `docs_list` to discover topic IDs. Example: docs_get(topic=\"tools\").",
		Options: []mcp.ToolOption{
			mcp.WithString("topic", mcp.Description(`Documentation topic id: "overview", "tools", "project-schemas", "coding-api", "middleware", "flows"`)),
			mcp.WithString("id", mcp.Description("Alias for topic (kept for back-compat).")),
		},
		Handler: s.toolGetDoc,
	})

	// ── Proxy ───────────────────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:     "proxy_status",
		Category: CatProxy,
		Behavior: BehaviorReadOnly,
		Summary:  "Get the current state of the MITM proxy listener.",
		Description: "Returns `running`, the port the proxy is actually listening on (0 if stopped), " +
			"whether intercept is enabled, the captured request count, and the intercept queue length.",
		Handler: s.toolProxyStatus,
	})

	s.register(ToolSpec{
		Name:     "proxy_start",
		Category: CatProxy,
		Behavior: BehaviorMutating,
		Summary:  "Start the MITM proxy listener.",
		Description: "Starts the proxy on the project's configured port. Pass `port` to switch the listener to a new port " +
			"(persisted in project config). No-op if already running on the requested port.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("port", mcp.Description("Optional new proxy port. Updates project config and rebinds the listener.")),
		},
		Handler: s.toolProxyStart,
	})

	s.register(ToolSpec{
		Name:     "proxy_stop",
		Category: CatProxy,
		Behavior: BehaviorMutating,
		Summary:  "Stop the MITM proxy listener.",
		Description: "Closes the listener and in-flight connections. Captured traffic is retained. " +
			"Call `proxy_start` to resume.",
		Handler: s.toolProxyStop,
	})

	// ── Traffic ─────────────────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:     "traffic_list",
		Aliases:  []string{"list_requests"},
		Category: CatTraffic,
		Behavior: BehaviorReadOnly,
		Summary:  "List captured HTTP requests (most recent first), with optional filters.",
		Description: "Returns `{requests, total}`. Use `traffic_get` for full headers + body of one request. " +
			"Tip: pass `include_decoded_body=true` to also receive the decompressed response body, but the limit " +
			"is capped at 50 to avoid huge payloads.",
		Options: []mcp.ToolOption{
			mcp.WithString("host", mcp.Description("Substring match on host, e.g. \"api.example.com\".")),
			mcp.WithString("method", mcp.Description("HTTP method filter (GET/POST/PUT/...).")),
			mcp.WithNumber("status_min", mcp.Description("Minimum response status code (inclusive). Example: 400 for errors.")),
			mcp.WithNumber("status_max", mcp.Description("Maximum response status code (inclusive). Example: 499.")),
			mcp.WithString("search", mcp.Description("Keyword across host, path, query (substring).")),
			mcp.WithString("content_type", mcp.Description("Substring match on response Content-Type, e.g. \"javascript\" or \"html\".")),
			mcp.WithNumber("limit", mcp.Description("Maximum results (default 20). Capped at 50 when include_decoded_body=true.")),
			mcp.WithNumber("offset", mcp.Description("Pagination offset (default 0).")),
			mcp.WithString("user_id", mcp.Description("Filter to one team member's traffic (team mode only).")),
			mcp.WithBoolean("include_decoded_body", mcp.Description("If true, decompresses gzip/br/zstd response bodies and adds `decoded_response_body` to each row.")),
		},
		Handler: s.toolListRequests,
	})

	s.register(ToolSpec{
		Name:     "traffic_get",
		Aliases:  []string{"get_request"},
		Category: CatTraffic,
		Behavior: BehaviorReadOnly,
		Summary:  "Fetch one captured request by ID with full headers, body, and response.",
		Description: "Returns the full Request record. With `decoded=true` (default), adds `decoded_body` to both " +
			"request and response and decompresses gzip/deflate/br/zstd response bodies.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("id", mcp.Description("Numeric request ID returned by traffic_list."), mcp.Required()),
			mcp.WithBoolean("decoded", mcp.Description("Add `decoded_body` (decompressed text) to request and response. Default true.")),
		},
		Handler: s.toolGetRequest,
	})

	s.register(ToolSpec{
		Name:     "traffic_search",
		Aliases:  []string{"search_requests"},
		Category: CatTraffic,
		Behavior: BehaviorReadOnly,
		Summary:  "Search captured requests by keyword (host/path/query).",
		Description: "Convenience wrapper over `traffic_list(search=...)`. Use `traffic_list` when you need full filters.",
		Options: []mcp.ToolOption{
			mcp.WithString("query", mcp.Description("Keyword to match (substring)."), mcp.Required()),
			mcp.WithNumber("limit", mcp.Description("Maximum results (default 20).")),
			mcp.WithString("user_id", mcp.Description("Filter to one team member (team mode only).")),
		},
		Handler: s.toolSearchRequests,
	})

	s.register(ToolSpec{
		Name:     "traffic_delete",
		Aliases:  []string{"delete_request"},
		Category: CatTraffic,
		Behavior: BehaviorDestructive,
		Summary:  "Permanently delete one captured request and its response.",
		Description: "Drops the request row from the database. The associated WebSocket session (if any) is also removed. " +
			"To remove many at once, use `traffic_delete_bulk` or `traffic_delete_by_host`.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("id", mcp.Description("Numeric request ID to delete."), mcp.Required()),
		},
		Handler: s.toolDeleteRequest,
	})

	s.register(ToolSpec{
		Name:     "traffic_delete_bulk",
		Aliases:  []string{"delete_sitemap_requests"},
		Category: CatTraffic,
		Behavior: BehaviorDestructive,
		Summary:  "Delete a list of captured requests by ID, with an optional dry-run preview.",
		Description: "Pass `ids` as a numeric array (preferred) or `ids_json` for legacy clients. " +
			"Use `dry_run=true` to preview how many rows would be removed without deleting anything. " +
			"For safety, deletes more than 5000 rows in one call must opt in with `confirm=true`.",
		Options: []mcp.ToolOption{
			mcp.WithArray("ids", mcp.Description("Numeric array of request IDs to delete, e.g. [12, 13, 14]."), mcp.Items(map[string]any{"type": "number"})),
			mcp.WithString("ids_json", mcp.Description("Legacy stringified JSON array. Prefer `ids`.")),
			mcp.WithBoolean("dry_run", mcp.Description("Preview only — return the count that would be deleted but do not delete.")),
			mcp.WithBoolean("confirm", mcp.Description("Required when deleting > 5000 rows in one call.")),
		},
		Handler: s.toolDeleteSitemapRequests,
	})

	s.register(ToolSpec{
		Name:     "traffic_delete_by_host",
		Aliases:  []string{"delete_sitemap_host"},
		Category: CatTraffic,
		Behavior: BehaviorDestructive,
		Summary:  "Delete every captured request for an exact host.",
		Description: "High blast radius. Use `dry_run=true` first to see how many rows would be removed.",
		Options: []mcp.ToolOption{
			mcp.WithString("host", mcp.Description("Exact host value as shown in the sitemap, e.g. \"api.example.com\"."), mcp.Required()),
			mcp.WithBoolean("dry_run", mcp.Description("Preview only — do not delete.")),
		},
		Handler: s.toolDeleteSitemapHost,
	})

	// ── WebSocket ───────────────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:     "websocket_get_session",
		Aliases:  []string{"get_websocket_session"},
		Category: CatWebSocket,
		Behavior: BehaviorReadOnly,
		Summary:  "Get the WebSocket session for one captured HTTP upgrade request.",
		Description: "Returns the session record, including open/closed timestamps. " +
			"Combine with `websocket_get_frames` to read messages.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("request_id", mcp.Description("HTTP upgrade request ID."), mcp.Required()),
		},
		Handler: s.toolGetWebSocketSession,
	})

	s.register(ToolSpec{
		Name:     "websocket_get_frames",
		Aliases:  []string{"get_websocket_frames"},
		Category: CatWebSocket,
		Behavior: BehaviorReadOnly,
		Summary:  "Get captured WebSocket frames for a session, with pagination and filters.",
		Description: "Pass either `request_id` (HTTP upgrade) or `session_id`. " +
			"Use `limit`/`after_id` to page through long sessions, and `direction`/`opcode` to filter. " +
			"Returns `{session_id, frames, has_more, next_after_id}`.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("request_id", mcp.Description("HTTP upgrade request ID (resolves session automatically).")),
			mcp.WithNumber("session_id", mcp.Description("Direct WebSocket session ID.")),
			mcp.WithString("direction", mcp.Description("Filter: \"c2s\" (client→server), \"s2c\" (server→client), or omit for both.")),
			mcp.WithNumber("opcode", mcp.Description("Filter by WebSocket opcode (1=text, 2=binary, 8=close, 9=ping, 10=pong).")),
			mcp.WithNumber("limit", mcp.Description("Maximum frames (default 200, max 2000).")),
			mcp.WithNumber("after_id", mcp.Description("Return only frames with id > after_id (cursor pagination).")),
		},
		Handler: s.toolGetWebSocketFrames,
	})

	// ── Replay ──────────────────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:      "replay_request",
		Category:  CatReplay,
		Behavior:  BehaviorMutating,
		OpenWorld: true,
		Summary:   "Replay a captured request with optional URL/headers/body overrides.",
		Description: "Creates a new Replay record; the original captured request is not modified. " +
			"Pass `modified_headers` as a native object or `modified_headers_json` as legacy stringified JSON. " +
			"With `decoded=true` (default), the result includes `decoded_response_body`.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("request_id", mcp.Description("ID of the captured request to replay."), mcp.Required()),
			mcp.WithString("modified_url", mcp.Description("Override the target URL.")),
			mcp.WithString("modified_body", mcp.Description("Override the request body (plain text).")),
			mcp.WithObject("modified_headers", mcp.Description("Header overrides, e.g. {\"Authorization\":\"Bearer new\"}.")),
			mcp.WithString("modified_headers_json", mcp.Description("Legacy: stringified JSON header overrides. Prefer `modified_headers`.")),
			mcp.WithBoolean("decoded", mcp.Description("Include `decoded_response_body` (decompressed text). Default true.")),
		},
		Handler: s.toolReplayRequest,
	})

	s.register(ToolSpec{
		Name:      "send_request",
		Category:  CatReplay,
		Behavior:  BehaviorMutating,
		OpenWorld: true,
		Summary:   "Send a fresh HTTP request through the proxy and capture the response.",
		Description: "Like `replay_request` but builds the request from scratch. Pass headers as `headers` (object) " +
			"or `headers_json` (legacy stringified). Result includes the decoded response body by default.",
		Options: []mcp.ToolOption{
			mcp.WithString("method", mcp.Description("HTTP method (GET/POST/...)."), mcp.Required()),
			mcp.WithString("url", mcp.Description("Full target URL, e.g. https://api.example.com/users."), mcp.Required()),
			mcp.WithString("body", mcp.Description("Request body (plain text or JSON).")),
			mcp.WithObject("headers", mcp.Description("Request headers, e.g. {\"Content-Type\":\"application/json\"}.")),
			mcp.WithString("headers_json", mcp.Description("Legacy: stringified JSON headers. Prefer `headers`.")),
			mcp.WithBoolean("decoded", mcp.Description("Include `decoded_response_body` (decompressed text). Default true.")),
		},
		Handler: s.toolSendRequest,
	})

	// ── Intercept ───────────────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:     "intercept_toggle",
		Category: CatIntercept,
		Behavior: BehaviorMutating,
		Summary:  "Enable or disable request interception globally.",
		Description: "When enabled, matching requests are held in the intercept queue until forwarded or dropped.",
		Options: []mcp.ToolOption{
			mcp.WithBoolean("enabled", mcp.Description("true to enable interception, false to disable."), mcp.Required()),
		},
		Handler: s.toolInterceptToggle,
	})

	s.register(ToolSpec{
		Name:     "intercept_list_queue",
		Aliases:  []string{"list_intercept_queue"},
		Category: CatIntercept,
		Behavior: BehaviorReadOnly,
		Summary:  "List requests currently held awaiting a forward/drop decision.",
		Handler:  s.toolListInterceptQueue,
	})

	s.register(ToolSpec{
		Name:      "intercept_forward",
		Category:  CatIntercept,
		Behavior:  BehaviorMutating,
		OpenWorld: true,
		Summary:   "Forward a held request to the server unchanged.",
		Description: "Returns `{success, reason}`. `reason` describes why if it could not be forwarded " +
			"(e.g. already resolved, request not in queue).",
		Options: []mcp.ToolOption{
			mcp.WithNumber("request_id", mcp.Description("Held request ID (from intercept_list_queue)."), mcp.Required()),
		},
		Handler: s.toolInterceptForward,
	})

	s.register(ToolSpec{
		Name:     "intercept_drop",
		Category: CatIntercept,
		Behavior: BehaviorDestructive,
		Summary:  "Drop a held request — the browser receives a 502 Bad Gateway.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("request_id", mcp.Description("Held request ID."), mcp.Required()),
		},
		Handler: s.toolInterceptDrop,
	})

	s.register(ToolSpec{
		Name:      "intercept_modify",
		Category:  CatIntercept,
		Behavior:  BehaviorMutating,
		OpenWorld: true,
		Summary:   "Modify and forward a held request using a replacement raw HTTP packet.",
		Description: "Provide `raw_text` (preferred, plain HTTP/1.1 text) or `raw` (legacy base64). " +
			"Use `intercept_get_editable` first to fetch the packet as text ready to edit.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("request_id", mcp.Description("Held request ID."), mcp.Required()),
			mcp.WithString("raw_text", mcp.Description("Modified raw HTTP/1.1 request as text. Preferred.")),
			mcp.WithString("raw", mcp.Description("Legacy: base64-encoded raw packet. Prefer `raw_text`.")),
		},
		Handler: s.toolInterceptModify,
	})

	s.register(ToolSpec{
		Name:     "intercept_get_editable",
		Category: CatIntercept,
		Behavior: BehaviorReadOnly,
		Summary:  "Return a held request as editable text + base64, ready to modify and pass to intercept_modify.",
		Description: "Skips the manual fetch→decode→edit→re-encode cycle. Returns `{raw_text, raw_base64, request_id}`.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("request_id", mcp.Description("Held request ID."), mcp.Required()),
		},
		Handler: s.toolInterceptGetEditable,
	})

	// ── Console ─────────────────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:     "console_get_output",
		Aliases:  []string{"get_console_output"},
		Category: CatConsole,
		Behavior: BehaviorReadOnly,
		Summary:  "Read recent console output from middleware and flow execution.",
		Description: "Filters: `source` (middleware|flow), `node_id`, `flow_id`, `level` (info|warn|error), " +
			"`since_id` for cursor pagination. Use this to debug Python middleware or flow `print()` and errors.",
		Options: []mcp.ToolOption{
			mcp.WithString("source", mcp.Description("Filter by source: \"middleware\" or \"flow\".")),
			mcp.WithString("node_id", mcp.Description("Middleware node id (when source=middleware).")),
			mcp.WithString("flow_id", mcp.Description("Flow id (when source=flow).")),
			mcp.WithString("level", mcp.Description("Severity filter: \"info\", \"warn\", or \"error\".")),
			mcp.WithNumber("since_id", mcp.Description("Return only entries with id > since_id (cursor).")),
			mcp.WithNumber("limit", mcp.Description("Maximum entries (default 200, max 2000).")),
		},
		Handler: s.toolGetConsoleOutput,
	})

	// ── Project ─────────────────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:     "project_get",
		Aliases:  []string{"get_project"},
		Category: CatProject,
		Behavior: BehaviorReadOnly,
		Summary:  "Get the current project configuration: proxy, scope, filters, match-replace, middleware, flows.",
		Handler:  s.toolGetProject,
	})

	s.register(ToolSpec{
		Name:     "project_update",
		Aliases:  []string{"update_project"},
		Category: CatProject,
		Behavior: BehaviorMutating,
		Summary:  "Update one or more fields on the current project. Only fields you provide are changed.",
		Description: "Nested config values accept both native objects/arrays and legacy stringified JSON " +
			"(`scope_include` vs `scope_include_json`, etc.). Read `docs_get(topic=\"project-schemas\")` for exact shapes.",
		Options: []mcp.ToolOption{
			mcp.WithString("name", mcp.Description("New project name.")),
			mcp.WithNumber("proxy_port", mcp.Description("Proxy listen port. Rebinds the listener immediately.")),
			mcp.WithString("upstream_url", mcp.Description("Optional upstream proxy URL.")),
			mcp.WithBoolean("intercept_enabled", mcp.Description("Enable/disable interception.")),
			mcp.WithObject("filters", mcp.Description("FilterConfig object. See project-schemas docs.")),
			mcp.WithString("filters_json", mcp.Description("Legacy stringified FilterConfig. Prefer `filters`.")),
			mcp.WithBoolean("scope_enabled", mcp.Description("Enable/disable scope filtering.")),
			mcp.WithArray("scope_include", mcp.Description("Array of ScopeRule objects (include rules)."), mcp.Items(map[string]any{"type": "object"})),
			mcp.WithString("scope_include_json", mcp.Description("Legacy stringified ScopeRule array.")),
			mcp.WithArray("scope_exclude", mcp.Description("Array of ScopeRule objects (exclude rules)."), mcp.Items(map[string]any{"type": "object"})),
			mcp.WithString("scope_exclude_json", mcp.Description("Legacy stringified ScopeRule array.")),
			mcp.WithArray("match_replace", mcp.Description("Array of MatchReplaceRule objects."), mcp.Items(map[string]any{"type": "object"})),
			mcp.WithString("match_replace_json", mcp.Description("Legacy stringified MatchReplaceRule array.")),
			mcp.WithObject("middleware", mcp.Description("MiddlewareConfig object. See project-schemas docs.")),
			mcp.WithString("middleware_json", mcp.Description("Legacy stringified MiddlewareConfig.")),
			mcp.WithArray("flows", mcp.Description("Array of Flow objects."), mcp.Items(map[string]any{"type": "object"})),
			mcp.WithString("flows_json", mcp.Description("Legacy stringified Flow array.")),
			mcp.WithBoolean("mcp_disabled", mcp.Description("Disable MCP access for this project.")),
			mcp.WithNumber("mcp_port", mcp.Description("MCP listen port.")),
		},
		Handler: s.toolUpdateProject,
	})

	s.register(ToolSpec{
		Name:     "project_rename",
		Aliases:  []string{"rename_project"},
		Category: CatProject,
		Behavior: BehaviorMutating,
		Summary:  "Rename the current project (equivalent to project_update(name=...)).",
		Options: []mcp.ToolOption{
			mcp.WithString("name", mcp.Description("New project name (non-empty)."), mcp.Required()),
		},
		Handler: s.toolRenameProject,
	})

	s.register(ToolSpec{
		Name:     "project_list_recent",
		Aliases:  []string{"list_recent_projects"},
		Category: CatProject,
		Behavior: BehaviorReadOnly,
		Summary:  "List recently-opened projects with existence flags.",
		Handler:  s.toolListRecentProjects,
	})

	s.register(ToolSpec{
		Name:     "project_open",
		Aliases:  []string{"open_project"},
		Category: CatProject,
		Behavior: BehaviorMutating,
		Summary:  "Open an existing project and switch the active project to it.",
		Options: []mcp.ToolOption{
			mcp.WithString("path", mcp.Description("Absolute path to the project folder."), mcp.Required()),
		},
		Handler: s.toolOpenProject,
	})

	s.register(ToolSpec{
		Name:     "project_new",
		Aliases:  []string{"new_project"},
		Category: CatProject,
		Behavior: BehaviorMutating,
		Summary:  "Create a new project at the given path and switch to it.",
		Options: []mcp.ToolOption{
			mcp.WithString("path", mcp.Description("Absolute path for the new project folder."), mcp.Required()),
			mcp.WithString("name", mcp.Description("Project display name (default \"New Project\").")),
		},
		Handler: s.toolNewProject,
	})

	// ── Match & Replace ─────────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:     "match_replace_get",
		Aliases:  []string{"get_match_replace"},
		Category: CatMatchReplace,
		Behavior: BehaviorReadOnly,
		Summary:  "Get the current Match & Replace rules.",
		Handler:  s.toolGetMatchReplace,
	})

	s.register(ToolSpec{
		Name:     "match_replace_update",
		Aliases:  []string{"update_match_replace"},
		Category: CatMatchReplace,
		Behavior: BehaviorMutating,
		Summary:  "Replace the current Match & Replace rule list.",
		Options: []mcp.ToolOption{
			mcp.WithArray("rules", mcp.Description("Array of MatchReplaceRule objects."), mcp.Items(map[string]any{"type": "object"})),
			mcp.WithString("rules_json", mcp.Description("Legacy stringified rule array. Prefer `rules`.")),
		},
		Handler: s.toolUpdateMatchReplace,
	})

	// ── Middleware ──────────────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:     "middleware_get",
		Aliases:  []string{"get_middleware"},
		Category: CatMiddleware,
		Behavior: BehaviorReadOnly,
		Summary:  "Get the current middleware graph configuration.",
		Handler:  s.toolGetMiddleware,
	})

	s.register(ToolSpec{
		Name:     "middleware_update",
		Aliases:  []string{"update_middleware"},
		Category: CatMiddleware,
		Behavior: BehaviorMutating,
		Summary:  "Replace the current middleware graph configuration.",
		Options: []mcp.ToolOption{
			mcp.WithObject("config", mcp.Description("MiddlewareConfig object. See project-schemas docs.")),
			mcp.WithString("config_json", mcp.Description("Legacy stringified MiddlewareConfig. Prefer `config`.")),
		},
		Handler: s.toolUpdateMiddleware,
	})

	// ── Flows ───────────────────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:     "flow_list",
		Aliases:  []string{"list_flows"},
		Category: CatFlow,
		Behavior: BehaviorReadOnly,
		Summary:  "List all saved flows.",
		Handler:  s.toolListFlows,
	})

	s.register(ToolSpec{
		Name:     "flow_get",
		Aliases:  []string{"get_flow"},
		Category: CatFlow,
		Behavior: BehaviorReadOnly,
		Summary:  "Fetch one flow definition by id.",
		Options: []mcp.ToolOption{
			mcp.WithString("flow_id", mcp.Description("Flow id."), mcp.Required()),
		},
		Handler: s.toolGetFlow,
	})

	s.register(ToolSpec{
		Name:     "flow_save",
		Aliases:  []string{"save_flow"},
		Category: CatFlow,
		Behavior: BehaviorMutating,
		Summary:  "Create or update one flow (upsert by id).",
		Options: []mcp.ToolOption{
			mcp.WithObject("flow", mcp.Description("Flow object. See project-schemas docs.")),
			mcp.WithString("flow_json", mcp.Description("Legacy stringified Flow. Prefer `flow`.")),
		},
		Handler: s.toolSaveFlow,
	})

	s.register(ToolSpec{
		Name:     "flow_delete",
		Aliases:  []string{"delete_flow"},
		Category: CatFlow,
		Behavior: BehaviorDestructive,
		Summary:  "Delete one flow by id.",
		Options: []mcp.ToolOption{
			mcp.WithString("flow_id", mcp.Description("Flow id."), mcp.Required()),
		},
		Handler: s.toolDeleteFlow,
	})

	s.register(ToolSpec{
		Name:      "flow_run",
		Aliases:   []string{"run_flow"},
		Category:  CatFlow,
		Behavior:  BehaviorMutating,
		OpenWorld: true,
		Summary:   "Execute a flow by id with optional seed variables.",
		Options: []mcp.ToolOption{
			mcp.WithString("flow_id", mcp.Description("Flow id to execute."), mcp.Required()),
			mcp.WithObject("variables", mcp.Description("Seed variable object.")),
			mcp.WithString("variables_json", mcp.Description("Legacy stringified variables object. Prefer `variables`.")),
		},
		Handler: s.toolRunFlow,
	})

	// ── Sitemap ─────────────────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:     "sitemap_get",
		Aliases:  []string{"get_sitemap"},
		Category: CatSitemap,
		Behavior: BehaviorReadOnly,
		Summary:  "Build a sitemap tree from captured requests.",
		Description: "Returns `{tree, request_count, host_count, route_count, responded_requests}` for the matching subset. " +
			"Filters work like `traffic_list`. Pass `in_scope_only=true` to restrict to current scope rules.",
		Options: []mcp.ToolOption{
			mcp.WithString("host", mcp.Description("Substring match on host.")),
			mcp.WithString("method", mcp.Description("HTTP method filter.")),
			mcp.WithString("search", mcp.Description("Keyword across host/path/query.")),
			mcp.WithNumber("status_min", mcp.Description("Minimum status code.")),
			mcp.WithNumber("status_max", mcp.Description("Maximum status code.")),
			mcp.WithBoolean("in_scope_only", mcp.Description("Restrict the tree to in-scope requests.")),
			mcp.WithString("user_id", mcp.Description("Restrict to one team member (team mode only).")),
		},
		Handler: s.toolGetSitemap,
	})

	// ── Certificate ─────────────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:     "ca_get",
		Aliases:  []string{"get_ca_cert"},
		Category: CatCA,
		Behavior: BehaviorReadOnly,
		Summary:  "Get the root CA certificate PEM and per-platform install instructions.",
		Handler:  s.toolGetCACert,
	})

	// ── Team — registration moved to team_tools.go ─────────────────────────
}

// ── Handlers ─────────────────────────────────────────────────────────────────

func (s *Server) toolProxyStatus(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	count, _ := s.getDB().CountRequests()
	port := 0
	if s.proxy.IsRunning() {
		port = s.cfg.ProxyPort
	}
	return map[string]any{
		"running":           s.proxy.IsRunning(),
		"port":              port,
		"configured_port":   s.cfg.ProxyPort,
		"intercept_enabled": s.intercept.IsEnabled(),
		"request_count":     count,
		"queue_length":      s.intercept.QueueLength(),
	}, nil
}

// toolProxyStart actually starts (or rebinds) the proxy listener. Previously
// it was a no-op that lied about its behavior; agents had no way to start the
// proxy through MCP.
func (s *Server) toolProxyStart(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	port := s.cfg.ProxyPort
	if v, ok := argInt64(req, "port"); ok && v > 0 {
		port = int(v)
	}

	if s.proxy.IsRunning() {
		// Already running. If the caller requested a different port, rebind.
		if port != s.cfg.ProxyPort {
			if err := s.proxy.ChangePort(port); err != nil {
				return nil, fmt.Errorf("rebind proxy on port %d: %w", port, err)
			}
			s.cfg.ProxyPort = port
			s.persistProxyPort(port)
		}
		return map[string]any{"success": true, "running": true, "port": port}, nil
	}

	// Not running. Update the config port if provided, then start.
	if port != s.cfg.ProxyPort {
		s.cfg.ProxyPort = port
		s.persistProxyPort(port)
	}
	bgCtx := s.bgCtx
	if bgCtx == nil {
		bgCtx = context.Background()
	}
	go func() {
		if err := s.proxy.Start(bgCtx); err != nil {
			s.publishProxyStatus()
		}
	}()
	// Brief pause is unnecessary: proxy.Start binds before returning the goroutine.
	s.publishProxyStatus()
	return map[string]any{"success": true, "running": true, "port": port}, nil
}

func (s *Server) persistProxyPort(port int) {
	mgr := s.getProject()
	if mgr == nil {
		return
	}
	cfg := mgr.Config()
	if cfg.Proxy.Port == port {
		return
	}
	cfg.Proxy.Port = port
	if err := mgr.Save(cfg); err == nil {
		s.publishProjectUpdated()
	}
}

func (s *Server) toolProxyStop(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	s.proxy.Stop()
	s.publishProxyStatus()
	return map[string]any{"success": true, "running": false}, nil
}

func (s *Server) toolListRequests(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	includeDecodedBody := argBool(req, "include_decoded_body", false)

	filter := storage.RequestFilter{Limit: 20}
	if v := argString(req, "host"); v != "" {
		filter.Host = v
	}
	if v := argString(req, "method"); v != "" {
		filter.Method = v
	}
	if v := argString(req, "search"); v != "" {
		filter.Search = v
	}
	if v := argString(req, "content_type"); v != "" {
		filter.ContentType = v
	}
	if v, ok := argInt64(req, "limit"); ok {
		filter.Limit = int(v)
	}
	if v, ok := argInt64(req, "offset"); ok {
		filter.Offset = int(v)
	}
	if v, ok := argInt64(req, "status_min"); ok {
		filter.StatusMin = int(v)
	}
	if v, ok := argInt64(req, "status_max"); ok {
		filter.StatusMax = int(v)
	}
	if v := argString(req, "user_id"); v != "" {
		filter.UserID = v
	}

	if includeDecodedBody && filter.Limit > 50 {
		filter.Limit = 50
	}

	requests, total, err := s.getDB().ListRequests(filter)
	if err != nil {
		return nil, err
	}

	if !includeDecodedBody {
		return map[string]any{"requests": requests, "total": total}, nil
	}

	type augmented struct {
		*storage.Request
		DecodedResponseBody string `json:"decoded_response_body,omitempty"`
	}
	aug := make([]augmented, 0, len(requests))
	for _, r := range requests {
		full, err := s.getDB().GetRequest(r.ID)
		if err != nil || full == nil {
			aug = append(aug, augmented{Request: r})
			continue
		}
		var decoded string
		if full.Response != nil {
			decoded = toUTF8(decodeBody(full.Response.Body, full.Response.Headers))
		}
		aug = append(aug, augmented{Request: full, DecodedResponseBody: decoded})
	}
	return map[string]any{"requests": aug, "total": total}, nil
}

func (s *Server) toolGetRequest(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	id, err := argRequiredInt64(req, "id")
	if err != nil {
		return nil, err
	}
	r, err := s.getDB().GetRequest(id)
	if err != nil {
		return nil, err
	}
	if r == nil {
		return nil, fmt.Errorf("request %d not found (use traffic_list to discover ids)", id)
	}

	if !argBool(req, "decoded", true) {
		return r, nil
	}
	return augmentRequestWithReadable(r), nil
}

func (s *Server) toolGetWebSocketSession(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	requestID, err := argRequiredInt64(req, "request_id")
	if err != nil {
		return nil, err
	}
	session, err := s.getDB().GetWebSocketSession(requestID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"session": session}, nil
}

func (s *Server) toolGetWebSocketFrames(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	var sessionID int64
	if v, ok := argInt64(req, "session_id"); ok {
		sessionID = v
	} else if v, ok := argInt64(req, "request_id"); ok {
		session, err := s.getDB().GetWebSocketSession(v)
		if err != nil {
			return nil, err
		}
		if session == nil {
			return map[string]any{"session_id": 0, "frames": []any{}, "has_more": false}, nil
		}
		sessionID = session.ID
	} else {
		return nil, fmt.Errorf("either request_id or session_id is required")
	}

	limit := 200
	if v, ok := argInt64(req, "limit"); ok && v > 0 {
		limit = int(v)
		if limit > 2000 {
			limit = 2000
		}
	}
	afterID, _ := argInt64(req, "after_id")
	direction := strings.ToLower(argString(req, "direction"))
	opcodeFilter, hasOpcode := argInt64(req, "opcode")

	all, err := s.getDB().ListWebSocketFrames(sessionID)
	if err != nil {
		return nil, err
	}

	filtered := make([]*storage.WebSocketFrame, 0, len(all))
	for _, f := range all {
		if f.ID <= afterID {
			continue
		}
		if direction != "" && f.Direction != direction {
			continue
		}
		if hasOpcode && int64(f.Opcode) != opcodeFilter {
			continue
		}
		filtered = append(filtered, f)
	}

	hasMore := len(filtered) > limit
	var nextAfter int64
	if hasMore {
		filtered = filtered[:limit]
	}
	if n := len(filtered); n > 0 {
		nextAfter = filtered[n-1].ID
	}

	return map[string]any{
		"session_id":    sessionID,
		"frames":        filtered,
		"has_more":      hasMore,
		"next_after_id": nextAfter,
	}, nil
}

func augmentRequestWithReadable(r *storage.Request) map[string]interface{} {
	if r == nil {
		return map[string]interface{}{}
	}
	data, _ := json.Marshal(r)
	var out map[string]interface{}
	_ = json.Unmarshal(data, &out)
	out["decoded_body"] = toUTF8(r.Body)
	if r.Response != nil {
		responseBody := toUTF8(decodeBody(r.Response.Body, r.Response.Headers))
		if respMap, ok := out["response"].(map[string]interface{}); ok {
			respMap["decoded_body"] = responseBody
		}
		out["decoded_response_body"] = responseBody
	}
	return out
}

func augmentReplayWithReadable(replay *storage.Replay) map[string]interface{} {
	if replay == nil {
		return map[string]interface{}{}
	}
	data, _ := json.Marshal(replay)
	var out map[string]interface{}
	_ = json.Unmarshal(data, &out)
	if replay.Request != nil {
		out["request"] = augmentRequestWithReadable(replay.Request)
	}
	if replay.Response != nil {
		responseBody := toUTF8(decodeBody(replay.Response.Body, replay.Response.Headers))
		if respMap, ok := out["response"].(map[string]interface{}); ok {
			respMap["decoded_body"] = responseBody
		}
		out["decoded_response_body"] = responseBody
	}
	return out
}

func (s *Server) toolReplayRequest(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	id, err := argRequiredInt64(req, "request_id")
	if err != nil {
		return nil, err
	}

	var modBody []byte
	if v := argString(req, "modified_body"); v != "" {
		modBody = []byte(v)
	}
	modURL := argString(req, "modified_url")

	var modHeaders map[string]string
	if obj, ok := argObject(req, "modified_headers"); ok {
		modHeaders = stringMap(obj)
	} else if _, err := argInto(req, "modified_headers_json", &modHeaders); err != nil {
		return nil, err
	}

	decoded := argBool(req, "decoded", true)

	replay, err := s.proxy.ReplayRequest(id, modHeaders, modBody, modURL, nil)
	if replay != nil {
		s.bus.Publish(events.Event{Type: events.EventReplayCreated, Data: replay})
	}
	if err != nil {
		return nil, err
	}
	if !decoded {
		return replay, nil
	}
	return augmentReplayWithReadable(replay), nil
}

func (s *Server) toolSendRequest(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	method, err := argRequiredString(req, "method")
	if err != nil {
		return nil, err
	}
	url, err := argRequiredString(req, "url")
	if err != nil {
		return nil, err
	}
	body := argString(req, "body")

	var headers map[string]string
	if obj, ok := argObject(req, "headers"); ok {
		headers = stringMap(obj)
	} else if _, err := argInto(req, "headers_json", &headers); err != nil {
		return nil, err
	}

	decoded := argBool(req, "decoded", true)

	captured, err := s.proxy.SendRequest(method, url, headers, []byte(body))
	if err != nil {
		return nil, err
	}
	if !decoded {
		return captured, nil
	}
	return augmentRequestWithReadable(captured), nil
}

// stringMap converts a map[string]any with scalar values into map[string]string.
// Used to bridge the object-shaped header arg to the existing []byte/string APIs.
func stringMap(in map[string]any) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		switch v := v.(type) {
		case string:
			out[k] = v
		case fmt.Stringer:
			out[k] = v.String()
		default:
			b, _ := json.Marshal(v)
			out[k] = string(b)
		}
	}
	return out
}

func (s *Server) toolInterceptToggle(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	enabled := argBool(req, "enabled", false)
	s.intercept.SetEnabled(enabled)
	s.publishProxyStatus()
	return map[string]any{"enabled": enabled}, nil
}

func (s *Server) toolInterceptForward(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	id, err := argRequiredInt64(req, "request_id")
	if err != nil {
		return nil, err
	}
	resolved := s.intercept.Resolve(id, proxy.InterceptDecision{Forward: true})
	if !resolved {
		return map[string]any{"success": false, "reason": "request_not_held"}, nil
	}
	return map[string]any{"success": true}, nil
}

func (s *Server) toolInterceptDrop(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	id, err := argRequiredInt64(req, "request_id")
	if err != nil {
		return nil, err
	}
	resolved := s.intercept.Resolve(id, proxy.InterceptDecision{Drop: true})
	if !resolved {
		return map[string]any{"success": false, "reason": "request_not_held"}, nil
	}
	return map[string]any{"success": true}, nil
}

func (s *Server) toolGetCACert(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	return map[string]any{
		"pem": s.ca.CertPEM(),
		"instructions": map[string]string{
			"chrome":  "Settings → Privacy and security → Security → Manage certificates → Import",
			"firefox": "Settings → Privacy & Security → Certificates → View Certificates → Import",
			"macos":   "Double-click the .crt file → Keychain Access → System → Trust → Always Trust for SSL",
			"linux":   "Copy to /usr/local/share/ca-certificates/ as .crt then run: sudo update-ca-certificates",
			"windows": "Run certmgr.msc → Trusted Root Certification Authorities → All Tasks → Import",
			"ios":     "Email/AirDrop the .crt to the device → install profile → Settings → General → About → Certificate Trust Settings → enable full trust",
			"android": "Settings → Security → Install from storage (note: user-installed CAs no longer work for app traffic on Android 7+)",
		},
	}, nil
}

func (s *Server) toolSearchRequests(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	query, err := argRequiredString(req, "query")
	if err != nil {
		return nil, err
	}
	limit := 20
	if v, ok := argInt64(req, "limit"); ok {
		limit = int(v)
	}
	filter := storage.RequestFilter{Search: query, Limit: limit}
	if v := argString(req, "user_id"); v != "" {
		filter.UserID = v
	}
	requests, total, err := s.getDB().ListRequests(filter)
	if err != nil {
		return nil, err
	}
	return map[string]any{"matches": requests, "total": total}, nil
}

func (s *Server) toolListInterceptQueue(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	ids := s.intercept.ListPending()
	requests := make([]any, 0, len(ids))
	for _, id := range ids {
		r, err := s.getDB().GetRequest(id)
		if err == nil && r != nil {
			requests = append(requests, r)
		}
	}
	return map[string]any{"queue": requests}, nil
}

func (s *Server) toolInterceptModify(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	id, err := argRequiredInt64(req, "request_id")
	if err != nil {
		return nil, err
	}
	var rawBytes []byte
	if v := argString(req, "raw_text"); v != "" {
		rawBytes = []byte(v)
	} else if rawB64 := argString(req, "raw"); rawB64 != "" {
		decoded, err := base64.StdEncoding.DecodeString(rawB64)
		if err != nil {
			return nil, fmt.Errorf("`raw` must be valid base64: %w", err)
		}
		rawBytes = decoded
	} else {
		return nil, fmt.Errorf("either `raw_text` (plain HTTP/1.1) or `raw` (base64) is required")
	}
	resolved := s.intercept.Resolve(id, proxy.InterceptDecision{Forward: true, ModifiedRaw: rawBytes})
	if !resolved {
		return map[string]any{"success": false, "reason": "request_not_held"}, nil
	}
	return map[string]any{"success": true}, nil
}

// toolInterceptGetEditable returns the held request as text + base64 so callers
// don't have to fetch, decode, edit, re-encode by hand.
func (s *Server) toolInterceptGetEditable(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	id, err := argRequiredInt64(req, "request_id")
	if err != nil {
		return nil, err
	}
	raw, ok := s.intercept.GetRawPacket(id)
	if !ok {
		return nil, fmt.Errorf("request %d is not in the intercept queue", id)
	}
	return map[string]any{
		"request_id": id,
		"raw_text":   string(raw),
		"raw_base64": base64.StdEncoding.EncodeToString(raw),
	}, nil
}

func (s *Server) toolDeleteRequest(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	id, err := argRequiredInt64(req, "id")
	if err != nil {
		return nil, err
	}
	if err := s.getDB().DeleteRequest(id); err != nil {
		return nil, err
	}
	s.publishRequestDeleted(id)
	s.publishProxyStatus()
	return map[string]any{"success": true, "deleted_id": id}, nil
}

const bulkDeleteSafeMax = 5000

func (s *Server) toolDeleteSitemapRequests(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	var ids []int64
	if arr, ok := argArray(req, "ids"); ok {
		for _, v := range arr {
			if f, ok := v.(float64); ok {
				ids = append(ids, int64(f))
			}
		}
	} else if _, err := argInto(req, "ids_json", &ids); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("`ids` (number array) or `ids_json` is required and must contain at least one id")
	}

	dryRun := argBool(req, "dry_run", false)
	confirm := argBool(req, "confirm", false)

	if len(ids) > bulkDeleteSafeMax && !confirm && !dryRun {
		return nil, fmt.Errorf("deleting %d rows requires confirm=true (safety threshold: %d). Use dry_run=true to preview", len(ids), bulkDeleteSafeMax)
	}

	if dryRun {
		return map[string]any{"dry_run": true, "would_delete": len(ids), "ids": ids}, nil
	}

	if err := s.getDB().DeleteRequests(ids); err != nil {
		return nil, err
	}
	for _, id := range ids {
		s.publishRequestDeleted(id)
	}
	s.publishProxyStatus()
	return map[string]any{"success": true, "deleted": len(ids), "deleted_ids": ids}, nil
}

func (s *Server) toolDeleteSitemapHost(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	host, err := argRequiredString(req, "host")
	if err != nil {
		return nil, err
	}
	dryRun := argBool(req, "dry_run", false)

	if dryRun {
		// Preview by listing instead of deleting.
		filter := storage.RequestFilter{Host: host, Limit: 1000000}
		previewReqs, _, err := s.getDB().ListRequests(filter)
		if err != nil {
			return nil, err
		}
		ids := make([]int64, 0, len(previewReqs))
		for _, r := range previewReqs {
			if r.Host == host { // ListRequests does substring match; insist on exact
				ids = append(ids, r.ID)
			}
		}
		return map[string]any{"dry_run": true, "host": host, "would_delete": len(ids)}, nil
	}

	ids, err := s.getDB().DeleteRequestsByHost(host)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		s.publishRequestDeleted(id)
	}
	s.publishProxyStatus()
	return map[string]any{"success": true, "host": host, "deleted": len(ids), "deleted_ids": ids}, nil
}

func (s *Server) toolGetProject(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded — use project_open or project_new")
	}
	return s.projectResult(mgr), nil
}

func (s *Server) toolUpdateProject(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded — use project_open or project_new")
	}
	cfg := mgr.Config()
	oldProxyPort := cfg.Proxy.Port
	oldMCPPort := cfg.MCPPort

	if v := argString(req, "name"); v != "" {
		cfg.Name = v
	}
	proxyChanged := false
	if v, ok := argInt64(req, "proxy_port"); ok {
		cfg.Proxy.Port = int(v)
		proxyChanged = true
	}
	if v := argString(req, "upstream_url"); v != "" {
		cfg.Proxy.UpstreamURL = v
		proxyChanged = true
	}
	if args := req.GetArguments(); args != nil {
		if v, ok := args["intercept_enabled"].(bool); ok {
			cfg.Proxy.InterceptEnabled = v
			proxyChanged = true
		}
	}

	// Filters: native object or legacy *_json string.
	{
		var filters proj.FilterConfig
		present, err := argInto(req, "filters", &filters)
		if !present {
			present, err = argInto(req, "filters_json", &filters)
		}
		if err != nil {
			return nil, err
		}
		if present {
			cfg.Filters = filters
		}
	}
	scopeChanged := false
	if args := req.GetArguments(); args != nil {
		if v, ok := args["scope_enabled"].(bool); ok {
			cfg.Scope.Enabled = v
			scopeChanged = true
		}
	}
	{
		var rules []proj.ScopeRule
		present, err := argInto(req, "scope_include", &rules)
		if !present {
			present, err = argInto(req, "scope_include_json", &rules)
		}
		if err != nil {
			return nil, err
		}
		if present {
			cfg.Scope.IncludeRules = rules
			scopeChanged = true
		}
	}
	{
		var rules []proj.ScopeRule
		present, err := argInto(req, "scope_exclude", &rules)
		if !present {
			present, err = argInto(req, "scope_exclude_json", &rules)
		}
		if err != nil {
			return nil, err
		}
		if present {
			cfg.Scope.ExcludeRules = rules
			scopeChanged = true
		}
	}
	if args := req.GetArguments(); args != nil {
		if v, ok := args["mcp_disabled"].(bool); ok {
			cfg.MCPDisabled = v
		}
	}
	if v, ok := argInt64(req, "mcp_port"); ok {
		cfg.MCPPort = int(v)
	}
	{
		var rules []proj.MatchReplaceRule
		present, err := argInto(req, "match_replace", &rules)
		if !present {
			present, err = argInto(req, "match_replace_json", &rules)
		}
		if err != nil {
			return nil, err
		}
		if present {
			cfg.MatchReplace = rules
			s.proxy.SetMatchReplace(cfg.MatchReplace)
		}
	}
	{
		var middleware proj.MiddlewareConfig
		present, err := argInto(req, "middleware", &middleware)
		if !present {
			present, err = argInto(req, "middleware_json", &middleware)
		}
		if err != nil {
			return nil, err
		}
		if present {
			cfg.Middleware = middleware
			s.proxy.SetMiddleware(cfg.Middleware)
		}
	}
	{
		var flows []proj.Flow
		present, err := argInto(req, "flows", &flows)
		if !present {
			present, err = argInto(req, "flows_json", &flows)
		}
		if err != nil {
			return nil, err
		}
		if present {
			cfg.Flows = flows
		}
	}

	if err := mgr.Save(cfg); err != nil {
		return nil, err
	}
	if proxyChanged {
		s.proxy.ApplyConfig(cfg.Proxy.Port, cfg.Proxy.InterceptEnabled, cfg.Proxy.UpstreamURL)
		if cfg.Proxy.Port != oldProxyPort && cfg.Proxy.Port > 0 {
			if err := s.proxy.ChangePort(cfg.Proxy.Port); err != nil {
				return nil, fmt.Errorf("proxy port in use: %w", err)
			}
		}
	}
	if scopeChanged {
		s.proxy.SetScope(cfg.Scope)
	}
	if cfg.MCPPort != oldMCPPort && cfg.MCPPort > 0 {
		if err := s.ChangePort(ctx, cfg.MCPPort); err != nil {
			return nil, fmt.Errorf("mcp port in use: %w", err)
		}
	}
	s.publishProjectUpdated()
	if proxyChanged {
		s.publishProxyStatus()
	}
	return s.projectResult(mgr), nil
}

func (s *Server) toolRenameProject(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	name, err := argRequiredString(req, "name")
	if err != nil {
		return nil, err
	}
	cfg := mgr.Config()
	cfg.Name = name
	if err := mgr.Save(cfg); err != nil {
		return nil, err
	}
	s.publishProjectUpdated()
	return map[string]any{"success": true, "name": cfg.Name, "path": mgr.Path(), "is_temp": mgr.IsTemp()}, nil
}

func (s *Server) toolGetMatchReplace(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	return map[string]any{"rules": mgr.Config().MatchReplace}, nil
}

func (s *Server) toolUpdateMatchReplace(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	var rules []proj.MatchReplaceRule
	present, err := argInto(req, "rules", &rules)
	if !present {
		present, err = argInto(req, "rules_json", &rules)
	}
	if err != nil {
		return nil, err
	}
	if !present {
		return nil, fmt.Errorf("`rules` (array) or `rules_json` is required")
	}
	cfg := mgr.Config()
	cfg.MatchReplace = rules
	if err := mgr.Save(cfg); err != nil {
		return nil, err
	}
	s.proxy.SetMatchReplace(cfg.MatchReplace)
	s.publishProjectUpdated()
	return map[string]any{"rules": cfg.MatchReplace}, nil
}

func (s *Server) toolGetMiddleware(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	return mgr.Config().Middleware, nil
}

func (s *Server) toolUpdateMiddleware(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	var cfgValue proj.MiddlewareConfig
	present, err := argInto(req, "config", &cfgValue)
	if !present {
		present, err = argInto(req, "config_json", &cfgValue)
	}
	if err != nil {
		return nil, err
	}
	if !present {
		return nil, fmt.Errorf("`config` (object) or `config_json` is required")
	}
	cfg := mgr.Config()
	cfg.Middleware = cfgValue
	if err := mgr.Save(cfg); err != nil {
		return nil, err
	}
	s.proxy.SetMiddleware(cfg.Middleware)
	s.publishProjectUpdated()
	return cfg.Middleware, nil
}

func (s *Server) toolListFlows(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	return map[string]any{"flows": mgr.Config().Flows}, nil
}

func (s *Server) toolGetFlow(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	flowID, err := argRequiredString(req, "flow_id")
	if err != nil {
		return nil, err
	}
	for _, flow := range mgr.Config().Flows {
		if flow.ID == flowID {
			return flow, nil
		}
	}
	return nil, fmt.Errorf("flow %q not found", flowID)
}

func (s *Server) toolSaveFlow(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	var flow proj.Flow
	present, err := argInto(req, "flow", &flow)
	if !present {
		present, err = argInto(req, "flow_json", &flow)
	}
	if err != nil {
		return nil, err
	}
	if !present {
		return nil, fmt.Errorf("`flow` (object) or `flow_json` is required")
	}
	cfg := mgr.Config()
	replaced := false
	for i := range cfg.Flows {
		if cfg.Flows[i].ID == flow.ID {
			cfg.Flows[i] = flow
			replaced = true
			break
		}
	}
	if !replaced {
		cfg.Flows = append(cfg.Flows, flow)
	}
	if err := mgr.Save(cfg); err != nil {
		return nil, err
	}
	s.publishProjectUpdated()
	return flow, nil
}

func (s *Server) toolDeleteFlow(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	flowID, err := argRequiredString(req, "flow_id")
	if err != nil {
		return nil, err
	}
	cfg := mgr.Config()
	next := make([]proj.Flow, 0, len(cfg.Flows))
	removed := false
	for _, flow := range cfg.Flows {
		if flow.ID == flowID {
			removed = true
			continue
		}
		next = append(next, flow)
	}
	if !removed {
		return nil, fmt.Errorf("flow %q not found", flowID)
	}
	cfg.Flows = next
	if err := mgr.Save(cfg); err != nil {
		return nil, err
	}
	s.publishProjectUpdated()
	return map[string]any{"success": true, "deleted_id": flowID}, nil
}

func (s *Server) toolRunFlow(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	flowID, err := argRequiredString(req, "flow_id")
	if err != nil {
		return nil, err
	}
	var seedVars map[string]string
	if obj, ok := argObject(req, "variables"); ok {
		seedVars = stringMap(obj)
	} else if _, err := argInto(req, "variables_json", &seedVars); err != nil {
		return nil, err
	}
	result, err := s.runFlowByID(ctx, flowID, seedVars)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Server) toolGetSitemap(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	filter := storage.RequestFilter{Limit: 50000}
	if v := argString(req, "host"); v != "" {
		filter.Host = v
	}
	if v := argString(req, "method"); v != "" {
		filter.Method = v
	}
	if v := argString(req, "search"); v != "" {
		filter.Search = v
	}
	if v, ok := argInt64(req, "status_min"); ok {
		filter.StatusMin = int(v)
	}
	if v, ok := argInt64(req, "status_max"); ok {
		filter.StatusMax = int(v)
	}
	if v := argString(req, "user_id"); v != "" {
		filter.UserID = v
	}
	requests, _, err := s.getDB().ListRequests(filter)
	if err != nil {
		return nil, err
	}
	if argBool(req, "in_scope_only", false) {
		mgr := s.getProject()
		if mgr != nil {
			requests = filterInScopeRequests(requests, mgr.Config().Scope)
		}
	}
	tree := buildSitemapTree(requests)
	return map[string]any{
		"tree":               tree,
		"request_count":      len(requests),
		"host_count":         len(tree),
		"route_count":        countUniqueRoutes(requests),
		"responded_requests": countResponses(requests),
	}, nil
}

func (s *Server) projectResult(mgr *proj.Manager) map[string]any {
	cfg := mgr.Config()
	return map[string]any{
		"name":          cfg.Name,
		"path":          mgr.Path(),
		"is_temp":       mgr.IsTemp(),
		"proxy":         cfg.Proxy,
		"filters":       cfg.Filters,
		"scope":         cfg.Scope,
		"mcp_disabled":  cfg.MCPDisabled,
		"mcp_port":      cfg.MCPPort,
		"mcp_status":    s.Status(),
		"match_replace": cfg.MatchReplace,
		"middleware":    cfg.Middleware,
		"flows":         cfg.Flows,
	}
}

func (s *Server) toolListRecentProjects(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	appCfg := s.getAppCfg()
	type entry struct {
		Path   string `json:"path"`
		Name   string `json:"name"`
		Exists bool   `json:"exists"`
	}
	result := []entry{}
	if appCfg != nil {
		for _, p := range appCfg.RecentProjects {
			e := entry{Path: p, Exists: true}
			if m, err := proj.OpenProject(p); err == nil {
				e.Name = m.Config().Name
			} else {
				if _, statErr := os.Stat(p); os.IsNotExist(statErr) {
					e.Exists = false
				}
				e.Name = p
			}
			result = append(result, e)
		}
	}
	return map[string]any{"projects": result}, nil
}

func (s *Server) toolOpenProject(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	path, err := argRequiredString(req, "path")
	if err != nil {
		return nil, err
	}
	var mgr *proj.Manager
	if proj.IsTempPath(path) {
		mgr, err = proj.TempProject()
	} else {
		mgr, err = proj.OpenProject(path)
	}
	if err != nil {
		return nil, fmt.Errorf("open project: %w", err)
	}
	s.projectMu.RLock()
	switchFn := s.onSwitchProject
	s.projectMu.RUnlock()
	if switchFn != nil {
		if err := switchFn(mgr); err != nil {
			return nil, fmt.Errorf("switch project: %w", err)
		}
	}
	cfg := mgr.Config()
	return map[string]any{"name": cfg.Name, "path": mgr.Path(), "is_temp": mgr.IsTemp()}, nil
}

func (s *Server) toolNewProject(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	path, err := argRequiredString(req, "path")
	if err != nil {
		return nil, err
	}
	name := "New Project"
	if v := argString(req, "name"); v != "" {
		name = v
	}
	mgr, err := proj.CreateProject(path, name)
	if err != nil {
		return nil, fmt.Errorf("create project: %w", err)
	}
	s.projectMu.RLock()
	switchFn := s.onSwitchProject
	s.projectMu.RUnlock()
	if switchFn != nil {
		if err := switchFn(mgr); err != nil {
			return nil, fmt.Errorf("switch project: %w", err)
		}
	}
	cfg := mgr.Config()
	return map[string]any{"name": cfg.Name, "path": mgr.Path(), "is_temp": mgr.IsTemp()}, nil
}

// jsonResult is preserved for the other tool files that still use it directly.
// New tools should return raw Go values and let registry.go handle serialization.
func jsonResult(v any) (*mcp.CallToolResult, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return mcp.NewToolResultStructured(v, string(b)), nil
}
