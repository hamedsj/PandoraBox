package api

import (
	"encoding/json"
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
	s.publishRequestDeleted(id)
	s.publishProxyStatus()

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

func (s *Server) updateRequestTags(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var body struct {
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	tagsJSON, err := json.Marshal(body.Tags)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.getDB().UpdateRequestTags(id, string(tagsJSON)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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

	s.publishRequestUpdated(req)
	writeJSON(w, http.StatusOK, req)
}

func (s *Server) deleteRequestsBulk(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if len(body.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids required")
		return
	}

	if err := s.getDB().DeleteRequests(body.IDs); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, id := range body.IDs {
		s.publishRequestDeleted(id)
	}
	s.publishProxyStatus()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":     true,
		"deleted_ids": body.IDs,
	})
}

func (s *Server) clearRequests(w http.ResponseWriter, r *http.Request) {
	if err := s.getDB().ClearRequests(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.publishRequestsCleared()
	s.publishProxyStatus()

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}
