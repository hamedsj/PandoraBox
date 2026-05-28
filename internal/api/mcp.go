// SPDX-License-Identifier: Apache-2.0
package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

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

func (s *Server) listCodeTools(w http.ResponseWriter, r *http.Request) {
	if s.mcpServer == nil {
		writeError(w, http.StatusServiceUnavailable, "MCP server not configured")
		return
	}
	result, err := s.mcpServer.ListTools(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) callCodeTool(w http.ResponseWriter, r *http.Request) {
	if s.mcpServer == nil {
		writeError(w, http.StatusServiceUnavailable, "MCP server not configured")
		return
	}
	name := chi.URLParam(r, "name")
	if name == "" {
		writeError(w, http.StatusBadRequest, "tool name required")
		return
	}

	var body struct {
		Arguments map[string]interface{} `json:"arguments"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	result, err := s.mcpServer.CallTool(r.Context(), name, body.Arguments)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}
