package team

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/hamedsj5/pandorabox/internal/project"
	"github.com/hamedsj5/pandorabox/internal/storage"
)

var teamUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// connectedMember represents an authenticated team member connection.
type connectedMember struct {
	member Member
	conn   *websocket.Conn
	send   chan []byte
	mu     sync.Mutex
}

// Server is the team sync hub. It runs in --team-server mode.
// It maintains shared project state and relays traffic events between clients.
type Server struct {
	cfg     *ServerConfig
	project *project.Manager
	db      *storage.DB

	mu            sync.RWMutex
	members       map[string]*connectedMember // keyed by user_id
	configVersion int64
	configJSON    json.RawMessage

	startTime time.Time
}

// NewServer constructs a team Server. The project manager and DB are loaded
// from cfg.DataDir.
func NewServer(cfg *ServerConfig, proj *project.Manager, db *storage.DB) *Server {
	return &Server{
		cfg:       cfg,
		project:   proj,
		db:        db,
		members:   make(map[string]*connectedMember),
		startTime: time.Now(),
	}
}

// Start begins accepting WebSocket connections on cfg.TeamPort.
func (s *Server) Start(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/team", s.serveWS)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	addr := fmt.Sprintf(":%d", s.cfg.TeamPort)
	srv := &http.Server{Addr: addr, Handler: mux}

	go func() {
		<-ctx.Done()
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutCtx) //nolint:errcheck
	}()

	slog.Info("team server listening", "addr", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("team server: %w", err)
	}
	return nil
}

// UptimeSeconds returns seconds since the server started.
func (s *Server) UptimeSeconds() int64 {
	return int64(time.Since(s.startTime).Seconds())
}

// Members returns a snapshot of currently connected members.
func (s *Server) Members() []Member {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Member, 0, len(s.members))
	for _, m := range s.members {
		out = append(out, m.member)
	}
	return out
}

// ConfigVersion returns the current config version counter.
func (s *Server) ConfigVersion() int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.configVersion
}

// serveWS upgrades a connection and runs the auth + relay loop.
func (s *Server) serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := teamUpgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("team WS upgrade", "err", err)
		return
	}

	// Auth timeout: client must send team.auth within 10 seconds.
	conn.SetReadDeadline(time.Now().Add(10 * time.Second)) //nolint:errcheck
	_, raw, err := conn.ReadMessage()
	if err != nil {
		conn.Close()
		return
	}
	conn.SetReadDeadline(time.Time{}) //nolint:errcheck

	env, err := decode(raw)
	if err != nil || env.Type != MsgAuth {
		s.sendError(conn, "expected team.auth as first message")
		conn.Close()
		return
	}

	var auth AuthPayload
	if err := json.Unmarshal(env.Data, &auth); err != nil {
		s.sendError(conn, "malformed auth payload")
		conn.Close()
		return
	}

	if !s.cfg.CheckPassword(auth.Password) {
		s.sendError(conn, "invalid password")
		conn.Close()
		return
	}
	if auth.UserID == "" {
		s.sendError(conn, "user_id is required")
		conn.Close()
		return
	}

	// Assign / validate color.
	color := s.assignColor(auth.UserID, auth.Color)

	m := &connectedMember{
		member: Member{
			UserID:      auth.UserID,
			DisplayName: auth.DisplayName,
			Color:       color,
			Online:      true,
		},
		conn: conn,
		send: make(chan []byte, 64),
	}

	// Check member cap.
	s.mu.Lock()
	if len(s.members) >= s.cfg.MaxMembers {
		s.mu.Unlock()
		s.sendError(conn, "server is at capacity")
		conn.Close()
		return
	}
	s.members[auth.UserID] = m
	currentMembers := s.snapshotMembers()
	cfgVersion := s.configVersion
	cfgJSON := s.configJSON
	s.mu.Unlock()

	// Send welcome.
	welcome, _ := encode(MsgAuthOK, AuthOKPayload{
		Members:       currentMembers,
		ConfigVersion: cfgVersion,
		Config:        cfgJSON,
	})
	if err := conn.WriteMessage(websocket.TextMessage, welcome); err != nil {
		s.removeMember(auth.UserID)
		conn.Close()
		return
	}

	// Notify others.
	s.fanOut(auth.UserID, MsgMemberJoined, MemberEventPayload{
		UserID:      auth.UserID,
		DisplayName: auth.DisplayName,
		Color:       color,
	})
	slog.Info("team member joined", "user_id", auth.UserID, "display_name", auth.DisplayName)

	// Start sender goroutine.
	go m.writePump()

	// Read loop.
	s.readLoop(m)
}

// readLoop handles messages from an authenticated member.
func (s *Server) readLoop(m *connectedMember) {
	defer func() {
		s.removeMember(m.member.UserID)
		m.conn.Close()
	}()

	m.conn.SetReadDeadline(time.Now().Add(60 * time.Second)) //nolint:errcheck
	m.conn.SetPongHandler(func(string) error {
		m.conn.SetReadDeadline(time.Now().Add(60 * time.Second)) //nolint:errcheck
		return nil
	})

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	go func() {
		for range ticker.C {
			msg, _ := encode(MsgPing, PingPayload{TS: time.Now().UTC().Format(time.RFC3339)})
			m.enqueue(msg)
		}
	}()

	for {
		_, raw, err := m.conn.ReadMessage()
		if err != nil {
			return
		}
		m.conn.SetReadDeadline(time.Now().Add(60 * time.Second)) //nolint:errcheck

		env, err := decode(raw)
		if err != nil {
			continue
		}

		switch env.Type {
		case MsgRequestCaptured:
			// Fan out to all other members and persist to server DB.
			var payload RequestCapturedPayload
			if err := json.Unmarshal(env.Data, &payload); err != nil {
				continue
			}
			// Save remote request to server DB.
			go s.saveRemoteRequest(payload)
			// Relay to everyone else.
			s.fanOut(m.member.UserID, MsgRequestCaptured, payload)

		case MsgConfigPush:
			var payload ConfigPushPayload
			if err := json.Unmarshal(env.Data, &payload); err != nil {
				continue
			}
			s.mu.Lock()
			if payload.Version > s.configVersion {
				s.configVersion = payload.Version
				s.configJSON = payload.Config
				// Persist to disk via project manager.
				go s.persistConfig(payload.Config)
				updatePayload := ConfigUpdatePayload{
					Version:   payload.Version,
					ChangedBy: m.member.UserID,
					Config:    payload.Config,
				}
				s.mu.Unlock()
				s.broadcast(MsgConfigUpdate, updatePayload)
			} else {
				s.mu.Unlock()
			}

		case MsgPong:
			// pong is handled by SetPongHandler; nothing extra needed.
		}
	}
}

// writePump drains the send channel and writes to the WebSocket connection.
func (m *connectedMember) writePump() {
	for msg := range m.send {
		m.mu.Lock()
		err := m.conn.WriteMessage(websocket.TextMessage, msg)
		m.mu.Unlock()
		if err != nil {
			return
		}
	}
}

// enqueue adds a message to the member's send buffer (drops if full).
func (m *connectedMember) enqueue(msg []byte) {
	select {
	case m.send <- msg:
	default:
	}
}

// fanOut sends msg to all members except excludeUserID.
func (s *Server) fanOut(excludeUserID string, msgType string, payload interface{}) {
	msg, err := encode(msgType, payload)
	if err != nil {
		return
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for uid, m := range s.members {
		if uid == excludeUserID {
			continue
		}
		m.enqueue(msg)
	}
}

// broadcast sends msg to ALL connected members.
func (s *Server) broadcast(msgType string, payload interface{}) {
	msg, err := encode(msgType, payload)
	if err != nil {
		return
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, m := range s.members {
		m.enqueue(msg)
	}
}

// KickMember forcibly disconnects a member by user_id.
func (s *Server) KickMember(userID string) bool {
	s.mu.Lock()
	m, ok := s.members[userID]
	s.mu.Unlock()
	if !ok {
		return false
	}
	m.conn.Close()
	return true
}

func (s *Server) removeMember(userID string) {
	s.mu.Lock()
	m, ok := s.members[userID]
	if ok {
		close(m.send)
		delete(s.members, userID)
	}
	s.mu.Unlock()
	if ok {
		s.fanOut(userID, MsgMemberLeft, MemberEventPayload{UserID: userID})
		slog.Info("team member left", "user_id", userID)
	}
}

func (s *Server) snapshotMembers() []Member {
	out := make([]Member, 0, len(s.members))
	for _, m := range s.members {
		out = append(out, m.member)
	}
	return out
}

func (s *Server) sendError(conn *websocket.Conn, msg string) {
	b, _ := encode(MsgAuthError, AuthErrorPayload{Message: msg})
	conn.WriteMessage(websocket.TextMessage, b) //nolint:errcheck
}

// saveRemoteRequest unmarshals a storage.Request from the payload and inserts it
// into the server's DB.
func (s *Server) saveRemoteRequest(payload RequestCapturedPayload) {
	if s.db == nil {
		return
	}
	var req storage.Request
	if err := json.Unmarshal(payload.Request, &req); err != nil {
		slog.Warn("team server: failed to unmarshal remote request", "err", err)
		return
	}
	req.UserID = payload.UserID
	// Clear raw to avoid storing large blobs from remote clients.
	req.Raw = nil
	if _, err := s.db.SaveRequest(&req); err != nil {
		slog.Warn("team server: failed to save remote request", "err", err)
	}
}

// persistConfig writes the latest project config to disk.
func (s *Server) persistConfig(cfgJSON json.RawMessage) {
	if s.project == nil {
		return
	}
	var cfg project.Config
	if err := json.Unmarshal(cfgJSON, &cfg); err != nil {
		slog.Warn("team server: failed to unmarshal project config", "err", err)
		return
	}
	if err := s.project.Save(cfg); err != nil {
		slog.Warn("team server: failed to save project config", "err", err)
	}
}

// accentColors is the ordered pool used for deterministic color assignment.
var accentColors = []string{
	"teal", "blue", "purple", "indigo", "pink",
	"red", "orange", "yellow", "green", "cyan",
}

// assignColor returns the color to use for userID. It honors the preferred color
// if it is not already taken by another connected member, otherwise assigns the
// next available slot.
func (s *Server) assignColor(userID, preferred string) string {
	used := make(map[string]bool)
	for uid, m := range s.members {
		if uid != userID {
			used[m.member.Color] = true
		}
	}
	if preferred != "" && !used[preferred] {
		return preferred
	}
	for _, c := range accentColors {
		if !used[c] {
			return c
		}
	}
	return "teal" // fallback if all 10 are taken
}
