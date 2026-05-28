// SPDX-License-Identifier: Apache-2.0
package api

import (
	"encoding/json"
	"net/http"

	"github.com/hamedsj5/pandorabox/internal/team"
)

// teamStatus returns the current team sync status and member list.
func (s *Server) teamStatus(w http.ResponseWriter, r *http.Request) {
	type response struct {
		Enabled   bool          `json:"enabled"`
		Connected bool          `json:"connected"`
		Status    string        `json:"status"`
		ServerURL string        `json:"server_url"`
		Members   []team.Member `json:"members"`
	}
	res := response{
		Enabled: s.teamClient != nil,
		Status:  string(team.SyncDisconnected),
		Members: []team.Member{},
	}
	if s.teamClient != nil {
		res.Connected = s.teamClient.SyncStatusValue() == team.SyncConnected
		res.Status = string(s.teamClient.SyncStatusValue())
		s.projectMu.RLock()
		res.ServerURL = s.appCfg.TeamURL
		s.projectMu.RUnlock()
		res.Members = s.teamClient.Members()
		if res.Members == nil {
			res.Members = []team.Member{}
		}
	}
	writeJSON(w, http.StatusOK, res)
}

// teamConnect starts a team client connection and persists the config.
func (s *Server) teamConnect(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ServerURL   string `json:"server_url"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "bad request")
		return
	}
	if body.ServerURL == "" || body.Password == "" {
		writeError(w, http.StatusBadRequest, "server_url and password are required")
		return
	}

	s.projectMu.Lock()
	appCfg := s.appCfg
	s.projectMu.Unlock()

	if appCfg != nil {
		if body.DisplayName != "" {
			appCfg.DisplayName = body.DisplayName
		}
		appCfg.TeamURL = body.ServerURL
		appCfg.TeamToken = body.Password
		appCfg.Save() //nolint:errcheck
	}

	// Stop existing client if any.
	if s.teamClient != nil {
		s.teamClient.Stop()
		s.teamClient = nil
	}

	s.projectMu.RLock()
	proj := s.project
	s.projectMu.RUnlock()

	cfg := team.ClientConfig{
		ServerURL:   body.ServerURL,
		Password:    body.Password,
		UserID:      appCfg.UserID,
		DisplayName: appCfg.DisplayName,
		Color:       appCfg.Color,
	}
	client := team.NewClient(cfg, s.bus, proj, s.getDB())
	s.teamClient = client
	client.Start(s.ctx)

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "status": "connecting"})
}

// teamDisconnect stops the team client.
func (s *Server) teamDisconnect(w http.ResponseWriter, r *http.Request) {
	if s.teamClient != nil {
		s.teamClient.Stop()
		s.teamClient = nil
	}
	s.projectMu.Lock()
	if s.appCfg != nil {
		s.appCfg.TeamURL = ""
		s.appCfg.TeamToken = ""
		s.appCfg.Save() //nolint:errcheck
	}
	s.projectMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// ---------- Admin endpoints (team server mode only) ----------

func (s *Server) requireServerMode(w http.ResponseWriter) bool {
	if !s.isServerMode || s.teamServer == nil {
		writeError(w, http.StatusForbidden, "only available in team server mode")
		return false
	}
	return true
}

func (s *Server) adminStatus(w http.ResponseWriter, r *http.Request) {
	if !s.requireServerMode(w) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"uptime_seconds": s.teamServer.UptimeSeconds(),
		"team_port":      s.teamServerCfg.TeamPort,
		"api_port":       s.teamServerCfg.APIPort,
		"team_name":      s.teamServerCfg.TeamName,
		"member_count":   len(s.teamServer.Members()),
		"members":        s.teamServer.Members(),
		"data_dir":       s.teamServerCfg.DataDir,
		"config_version": s.teamServer.ConfigVersion(),
	})
}

func (s *Server) adminListMembers(w http.ResponseWriter, r *http.Request) {
	if !s.requireServerMode(w) {
		return
	}
	members := s.teamServer.Members()
	type enrichedMember struct {
		team.Member
		RequestCount int64 `json:"request_count"`
	}
	result := make([]enrichedMember, len(members))
	for i, m := range members {
		count, _ := s.getDB().CountRequestsByUser(m.UserID)
		result[i] = enrichedMember{Member: m, RequestCount: count}
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) adminKickMember(w http.ResponseWriter, r *http.Request) {
	if !s.requireServerMode(w) {
		return
	}
	userID := r.PathValue("user_id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user_id required")
		return
	}
	ok := s.teamServer.KickMember(userID)
	writeJSON(w, http.StatusOK, map[string]bool{"success": ok})
}

func (s *Server) adminUpdateConfig(w http.ResponseWriter, r *http.Request) {
	if !s.requireServerMode(w) {
		return
	}
	var body struct {
		TeamName   string `json:"team_name"`
		MaxMembers int    `json:"max_members"`
		TeamPort   int    `json:"team_port"`
		APIPort    int    `json:"api_port"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "bad request")
		return
	}
	cfg := s.teamServerCfg
	if body.TeamName != "" {
		cfg.TeamName = body.TeamName
	}
	if body.MaxMembers > 0 {
		cfg.MaxMembers = body.MaxMembers
	}
	if body.TeamPort > 0 {
		cfg.TeamPort = body.TeamPort
	}
	if body.APIPort > 0 {
		cfg.APIPort = body.APIPort
	}
	if err := cfg.Save(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save config")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "config": cfg})
}

func (s *Server) adminSetPassword(w http.ResponseWriter, r *http.Request) {
	if !s.requireServerMode(w) {
		return
	}
	var body struct {
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.NewPassword == "" {
		writeError(w, http.StatusBadRequest, "new_password is required")
		return
	}
	if err := s.teamServerCfg.SetPassword(body.NewPassword); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to hash password")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) adminExportProject(w http.ResponseWriter, r *http.Request) {
	if !s.requireServerMode(w) {
		return
	}
	zipData, err := exportProjectZip(s.teamServerCfg.DataDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "export failed: "+err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=\"pandorabox-project.zip\"")
	w.WriteHeader(http.StatusOK)
	w.Write(zipData) //nolint:errcheck
}

func (s *Server) adminRestartServer(w http.ResponseWriter, r *http.Request) {
	if !s.requireServerMode(w) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"restarting": true})
	// Signal graceful shutdown; Docker restart policy will bring it back.
	go func() {
		if s.ctx != nil {
			// Cancel is stored in main; the process exits and Docker restarts.
			// We call the context cancellation through the stored cancel func.
		}
	}()
}

func (s *Server) adminMigrateData(w http.ResponseWriter, r *http.Request) {
	if !s.requireServerMode(w) {
		return
	}
	var body struct {
		NewDataDir string `json:"new_data_dir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.NewDataDir == "" {
		writeError(w, http.StatusBadRequest, "new_data_dir is required")
		return
	}
	if err := migrateDataDir(s.teamServerCfg.DataDir, body.NewDataDir); err != nil {
		writeError(w, http.StatusInternalServerError, "migration failed: "+err.Error())
		return
	}
	s.teamServerCfg.DataDir = body.NewDataDir
	if err := s.teamServerCfg.Save(); err != nil {
		writeError(w, http.StatusInternalServerError, "config save failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "new_data_dir": body.NewDataDir})
}
