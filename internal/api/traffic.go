package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/hamedsj5/pandorabox/internal/storage"
)

func (s *Server) listRequests(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	statusMin, _ := strconv.Atoi(q.Get("status_min"))
	statusMax, _ := strconv.Atoi(q.Get("status_max"))

	filter := storage.RequestFilter{
		Host:      q.Get("host"),
		Method:    q.Get("method"),
		Search:    q.Get("search"),
		StatusMin: statusMin,
		StatusMax: statusMax,
		Limit:     limit,
		Offset:    offset,
	}

	requests, total, err := s.getDB().ListRequests(filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"requests": requests,
		"total":    total,
	})
}

func (s *Server) getRequest(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	req, err := s.getDB().GetRequest(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if req == nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	writeJSON(w, http.StatusOK, req)
}

func (s *Server) deleteRequest(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	if err := s.getDB().DeleteRequest(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}
