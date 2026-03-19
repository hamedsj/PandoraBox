package mcp

import "github.com/hamedsj5/pandorabox/internal/events"

func (s *Server) publishProjectUpdated() {
	if s.bus == nil {
		return
	}
	mgr := s.getProject()
	if mgr == nil {
		return
	}
	s.bus.Publish(events.Event{
		Type: events.EventProjectUpdated,
		Data: s.projectResult(mgr),
	})
}

func (s *Server) publishProxyStatus() {
	if s.bus == nil {
		return
	}
	count, _ := s.getDB().CountRequests()
	s.bus.Publish(events.Event{
		Type: events.EventProxyStatus,
		Data: map[string]interface{}{
			"running":           s.proxy.IsRunning(),
			"port":              s.cfg.ProxyPort,
			"intercept_enabled": s.intercept.IsEnabled(),
			"request_count":     count,
			"queue_length":      s.intercept.QueueLength(),
		},
	})
}

func (s *Server) publishRequestDeleted(id int64) {
	if s.bus == nil {
		return
	}
	s.bus.Publish(events.Event{
		Type: events.EventRequestDeleted,
		Data: map[string]interface{}{"id": id},
	})
}
