package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

func (s *Server) createReplay(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RequestID       int64             `json:"request_id"`
		ModifiedHeaders map[string]string `json:"modified_headers"`
		ModifiedBody    []byte            `json:"modified_body"`
		ModifiedURL     string            `json:"modified_url"`
		Raw             string            `json:"raw"`
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

	replay, err := s.proxy.ReplayRequest(body.RequestID, body.ModifiedHeaders, body.ModifiedBody, body.ModifiedURL, rawBytes)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, replay)
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
