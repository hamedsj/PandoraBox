package mcp

import (
	"context"
	"fmt"
	"log/slog"
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
	addr := fmt.Sprintf(":%d", s.cfg.MCPPort)
	slog.Info("MCP SSE server starting", "addr", addr)

	sseServer := server.NewSSEServer(s.mcp,
		fmt.Sprintf("http://localhost:%d", s.cfg.MCPPort),
	)

	go func() {
		<-ctx.Done()
	}()

	return sseServer.Start(addr)
}

// StartStdio starts MCP over stdio (for Claude Desktop)
func (s *Server) StartStdio() error {
	return server.ServeStdio(s.mcp)
}
