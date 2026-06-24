// SPDX-License-Identifier: Apache-2.0
// Package api — intruder.go: REST surface for marker-driven fuzzing jobs,
// backed by internal/intruder.Manager. Jobs started here are visible to the
// UI in real time over the same event bus the legacy MCP server's own
// intruder tools also publish to.
package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

// POST /api/intruder/start
//
// Body: {request_id, raw_text | raw_b64, attack_type, payloads, concurrency}
// raw_text/raw_b64 must contain §marker§-delimited injection points.
func (s *Server) startIntruderJob(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RequestID   int64      `json:"request_id"`
		RawText     string     `json:"raw_text"`
		RawB64      string     `json:"raw_b64"`
		AttackType  string     `json:"attack_type"`
		Payloads    [][]string `json:"payloads"`
		Concurrency int        `json:"concurrency"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.RequestID == 0 {
		writeError(w, http.StatusBadRequest, "request_id is required")
		return
	}

	template := body.RawText
	if template == "" && body.RawB64 != "" {
		dec, err := base64.StdEncoding.DecodeString(body.RawB64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "raw_b64: invalid base64")
			return
		}
		template = string(dec)
	}
	if template == "" {
		writeError(w, http.StatusBadRequest, "raw_text or raw_b64 is required")
		return
	}
	if len(body.Payloads) == 0 {
		writeError(w, http.StatusBadRequest, "payloads (array of arrays) is required")
		return
	}

	job, err := s.intruderMgr.Start(body.RequestID, template, body.AttackType, body.Payloads, body.Concurrency)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"job_id": job.ID, "total": job.Total, "status": job.Status})
}

// GET /api/intruder/{id}/status
func (s *Server) getIntruderStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	status, ok := s.intruderMgr.Status(id)
	if !ok {
		writeError(w, http.StatusNotFound, "job not found (expired or cancelled)")
		return
	}
	writeJSON(w, http.StatusOK, status)
}

// GET /api/intruder/{id}/results?after_index=N&limit=500
func (s *Server) getIntruderResults(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	q := r.URL.Query()
	afterIndex, _ := strconv.Atoi(q.Get("after_index"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	page, ok := s.intruderMgr.Results(id, afterIndex, limit)
	if !ok {
		writeError(w, http.StatusNotFound, "job not found (expired or cancelled)")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// POST /api/intruder/{id}/cancel
func (s *Server) cancelIntruderJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.intruderMgr.Cancel(id) {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"job_id": id, "cancelled": true})
}
