package mcp

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"sync"

	"github.com/hamedsj5/pandorabox/internal/ca"
	"github.com/hamedsj5/pandorabox/internal/config"
	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/hamedsj5/pandorabox/internal/proxy"
	"github.com/hamedsj5/pandorabox/internal/storage"
	"github.com/mark3labs/mcp-go/server"
)

type Server struct {
	cfg       *config.Config
	dbMu      sync.RWMutex
	db        *storage.DB
	proxy     *proxy.Proxy
	intercept *proxy.InterceptQueue
	ca        *ca.CA
	mcp       *server.MCPServer

	cancelMu sync.Mutex
	cancel   context.CancelFunc
	mcpPort  int

	projectMu       sync.RWMutex
	project         *proj.Manager
	appCfg          *proj.AppConfig
	onSwitchProject func(*proj.Manager) error
}

func (s *Server) getDB() *storage.DB {
	s.dbMu.RLock()
	defer s.dbMu.RUnlock()
	return s.db
}

func (s *Server) SetDB(db *storage.DB) {
	s.dbMu.Lock()
	s.db = db
	s.dbMu.Unlock()
}

func (s *Server) SetProject(mgr *proj.Manager, appCfg *proj.AppConfig) {
	s.projectMu.Lock()
	s.project = mgr
	s.appCfg = appCfg
	s.projectMu.Unlock()
}

func (s *Server) getProject() *proj.Manager {
	s.projectMu.RLock()
	defer s.projectMu.RUnlock()
	return s.project
}

func (s *Server) getAppCfg() *proj.AppConfig {
	s.projectMu.RLock()
	defer s.projectMu.RUnlock()
	return s.appCfg
}

func (s *Server) SetSwitchProjectFn(fn func(*proj.Manager) error) {
	s.projectMu.Lock()
	s.onSwitchProject = fn
	s.projectMu.Unlock()
}

func (s *Server) mcpEnabled() bool {
	p := s.getProject()
	if p == nil {
		return true
	}
	return !p.Config().MCPDisabled
}

func NewServer(cfg *config.Config, db *storage.DB, p *proxy.Proxy, intercept *proxy.InterceptQueue, authority *ca.CA) *Server {
	s := &Server{
		cfg:       cfg,
		db:        db,
		proxy:     p,
		intercept: intercept,
		ca:        authority,
	}

	mcpServer := server.NewMCPServer(
		"PandoraBox",
		"1.0.0",
	)

	s.mcp = mcpServer
	s.registerTools()

	return s
}

func (s *Server) Start(ctx context.Context) error {
	s.cancelMu.Lock()
	s.mcpPort = s.cfg.MCPPort
	innerCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.cancelMu.Unlock()

	return s.startOn(innerCtx, s.cfg.MCPPort)
}

func (s *Server) startOn(ctx context.Context, port int) error {
	addr := fmt.Sprintf(":%d", port)
	slog.Info("MCP SSE server starting", "addr", addr)

	sseServer := server.NewSSEServer(s.mcp,
		fmt.Sprintf("http://localhost:%d", port),
	)

	go func() {
		<-ctx.Done()
	}()

	return sseServer.Start(addr)
}

func (s *Server) ChangePort(ctx context.Context, newPort int) error {
	// Verify port is free before switching
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", newPort))
	if err != nil {
		return err
	}
	ln.Close()

	s.cancelMu.Lock()
	if s.cancel != nil {
		s.cancel()
	}
	innerCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.mcpPort = newPort
	s.cancelMu.Unlock()

	s.cfg.MCPPort = newPort
	go s.startOn(innerCtx, newPort) //nolint:errcheck
	slog.Info("MCP port changed", "port", newPort)
	return nil
}

// StartStdio starts MCP over stdio (for Claude Desktop)
func (s *Server) StartStdio() error {
	return server.ServeStdio(s.mcp)
}
