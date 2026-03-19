package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"github.com/hamedsj5/pandorabox/internal/events"
	mcpsrv "github.com/hamedsj5/pandorabox/internal/mcp"
	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/hamedsj5/pandorabox/internal/storage"
)

type projectInfoResponse struct {
	Name         string                  `json:"name"`
	Path         string                  `json:"path"`
	IsTemp       bool                    `json:"is_temp"`
	Proxy        proj.ProxyConfig        `json:"proxy"`
	Filters      proj.FilterConfig       `json:"filters"`
	Scope        proj.ScopeConfig        `json:"scope"`
	MCPDisabled  bool                    `json:"mcp_disabled"`
	MCPPort      int                     `json:"mcp_port,omitempty"`
	MCPStatus    mcpsrv.Status           `json:"mcp_status"`
	MatchReplace []proj.MatchReplaceRule `json:"match_replace"`
	Middleware   proj.MiddlewareConfig   `json:"middleware"`
	Flows        []proj.Flow             `json:"flows"`
}

func (s *Server) getMCPStatusSnapshot() mcpsrv.Status {
	if s.mcpServer == nil {
		return mcpsrv.Status{}
	}
	return s.mcpServer.Status()
}

func (s *Server) getProject(w http.ResponseWriter, r *http.Request) {
	s.projectMu.RLock()
	mgr := s.project
	s.projectMu.RUnlock()

	if mgr == nil {
		writeError(w, http.StatusServiceUnavailable, "no project loaded")
		return
	}

	cfg := mgr.Config()
	writeJSON(w, http.StatusOK, projectInfoResponse{
		Name:         cfg.Name,
		Path:         mgr.Path(),
		IsTemp:       mgr.IsTemp(),
		Proxy:        cfg.Proxy,
		Filters:      cfg.Filters,
		Scope:        cfg.Scope,
		MCPDisabled:  cfg.MCPDisabled,
		MCPPort:      cfg.MCPPort,
		MCPStatus:    s.getMCPStatusSnapshot(),
		MatchReplace: cfg.MatchReplace,
		Middleware:   cfg.Middleware,
		Flows:        cfg.Flows,
	})
}

func (s *Server) updateProject(w http.ResponseWriter, r *http.Request) {
	s.projectMu.RLock()
	mgr := s.project
	s.projectMu.RUnlock()

	if mgr == nil {
		writeError(w, http.StatusServiceUnavailable, "no project loaded")
		return
	}

	var body struct {
		Name         *string                  `json:"name"`
		Proxy        *proj.ProxyConfig        `json:"proxy"`
		Filters      *proj.FilterConfig       `json:"filters"`
		Scope        *proj.ScopeConfig        `json:"scope"`
		MCPDisabled  *bool                    `json:"mcp_disabled"`
		MCPPort      *int                     `json:"mcp_port"`
		MatchReplace *[]proj.MatchReplaceRule `json:"match_replace"`
		Middleware   *proj.MiddlewareConfig   `json:"middleware"`
		Flows        *[]proj.Flow             `json:"flows"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	cfg := mgr.Config()
	oldProxyPort := cfg.Proxy.Port
	oldMCPPort := cfg.MCPPort

	if body.Name != nil {
		cfg.Name = *body.Name
	}
	if body.Proxy != nil {
		cfg.Proxy = *body.Proxy
		s.proxy.ApplyConfig(cfg.Proxy.Port, cfg.Proxy.InterceptEnabled, cfg.Proxy.UpstreamURL)
	}
	if body.Filters != nil {
		cfg.Filters = *body.Filters
	}
	if body.Scope != nil {
		cfg.Scope = *body.Scope
		s.proxy.SetScope(cfg.Scope)
	}
	if body.MCPDisabled != nil {
		cfg.MCPDisabled = *body.MCPDisabled
	}
	if body.MCPPort != nil {
		cfg.MCPPort = *body.MCPPort
	}
	if body.MatchReplace != nil {
		cfg.MatchReplace = *body.MatchReplace
		s.proxy.SetMatchReplace(cfg.MatchReplace)
	}
	if body.Middleware != nil {
		cfg.Middleware = *body.Middleware
		s.proxy.SetMiddleware(cfg.Middleware)
	}
	if body.Flows != nil {
		cfg.Flows = *body.Flows
	}

	if err := mgr.Save(cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Hot-reload proxy port if changed
	if body.Proxy != nil && cfg.Proxy.Port != oldProxyPort && cfg.Proxy.Port > 0 {
		if err := s.proxy.ChangePort(cfg.Proxy.Port); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "proxy port in use: " + err.Error()})
			return
		}
	}

	// Hot-reload MCP port if changed
	if body.MCPPort != nil && cfg.MCPPort != oldMCPPort && cfg.MCPPort > 0 {
		ctx := s.ctx
		if ctx == nil {
			ctx = r.Context()
		}
		if s.mcpServer != nil {
			if err := s.mcpServer.ChangePort(ctx, cfg.MCPPort); err != nil {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "mcp port in use: " + err.Error()})
				return
			}
		}
	}
	s.publishProjectUpdated()
	if body.Proxy != nil {
		s.publishProxyStatus()
	}

	writeJSON(w, http.StatusOK, projectInfoResponse{
		Name:         cfg.Name,
		Path:         mgr.Path(),
		IsTemp:       mgr.IsTemp(),
		Proxy:        cfg.Proxy,
		Filters:      cfg.Filters,
		Scope:        cfg.Scope,
		MCPDisabled:  cfg.MCPDisabled,
		MCPPort:      cfg.MCPPort,
		MCPStatus:    s.getMCPStatusSnapshot(),
		MatchReplace: cfg.MatchReplace,
		Middleware:   cfg.Middleware,
		Flows:        cfg.Flows,
	})
}

func (s *Server) projectSaveAs(w http.ResponseWriter, r *http.Request) {
	s.projectMu.RLock()
	mgr := s.project
	appCfg := s.appCfg
	s.projectMu.RUnlock()

	if mgr == nil {
		writeError(w, http.StatusServiceUnavailable, "no project loaded")
		return
	}

	var body struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.Path == "" {
		writeError(w, http.StatusBadRequest, "path required")
		return
	}

	if db := s.getDB(); db != nil {
		if err := db.Checkpoint(); err != nil {
			writeError(w, http.StatusInternalServerError, "checkpoint db: "+err.Error())
			return
		}
	}

	if err := mgr.SaveAs(body.Path); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Open the new project and switch to it
	name := body.Name
	if name == "" {
		name = mgr.Config().Name
	}
	// Update the name in the saved project
	newMgr, err := proj.OpenProject(body.Path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if name != "" {
		cfg := newMgr.Config()
		cfg.Name = name
		newMgr.Save(cfg)
	}

	s.switchProject(newMgr, appCfg, w, r)
}

func (s *Server) getRecentProjects(w http.ResponseWriter, r *http.Request) {
	s.projectMu.RLock()
	appCfg := s.appCfg
	s.projectMu.RUnlock()

	type recentEntry struct {
		Path   string `json:"path"`
		Name   string `json:"name"`
		Exists bool   `json:"exists"`
	}

	var result []recentEntry
	if appCfg != nil {
		for _, p := range appCfg.RecentProjects {
			entry := recentEntry{Path: p, Exists: true}
			if m, err := proj.OpenProject(p); err == nil {
				entry.Name = m.Config().Name
			} else {
				if _, statErr := os.Stat(p); os.IsNotExist(statErr) {
					entry.Exists = false
				}
				entry.Name = p
			}
			result = append(result, entry)
		}
	}
	if result == nil {
		result = []recentEntry{}
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) openProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.Path == "" {
		writeError(w, http.StatusBadRequest, "path required")
		return
	}

	var mgr *proj.Manager
	var err error
	if proj.IsTempPath(body.Path) {
		mgr, err = proj.TempProject()
	} else {
		mgr, err = proj.OpenProject(body.Path)
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	s.projectMu.RLock()
	appCfg := s.appCfg
	s.projectMu.RUnlock()

	s.switchProject(mgr, appCfg, w, r)
}

func (s *Server) newProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.Path == "" {
		writeError(w, http.StatusBadRequest, "path required")
		return
	}
	name := body.Name
	if name == "" {
		name = "New Project"
	}

	mgr, err := proj.CreateProject(body.Path, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.projectMu.RLock()
	appCfg := s.appCfg
	s.projectMu.RUnlock()

	s.switchProject(mgr, appCfg, w, r)
}

// SwitchProject performs a full project switch: opens the new DB, swaps it on all
// components, updates the project manager, applies proxy config, and broadcasts
// the project.switched event. Called by HTTP handlers and the MCP server callback.
func (s *Server) SwitchProject(newMgr *proj.Manager) error {
	newDB, err := storage.Open(newMgr.DBPath())
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}

	// Swap DB on all components
	oldDB := s.getDB()
	s.setDB(newDB)
	s.proxy.SetDB(newDB)
	if s.mcpServer != nil {
		s.mcpServer.SetDB(newDB)
	}

	// Close old DB
	if oldDB != nil {
		oldDB.Close()
	}

	// Update project manager
	s.projectMu.Lock()
	s.project = newMgr
	appCfg := s.appCfg
	s.projectMu.Unlock()

	// Notify MCP server of new project
	if s.mcpServer != nil {
		s.mcpServer.SetProject(newMgr, appCfg)
	}

	// Apply proxy config from new project
	cfg := newMgr.Config()
	s.proxy.ApplyConfig(cfg.Proxy.Port, cfg.Proxy.InterceptEnabled, cfg.Proxy.UpstreamURL)
	s.proxy.SetScope(cfg.Scope)
	s.proxy.SetMatchReplace(cfg.MatchReplace)
	s.proxy.SetMiddleware(cfg.Middleware)

	// Update recent projects
	if appCfg != nil {
		appCfg.AddRecent(newMgr.Path())
		appCfg.Save()
	}

	// Broadcast project switched event
	s.bus.Publish(events.Event{
		Type: events.EventProjectSwitched,
		Data: map[string]interface{}{
			"name":    cfg.Name,
			"path":    newMgr.Path(),
			"is_temp": newMgr.IsTemp(),
		},
	})

	return nil
}

// switchProject is the HTTP-layer wrapper around SwitchProject.
func (s *Server) switchProject(newMgr *proj.Manager, appCfg *proj.AppConfig, w http.ResponseWriter, r *http.Request) {
	if err := s.SwitchProject(newMgr); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	cfg := newMgr.Config()
	writeJSON(w, http.StatusOK, projectInfoResponse{
		Name:         cfg.Name,
		Path:         newMgr.Path(),
		IsTemp:       newMgr.IsTemp(),
		Proxy:        cfg.Proxy,
		Filters:      cfg.Filters,
		Scope:        cfg.Scope,
		MCPDisabled:  cfg.MCPDisabled,
		MCPPort:      cfg.MCPPort,
		MCPStatus:    s.getMCPStatusSnapshot(),
		MatchReplace: cfg.MatchReplace,
		Middleware:   cfg.Middleware,
		Flows:        cfg.Flows,
	})
}
