package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hamedsj5/pandorabox/internal/ca"
	"github.com/hamedsj5/pandorabox/internal/config"
	"github.com/hamedsj5/pandorabox/internal/events"
	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/hamedsj5/pandorabox/internal/proxy"
	"github.com/hamedsj5/pandorabox/internal/storage"
	"github.com/hamedsj5/pandorabox/internal/team"
	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

const (
	mcpEndpointPath          = "/mcp"
	sseEndpointPath          = "/sse"
	supportedProtocolVersion = "2025-03-26"
)

type Status struct {
	Running           bool   `json:"running"`
	AccessEnabled     bool   `json:"access_enabled"`
	Port              int    `json:"port"`
	Transport         string `json:"transport"`
	Endpoint          string `json:"endpoint"`
	LegacySSEEndpoint string `json:"legacy_sse_endpoint,omitempty"`
	LastError         string `json:"last_error,omitempty"`
}

type session struct {
	id      string
	writeMu sync.Mutex
	writer  http.ResponseWriter
	flusher http.Flusher
}

type Server struct {
	cfg       *config.Config
	dbMu      sync.RWMutex
	db        *storage.DB
	bus       *events.Bus
	proxy     *proxy.Proxy
	intercept *proxy.InterceptQueue
	ca        *ca.CA
	mcp       *mcpserver.MCPServer

	cancelMu sync.Mutex
	cancel   context.CancelFunc

	httpMu     sync.Mutex
	httpServer *http.Server
	statusMu   sync.RWMutex
	status     Status

	sessions sync.Map

	consoleMu      sync.RWMutex
	consoleEntries []events.ConsoleOutputData

	projectMu       sync.RWMutex
	project         *proj.Manager
	appCfg          *proj.AppConfig
	onSwitchProject func(*proj.Manager) error

	teamClient    *team.Client
	teamServer    *team.Server
	teamServerCfg *team.ServerConfig
	isServerMode  bool
	bgCtx         context.Context
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
	s.updateStatus(func(st *Status) {
		st.AccessEnabled = s.mcpEnabled()
	})
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

// SetContext stores the server's lifecycle context for use in long-running tools.
func (s *Server) SetContext(ctx context.Context) {
	s.bgCtx = ctx
}

// SetTeamClient attaches the team client (outbound connection) to the MCP server.
func (s *Server) SetTeamClient(c *team.Client) {
	s.teamClient = c
}

// SetTeamServer attaches the team server hub and config (server mode only).
func (s *Server) SetTeamServer(srv *team.Server, cfg *team.ServerConfig) {
	s.teamServer = srv
	s.teamServerCfg = cfg
	s.isServerMode = true
}

func (s *Server) mcpEnabled() bool {
	p := s.getProject()
	if p == nil {
		return true
	}
	return !p.Config().MCPDisabled
}

func NewServer(cfg *config.Config, db *storage.DB, bus *events.Bus, p *proxy.Proxy, intercept *proxy.InterceptQueue, authority *ca.CA) *Server {
	s := &Server{
		cfg:       cfg,
		db:        db,
		bus:       bus,
		proxy:     p,
		intercept: intercept,
		ca:        authority,
		status: Status{
			Port:      cfg.MCPPort,
			Transport: "streamable-http+legacy-sse",
			Endpoint:  fmt.Sprintf("http://localhost:%d%s", cfg.MCPPort, mcpEndpointPath),
			LegacySSEEndpoint: fmt.Sprintf(
				"http://localhost:%d%s",
				cfg.MCPPort,
				sseEndpointPath,
			),
			AccessEnabled: true,
		},
	}

	mcpSrv := mcpserver.NewMCPServer(
		"PandoraBox",
		"1.0.0",
		mcpserver.WithResourceCapabilities(false, false),
	)

	s.mcp = mcpSrv
	s.startConsoleCapture()
	s.registerDocs()
	s.registerTools()
	s.registerOrganizerTools()

	return s
}

func (s *Server) Status() Status {
	s.statusMu.RLock()
	defer s.statusMu.RUnlock()
	st := s.status
	st.AccessEnabled = s.mcpEnabled()
	return st
}

func (s *Server) Start(ctx context.Context) error {
	s.cancelMu.Lock()
	innerCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.cancelMu.Unlock()

	return s.startOn(innerCtx, s.cfg.MCPPort)
}

func (s *Server) startOn(ctx context.Context, port int) error {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	slog.Info("MCP server starting", "addr", addr, "endpoint", fmt.Sprintf("http://localhost:%d%s", port, mcpEndpointPath))

	mux := http.NewServeMux()
	mux.HandleFunc(mcpEndpointPath, s.handleMCP)
	mux.HandleFunc(sseEndpointPath, s.handleLegacySSE)
	mux.HandleFunc("/message", s.handleLegacyMessage)

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	s.httpMu.Lock()
	s.httpServer = srv
	s.httpMu.Unlock()

	s.updateStatus(func(st *Status) {
		st.Running = true
		st.Port = port
		st.Endpoint = fmt.Sprintf("http://localhost:%d%s", port, mcpEndpointPath)
		st.LegacySSEEndpoint = fmt.Sprintf("http://localhost:%d%s", port, sseEndpointPath)
		st.LastError = ""
		st.AccessEnabled = s.mcpEnabled()
	})

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil && err != http.ErrServerClosed {
			slog.Warn("MCP server shutdown error", "err", err)
		}
	}()

	err := srv.ListenAndServe()

	s.httpMu.Lock()
	wasCurrent := false
	if s.httpServer == srv {
		s.httpServer = nil
		wasCurrent = true
	}
	s.httpMu.Unlock()

	if err != nil && err != http.ErrServerClosed {
		if wasCurrent {
			s.updateStatus(func(st *Status) {
				st.Running = false
				st.Port = port
				st.LastError = err.Error()
				st.AccessEnabled = s.mcpEnabled()
			})
		}
		return err
	}

	if wasCurrent {
		s.updateStatus(func(st *Status) {
			st.Running = false
			st.Port = port
			st.AccessEnabled = s.mcpEnabled()
		})
	}
	return nil
}

func (s *Server) ChangePort(ctx context.Context, newPort int) error {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", newPort))
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
	s.cancelMu.Unlock()

	s.httpMu.Lock()
	current := s.httpServer
	s.httpMu.Unlock()
	if current != nil {
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = current.Shutdown(shutdownCtx)
		shutdownCancel()
	}

	s.cfg.MCPPort = newPort
	s.updateStatus(func(st *Status) {
		st.Port = newPort
		st.Endpoint = fmt.Sprintf("http://localhost:%d%s", newPort, mcpEndpointPath)
		st.LegacySSEEndpoint = fmt.Sprintf("http://localhost:%d%s", newPort, sseEndpointPath)
		st.LastError = ""
		st.AccessEnabled = s.mcpEnabled()
	})

	go func() {
		if err := s.startOn(innerCtx, newPort); err != nil && err != http.ErrServerClosed {
			slog.Error("MCP server error", "err", err)
		}
	}()

	slog.Info("MCP port changed", "port", newPort)
	return nil
}

func (s *Server) StartStdio() error {
	return mcpserver.ServeStdio(s.mcp)
}

func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	if !s.allowOrigin(r) {
		writeJSONRPCError(w, nil, mcp.INVALID_REQUEST, "Origin not allowed")
		return
	}

	switch r.Method {
	case http.MethodGet:
		s.handleStreamableSSE(w, r)
	case http.MethodPost:
		s.handleStreamablePost(w, r)
	case http.MethodDelete:
		s.handleSessionDelete(w, r)
	default:
		w.Header().Set("Allow", "GET, POST, DELETE")
		writeJSONRPCError(w, nil, mcp.INVALID_REQUEST, "Method not allowed")
	}
}

func (s *Server) handleStreamableSSE(w http.ResponseWriter, r *http.Request) {
	if err := validateProtocolHeader(r); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	sessionID := r.Header.Get("Mcp-Session-Id")
	if sessionID == "" {
		sessionID = uuid.NewString()
	}
	s.attachSSESession(w, r, sessionID, true, nil)
}

func (s *Server) handleLegacySSE(w http.ResponseWriter, r *http.Request) {
	if !s.allowOrigin(r) {
		http.Error(w, "Origin not allowed", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sessionID := uuid.NewString()
	messageEndpoint := fmt.Sprintf("http://localhost:%d/message?sessionId=%s", s.cfg.MCPPort, sessionID)
	s.attachSSESession(w, r, sessionID, false, func() {
		if ok := s.writeSSEMessage(sessionID, "endpoint", []byte(messageEndpoint)); !ok {
			slog.Debug("MCP legacy endpoint event dropped", "session", sessionID)
		}
	})
}

func (s *Server) handleLegacyMessage(w http.ResponseWriter, r *http.Request) {
	if !s.allowOrigin(r) {
		writeJSONRPCError(w, nil, mcp.INVALID_REQUEST, "Origin not allowed")
		return
	}
	if r.Method != http.MethodPost {
		writeJSONRPCError(w, nil, mcp.INVALID_REQUEST, "Method not allowed")
		return
	}

	sessionID := r.URL.Query().Get("sessionId")
	if sessionID == "" {
		writeJSONRPCError(w, nil, mcp.INVALID_PARAMS, "Missing sessionId")
		return
	}

	rawMessage, ok := decodeRawMessage(w, r)
	if !ok {
		return
	}
	baseMessage, ok := parseBaseMessage(w, rawMessage)
	if !ok {
		return
	}

	ctx := s.mcp.WithContext(r.Context(), mcpserver.NotificationContext{
		ClientID:  sessionID,
		SessionID: sessionID,
	})
	response := s.mcp.HandleMessage(ctx, rawMessage)
	if response != nil {
		payload, err := json.Marshal(response)
		if err != nil {
			writeJSONRPCError(w, nil, mcp.INTERNAL_ERROR, "Failed to encode response")
			return
		}
		payload = normalizeResponsePayload(baseMessage.Method, payload)
		if !s.writeSSEMessage(sessionID, "message", payload) {
			writeJSONRPCError(w, nil, mcp.INVALID_PARAMS, "Invalid session ID")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Mcp-Protocol-Version", supportedProtocolVersion)
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write(payload)
		return
	}

	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) handleStreamablePost(w http.ResponseWriter, r *http.Request) {
	rawMessage, ok := decodeRawMessage(w, r)
	if !ok {
		return
	}

	sessionID := strings.TrimSpace(r.Header.Get("Mcp-Session-Id"))
	baseMessage, ok := parseBaseMessage(w, rawMessage)
	if !ok {
		return
	}
	if baseMessage.Method != "initialize" {
		if err := validateProtocolHeader(r); err != nil {
			writeJSONRPCError(w, baseMessage.ID, mcp.INVALID_REQUEST, err.Error())
			return
		}
	}

	if sessionID == "" && baseMessage.Method != "initialize" {
		writeJSONRPCError(w, baseMessage.ID, mcp.INVALID_PARAMS, "Missing Mcp-Session-Id")
		return
	}

	if sessionID == "" {
		sessionID = uuid.NewString()
	}
	if _, loaded := s.sessions.LoadOrStore(sessionID, &session{id: sessionID}); !loaded {
		slog.Debug("MCP session created", "session", sessionID)
	}

	ctx := s.mcp.WithContext(r.Context(), mcpserver.NotificationContext{
		ClientID:  sessionID,
		SessionID: sessionID,
	})

	response := s.mcp.HandleMessage(ctx, rawMessage)
	w.Header().Set("Mcp-Session-Id", sessionID)
	w.Header().Set("Mcp-Protocol-Version", supportedProtocolVersion)
	if response == nil {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	payload, err := json.Marshal(response)
	if err != nil {
		writeJSONRPCError(w, baseMessage.ID, mcp.INTERNAL_ERROR, "Failed to encode response")
		return
	}
	payload = normalizeResponsePayload(baseMessage.Method, payload)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}

func (s *Server) handleSessionDelete(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimSpace(r.Header.Get("Mcp-Session-Id"))
	if sessionID == "" {
		http.Error(w, "Missing Mcp-Session-Id", http.StatusBadRequest)
		return
	}
	if value, ok := s.sessions.LoadAndDelete(sessionID); ok {
		sess := value.(*session)
		sess.writeMu.Lock()
		sess.writer = nil
		sess.flusher = nil
		sess.writeMu.Unlock()
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) attachSSESession(w http.ResponseWriter, r *http.Request, sessionID string, emitSessionHeader bool, onReady func()) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if emitSessionHeader {
		w.Header().Set("Mcp-Session-Id", sessionID)
		w.Header().Set("Mcp-Protocol-Version", supportedProtocolVersion)
	}

	sess := s.getOrCreateSession(sessionID)
	sess.writeMu.Lock()
	sess.writer = w
	sess.flusher = flusher
	sess.writeMu.Unlock()

	if emitSessionHeader {
		_, _ = w.Write([]byte(": connected\n\n"))
		flusher.Flush()
	}
	if onReady != nil {
		onReady()
	}

	<-r.Context().Done()

	sess.writeMu.Lock()
	if sess.writer == w {
		sess.writer = nil
		sess.flusher = nil
	}
	sess.writeMu.Unlock()
}

func (s *Server) getOrCreateSession(sessionID string) *session {
	if value, ok := s.sessions.Load(sessionID); ok {
		return value.(*session)
	}
	sess := &session{id: sessionID}
	actual, _ := s.sessions.LoadOrStore(sessionID, sess)
	return actual.(*session)
}

func (s *Server) writeSSEMessage(sessionID, event string, payload []byte) bool {
	value, ok := s.sessions.Load(sessionID)
	if !ok {
		return false
	}
	sess := value.(*session)
	sess.writeMu.Lock()
	defer sess.writeMu.Unlock()
	if sess.writer == nil || sess.flusher == nil {
		return false
	}

	_, err := fmt.Fprintf(sess.writer, "event: %s\ndata: %s\n\n", event, payload)
	if err != nil {
		sess.writer = nil
		sess.flusher = nil
		return false
	}
	sess.flusher.Flush()
	return true
}

func (s *Server) allowOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}

	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}

	host := strings.ToLower(parsed.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func (s *Server) updateStatus(fn func(*Status)) {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	fn(&s.status)
}

func decodeRawMessage(w http.ResponseWriter, r *http.Request) (json.RawMessage, bool) {
	defer r.Body.Close()
	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeJSONRPCError(w, nil, mcp.PARSE_ERROR, "Parse error")
		return nil, false
	}
	return raw, true
}

type baseMessage struct {
	JSONRPC string      `json:"jsonrpc"`
	Method  string      `json:"method"`
	ID      interface{} `json:"id,omitempty"`
}

func parseBaseMessage(w http.ResponseWriter, raw json.RawMessage) (baseMessage, bool) {
	var msg baseMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		writeJSONRPCError(w, nil, mcp.PARSE_ERROR, "Parse error")
		return baseMessage{}, false
	}
	if msg.JSONRPC != mcp.JSONRPC_VERSION {
		writeJSONRPCError(w, msg.ID, mcp.INVALID_REQUEST, "Invalid JSON-RPC version")
		return baseMessage{}, false
	}
	return msg, true
}

func writeJSONRPCError(w http.ResponseWriter, id interface{}, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"jsonrpc": mcp.JSONRPC_VERSION,
		"id":      id,
		"error": map[string]interface{}{
			"code":    code,
			"message": message,
		},
	})
}

func validateProtocolHeader(r *http.Request) error {
	version := strings.TrimSpace(r.Header.Get("Mcp-Protocol-Version"))
	if version == "" {
		return nil
	}
	if version != supportedProtocolVersion {
		return fmt.Errorf("Unsupported MCP-Protocol-Version: %s", version)
	}
	return nil
}

func normalizeResponsePayload(method string, payload []byte) []byte {
	if method != "initialize" {
		return payload
	}

	var message map[string]interface{}
	if err := json.Unmarshal(payload, &message); err != nil {
		return payload
	}
	result, ok := message["result"].(map[string]interface{})
	if !ok {
		return payload
	}
	result["protocolVersion"] = supportedProtocolVersion
	normalized, err := json.Marshal(message)
	if err != nil {
		return payload
	}
	return normalized
}
