package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

func (s *Server) getWebSocketFrames(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	db := s.getDB()
	session, err := db.GetWebSocketSession(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if session == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"session": nil, "frames": []any{}})
		return
	}

	frames, err := db.ListWebSocketFrames(session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"session": session, "frames": frames})
}
