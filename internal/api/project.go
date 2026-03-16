package api

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/hamedsj5/pitokmonitor/internal/events"
	proj "github.com/hamedsj5/pitokmonitor/internal/project"
	"github.com/hamedsj5/pitokmonitor/internal/storage"
)

type projectInfoResponse struct {
	Name    string           `json:"name"`
	Path    string           `json:"path"`
	IsTemp  bool             `json:"is_temp"`
	Proxy   proj.ProxyConfig  `json:"proxy"`
	Filters proj.FilterConfig `json:"filters"`
	Scope   proj.ScopeConfig  `json:"scope"`
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
		Name:    cfg.Name,
		Path:    mgr.Path(),
		IsTemp:  mgr.IsTemp(),
		Proxy:   cfg.Proxy,
		Filters: cfg.Filters,
		Scope:   cfg.Scope,
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
		Name    *string             `json:"name"`
		Proxy   *proj.ProxyConfig   `json:"proxy"`
		Filters *proj.FilterConfig  `json:"filters"`
		Scope   *proj.ScopeConfig   `json:"scope"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	cfg := mgr.Config()
	if body.Name != nil {
		cfg.Name = *body.Name
	}
	if body.Proxy != nil {
		cfg.Proxy = *body.Proxy
		s.proxy.ApplyConfig(cfg.Proxy.Port, cfg.Proxy.InterceptEnabled)
	}
	if body.Filters != nil {
		cfg.Filters = *body.Filters
	}
	if body.Scope != nil {
		cfg.Scope = *body.Scope
		s.proxy.SetScope(cfg.Scope)
	}

	if err := mgr.Save(cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, projectInfoResponse{
		Name:    cfg.Name,
		Path:    mgr.Path(),
		IsTemp:  mgr.IsTemp(),
		Proxy:   cfg.Proxy,
		Filters: cfg.Filters,
		Scope:   cfg.Scope,
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

// switchProject closes the current DB, opens the new one, updates all components,
// and broadcasts the project.switched event.
func (s *Server) switchProject(newMgr *proj.Manager, appCfg *proj.AppConfig, w http.ResponseWriter, r *http.Request) {
	// Open new DB
	newDB, err := storage.Open(newMgr.DBPath())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "open db: "+err.Error())
		return
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
	s.projectMu.Unlock()

	// Apply proxy config from new project
	cfg := newMgr.Config()
	s.proxy.ApplyConfig(cfg.Proxy.Port, cfg.Proxy.InterceptEnabled)
	s.proxy.SetScope(cfg.Scope)

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

	writeJSON(w, http.StatusOK, projectInfoResponse{
		Name:    cfg.Name,
		Path:    newMgr.Path(),
		IsTemp:  newMgr.IsTemp(),
		Proxy:   cfg.Proxy,
		Filters: cfg.Filters,
		Scope:   cfg.Scope,
	})
}
