// Package mcp — team_tools.go: team client + team-server admin tools.
// Registered through the same registry as the rest. Server-mode-only tools are
// declared with a clear note in the description and short-circuit with a
// helpful error when invoked outside team-server mode.
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

func (s *Server) registerTeamTools() {
	// ── Team client tools ──────────────────────────────────────────────────
	s.register(ToolSpec{
		Name:     "team_status",
		Category: CatTeam,
		Behavior: BehaviorReadOnly,
		Summary:  "Get current team-sync status, server URL, and member list.",
		Handler:  s.toolTeamStatus,
	})

	s.register(ToolSpec{
		Name:      "team_connect",
		Category:  CatTeam,
		Behavior:  BehaviorMutating,
		OpenWorld: true,
		Summary:   "Connect this PandoraBox instance to a team-sync server.",
		Description: "Credentials are saved so the connection is restored on next startup. " +
			"Call `team_status` after a moment to confirm the connection is established.",
		Options: []mcp.ToolOption{
			mcp.WithString("server_url", mcp.Description("Team server WebSocket URL, e.g. ws://host:7778."), mcp.Required()),
			mcp.WithString("password", mcp.Description("Team server password."), mcp.Required()),
			mcp.WithString("display_name", mcp.Description("Your display name visible to teammates.")),
		},
		Handler: s.toolTeamConnect,
	})

	s.register(ToolSpec{
		Name:     "team_disconnect",
		Category: CatTeam,
		Behavior: BehaviorMutating,
		Summary:  "Disconnect from the team server and clear saved credentials.",
		Handler:  s.toolTeamDisconnect,
	})

	s.register(ToolSpec{
		Name:     "team_list_members",
		Aliases:  []string{"list_team_members"},
		Category: CatTeam,
		Behavior: BehaviorReadOnly,
		Summary:  "List all known team members (online and recently seen).",
		Handler:  s.toolListTeamMembers,
	})

	s.register(ToolSpec{
		Name:     "team_get_member_traffic",
		Aliases:  []string{"get_team_member_traffic"},
		Category: CatTeam,
		Behavior: BehaviorReadOnly,
		Summary:  "Get the captured requests of one team member.",
		Options: []mcp.ToolOption{
			mcp.WithString("user_id", mcp.Description("Team member's user id."), mcp.Required()),
			mcp.WithNumber("limit", mcp.Description("Maximum results (default 20).")),
			mcp.WithString("host", mcp.Description("Filter by host (substring).")),
		},
		Handler: s.toolGetTeamMemberTraffic,
	})

	// ── Team server admin tools (server mode only) ─────────────────────────
	s.register(ToolSpec{
		Name:     "team_server_status",
		Category: CatTeamServer,
		Behavior: BehaviorReadOnly,
		Summary:  "[server mode only] Get team-server uptime, config, and member count.",
		Handler:  s.toolTeamServerStatus,
	})

	s.register(ToolSpec{
		Name:     "team_server_list_members",
		Category: CatTeamServer,
		Behavior: BehaviorReadOnly,
		Summary:  "[server mode only] List all members (online + offline) with request counts.",
		Handler:  s.toolTeamServerListMembers,
	})

	s.register(ToolSpec{
		Name:     "team_server_kick_member",
		Category: CatTeamServer,
		Behavior: BehaviorDestructive,
		Summary:  "[server mode only] Forcibly disconnect a team member.",
		Options: []mcp.ToolOption{
			mcp.WithString("user_id", mcp.Description("Team member's user id."), mcp.Required()),
		},
		Handler: s.toolTeamServerKickMember,
	})

	s.register(ToolSpec{
		Name:     "team_server_update_config",
		Category: CatTeamServer,
		Behavior: BehaviorMutating,
		Summary:  "[server mode only] Update pandorabox-server.json settings (port changes require restart).",
		Options: []mcp.ToolOption{
			mcp.WithString("team_name", mcp.Description("New team name.")),
			mcp.WithNumber("max_members", mcp.Description("Max simultaneous connections.")),
			mcp.WithNumber("team_port", mcp.Description("Sync WebSocket port (restart required).")),
			mcp.WithNumber("api_port", mcp.Description("API/UI port (restart required).")),
		},
		Handler: s.toolTeamServerUpdateConfig,
	})

	s.register(ToolSpec{
		Name:     "team_server_set_password",
		Category: CatTeamServer,
		Behavior: BehaviorDestructive,
		Summary:  "[server mode only] Change the team server password.",
		Description: "Existing connections are NOT dropped; the new password takes effect on reconnect. " +
			"For safety this is marked destructive — callers should confirm intent.",
		Options: []mcp.ToolOption{
			mcp.WithString("new_password", mcp.Description("New plaintext password (hashed with bcrypt on save)."), mcp.Required()),
			mcp.WithBoolean("confirm", mcp.Description("Required: set to true to acknowledge the change.")),
		},
		Handler: s.toolTeamServerSetPassword,
	})

	s.register(ToolSpec{
		Name:     "team_server_export_project",
		Category: CatTeamServer,
		Behavior: BehaviorReadOnly,
		Summary:  "[server mode only] Export the server's project as a base64 ZIP (project.json + pandora.db).",
		Handler:  s.toolTeamServerExportProject,
	})

	s.register(ToolSpec{
		Name:     "team_server_restart",
		Category: CatTeamServer,
		Behavior: BehaviorDestructive,
		Summary:  "[server mode only] Gracefully restart the team-server process.",
		Description: "All clients disconnect briefly and reconnect (those with auto-reconnect rejoin automatically). " +
			"For safety this is marked destructive — pass confirm=true to actually restart.",
		Options: []mcp.ToolOption{
			mcp.WithBoolean("confirm", mcp.Description("Required: set to true to perform the restart.")),
		},
		Handler: s.toolTeamServerRestart,
	})

	s.register(ToolSpec{
		Name:     "team_server_migrate_data",
		Category: CatTeamServer,
		Behavior: BehaviorDestructive,
		Summary:  "[server mode only] Move the server's data directory to a new path.",
		Description: "Copies project.json and pandora.db to the new directory, then updates the config. " +
			"Pass confirm=true to acknowledge the migration.",
		Options: []mcp.ToolOption{
			mcp.WithString("new_data_dir", mcp.Description("New absolute path for the data directory."), mcp.Required()),
			mcp.WithBoolean("confirm", mcp.Description("Required: set to true to perform the migration.")),
		},
		Handler: s.toolTeamServerMigrateData,
	})
}

// requireServerMode returns an error if the MCP server is not in team-server mode.
func (s *Server) requireServerMode() error {
	if !s.isServerMode || s.teamServer == nil || s.teamServerCfg == nil {
		return fmt.Errorf("this tool is only available in team-server mode (started with --team-server)")
	}
	return nil
}

// ── Team client handlers ─────────────────────────────────────────────────────

func (s *Server) toolTeamStatus(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	if s.teamClient == nil {
		return map[string]any{
			"connected": false, "status": "disconnected", "server_url": "", "members": []any{},
		}, nil
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
	return map[string]any{
		"connected":  status == team.SyncConnected,
		"status":     string(status),
		"server_url": serverURL,
		"members":    members,
	}, nil
}

func (s *Server) toolTeamConnect(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	serverURL, err := argRequiredString(req, "server_url")
	if err != nil {
		return nil, err
	}
	password, err := argRequiredString(req, "password")
	if err != nil {
		return nil, err
	}
	displayName := argString(req, "display_name")

	s.projectMu.Lock()
	appCfg := s.appCfg
	projMgr := s.project
	if appCfg != nil {
		if displayName != "" {
			appCfg.DisplayName = displayName
		}
		appCfg.TeamURL = serverURL
		appCfg.TeamToken = password
		appCfg.Save() //nolint:errcheck
	}
	s.projectMu.Unlock()

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
	client := team.NewClient(cfg, s.bus, projMgr, s.getDB())
	s.teamClient = client
	client.Start(runCtx)

	return map[string]any{"success": true, "status": "connecting"}, nil
}

func (s *Server) toolTeamDisconnect(ctx context.Context, req mcp.CallToolRequest) (any, error) {
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
	return map[string]any{"success": true}, nil
}

func (s *Server) toolListTeamMembers(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	if s.teamClient == nil {
		return map[string]any{"members": []any{}}, nil
	}
	members := s.teamClient.Members()
	if members == nil {
		members = []team.Member{}
	}
	return map[string]any{"members": members}, nil
}

func (s *Server) toolGetTeamMemberTraffic(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	userID, err := argRequiredString(req, "user_id")
	if err != nil {
		return nil, err
	}
	limit := 20
	if v, ok := argInt64(req, "limit"); ok {
		limit = int(v)
	}
	filter := storage.RequestFilter{UserID: userID, Limit: limit}
	if v := argString(req, "host"); v != "" {
		filter.Host = v
	}
	requests, total, err := s.getDB().ListRequests(filter)
	if err != nil {
		return nil, err
	}
	return map[string]any{"user_id": userID, "requests": requests, "total": total}, nil
}

// ── Team server admin handlers ───────────────────────────────────────────────

func (s *Server) toolTeamServerStatus(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	cfg := s.teamServerCfg
	members := s.teamServer.Members()
	if members == nil {
		members = []team.Member{}
	}
	return map[string]any{
		"uptime_seconds": s.teamServer.UptimeSeconds(),
		"team_port":      cfg.TeamPort,
		"api_port":       cfg.APIPort,
		"team_name":      cfg.TeamName,
		"max_members":    cfg.MaxMembers,
		"member_count":   len(members),
		"members":        members,
		"data_dir":       cfg.DataDir,
		"config_version": s.teamServer.ConfigVersion(),
	}, nil
}

func (s *Server) toolTeamServerListMembers(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	members := s.teamServer.Members()
	if members == nil {
		members = []team.Member{}
	}
	return map[string]any{"members": members}, nil
}

func (s *Server) toolTeamServerKickMember(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	userID, err := argRequiredString(req, "user_id")
	if err != nil {
		return nil, err
	}
	kicked := s.teamServer.KickMember(userID)
	if !kicked {
		return map[string]any{"success": false, "reason": "user_not_connected"}, nil
	}
	return map[string]any{"success": true}, nil
}

func (s *Server) toolTeamServerUpdateConfig(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	cfg := s.teamServerCfg
	if v := argString(req, "team_name"); v != "" {
		cfg.TeamName = v
	}
	if v, ok := argInt64(req, "max_members"); ok {
		cfg.MaxMembers = int(v)
	}
	if v, ok := argInt64(req, "team_port"); ok {
		cfg.TeamPort = int(v)
	}
	if v, ok := argInt64(req, "api_port"); ok {
		cfg.APIPort = int(v)
	}
	if err := cfg.Save(); err != nil {
		return nil, fmt.Errorf("save config: %w", err)
	}
	return map[string]any{
		"success": true,
		"config": map[string]any{
			"team_name": cfg.TeamName, "max_members": cfg.MaxMembers,
			"team_port": cfg.TeamPort, "api_port": cfg.APIPort, "data_dir": cfg.DataDir,
		},
	}, nil
}

func (s *Server) toolTeamServerSetPassword(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	if !argBool(req, "confirm", false) {
		return nil, fmt.Errorf("set `confirm=true` to acknowledge changing the team-server password")
	}
	newPw, err := argRequiredString(req, "new_password")
	if err != nil {
		return nil, err
	}
	if err := s.teamServerCfg.SetPassword(newPw); err != nil {
		return nil, fmt.Errorf("set password: %w", err)
	}
	return map[string]any{"success": true}, nil
}

func (s *Server) toolTeamServerExportProject(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	zipData, err := mcpExportProjectZip(s.teamServerCfg.DataDir)
	if err != nil {
		return nil, fmt.Errorf("export: %w", err)
	}
	return map[string]any{
		"zip_base64": base64.StdEncoding.EncodeToString(zipData),
		"size_bytes": len(zipData),
	}, nil
}

func (s *Server) toolTeamServerRestart(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	if !argBool(req, "confirm", false) {
		return nil, fmt.Errorf("set `confirm=true` to acknowledge restarting the team server")
	}
	s.cancelMu.Lock()
	cancel := s.cancel
	s.cancelMu.Unlock()
	if cancel != nil {
		go cancel()
	}
	return map[string]any{"restarting": true}, nil
}

func (s *Server) toolTeamServerMigrateData(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	if err := s.requireServerMode(); err != nil {
		return nil, err
	}
	if !argBool(req, "confirm", false) {
		return nil, fmt.Errorf("set `confirm=true` to acknowledge migrating the data directory")
	}
	newDir, err := argRequiredString(req, "new_data_dir")
	if err != nil {
		return nil, err
	}
	if err := mcpMigrateDataDir(s.teamServerCfg.DataDir, newDir); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	s.teamServerCfg.DataDir = newDir
	if err := s.teamServerCfg.Save(); err != nil {
		return nil, fmt.Errorf("save config: %w", err)
	}
	return map[string]any{"success": true, "new_data_dir": newDir}, nil
}

// ── File operation helpers ───────────────────────────────────────────────────

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
