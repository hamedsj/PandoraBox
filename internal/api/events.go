package api

import "github.com/hamedsj5/pandorabox/internal/events"

func (s *Server) projectEventData() map[string]interface{} {
	s.projectMu.RLock()
	mgr := s.project
	s.projectMu.RUnlock()
	if mgr == nil {
		return nil
	}
	cfg := mgr.Config()
	return map[string]interface{}{
		"name":          cfg.Name,
		"path":          mgr.Path(),
		"is_temp":       mgr.IsTemp(),
		"proxy":         cfg.Proxy,
		"filters":       cfg.Filters,
		"scope":         cfg.Scope,
		"mcp_disabled":  cfg.MCPDisabled,
		"mcp_port":      cfg.MCPPort,
		"mcp_status":    s.getMCPStatusSnapshot(),
		"match_replace": cfg.MatchReplace,
		"middleware":    cfg.Middleware,
		"flows":         cfg.Flows,
	}
}

func (s *Server) publishProjectUpdated() {
	data := s.projectEventData()
	if data == nil {
		return
	}
	s.bus.Publish(events.Event{
		Type: events.EventProjectUpdated,
		Data: data,
	})
}

func (s *Server) publishProxyStatus() {
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
	s.bus.Publish(events.Event{
		Type: events.EventRequestDeleted,
		Data: map[string]interface{}{"id": id},
	})
}
