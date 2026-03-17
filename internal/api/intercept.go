package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/hamedsj5/pandorabox/internal/proxy"
)

func (s *Server) getInterceptFilter(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.intercept.GetFilter())
}

func (s *Server) setInterceptFilter(w http.ResponseWriter, r *http.Request) {
	var f proxy.InterceptFilter
	if err := json.NewDecoder(r.Body).Decode(&f); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.intercept.SetFilter(f)
	writeJSON(w, http.StatusOK, f)
}

func (s *Server) interceptForwardAll(w http.ResponseWriter, r *http.Request) {
	ids := s.intercept.ListPending()
	count := 0
	for _, id := range ids {
		if s.intercept.Resolve(id, proxy.InterceptDecision{Forward: true}) {
			count++
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"forwarded": count})
}

func (s *Server) interceptQueue(w http.ResponseWriter, r *http.Request) {
	ids := s.intercept.ListPending()
	requests := make([]interface{}, 0, len(ids))
	for _, id := range ids {
		req, err := s.getDB().GetRequest(id)
		if err == nil && req != nil {
			requests = append(requests, req)
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"queue": requests})
}

func (s *Server) interceptToggle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.intercept.SetEnabled(body.Enabled)
	writeJSON(w, http.StatusOK, map[string]interface{}{"enabled": body.Enabled})
}

func (s *Server) interceptForward(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	ok := s.intercept.Resolve(id, proxy.InterceptDecision{Forward: true})
	if !ok {
		writeError(w, http.StatusNotFound, "request not in queue")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

func (s *Server) interceptDrop(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	ok := s.intercept.Resolve(id, proxy.InterceptDecision{Drop: true})
	if !ok {
		writeError(w, http.StatusNotFound, "request not in queue")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

func (s *Server) interceptModify(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var body struct {
		Raw string `json:"raw"` // base64-encoded modified HTTP request
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	rawBytes, err := base64.StdEncoding.DecodeString(body.Raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid base64")
		return
	}

	ok := s.intercept.Resolve(id, proxy.InterceptDecision{Forward: true, ModifiedRaw: rawBytes})
	if !ok {
		writeError(w, http.StatusNotFound, "request not in queue")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}
