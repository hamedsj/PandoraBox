// SPDX-License-Identifier: Apache-2.0
package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/hamedsj5/pandorabox/internal/events"
)

func (s *Server) createReplay(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RequestID       int64             `json:"request_id"`
		ModifiedHeaders map[string]string `json:"modified_headers"`
		ModifiedBody    []byte            `json:"modified_body"`
		ModifiedURL     string            `json:"modified_url"`
		Raw             string            `json:"raw"`
		Scheme          string            `json:"scheme"` // optional "http"/"https" override
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var (
		rawBytes []byte
		err      error
	)
	if body.Raw != "" {
		rawBytes, err = base64.StdEncoding.DecodeString(body.Raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid base64")
			return
		}
	}

	replay, err := s.proxy.ReplayRequest(body.RequestID, body.ModifiedHeaders, body.ModifiedBody, body.ModifiedURL, rawBytes, body.Scheme)
	if err != nil {
		// A failed replay still returns a result object (status=error) so the UI
		// can show the transport error; only signal 500 when there is no replay.
		if replay == nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	s.bus.Publish(events.Event{Type: events.EventReplayCreated, Data: replay})
	writeJSON(w, http.StatusOK, replay)
}

// queueReplay handles POST /api/replay/queue — adds a request to every
// connected browser's repeater queue without sending it. The browser handles
// dedup (re-adding an existing request just bumps attention).
func (s *Server) queueReplay(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RequestID int64 `json:"request_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RequestID == 0 {
		writeError(w, http.StatusBadRequest, "request_id required")
		return
	}
	req, err := s.getDB().GetRequest(body.RequestID)
	if err != nil || req == nil {
		writeError(w, http.StatusNotFound, "request not found")
		return
	}
	s.bus.Publish(events.Event{Type: events.EventReplayQueued, Data: req})
	writeJSON(w, http.StatusOK, map[string]interface{}{"queued": true, "request_id": body.RequestID})
}

func (s *Server) getReplay(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	replay, err := s.getDB().GetReplay(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if replay == nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	writeJSON(w, http.StatusOK, replay)
}

func (s *Server) listReplays(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))

	replays, total, err := s.getDB().ListReplays(limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"replays": replays,
		"total":   total,
	})
}
