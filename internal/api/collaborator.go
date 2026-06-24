// SPDX-License-Identifier: Apache-2.0
// Package api — collaborator.go: REST surface for out-of-band (interactsh)
// Collaborator sessions, backed by internal/collaborator.Manager. Sessions
// started here are visible to the UI in real time over the same event bus,
// whether they were started from the browser, the CLI, or (independently)
// the legacy MCP server's own collaborator tools.
package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// GET /api/collaborator/sessions
//
// Returns every active Collaborator session: session_id, server,
// correlation_id, the test URL, the start time, and how many interactions have
// arrived so far. Empty list (not 404) when nothing is active.
func (s *Server) listCollaboratorSessions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"sessions": s.collaboratorMgr.List()})
}

// GET /api/collaborator/sessions/{id}/interactions
//
// Returns the accumulated interactions (DNS / HTTP / SMTP / ...) the
// background poller has collected for one session.
func (s *Server) getCollaboratorSessionInteractions(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing session id")
		return
	}
	interactions, ok := s.collaboratorMgr.Interactions(id)
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"session_id":   id,
		"interactions": interactions,
		"count":        len(interactions),
	})
}

// POST /api/collaborator/sessions
//
// Starts a new Collaborator session. Body: {"server": "oast.pro"} (optional).
func (s *Server) startCollaboratorSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Server string `json:"server"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	info, err := s.collaboratorMgr.Start(body.Server)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

// POST /api/collaborator/sessions/{id}/poll
func (s *Server) pollCollaboratorSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	interactions, err := s.collaboratorMgr.Poll(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"interactions": interactions, "count": len(interactions)})
}

// POST /api/collaborator/sessions/{id}/stop
func (s *Server) stopCollaboratorSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.collaboratorMgr.Stop(id) {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "reason": "session_not_found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// POST /api/collaborator/sessions/{id}/url
//
// Generates another unique test URL for an existing session (same
// correlation id, new random nonce) so each injection point is distinguishable.
func (s *Server) generateCollaboratorURL(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	url, err := s.collaboratorMgr.GenerateURL(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": url})
}
