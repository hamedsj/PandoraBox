// SPDX-License-Identifier: Apache-2.0
// Package api — collaborator.go: REST surface for server-side (MCP-started)
// Collaborator sessions. The UI uses these to render sessions an agent created
// on the same instance, alongside the browser-managed (purely-local) sessions
// the Collaborator page has always supported.
package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// GET /api/collaborator/sessions
//
// Returns every active server-side Collaborator session: session_id, server,
// correlation_id, the test URL, the start time, and how many interactions have
// arrived so far. Empty list (not 404) when nothing is active.
func (s *Server) listCollaboratorSessions(w http.ResponseWriter, r *http.Request) {
	if s.mcpServer == nil {
		writeJSON(w, http.StatusOK, map[string]any{"sessions": []any{}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": s.mcpServer.ListCollaboratorSessions()})
}

// GET /api/collaborator/sessions/{id}/interactions
//
// Returns the accumulated interactions (DNS / HTTP / SMTP / ...) the
// background poller has collected for one session.
func (s *Server) getCollaboratorSessionInteractions(w http.ResponseWriter, r *http.Request) {
	if s.mcpServer == nil {
		writeError(w, http.StatusServiceUnavailable, "MCP server not attached")
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing session id")
		return
	}
	interactions, ok := s.mcpServer.GetCollaboratorSessionInteractions(id)
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	if interactions == nil {
		interactions = []any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"session_id":   id,
		"interactions": interactions,
		"count":        len(interactions),
	})
}
