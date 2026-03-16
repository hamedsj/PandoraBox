package mcp

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/hamedsj5/pitokmonitor/internal/ca"
	"github.com/hamedsj5/pitokmonitor/internal/config"
	"github.com/hamedsj5/pitokmonitor/internal/proxy"
	"github.com/hamedsj5/pitokmonitor/internal/storage"
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

func NewServer(cfg *config.Config, db *storage.DB, p *proxy.Proxy, intercept *proxy.InterceptQueue, authority *ca.CA) *Server {
	s := &Server{
		cfg:       cfg,
		db:        db,
		proxy:     p,
		intercept: intercept,
		ca:        authority,
	}

	mcpServer := server.NewMCPServer(
		"PitokMonitor",
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
