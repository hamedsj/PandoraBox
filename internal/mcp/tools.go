package mcp

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hamedsj5/pitokmonitor/internal/proxy"
	"github.com/hamedsj5/pitokmonitor/internal/storage"
	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerTools() {
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

	// replay_request
	s.mcp.AddTool(mcp.NewTool("replay_request",
		mcp.WithDescription("Replay a captured request with optional modifications"),
		mcp.WithNumber("request_id", mcp.Description("Request ID to replay"), mcp.Required()),
		mcp.WithString("modified_url", mcp.Description("Override URL")),
		mcp.WithString("modified_body", mcp.Description("Override body (string)")),
	), s.toolReplayRequest)

	// send_request
	s.mcp.AddTool(mcp.NewTool("send_request",
		mcp.WithDescription("Send a new HTTP request through the proxy"),
		mcp.WithString("method", mcp.Description("HTTP method"), mcp.Required()),
		mcp.WithString("url", mcp.Description("Target URL"), mcp.Required()),
		mcp.WithString("body", mcp.Description("Request body")),
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
}

func (s *Server) toolProxyStatus(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
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
	return jsonResult(map[string]interface{}{
		"success": s.proxy.IsRunning(),
		"port":    s.cfg.ProxyPort,
	})
}

func (s *Server) toolProxyStop(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	s.proxy.Stop()
	return jsonResult(map[string]interface{}{"success": true})
}

func (s *Server) toolListRequests(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
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

func (s *Server) toolReplayRequest(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
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

	replay, err := s.proxy.ReplayRequest(int64(id), nil, modBody, modURL)
	if err != nil {
		return nil, err
	}

	return jsonResult(replay)
}

func (s *Server) toolSendRequest(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.Params.Arguments
	method, _ := args["method"].(string)
	url, _ := args["url"].(string)
	bodyStr, _ := args["body"].(string)

	captured, err := s.proxy.SendRequest(method, url, nil, []byte(bodyStr))
	if err != nil {
		return nil, err
	}

	return jsonResult(captured)
}

func (s *Server) toolInterceptToggle(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	enabled, _ := req.Params.Arguments["enabled"].(bool)
	s.intercept.SetEnabled(enabled)
	return jsonResult(map[string]interface{}{"enabled": enabled})
}

func (s *Server) toolInterceptForward(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, ok := req.Params.Arguments["request_id"].(float64)
	if !ok {
		return nil, fmt.Errorf("request_id required")
	}

	resolved := s.intercept.Resolve(int64(id), proxy.InterceptDecision{Forward: true})
	return jsonResult(map[string]interface{}{"success": resolved})
}

func (s *Server) toolInterceptDrop(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, ok := req.Params.Arguments["request_id"].(float64)
	if !ok {
		return nil, fmt.Errorf("request_id required")
	}

	resolved := s.intercept.Resolve(int64(id), proxy.InterceptDecision{Drop: true})
	return jsonResult(map[string]interface{}{"success": resolved})
}

func (s *Server) toolGetCACert(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
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

func jsonResult(v interface{}) (*mcp.CallToolResult, error) {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, err
	}
	return mcp.NewToolResultText(string(b)), nil
}

