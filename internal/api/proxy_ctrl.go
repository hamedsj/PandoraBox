package api

import (
	"encoding/json"
	"net/http"

	"github.com/hamedsj5/pandorabox/internal/events"
)

func (s *Server) proxyStart(w http.ResponseWriter, r *http.Request) {
	// The proxy is already running (started in main.go)
	// This endpoint can be used to report status
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"port":    s.cfg.ProxyPort,
	})
}

func (s *Server) proxyStop(w http.ResponseWriter, r *http.Request) {
	s.proxy.Stop()
	s.bus.Publish(events.Event{
		Type: events.EventProxyStatus,
		Data: map[string]interface{}{"running": false},
	})
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

func (s *Server) proxyStatus(w http.ResponseWriter, r *http.Request) {
	count, _ := s.getDB().CountRequests()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"running":           s.proxy.IsRunning(),
		"port":              s.cfg.ProxyPort,
		"intercept_enabled": s.intercept.IsEnabled(),
		"request_count":     count,
		"queue_length":      s.intercept.QueueLength(),
	})
}

func (s *Server) proxyConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Port             *int  `json:"port"`
		InterceptEnabled *bool `json:"intercept_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.InterceptEnabled != nil {
		s.intercept.SetEnabled(*body.InterceptEnabled)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

func (s *Server) getCACert(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/x-pem-file")
	w.Header().Set("Content-Disposition", `attachment; filename="pandorabox-ca.crt"`)
	w.Write(s.ca.CertBytes())
}
