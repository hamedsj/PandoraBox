package api

import "net/http"

func (s *Server) getMCPStatus(w http.ResponseWriter, r *http.Request) {
	if s.mcpServer == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"running":             false,
			"access_enabled":      false,
			"port":                0,
			"transport":           "",
			"endpoint":            "",
			"legacy_sse_endpoint": "",
			"last_error":          "MCP server not configured",
		})
		return
	}
	writeJSON(w, http.StatusOK, s.mcpServer.Status())
}
