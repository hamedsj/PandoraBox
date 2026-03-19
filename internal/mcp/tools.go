package mcp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"

	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/hamedsj5/pandorabox/internal/proxy"
	"github.com/hamedsj5/pandorabox/internal/storage"
	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerTools() {
	// list_docs
	s.mcp.AddTool(mcp.NewTool("list_docs",
		mcp.WithDescription("List built-in PandoraBox MCP documentation topics for tool usage, project schemas, middleware, and flows"),
	), s.toolListDocs)

	// get_doc
	s.mcp.AddTool(mcp.NewTool("get_doc",
		mcp.WithDescription("Read one built-in PandoraBox MCP documentation topic"),
		mcp.WithString("topic", mcp.Description(`Documentation topic id: "overview", "tools", "project-schemas", "middleware", or "flows"`)),
		mcp.WithString("id", mcp.Description("Alias for topic")),
	), s.toolGetDoc)

	// proxy_status
	s.mcp.AddTool(mcp.NewTool("proxy_status",
		mcp.WithDescription("Get proxy status"),
	), s.toolProxyStatus)

	// proxy_start
	s.mcp.AddTool(mcp.NewTool("proxy_start",
		mcp.WithDescription("Start the proxy"),
		mcp.WithNumber("port", mcp.Description("Proxy port")),
	), s.toolProxyStart)

	// proxy_stop
	s.mcp.AddTool(mcp.NewTool("proxy_stop",
		mcp.WithDescription("Stop the proxy"),
	), s.toolProxyStop)

	// list_requests
	s.mcp.AddTool(mcp.NewTool("list_requests",
		mcp.WithDescription("List captured HTTP requests"),
		mcp.WithString("host", mcp.Description("Filter by host")),
		mcp.WithString("method", mcp.Description("Filter by HTTP method")),
		mcp.WithNumber("status_min", mcp.Description("Minimum status code")),
		mcp.WithNumber("status_max", mcp.Description("Maximum status code")),
		mcp.WithString("search", mcp.Description("Search in host/path/query")),
		mcp.WithNumber("limit", mcp.Description("Max results (default 20)")),
		mcp.WithNumber("offset", mcp.Description("Offset for pagination")),
	), s.toolListRequests)

	// get_request
	s.mcp.AddTool(mcp.NewTool("get_request",
		mcp.WithDescription("Get full request and response details"),
		mcp.WithNumber("id", mcp.Description("Request ID"), mcp.Required()),
	), s.toolGetRequest)

	// get_websocket_session
	s.mcp.AddTool(mcp.NewTool("get_websocket_session",
		mcp.WithDescription("Get the WebSocket session associated with an HTTP upgrade request"),
		mcp.WithNumber("request_id", mcp.Description("HTTP upgrade request ID"), mcp.Required()),
	), s.toolGetWebSocketSession)

	// get_websocket_frames
	s.mcp.AddTool(mcp.NewTool("get_websocket_frames",
		mcp.WithDescription("Get captured WebSocket frames for an HTTP upgrade request or session"),
		mcp.WithNumber("request_id", mcp.Description("HTTP upgrade request ID")),
		mcp.WithNumber("session_id", mcp.Description("WebSocket session ID")),
	), s.toolGetWebSocketFrames)

	// replay_request
	s.mcp.AddTool(mcp.NewTool("replay_request",
		mcp.WithDescription("Replay a captured request with optional modifications"),
		mcp.WithNumber("request_id", mcp.Description("Request ID to replay"), mcp.Required()),
		mcp.WithString("modified_url", mcp.Description("Override URL")),
		mcp.WithString("modified_body", mcp.Description("Override body (string)")),
		mcp.WithString("modified_headers_json", mcp.Description(`Optional JSON object of header overrides, e.g. {"X-Custom": "value"}`)),
	), s.toolReplayRequest)

	// send_request
	s.mcp.AddTool(mcp.NewTool("send_request",
		mcp.WithDescription("Send a new HTTP request through the proxy"),
		mcp.WithString("method", mcp.Description("HTTP method"), mcp.Required()),
		mcp.WithString("url", mcp.Description("Target URL"), mcp.Required()),
		mcp.WithString("body", mcp.Description("Request body")),
		mcp.WithString("headers_json", mcp.Description(`Optional JSON object of request headers, e.g. {"Authorization": "Bearer token"}`)),
	), s.toolSendRequest)

	// intercept_toggle
	s.mcp.AddTool(mcp.NewTool("intercept_toggle",
		mcp.WithDescription("Enable or disable request interception"),
		mcp.WithBoolean("enabled", mcp.Description("Enable intercept"), mcp.Required()),
	), s.toolInterceptToggle)

	// intercept_forward
	s.mcp.AddTool(mcp.NewTool("intercept_forward",
		mcp.WithDescription("Forward a held request"),
		mcp.WithNumber("request_id", mcp.Description("Request ID"), mcp.Required()),
	), s.toolInterceptForward)

	// intercept_drop
	s.mcp.AddTool(mcp.NewTool("intercept_drop",
		mcp.WithDescription("Drop a held request"),
		mcp.WithNumber("request_id", mcp.Description("Request ID"), mcp.Required()),
	), s.toolInterceptDrop)

	// get_ca_cert
	s.mcp.AddTool(mcp.NewTool("get_ca_cert",
		mcp.WithDescription("Get the CA certificate PEM for browser installation"),
	), s.toolGetCACert)

	// search_requests
	s.mcp.AddTool(mcp.NewTool("search_requests",
		mcp.WithDescription("Search requests by keyword"),
		mcp.WithString("query", mcp.Description("Search query"), mcp.Required()),
		mcp.WithNumber("limit", mcp.Description("Max results")),
	), s.toolSearchRequests)

	// list_intercept_queue
	s.mcp.AddTool(mcp.NewTool("list_intercept_queue",
		mcp.WithDescription("List all requests currently held in the intercept queue"),
	), s.toolListInterceptQueue)

	// intercept_modify
	s.mcp.AddTool(mcp.NewTool("intercept_modify",
		mcp.WithDescription("Modify and forward a held request using a base64-encoded raw HTTP packet"),
		mcp.WithNumber("request_id", mcp.Description("Request ID to modify"), mcp.Required()),
		mcp.WithString("raw", mcp.Description("Base64-encoded modified raw HTTP request"), mcp.Required()),
	), s.toolInterceptModify)

	// delete_request
	s.mcp.AddTool(mcp.NewTool("delete_request",
		mcp.WithDescription("Delete a captured request (and its response) by ID"),
		mcp.WithNumber("id", mcp.Description("Request ID"), mcp.Required()),
	), s.toolDeleteRequest)

	// get_project
	s.mcp.AddTool(mcp.NewTool("get_project",
		mcp.WithDescription("Get current project information including proxy config, scope, filters, match/replace, middleware, and flows"),
	), s.toolGetProject)

	// update_project
	s.mcp.AddTool(mcp.NewTool("update_project",
		mcp.WithDescription("Update current project settings"),
		mcp.WithString("name", mcp.Description("New project name")),
		mcp.WithNumber("proxy_port", mcp.Description("Proxy listen port")),
		mcp.WithString("upstream_url", mcp.Description("Optional upstream proxy URL")),
		mcp.WithBoolean("intercept_enabled", mcp.Description("Enable/disable intercept")),
		mcp.WithString("filters_json", mcp.Description("JSON FilterConfig object")),
		mcp.WithBoolean("scope_enabled", mcp.Description("Enable/disable scope filtering")),
		mcp.WithString("scope_include_json", mcp.Description("JSON array of ScopeRule objects for include rules")),
		mcp.WithString("scope_exclude_json", mcp.Description("JSON array of ScopeRule objects for exclude rules")),
		mcp.WithString("match_replace_json", mcp.Description("JSON array of MatchReplaceRule objects")),
		mcp.WithString("middleware_json", mcp.Description("JSON MiddlewareConfig object")),
		mcp.WithString("flows_json", mcp.Description("JSON array of Flow objects")),
		mcp.WithBoolean("mcp_disabled", mcp.Description("Disable MCP access for this project")),
		mcp.WithNumber("mcp_port", mcp.Description("MCP listen port")),
	), s.toolUpdateProject)

	// get_match_replace
	s.mcp.AddTool(mcp.NewTool("get_match_replace",
		mcp.WithDescription("Get the current Match & Replace rules"),
	), s.toolGetMatchReplace)

	// update_match_replace
	s.mcp.AddTool(mcp.NewTool("update_match_replace",
		mcp.WithDescription("Replace the current Match & Replace rules"),
		mcp.WithString("rules_json", mcp.Description("JSON array of MatchReplaceRule objects"), mcp.Required()),
	), s.toolUpdateMatchReplace)

	// get_middleware
	s.mcp.AddTool(mcp.NewTool("get_middleware",
		mcp.WithDescription("Get the current middleware graph configuration"),
	), s.toolGetMiddleware)

	// update_middleware
	s.mcp.AddTool(mcp.NewTool("update_middleware",
		mcp.WithDescription("Replace the current middleware graph configuration"),
		mcp.WithString("config_json", mcp.Description("JSON MiddlewareConfig object"), mcp.Required()),
	), s.toolUpdateMiddleware)

	// list_flows
	s.mcp.AddTool(mcp.NewTool("list_flows",
		mcp.WithDescription("List all saved flows"),
	), s.toolListFlows)

	// get_flow
	s.mcp.AddTool(mcp.NewTool("get_flow",
		mcp.WithDescription("Get one flow by id"),
		mcp.WithString("flow_id", mcp.Description("Flow ID"), mcp.Required()),
	), s.toolGetFlow)

	// save_flow
	s.mcp.AddTool(mcp.NewTool("save_flow",
		mcp.WithDescription("Create or update one flow"),
		mcp.WithString("flow_json", mcp.Description("JSON Flow object"), mcp.Required()),
	), s.toolSaveFlow)

	// delete_flow
	s.mcp.AddTool(mcp.NewTool("delete_flow",
		mcp.WithDescription("Delete one flow by id"),
		mcp.WithString("flow_id", mcp.Description("Flow ID"), mcp.Required()),
	), s.toolDeleteFlow)

	// run_flow
	s.mcp.AddTool(mcp.NewTool("run_flow",
		mcp.WithDescription("Execute a flow by id"),
		mcp.WithString("flow_id", mcp.Description("Flow ID"), mcp.Required()),
		mcp.WithString("variables_json", mcp.Description("Optional JSON object of seed variables")),
	), s.toolRunFlow)

	// get_sitemap
	s.mcp.AddTool(mcp.NewTool("get_sitemap",
		mcp.WithDescription("Build a SiteMap tree from captured requests"),
		mcp.WithString("host", mcp.Description("Filter by host")),
		mcp.WithString("method", mcp.Description("Filter by HTTP method")),
		mcp.WithString("search", mcp.Description("Search in host/path/query")),
		mcp.WithNumber("status_min", mcp.Description("Minimum status code")),
		mcp.WithNumber("status_max", mcp.Description("Maximum status code")),
		mcp.WithBoolean("in_scope_only", mcp.Description("Restrict the SiteMap to in-scope requests")),
	), s.toolGetSitemap)

	// list_recent_projects
	s.mcp.AddTool(mcp.NewTool("list_recent_projects",
		mcp.WithDescription("List recently opened projects"),
	), s.toolListRecentProjects)

	// open_project
	s.mcp.AddTool(mcp.NewTool("open_project",
		mcp.WithDescription("Open an existing project by path and switch to it"),
		mcp.WithString("path", mcp.Description("Absolute path to project folder"), mcp.Required()),
	), s.toolOpenProject)

	// new_project
	s.mcp.AddTool(mcp.NewTool("new_project",
		mcp.WithDescription("Create a new project at the given path and switch to it"),
		mcp.WithString("path", mcp.Description("Absolute path for new project folder"), mcp.Required()),
		mcp.WithString("name", mcp.Description("Project name (optional)")),
	), s.toolNewProject)
}

func (s *Server) toolProxyStatus(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	count, _ := s.getDB().CountRequests()
	result := map[string]interface{}{
		"running":           s.proxy.IsRunning(),
		"port":              s.cfg.ProxyPort,
		"intercept_enabled": s.intercept.IsEnabled(),
		"request_count":     count,
		"queue_length":      s.intercept.QueueLength(),
	}
	return jsonResult(result)
}

func (s *Server) toolProxyStart(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	return jsonResult(map[string]interface{}{
		"success": s.proxy.IsRunning(),
		"port":    s.cfg.ProxyPort,
	})
}

func (s *Server) toolProxyStop(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	s.proxy.Stop()
	s.publishProxyStatus()
	return jsonResult(map[string]interface{}{"success": true})
}

func (s *Server) toolListRequests(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	args := req.Params.Arguments

	filter := storage.RequestFilter{
		Limit: 20,
	}
	if v, ok := args["host"].(string); ok {
		filter.Host = v
	}
	if v, ok := args["method"].(string); ok {
		filter.Method = v
	}
	if v, ok := args["search"].(string); ok {
		filter.Search = v
	}
	if v, ok := args["limit"].(float64); ok {
		filter.Limit = int(v)
	}
	if v, ok := args["offset"].(float64); ok {
		filter.Offset = int(v)
	}
	if v, ok := args["status_min"].(float64); ok {
		filter.StatusMin = int(v)
	}
	if v, ok := args["status_max"].(float64); ok {
		filter.StatusMax = int(v)
	}

	requests, total, err := s.getDB().ListRequests(filter)
	if err != nil {
		return nil, err
	}

	return jsonResult(map[string]interface{}{
		"requests": requests,
		"total":    total,
	})
}

func (s *Server) toolGetRequest(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	id, ok := req.Params.Arguments["id"].(float64)
	if !ok {
		return nil, fmt.Errorf("id required")
	}

	r, err := s.getDB().GetRequest(int64(id))
	if err != nil {
		return nil, err
	}
	if r == nil {
		return nil, fmt.Errorf("request not found")
	}

	return jsonResult(r)
}

func (s *Server) toolGetWebSocketSession(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	requestID, ok := req.Params.Arguments["request_id"].(float64)
	if !ok {
		return nil, fmt.Errorf("request_id required")
	}

	session, err := s.getDB().GetWebSocketSession(int64(requestID))
	if err != nil {
		return nil, err
	}
	return jsonResult(map[string]interface{}{"session": session})
}

func (s *Server) toolGetWebSocketFrames(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}

	var sessionID int64
	if raw, ok := req.Params.Arguments["session_id"].(float64); ok {
		sessionID = int64(raw)
	} else if raw, ok := req.Params.Arguments["request_id"].(float64); ok {
		session, err := s.getDB().GetWebSocketSession(int64(raw))
		if err != nil {
			return nil, err
		}
		if session == nil {
			return jsonResult(map[string]interface{}{"session": nil, "frames": []any{}})
		}
		sessionID = session.ID
	} else {
		return nil, fmt.Errorf("request_id or session_id required")
	}

	frames, err := s.getDB().ListWebSocketFrames(sessionID)
	if err != nil {
		return nil, err
	}

	return jsonResult(map[string]interface{}{
		"session_id": sessionID,
		"frames":     frames,
	})
}

func (s *Server) toolReplayRequest(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	args := req.Params.Arguments
	id, ok := args["request_id"].(float64)
	if !ok {
		return nil, fmt.Errorf("request_id required")
	}

	var modBody []byte
	if v, ok := args["modified_body"].(string); ok {
		modBody = []byte(v)
	}
	var modURL string
	if v, ok := args["modified_url"].(string); ok {
		modURL = v
	}
	var modHeaders map[string]string
	if v, ok := args["modified_headers_json"].(string); ok && v != "" {
		if err := json.Unmarshal([]byte(v), &modHeaders); err != nil {
			return nil, fmt.Errorf("modified_headers_json: %w", err)
		}
	}

	replay, err := s.proxy.ReplayRequest(int64(id), modHeaders, modBody, modURL, nil)
	if err != nil {
		return nil, err
	}

	return jsonResult(replay)
}

func (s *Server) toolSendRequest(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	args := req.Params.Arguments
	method, _ := args["method"].(string)
	url, _ := args["url"].(string)
	bodyStr, _ := args["body"].(string)

	var headers map[string]string
	if v, ok := args["headers_json"].(string); ok && v != "" {
		if err := json.Unmarshal([]byte(v), &headers); err != nil {
			return nil, fmt.Errorf("headers_json: %w", err)
		}
	}

	captured, err := s.proxy.SendRequest(method, url, headers, []byte(bodyStr))
	if err != nil {
		return nil, err
	}

	return jsonResult(captured)
}

func (s *Server) toolInterceptToggle(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	enabled, _ := req.Params.Arguments["enabled"].(bool)
	s.intercept.SetEnabled(enabled)
	s.publishProxyStatus()
	return jsonResult(map[string]interface{}{"enabled": enabled})
}

func (s *Server) toolInterceptForward(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	id, ok := req.Params.Arguments["request_id"].(float64)
	if !ok {
		return nil, fmt.Errorf("request_id required")
	}

	resolved := s.intercept.Resolve(int64(id), proxy.InterceptDecision{Forward: true})
	return jsonResult(map[string]interface{}{"success": resolved})
}

func (s *Server) toolInterceptDrop(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	id, ok := req.Params.Arguments["request_id"].(float64)
	if !ok {
		return nil, fmt.Errorf("request_id required")
	}

	resolved := s.intercept.Resolve(int64(id), proxy.InterceptDecision{Drop: true})
	return jsonResult(map[string]interface{}{"success": resolved})
}

func (s *Server) toolGetCACert(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	return jsonResult(map[string]interface{}{
		"pem": s.ca.CertPEM(),
		"instructions": map[string]string{
			"chrome":  "Settings → Privacy and security → Security → Manage certificates → Import",
			"firefox": "Settings → Privacy & Security → Certificates → View Certificates → Import",
			"macos":   "Double-click the .crt file → Trust → Always Trust for SSL",
		},
	})
}

func (s *Server) toolSearchRequests(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	args := req.Params.Arguments
	query, _ := args["query"].(string)
	limit := 20
	if v, ok := args["limit"].(float64); ok {
		limit = int(v)
	}

	requests, total, err := s.getDB().ListRequests(storage.RequestFilter{
		Search: query,
		Limit:  limit,
	})
	if err != nil {
		return nil, err
	}

	return jsonResult(map[string]interface{}{
		"matches": requests,
		"total":   total,
	})
}

func (s *Server) toolListInterceptQueue(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	ids := s.intercept.ListPending()
	requests := make([]interface{}, 0, len(ids))
	for _, id := range ids {
		r, err := s.getDB().GetRequest(id)
		if err == nil && r != nil {
			requests = append(requests, r)
		}
	}
	return jsonResult(map[string]interface{}{"queue": requests})
}

func (s *Server) toolInterceptModify(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	args := req.Params.Arguments
	id, ok := args["request_id"].(float64)
	if !ok {
		return nil, fmt.Errorf("request_id required")
	}
	rawB64, ok := args["raw"].(string)
	if !ok {
		return nil, fmt.Errorf("raw required")
	}
	rawBytes, err := base64.StdEncoding.DecodeString(rawB64)
	if err != nil {
		return nil, fmt.Errorf("invalid base64: %w", err)
	}
	resolved := s.intercept.Resolve(int64(id), proxy.InterceptDecision{Forward: true, ModifiedRaw: rawBytes})
	return jsonResult(map[string]interface{}{"success": resolved})
}

func (s *Server) toolDeleteRequest(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	id, ok := req.Params.Arguments["id"].(float64)
	if !ok {
		return nil, fmt.Errorf("id required")
	}
	if err := s.getDB().DeleteRequest(int64(id)); err != nil {
		return nil, err
	}
	s.publishRequestDeleted(int64(id))
	s.publishProxyStatus()
	return jsonResult(map[string]interface{}{"success": true})
}

func (s *Server) toolGetProject(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	return jsonResult(s.projectResult(mgr))
}

func (s *Server) toolUpdateProject(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}

	args := req.Params.Arguments
	cfg := mgr.Config()
	oldProxyPort := cfg.Proxy.Port
	oldMCPPort := cfg.MCPPort

	if v, ok := args["name"].(string); ok {
		cfg.Name = v
	}
	proxyChanged := false
	if v, ok := args["proxy_port"].(float64); ok {
		cfg.Proxy.Port = int(v)
		proxyChanged = true
	}
	if v, ok := args["upstream_url"].(string); ok {
		cfg.Proxy.UpstreamURL = v
		proxyChanged = true
	}
	if v, ok := args["intercept_enabled"].(bool); ok {
		cfg.Proxy.InterceptEnabled = v
		proxyChanged = true
	}
	if v, ok := args["filters_json"].(string); ok && v != "" {
		var filters proj.FilterConfig
		if err := json.Unmarshal([]byte(v), &filters); err != nil {
			return nil, fmt.Errorf("filters_json: %w", err)
		}
		cfg.Filters = filters
	}
	scopeChanged := false
	if v, ok := args["scope_enabled"].(bool); ok {
		cfg.Scope.Enabled = v
		scopeChanged = true
	}
	if v, ok := args["scope_include_json"].(string); ok && v != "" {
		var rules []proj.ScopeRule
		if err := json.Unmarshal([]byte(v), &rules); err != nil {
			return nil, fmt.Errorf("scope_include_json: %w", err)
		}
		cfg.Scope.IncludeRules = rules
		scopeChanged = true
	}
	if v, ok := args["scope_exclude_json"].(string); ok && v != "" {
		var rules []proj.ScopeRule
		if err := json.Unmarshal([]byte(v), &rules); err != nil {
			return nil, fmt.Errorf("scope_exclude_json: %w", err)
		}
		cfg.Scope.ExcludeRules = rules
		scopeChanged = true
	}
	if v, ok := args["mcp_disabled"].(bool); ok {
		cfg.MCPDisabled = v
	}
	if v, ok := args["mcp_port"].(float64); ok {
		cfg.MCPPort = int(v)
	}
	if v, ok := args["match_replace_json"].(string); ok && v != "" {
		var rules []proj.MatchReplaceRule
		if err := json.Unmarshal([]byte(v), &rules); err != nil {
			return nil, fmt.Errorf("match_replace_json: %w", err)
		}
		cfg.MatchReplace = rules
		s.proxy.SetMatchReplace(cfg.MatchReplace)
	}
	if v, ok := args["middleware_json"].(string); ok && v != "" {
		var middleware proj.MiddlewareConfig
		if err := json.Unmarshal([]byte(v), &middleware); err != nil {
			return nil, fmt.Errorf("middleware_json: %w", err)
		}
		cfg.Middleware = middleware
		s.proxy.SetMiddleware(cfg.Middleware)
	}
	if v, ok := args["flows_json"].(string); ok && v != "" {
		var flows []proj.Flow
		if err := json.Unmarshal([]byte(v), &flows); err != nil {
			return nil, fmt.Errorf("flows_json: %w", err)
		}
		cfg.Flows = flows
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

	return jsonResult(s.projectResult(mgr))
}

func (s *Server) toolGetMatchReplace(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	return jsonResult(mgr.Config().MatchReplace)
}

func (s *Server) toolUpdateMatchReplace(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	rulesJSON, ok := req.Params.Arguments["rules_json"].(string)
	if !ok || rulesJSON == "" {
		return nil, fmt.Errorf("rules_json required")
	}
	var rules []proj.MatchReplaceRule
	if err := json.Unmarshal([]byte(rulesJSON), &rules); err != nil {
		return nil, fmt.Errorf("rules_json: %w", err)
	}
	cfg := mgr.Config()
	cfg.MatchReplace = rules
	if err := mgr.Save(cfg); err != nil {
		return nil, err
	}
	s.proxy.SetMatchReplace(cfg.MatchReplace)
	s.publishProjectUpdated()
	return jsonResult(cfg.MatchReplace)
}

func (s *Server) toolGetMiddleware(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	return jsonResult(mgr.Config().Middleware)
}

func (s *Server) toolUpdateMiddleware(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	configJSON, ok := req.Params.Arguments["config_json"].(string)
	if !ok || configJSON == "" {
		return nil, fmt.Errorf("config_json required")
	}
	var cfgValue proj.MiddlewareConfig
	if err := json.Unmarshal([]byte(configJSON), &cfgValue); err != nil {
		return nil, fmt.Errorf("config_json: %w", err)
	}
	cfg := mgr.Config()
	cfg.Middleware = cfgValue
	if err := mgr.Save(cfg); err != nil {
		return nil, err
	}
	s.proxy.SetMiddleware(cfg.Middleware)
	s.publishProjectUpdated()
	return jsonResult(cfg.Middleware)
}

func (s *Server) toolListFlows(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	return jsonResult(mgr.Config().Flows)
}

func (s *Server) toolGetFlow(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	flowID, ok := req.Params.Arguments["flow_id"].(string)
	if !ok || flowID == "" {
		return nil, fmt.Errorf("flow_id required")
	}
	for _, flow := range mgr.Config().Flows {
		if flow.ID == flowID {
			return jsonResult(flow)
		}
	}
	return nil, fmt.Errorf("flow not found")
}

func (s *Server) toolSaveFlow(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	flowJSON, ok := req.Params.Arguments["flow_json"].(string)
	if !ok || flowJSON == "" {
		return nil, fmt.Errorf("flow_json required")
	}
	var flow proj.Flow
	if err := json.Unmarshal([]byte(flowJSON), &flow); err != nil {
		return nil, fmt.Errorf("flow_json: %w", err)
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
	return jsonResult(flow)
}

func (s *Server) toolDeleteFlow(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	flowID, ok := req.Params.Arguments["flow_id"].(string)
	if !ok || flowID == "" {
		return nil, fmt.Errorf("flow_id required")
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
		return nil, fmt.Errorf("flow not found")
	}
	cfg.Flows = next
	if err := mgr.Save(cfg); err != nil {
		return nil, err
	}
	s.publishProjectUpdated()
	return jsonResult(map[string]interface{}{"success": true})
}

func (s *Server) toolRunFlow(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	flowID, ok := req.Params.Arguments["flow_id"].(string)
	if !ok || flowID == "" {
		return nil, fmt.Errorf("flow_id required")
	}
	var seedVars map[string]string
	if raw, ok := req.Params.Arguments["variables_json"].(string); ok && raw != "" {
		if err := json.Unmarshal([]byte(raw), &seedVars); err != nil {
			return nil, fmt.Errorf("variables_json: %w", err)
		}
	}
	result, err := s.runFlowByID(ctx, flowID, seedVars)
	if err != nil {
		return nil, err
	}
	return jsonResult(result)
}

func (s *Server) toolGetSitemap(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	args := req.Params.Arguments
	filter := storage.RequestFilter{Limit: 50000}
	if v, ok := args["host"].(string); ok {
		filter.Host = v
	}
	if v, ok := args["method"].(string); ok {
		filter.Method = v
	}
	if v, ok := args["search"].(string); ok {
		filter.Search = v
	}
	if v, ok := args["status_min"].(float64); ok {
		filter.StatusMin = int(v)
	}
	if v, ok := args["status_max"].(float64); ok {
		filter.StatusMax = int(v)
	}
	requests, _, err := s.getDB().ListRequests(filter)
	if err != nil {
		return nil, err
	}
	if v, ok := args["in_scope_only"].(bool); ok && v {
		mgr := s.getProject()
		if mgr != nil {
			requests = filterInScopeRequests(requests, mgr.Config().Scope)
		}
	}
	tree := buildSitemapTree(requests)
	return jsonResult(map[string]interface{}{
		"tree":               tree,
		"request_count":      len(requests),
		"host_count":         len(tree),
		"route_count":        countUniqueRoutes(requests),
		"responded_requests": countResponses(requests),
	})
}

func (s *Server) projectResult(mgr *proj.Manager) map[string]interface{} {
	cfg := mgr.Config()
	return map[string]interface{}{
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

func (s *Server) toolListRecentProjects(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	appCfg := s.getAppCfg()
	type entry struct {
		Path   string `json:"path"`
		Name   string `json:"name"`
		Exists bool   `json:"exists"`
	}
	var result []entry
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
	if result == nil {
		result = []entry{}
	}
	return jsonResult(result)
}

func (s *Server) toolOpenProject(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	path, ok := req.Params.Arguments["path"].(string)
	if !ok || path == "" {
		return nil, fmt.Errorf("path required")
	}

	var mgr *proj.Manager
	var err error
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
	return jsonResult(map[string]interface{}{
		"name":    cfg.Name,
		"path":    mgr.Path(),
		"is_temp": mgr.IsTemp(),
	})
}

func (s *Server) toolNewProject(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	args := req.Params.Arguments
	path, ok := args["path"].(string)
	if !ok || path == "" {
		return nil, fmt.Errorf("path required")
	}
	name := "New Project"
	if v, ok := args["name"].(string); ok && v != "" {
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
	return jsonResult(map[string]interface{}{
		"name":    cfg.Name,
		"path":    mgr.Path(),
		"is_temp": mgr.IsTemp(),
	})
}

func jsonResult(v interface{}) (*mcp.CallToolResult, error) {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, err
	}
	return mcp.NewToolResultText(string(b)), nil
}
