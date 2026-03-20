package mcp

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/hamedsj5/pandorabox/internal/storage"
	"github.com/hamedsj5/pandorabox/internal/team"
	"github.com/mark3labs/mcp-go/mcp"
)

// requireServerMode returns an error if the MCP server is not in team-server mode.
func (s *Server) requireServerMode() error {
	if !s.isServerMode || s.teamServer == nil || s.teamServerCfg == nil {
		return fmt.Errorf("this tool is only available in team-server mode")
	}
	return nil
}

// ── Team Client Tools ──────────────────────────────────────────────────────────

func (s *Server) toolTeamStatus(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if s.teamClient == nil {
		return jsonResult(map[string]interface{}{
			"connected":  false,
			"status":     "disconnected",
			"server_url": "",
			"members":    []interface{}{},
		})
	}

	s.projectMu.RLock()
	serverURL := ""
	if s.appCfg != nil {
		serverURL = s.appCfg.TeamURL
	}
	s.projectMu.RUnlock()

	members := s.teamClient.Members()
	if members == nil {
		members = []team.Member{}
	}
	status := s.teamClient.SyncStatusValue()
	return jsonResult(map[string]interface{}{
		"connected":  status == team.SyncConnected,
		"status":     string(status),
		"server_url": serverURL,
		"members":    members,
	})
}

func (s *Server) toolTeamConnect(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.Params.Arguments
	serverURL, _ := args["server_url"].(string)
	password, _ := args["password"].(string)
	if serverURL == "" || password == "" {
		return nil, fmt.Errorf("server_url and password are required")
	}
	displayName, _ := args["display_name"].(string)

	s.projectMu.Lock()
	appCfg := s.appCfg
	proj := s.project
	if appCfg != nil {
		if displayName != "" {
			appCfg.DisplayName = displayName
		}
		appCfg.TeamURL = serverURL
		appCfg.TeamToken = password
		appCfg.Save() //nolint:errcheck
	}
	s.projectMu.Unlock()

	// Stop existing client if any.
	if s.teamClient != nil {
		s.teamClient.Stop()
	}

	runCtx := s.bgCtx
	if runCtx == nil {
		runCtx = context.Background()
	}

	userID := ""
	color := ""
	if appCfg != nil {
		userID = appCfg.UserID
		color = appCfg.Color
		if displayName == "" && appCfg.DisplayName != "" {
			displayName = appCfg.DisplayName
		}
	}

	cfg := team.ClientConfig{
		ServerURL:   serverURL,
		Password:    password,
		UserID:      userID,
		DisplayName: displayName,
		Color:       color,
	}
	client := team.NewClient(cfg, s.bus, proj, s.getDB())
	s.teamClient = client
	client.Start(runCtx)

	return jsonResult(map[string]interface{}{"success": true, "status": "connecting"})
}

func (s *Server) toolTeamDisconnect(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
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
	return jsonResult(map[string]bool{"success": true})
}

func (s *Server) toolListTeamMembers(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if s.teamClient == nil {
		return jsonResult([]interface{}{})
	}
	members := s.teamClient.Members()
	if members == nil {
		members = []team.Member{}
	}
	return jsonResult(members)
}

func (s *Server) toolGetTeamMemberTraffic(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	args := req.Params.Arguments
	userID, _ := args["user_id"].(string)
	if userID == "" {
		return nil, fmt.Errorf("user_id is required")
	}
	limit := 20
	if v, ok := args["limit"].(float64); ok {
		limit = int(v)
	}
	filter := storage.RequestFilter{UserID: userID, Limit: limit}
	if v, ok := args["host"].(string); ok {
		filter.Host = v
	}
	requests, total, err := s.getDB().ListRequests(filter)
	if err != nil {
		return nil, err
	}
	return jsonResult(map[string]interface{}{
		"user_id":  userID,
		"requests": requests,
		"total":    total,
	})
}

// ── Team Server Admin Tools ────────────────────────────────────────────────────

func (s *Server) toolTeamServerStatus(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	cfg := s.teamServerCfg
	members := s.teamServer.Members()
	if members == nil {
		members = []team.Member{}
	}
	return jsonResult(map[string]interface{}{
		"uptime_seconds":  s.teamServer.UptimeSeconds(),
		"team_port":       cfg.TeamPort,
		"api_port":        cfg.APIPort,
		"team_name":       cfg.TeamName,
		"max_members":     cfg.MaxMembers,
		"member_count":    len(members),
		"members":         members,
		"data_dir":        cfg.DataDir,
		"config_version":  s.teamServer.ConfigVersion(),
	})
}

func (s *Server) toolTeamServerListMembers(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	members := s.teamServer.Members()
	if members == nil {
		members = []team.Member{}
	}
	return jsonResult(members)
}

func (s *Server) toolTeamServerKickMember(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	userID, _ := req.Params.Arguments["user_id"].(string)
	if userID == "" {
		return nil, fmt.Errorf("user_id is required")
	}
	kicked := s.teamServer.KickMember(userID)
	return jsonResult(map[string]bool{"success": kicked})
}

func (s *Server) toolTeamServerUpdateConfig(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	cfg := s.teamServerCfg
	args := req.Params.Arguments
	if v, ok := args["team_name"].(string); ok && v != "" {
		cfg.TeamName = v
	}
	if v, ok := args["max_members"].(float64); ok {
		cfg.MaxMembers = int(v)
	}
	if v, ok := args["team_port"].(float64); ok {
		cfg.TeamPort = int(v)
	}
	if v, ok := args["api_port"].(float64); ok {
		cfg.APIPort = int(v)
	}
	if err := cfg.Save(); err != nil {
		return nil, fmt.Errorf("save config: %w", err)
	}
	return jsonResult(map[string]interface{}{
		"success": true,
		"config": map[string]interface{}{
			"team_name":   cfg.TeamName,
			"max_members": cfg.MaxMembers,
			"team_port":   cfg.TeamPort,
			"api_port":    cfg.APIPort,
			"data_dir":    cfg.DataDir,
		},
	})
}

func (s *Server) toolTeamServerSetPassword(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	newPw, _ := req.Params.Arguments["new_password"].(string)
	if newPw == "" {
		return nil, fmt.Errorf("new_password is required")
	}
	if err := s.teamServerCfg.SetPassword(newPw); err != nil {
		return nil, fmt.Errorf("set password: %w", err)
	}
	return jsonResult(map[string]bool{"success": true})
}

func (s *Server) toolTeamServerExportProject(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	zipData, err := mcpExportProjectZip(s.teamServerCfg.DataDir)
	if err != nil {
		return nil, fmt.Errorf("export: %w", err)
	}
	encoded := base64.StdEncoding.EncodeToString(zipData)
	return jsonResult(map[string]interface{}{
		"zip_base64": encoded,
		"size_bytes": len(zipData),
	})
}

func (s *Server) toolTeamServerRestart(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	// Signal restart by cancelling the server's lifecycle context.
	s.cancelMu.Lock()
	cancel := s.cancel
	s.cancelMu.Unlock()
	if cancel != nil {
		go cancel()
	}
	return jsonResult(map[string]bool{"restarting": true})
}

func (s *Server) toolTeamServerMigrateData(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	newDir, _ := req.Params.Arguments["new_data_dir"].(string)
	if newDir == "" {
		return nil, fmt.Errorf("new_data_dir is required")
	}
	if err := mcpMigrateDataDir(s.teamServerCfg.DataDir, newDir); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	s.teamServerCfg.DataDir = newDir
	if err := s.teamServerCfg.Save(); err != nil {
		return nil, fmt.Errorf("save config: %w", err)
	}
	return jsonResult(map[string]interface{}{
		"success":      true,
		"new_data_dir": newDir,
	})
}

// ── File operation helpers ─────────────────────────────────────────────────────

func mcpExportProjectZip(dataDir string) ([]byte, error) {
	files := []string{"project.json", "pandora.db"}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range files {
		src := filepath.Join(dataDir, name)
		f, err := os.Open(src)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("open %s: %w", name, err)
		}
		w, err := zw.Create(name)
		if err != nil {
			f.Close()
			return nil, fmt.Errorf("zip create %s: %w", name, err)
		}
		if _, err := io.Copy(w, f); err != nil {
			f.Close()
			return nil, fmt.Errorf("zip write %s: %w", name, err)
		}
		f.Close()
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("zip close: %w", err)
	}
	return buf.Bytes(), nil
}

func mcpMigrateDataDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0755); err != nil {
		return fmt.Errorf("create dst dir: %w", err)
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return fmt.Errorf("read src dir: %w", err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		srcPath := filepath.Join(src, e.Name())
		dstPath := filepath.Join(dst, e.Name())
		in, err := os.Open(srcPath)
		if err != nil {
			return fmt.Errorf("open %s: %w", e.Name(), err)
		}
		out, err := os.Create(dstPath)
		if err != nil {
			in.Close()
			return fmt.Errorf("create %s: %w", e.Name(), err)
		}
		if _, err := io.Copy(out, in); err != nil {
			in.Close()
			out.Close()
			return fmt.Errorf("copy %s: %w", e.Name(), err)
		}
		in.Close()
		out.Close()
	}
	return nil
}
