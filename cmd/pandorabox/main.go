package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/hamedsj5/pandorabox/internal/api"
	"github.com/hamedsj5/pandorabox/internal/ca"
	"github.com/hamedsj5/pandorabox/internal/config"
	"github.com/hamedsj5/pandorabox/internal/events"
	mcpsrv "github.com/hamedsj5/pandorabox/internal/mcp"
	"github.com/hamedsj5/pandorabox/internal/project"
	"github.com/hamedsj5/pandorabox/internal/proxy"
	"github.com/hamedsj5/pandorabox/internal/storage"
	"github.com/hamedsj5/pandorabox/internal/team"
	"github.com/spf13/cobra"
)

func main() {
	root := &cobra.Command{
		Use:   "pandorabox",
		Short: "MITM proxy with AI/MCP integration",
	}

	serveCmd := &cobra.Command{
		Use:   "serve",
		Short: "Start the proxy and web UI",
		RunE:  runServe,
	}

	caCmd := &cobra.Command{
		Use:   "ca",
		Short: "CA management",
	}
	caExportCmd := &cobra.Command{
		Use:   "export",
		Short: "Print CA certificate PEM to stdout",
		RunE:  runCAExport,
	}
	caRegenCmd := &cobra.Command{
		Use:   "regenerate",
		Short: "Delete and regenerate the CA (re-install in browser after this)",
		RunE: func(cmd *cobra.Command, args []string) error {
			authority, err := ca.Regenerate()
			if err != nil {
				return err
			}
			fmt.Println("New CA generated. Re-download and re-install it in your browser.")
			fmt.Print(authority.CertPEM())
			return nil
		},
	}
	caCmd.AddCommand(caExportCmd, caRegenCmd)

	serveCmd.Flags().Int("proxy-port", 8080, "Proxy port")
	serveCmd.Flags().Int("api-port", 7777, "API/UI port")
	serveCmd.Flags().Int("mcp-port", 9090, "MCP SSE port")
	serveCmd.Flags().String("db", "", "SQLite database path (overrides project DB)")
	serveCmd.Flags().String("project", "", "Project folder path to open on startup")

	// Team collaboration flags
	serveCmd.Flags().Bool("team-server", false, "Run as team sync hub (no local proxy)")
	serveCmd.Flags().Int("team-port", 7778, "Team sync WebSocket port")
	serveCmd.Flags().String("team-url", "", "Team server URL for client mode (e.g. ws://host:7778)")
	serveCmd.Flags().String("server-config", "", "Path to pandorabox-server.json (team server mode)")

	root.AddCommand(serveCmd, caCmd)

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

func runServe(cmd *cobra.Command, args []string) error {
	cfg := config.FromFlags(cmd)

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	// Load global app config (recent projects, last opened, user identity)
	appCfg, err := project.LoadAppConfig()
	if err != nil {
		slog.Warn("Failed to load app config, using defaults", "err", err)
		appCfg = &project.AppConfig{}
	}

	// Ensure the user has a stable identity for team collaboration.
	if err := appCfg.EnsureUserID(); err != nil {
		slog.Warn("Failed to ensure user ID", "err", err)
	}

	// ── Team server mode ──────────────────────────────────────────────────────
	if cfg.TeamServer {
		return runTeamServer(cmd, cfg, appCfg)
	}

	// ── Normal / team-client mode ─────────────────────────────────────────────

	// Determine which project to open
	projectPath, _ := cmd.Flags().GetString("project")
	var projectMgr *project.Manager
	if projectPath != "" {
		if project.IsTempPath(projectPath) {
			projectMgr, err = project.TempProject()
		} else {
			projectMgr, err = project.OpenProject(projectPath)
		}
		if err != nil {
			slog.Warn("Failed to open specified project, falling back to temp", "path", projectPath, "err", err)
		}
	}
	if projectMgr == nil && appCfg.LastProject != "" {
		if project.IsTempPath(appCfg.LastProject) {
			projectMgr, err = project.TempProject()
		} else {
			projectMgr, err = project.OpenProject(appCfg.LastProject)
		}
		if err != nil {
			slog.Warn("Failed to open last project, falling back to temp", "path", appCfg.LastProject, "err", err)
		}
	}
	if projectMgr == nil {
		projectMgr, err = project.TempProject()
		if err != nil {
			return fmt.Errorf("create temp project: %w", err)
		}
	}

	slog.Info("Opened project", "name", projectMgr.Config().Name, "path", projectMgr.Path())

	dbOverride, _ := cmd.Flags().GetString("db")
	dbPath := projectMgr.DBPath()
	if dbOverride != "" {
		dbPath = dbOverride
	}

	projCfg := projectMgr.Config()
	if projCfg.Proxy.Port > 0 {
		cfg.ProxyPort = projCfg.Proxy.Port
	}
	if projCfg.MCPPort > 0 {
		cfg.MCPPort = projCfg.MCPPort
	}

	appCfg.AddRecent(projectMgr.Path())
	if saveErr := appCfg.Save(); saveErr != nil {
		slog.Warn("Failed to save app config", "err", saveErr)
	}

	// Storage
	db, err := storage.Open(dbPath)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	defer db.Close()

	// CA
	authority, err := ca.Load()
	if err != nil {
		return fmt.Errorf("load CA: %w", err)
	}

	// Event bus
	bus := events.NewBus()

	// Intercept queue
	interceptQueue := proxy.NewInterceptQueue()
	interceptQueue.SetEnabled(projCfg.Proxy.InterceptEnabled)

	// Proxy engine
	proxyEngine := proxy.New(cfg, db, authority, bus, interceptQueue)
	proxyEngine.SetScope(projCfg.Scope)

	// API server
	apiServer := api.NewServer(cfg, db, bus, proxyEngine, interceptQueue, authority)
	apiServer.SetStaticFS(getUIFS())
	apiServer.SetProject(projectMgr, appCfg)

	// MCP server
	mcpServer := mcpsrv.NewServer(cfg, db, bus, proxyEngine, interceptQueue, authority)
	mcpServer.SetProject(projectMgr, appCfg)
	mcpServer.SetSwitchProjectFn(apiServer.SwitchProject)
	apiServer.SetMCPServer(mcpServer)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	apiServer.SetContext(ctx)
	mcpServer.SetContext(ctx)

	// Team client — start if team-url is set or persisted in app config.
	teamURL := cfg.TeamURL
	if teamURL == "" {
		teamURL = appCfg.TeamURL
	}
	if teamURL != "" && appCfg.TeamToken != "" {
		teamCfg := team.ClientConfig{
			ServerURL:   teamURL,
			Password:    appCfg.TeamToken,
			UserID:      appCfg.UserID,
			DisplayName: appCfg.DisplayName,
			Color:       appCfg.Color,
		}
		teamClient := team.NewClient(teamCfg, bus, projectMgr, db)
		teamClient.Start(ctx)
		apiServer.SetTeamClient(teamClient)
		mcpServer.SetTeamClient(teamClient)
		slog.Info("Team client started", "url", teamURL)
	}

	// Start API server
	go func() {
		addr := fmt.Sprintf(":%d", cfg.APIPort)
		slog.Info("API server starting", "addr", addr)
		srv := &http.Server{Addr: addr, Handler: apiServer.Handler()}
		go func() {
			<-ctx.Done()
			srv.Shutdown(context.Background()) //nolint:errcheck
		}()
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("API server error", "err", err)
		}
	}()

	// Start MCP server
	go func() {
		slog.Info("MCP server starting", "port", cfg.MCPPort)
		if err := mcpServer.Start(ctx); err != nil {
			slog.Error("MCP server error", "err", err)
		}
	}()

	// Start proxy (blocking until ctx done)
	slog.Info("Proxy starting", "port", cfg.ProxyPort)
	return proxyEngine.Start(ctx)
}

// runTeamServer starts the binary in dedicated team-server mode.
// The local proxy is NOT started. The team hub, API server, and MCP server run.
func runTeamServer(cmd *cobra.Command, cfg *config.Config, appCfg *project.AppConfig) error {
	// Load or create server config.
	serverCfgPath := cfg.ServerConfigPath
	srvCfg, err := team.LoadServerConfig(serverCfgPath)
	if err != nil {
		return fmt.Errorf("load server config: %w", err)
	}

	// Override server config with CLI flags when provided.
	if cfg.TeamPort != 0 && cfg.TeamPort != 7778 {
		srvCfg.TeamPort = cfg.TeamPort
	}
	if cfg.APIPort != 0 && cfg.APIPort != 7777 {
		srvCfg.APIPort = cfg.APIPort
	}

	slog.Info("Starting team server", "team_port", srvCfg.TeamPort, "api_port", srvCfg.APIPort, "data_dir", srvCfg.DataDir)

	// Ensure data directory exists.
	if err := os.MkdirAll(srvCfg.DataDir, 0755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}

	// Open shared project.
	projectPath := srvCfg.DataDir
	var projectMgr *project.Manager
	projectMgr, err = project.OpenProject(projectPath)
	if err != nil {
		// First run — create a new project in the data dir.
		projectMgr, err = project.CreateProject(projectPath, "Team Project")
		if err != nil {
			return fmt.Errorf("create team project: %w", err)
		}
	}

	// Open shared DB.
	dbPath := projectMgr.DBPath()
	db, err := storage.Open(dbPath)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	defer db.Close()

	// CA (needed by API server for the /api/ca/cert endpoint).
	authority, err := ca.Load()
	if err != nil {
		return fmt.Errorf("load CA: %w", err)
	}

	// Event bus (no proxy events on server, but needed by API hub).
	bus := events.NewBus()

	// Team sync server.
	teamSrv := team.NewServer(srvCfg, projectMgr, db)

	// Intercept queue (required by API server constructor; unused in server mode).
	interceptQueue := proxy.NewInterceptQueue()

	// Proxy engine (required by API server constructor; Start() is never called).
	proxyEngine := proxy.New(&config.Config{
		ProxyPort: srvCfg.TeamPort, // placeholder — not started
		APIPort:   srvCfg.APIPort,
	}, db, authority, bus, interceptQueue)

	// API server.
	apiCfg := &config.Config{
		APIPort: srvCfg.APIPort,
		MCPPort: 9090,
	}
	apiServer := api.NewServer(apiCfg, db, bus, proxyEngine, interceptQueue, authority)
	apiServer.SetStaticFS(getUIFS())
	apiServer.SetProject(projectMgr, appCfg)
	apiServer.SetTeamServer(teamSrv, srvCfg)

	// MCP server.
	mcpServer := mcpsrv.NewServer(apiCfg, db, bus, proxyEngine, interceptQueue, authority)
	mcpServer.SetProject(projectMgr, appCfg)
	mcpServer.SetTeamServer(teamSrv, srvCfg)
	apiServer.SetMCPServer(mcpServer)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	apiServer.SetContext(ctx)
	mcpServer.SetContext(ctx)

	// Start API server.
	go func() {
		addr := fmt.Sprintf(":%d", srvCfg.APIPort)
		slog.Info("API server starting (team server mode)", "addr", addr)
		srv := &http.Server{Addr: addr, Handler: apiServer.Handler()}
		go func() {
			<-ctx.Done()
			srv.Shutdown(context.Background()) //nolint:errcheck
		}()
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("API server error", "err", err)
		}
	}()

	// Start MCP server.
	go func() {
		if err := mcpServer.Start(ctx); err != nil {
			slog.Warn("MCP server exited", "err", err)
		}
	}()

	// Start team sync server (blocking until ctx done).
	return teamSrv.Start(ctx)
}

func runCAExport(cmd *cobra.Command, args []string) error {
	authority, err := ca.Load()
	if err != nil {
		return err
	}
	fmt.Print(authority.CertPEM())
	return nil
}
