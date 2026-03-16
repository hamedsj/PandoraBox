package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/hamedsj5/pitokmonitor/internal/api"
	"github.com/hamedsj5/pitokmonitor/internal/ca"
	"github.com/hamedsj5/pitokmonitor/internal/config"
	"github.com/hamedsj5/pitokmonitor/internal/events"
	mcpsrv "github.com/hamedsj5/pitokmonitor/internal/mcp"
	"github.com/hamedsj5/pitokmonitor/internal/project"
	"github.com/hamedsj5/pitokmonitor/internal/proxy"
	"github.com/hamedsj5/pitokmonitor/internal/storage"
	"github.com/spf13/cobra"
)

func main() {
	root := &cobra.Command{
		Use:   "pitokmonitor",
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

	root.AddCommand(serveCmd, caCmd)

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

func runServe(cmd *cobra.Command, args []string) error {
	cfg := config.FromFlags(cmd)

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	// Load global app config (recent projects, last opened)
	appCfg, err := project.LoadAppConfig()
	if err != nil {
		slog.Warn("Failed to load app config, using defaults", "err", err)
		appCfg = &project.AppConfig{}
	}

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

	// Apply project proxy port to config if not overridden by flag
	dbOverride, _ := cmd.Flags().GetString("db")
	dbPath := projectMgr.DBPath()
	if dbOverride != "" {
		dbPath = dbOverride
	}

	// Apply project proxy port to cfg
	projCfg := projectMgr.Config()
	if projCfg.Proxy.Port > 0 {
		cfg.ProxyPort = projCfg.Proxy.Port
	}

	// Update recent projects
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

	// API server
	apiServer := api.NewServer(cfg, db, bus, proxyEngine, interceptQueue, authority)
	apiServer.SetStaticFS(getUIFS())
	apiServer.SetProject(projectMgr, appCfg)

	// MCP server
	mcpServer := mcpsrv.NewServer(cfg, db, proxyEngine, interceptQueue, authority)
	apiServer.SetMCPServer(mcpServer)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// Start API server
	go func() {
		addr := fmt.Sprintf(":%d", cfg.APIPort)
		slog.Info("API server starting", "addr", addr)
		srv := &http.Server{Addr: addr, Handler: apiServer.Handler()}
		go func() {
			<-ctx.Done()
			srv.Shutdown(context.Background())
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

func runCAExport(cmd *cobra.Command, args []string) error {
	authority, err := ca.Load()
	if err != nil {
		return err
	}
	fmt.Print(authority.CertPEM())
	return nil
}
