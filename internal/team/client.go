package team

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/hamedsj5/pandorabox/internal/events"
	"github.com/hamedsj5/pandorabox/internal/project"
	"github.com/hamedsj5/pandorabox/internal/storage"
)

// ClientConfig holds the settings for connecting to a team server.
type ClientConfig struct {
	ServerURL   string // ws://host:7778
	Password    string
	UserID      string
	DisplayName string
	Color       string
}

// SyncStatus describes the current connection state.
type SyncStatus string

const (
	SyncConnected    SyncStatus = "connected"
	SyncConnecting   SyncStatus = "connecting"
	SyncDisconnected SyncStatus = "disconnected"
)

// Client is the outbound team connection that runs inside a normal pandorabox
// serve process. It bridges the local event bus and the remote team server.
type Client struct {
	cfg     ClientConfig
	bus     *events.Bus
	project *project.Manager
	db      *storage.DB

	mu         sync.RWMutex
	members    []Member
	syncStatus SyncStatus
	conn       *websocket.Conn

	// configPush is a debounce timer for sending local config changes.
	configPushMu      sync.Mutex
	configPushTimer   *time.Timer
	configPushPending *ConfigPushPayload

	cancel context.CancelFunc
}

// NewClient constructs a team Client. It does not connect until Start() is called.
func NewClient(cfg ClientConfig, bus *events.Bus, proj *project.Manager, db *storage.DB) *Client {
	return &Client{
		cfg:        cfg,
		bus:        bus,
		project:    proj,
		db:         db,
		syncStatus: SyncDisconnected,
	}
}

// Start begins the reconnect loop in a background goroutine.
func (c *Client) Start(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	go c.reconnectLoop(ctx)
	go c.subscribeLocal(ctx)
}

// Stop gracefully shuts down the client.
func (c *Client) Stop() {
	if c.cancel != nil {
		c.cancel()
	}
}

// Members returns a snapshot of the current team member list.
func (c *Client) Members() []Member {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]Member, len(c.members))
	copy(out, c.members)
	return out
}

// SyncStatusValue returns the current connection status.
func (c *Client) SyncStatusValue() SyncStatus {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.syncStatus
}

// UpdateConfig schedules a debounced push of the local project config to the server.
// The push fires 5 seconds after the last call.
func (c *Client) UpdateConfig(cfg project.Config, version int64) {
	cfgJSON, err := json.Marshal(cfg)
	if err != nil {
		return
	}
	payload := &ConfigPushPayload{Version: version, Config: cfgJSON}

	c.configPushMu.Lock()
	c.configPushPending = payload
	if c.configPushTimer != nil {
		c.configPushTimer.Stop()
	}
	c.configPushTimer = time.AfterFunc(5*time.Second, func() {
		c.configPushMu.Lock()
		p := c.configPushPending
		c.configPushMu.Unlock()
		if p != nil {
			c.sendMsg(MsgConfigPush, p)
		}
	})
	c.configPushMu.Unlock()
}

// reconnectLoop maintains the WebSocket connection with exponential backoff.
func (c *Client) reconnectLoop(ctx context.Context) {
	backoff := time.Second
	const maxBackoff = 30 * time.Second

	for {
		c.setStatus(SyncConnecting)
		conn, err := c.connect(ctx)
		if err != nil {
			slog.Info("team client: connect failed", "err", err, "retry_in", backoff)
			c.setStatus(SyncDisconnected)
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			if backoff < maxBackoff {
				backoff *= 2
			}
			continue
		}

		// Reset backoff on successful auth.
		backoff = time.Second
		c.mu.Lock()
		c.conn = conn
		c.mu.Unlock()

		c.readLoop(ctx, conn)

		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()
		c.setStatus(SyncDisconnected)

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
	}
}

// connect dials the team server and performs authentication. Returns the
// authenticated connection or an error.
func (c *Client) connect(ctx context.Context) (*websocket.Conn, error) {
	dialer := websocket.DefaultDialer
	conn, _, err := dialer.DialContext(ctx, c.cfg.ServerURL+"/team", nil)
	if err != nil {
		return nil, err
	}

	// Send auth.
	auth, err := encode(MsgAuth, AuthPayload{
		Password:    c.cfg.Password,
		UserID:      c.cfg.UserID,
		DisplayName: c.cfg.DisplayName,
		Color:       c.cfg.Color,
	})
	if err != nil {
		conn.Close()
		return nil, err
	}
	if err := conn.WriteMessage(websocket.TextMessage, auth); err != nil {
		conn.Close()
		return nil, err
	}

	// Wait for auth response.
	conn.SetReadDeadline(time.Now().Add(10 * time.Second)) //nolint:errcheck
	_, raw, err := conn.ReadMessage()
	if err != nil {
		conn.Close()
		return nil, err
	}
	conn.SetReadDeadline(time.Time{}) //nolint:errcheck

	env, err := decode(raw)
	if err != nil {
		conn.Close()
		return nil, err
	}
	if env.Type == MsgAuthError {
		var errPayload AuthErrorPayload
		json.Unmarshal(env.Data, &errPayload) //nolint:errcheck
		conn.Close()
		return nil, &AuthError{Message: errPayload.Message}
	}
	if env.Type != MsgAuthOK {
		conn.Close()
		return nil, &AuthError{Message: "unexpected response to auth"}
	}

	var ok AuthOKPayload
	if err := json.Unmarshal(env.Data, &ok); err != nil {
		conn.Close()
		return nil, err
	}

	c.setMembers(ok.Members)
	c.setStatus(SyncConnected)
	c.bus.Publish(events.Event{Type: events.EventTeamMembersUpdate, Data: ok.Members})
	c.bus.Publish(events.Event{Type: events.EventTeamSyncStatus, Data: map[string]string{"status": string(SyncConnected)}})

	// Apply server's config if it's newer.
	if ok.Config != nil && c.project != nil {
		go c.applyServerConfig(ok.Config, ok.ConfigVersion)
	}

	// Push our local config to the server on first connect.
	if c.project != nil {
		go func() {
			cfg := c.project.Config()
			cfgJSON, _ := json.Marshal(cfg)
			c.sendMsg(MsgConfigPush, ConfigPushPayload{
				Version: ok.ConfigVersion + 1,
				Config:  cfgJSON,
			})
		}()
	}

	return conn, nil
}

// readLoop handles incoming messages from the server.
func (c *Client) readLoop(ctx context.Context, conn *websocket.Conn) {
	conn.SetReadDeadline(time.Now().Add(60 * time.Second)) //nolint:errcheck
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second)) //nolint:errcheck
		return nil
	})

	for {
		select {
		case <-ctx.Done():
			conn.Close()
			return
		default:
		}

		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		conn.SetReadDeadline(time.Now().Add(60 * time.Second)) //nolint:errcheck

		env, err := decode(raw)
		if err != nil {
			continue
		}

		switch env.Type {
		case MsgMemberJoined:
			var p MemberEventPayload
			if err := json.Unmarshal(env.Data, &p); err != nil {
				continue
			}
			m := Member{UserID: p.UserID, DisplayName: p.DisplayName, Color: p.Color, Online: true}
			c.upsertMember(m)
			c.bus.Publish(events.Event{Type: events.EventTeamMemberJoined, Data: m})

		case MsgMemberLeft:
			var p MemberEventPayload
			if err := json.Unmarshal(env.Data, &p); err != nil {
				continue
			}
			c.removeMember(p.UserID)
			c.bus.Publish(events.Event{Type: events.EventTeamMemberLeft, Data: map[string]string{"user_id": p.UserID}})

		case MsgRequestCaptured:
			var payload RequestCapturedPayload
			if err := json.Unmarshal(env.Data, &payload); err != nil {
				continue
			}
			// Skip our own traffic (should not happen but guard anyway).
			if payload.UserID == c.cfg.UserID {
				continue
			}
			go c.saveRemoteRequest(payload)

		case MsgConfigUpdate:
			var payload ConfigUpdatePayload
			if err := json.Unmarshal(env.Data, &payload); err != nil {
				continue
			}
			if payload.ChangedBy != c.cfg.UserID {
				go c.applyServerConfig(payload.Config, payload.Version)
			}

		case MsgPing:
			pong, _ := encode(MsgPong, struct{}{})
			conn.WriteMessage(websocket.TextMessage, pong) //nolint:errcheck

		// ── Organizer relay messages → apply to local DB + publish to browser ─
		case MsgOrganizerFolderCreated:
			var p OrganizerMutationPayload
			if err := json.Unmarshal(env.Data, &p); err != nil {
				continue
			}
			go c.applyRemoteOrganizerFolderCreate(p)

		case MsgOrganizerFolderUpdated:
			var p OrganizerMutationPayload
			if err := json.Unmarshal(env.Data, &p); err != nil {
				continue
			}
			go c.applyRemoteOrganizerFolderUpdate(p)

		case MsgOrganizerFolderDeleted:
			var p OrganizerDeletePayload
			if err := json.Unmarshal(env.Data, &p); err != nil {
				continue
			}
			go c.applyRemoteOrganizerFolderDelete(p)

		case MsgOrganizerFoldersReordered:
			var p OrganizerReorderPayload
			if err := json.Unmarshal(env.Data, &p); err != nil {
				continue
			}
			go c.applyRemoteOrganizerFoldersReorder(p)

		case MsgOrganizerItemAdded:
			var p OrganizerMutationPayload
			if err := json.Unmarshal(env.Data, &p); err != nil {
				continue
			}
			go c.applyRemoteOrganizerItemAdd(p)

		case MsgOrganizerItemUpdated:
			var p OrganizerMutationPayload
			if err := json.Unmarshal(env.Data, &p); err != nil {
				continue
			}
			go c.applyRemoteOrganizerItemUpdate(p)

		case MsgOrganizerItemRemoved:
			var p OrganizerDeletePayload
			if err := json.Unmarshal(env.Data, &p); err != nil {
				continue
			}
			go c.applyRemoteOrganizerItemRemove(p)

		case MsgOrganizerItemsReordered:
			var p OrganizerReorderPayload
			if err := json.Unmarshal(env.Data, &p); err != nil {
				continue
			}
			go c.applyRemoteOrganizerItemsReorder(p)
		}
	}
}

// subscribeLocal listens to the local event bus and forwards relevant events to
// the team server.
func (c *Client) subscribeLocal(ctx context.Context) {
	sub := c.bus.Subscribe()
	defer c.bus.Unsubscribe(sub)

	for {
		select {
		case <-ctx.Done():
			return
		case evt, ok := <-sub:
			if !ok {
				return
			}
			switch evt.Type {
			case events.EventRequestCaptured:
				c.forwardRequest(evt.Data)
			case events.EventOrganizerFolderCreated:
				c.forwardOrganizerEvent(MsgOrganizerFolderCreated, evt.Data)
			case events.EventOrganizerFolderUpdated:
				c.forwardOrganizerEvent(MsgOrganizerFolderUpdated, evt.Data)
			case events.EventOrganizerFolderDeleted:
				c.forwardOrganizerDelete(MsgOrganizerFolderDeleted, evt.Data)
			case events.EventOrganizerFoldersReordered:
				c.forwardOrganizerReorder(MsgOrganizerFoldersReordered, evt.Data, 0)
			case events.EventOrganizerItemAdded:
				c.forwardOrganizerEvent(MsgOrganizerItemAdded, evt.Data)
			case events.EventOrganizerItemUpdated:
				c.forwardOrganizerEvent(MsgOrganizerItemUpdated, evt.Data)
			case events.EventOrganizerItemRemoved:
				c.forwardOrganizerDelete(MsgOrganizerItemRemoved, evt.Data)
			case events.EventOrganizerItemsReordered:
				if m, ok := evt.Data.(map[string]int64); ok {
					c.forwardOrganizerReorder(MsgOrganizerItemsReordered, nil, m["folder_id"])
				}
			}
		}
	}
}

// forwardRequest sends a newly captured local request to the team server.
func (c *Client) forwardRequest(data interface{}) {
	// data is *storage.Request
	reqJSON, err := json.Marshal(data)
	if err != nil {
		return
	}
	payload := RequestCapturedPayload{
		UserID:  c.cfg.UserID,
		Request: reqJSON,
	}
	c.sendMsg(MsgRequestCaptured, payload)
}

// saveRemoteRequest unmarshals and inserts a remote request into the local DB,
// then publishes it on the local bus so the browser UI receives it.
func (c *Client) saveRemoteRequest(payload RequestCapturedPayload) {
	if c.db == nil {
		return
	}
	var req storage.Request
	if err := json.Unmarshal(payload.Request, &req); err != nil {
		slog.Warn("team client: bad remote request", "err", err)
		return
	}
	req.UserID = payload.UserID
	req.Raw = nil // raw blobs are not transmitted over the wire
	id, err := c.db.SaveRequest(&req)
	if err != nil {
		slog.Warn("team client: failed to save remote request", "err", err)
		return
	}
	req.ID = id
	c.bus.Publish(events.Event{Type: events.EventRequestCaptured, Data: &req})
}

// applyServerConfig unmarshals and applies a remote project config to the local
// project manager, then publishes EventProjectUpdated so the UI refreshes.
func (c *Client) applyServerConfig(cfgJSON json.RawMessage, version int64) {
	if c.project == nil {
		return
	}
	var cfg project.Config
	if err := json.Unmarshal(cfgJSON, &cfg); err != nil {
		slog.Warn("team client: bad remote config", "err", err)
		return
	}
	if err := c.project.Save(cfg); err != nil {
		slog.Warn("team client: failed to apply remote config", "err", err)
		return
	}
	c.bus.Publish(events.Event{Type: events.EventProjectUpdated, Data: cfg})
	slog.Info("team client: applied server config", "version", version)
}

// sendMsg encodes and writes a message to the current connection (best-effort).
func (c *Client) sendMsg(msgType string, payload interface{}) {
	c.mu.RLock()
	conn := c.conn
	c.mu.RUnlock()
	if conn == nil {
		return
	}
	msg, err := encode(msgType, payload)
	if err != nil {
		return
	}
	conn.WriteMessage(websocket.TextMessage, msg) //nolint:errcheck
}

func (c *Client) setStatus(s SyncStatus) {
	c.mu.Lock()
	c.syncStatus = s
	c.mu.Unlock()
	c.bus.Publish(events.Event{
		Type: events.EventTeamSyncStatus,
		Data: map[string]string{"status": string(s)},
	})
}

func (c *Client) setMembers(members []Member) {
	c.mu.Lock()
	c.members = members
	c.mu.Unlock()
}

func (c *Client) upsertMember(m Member) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, existing := range c.members {
		if existing.UserID == m.UserID {
			c.members[i] = m
			return
		}
	}
	c.members = append(c.members, m)
}

func (c *Client) removeMember(userID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	filtered := c.members[:0]
	for _, m := range c.members {
		if m.UserID != userID {
			filtered = append(filtered, m)
		}
	}
	c.members = filtered
}

// ─── Organizer forwarding helpers ────────────────────────────────────────────

func (c *Client) forwardOrganizerEvent(msgType string, data interface{}) {
	dataJSON, err := json.Marshal(data)
	if err != nil {
		return
	}
	c.sendMsg(msgType, OrganizerMutationPayload{UserID: c.cfg.UserID, Data: dataJSON})
}

func (c *Client) forwardOrganizerDelete(msgType string, data interface{}) {
	// data should be map[string]int64{"id": ...}
	if m, ok := data.(map[string]int64); ok {
		c.sendMsg(msgType, OrganizerDeletePayload{UserID: c.cfg.UserID, ID: m["id"]})
	}
}

func (c *Client) forwardOrganizerReorder(msgType string, data interface{}, folderID int64) {
	var rawData json.RawMessage
	if data != nil {
		b, err := json.Marshal(data)
		if err != nil {
			return
		}
		rawData = b
	}
	c.sendMsg(msgType, OrganizerReorderPayload{UserID: c.cfg.UserID, FolderID: folderID, Data: rawData})
}

// ─── Organizer remote-apply helpers ──────────────────────────────────────────

func (c *Client) applyRemoteOrganizerFolderCreate(p OrganizerMutationPayload) {
	if c.db == nil {
		return
	}
	var f storage.OrganizerFolder
	if err := json.Unmarshal(p.Data, &f); err != nil {
		return
	}
	f.ID = 0
	if _, err := c.db.CreateOrganizerFolder(&f); err != nil {
		slog.Warn("team client: failed to apply remote folder create", "err", err)
		return
	}
	// Re-fetch to get the DB-assigned ID and timestamps.
	flat, _ := c.db.ListOrganizerFolders()
	c.bus.Publish(events.Event{Type: events.EventOrganizerFolderCreated, Data: flat})
}

func (c *Client) applyRemoteOrganizerFolderUpdate(p OrganizerMutationPayload) {
	if c.db == nil {
		return
	}
	var f storage.OrganizerFolder
	if err := json.Unmarshal(p.Data, &f); err != nil {
		return
	}
	if err := c.db.UpdateOrganizerFolder(&f); err != nil {
		slog.Warn("team client: failed to apply remote folder update", "err", err)
		return
	}
	updated, _ := c.db.GetOrganizerFolder(f.ID)
	if updated != nil {
		c.bus.Publish(events.Event{Type: events.EventOrganizerFolderUpdated, Data: updated})
	}
}

func (c *Client) applyRemoteOrganizerFolderDelete(p OrganizerDeletePayload) {
	if c.db == nil {
		return
	}
	if err := c.db.DeleteOrganizerFolder(p.ID); err != nil {
		slog.Warn("team client: failed to apply remote folder delete", "err", err)
		return
	}
	c.bus.Publish(events.Event{Type: events.EventOrganizerFolderDeleted, Data: map[string]int64{"id": p.ID}})
}

func (c *Client) applyRemoteOrganizerFoldersReorder(p OrganizerReorderPayload) {
	if c.db == nil {
		return
	}
	var updates []storage.ReorderFolderUpdate
	if err := json.Unmarshal(p.Data, &updates); err != nil {
		return
	}
	if err := c.db.ReorderOrganizerFolders(updates); err != nil {
		slog.Warn("team client: failed to apply remote folders reorder", "err", err)
		return
	}
	c.bus.Publish(events.Event{Type: events.EventOrganizerFoldersReordered, Data: updates})
}

func (c *Client) applyRemoteOrganizerItemAdd(p OrganizerMutationPayload) {
	if c.db == nil {
		return
	}
	var item storage.OrganizerItem
	if err := json.Unmarshal(p.Data, &item); err != nil {
		return
	}
	item.ID = 0
	if _, err := c.db.AddOrganizerItem(&item); err != nil {
		slog.Warn("team client: failed to apply remote item add", "err", err)
		return
	}
	items, _ := c.db.ListOrganizerItems(item.FolderID)
	c.bus.Publish(events.Event{Type: events.EventOrganizerItemAdded, Data: map[string]interface{}{
		"folder_id": item.FolderID,
		"items":     items,
	}})
}

func (c *Client) applyRemoteOrganizerItemUpdate(p OrganizerMutationPayload) {
	if c.db == nil {
		return
	}
	var item storage.OrganizerItem
	if err := json.Unmarshal(p.Data, &item); err != nil {
		return
	}
	if err := c.db.UpdateOrganizerItem(&item); err != nil {
		slog.Warn("team client: failed to apply remote item update", "err", err)
		return
	}
	c.bus.Publish(events.Event{Type: events.EventOrganizerItemUpdated, Data: &item})
}

func (c *Client) applyRemoteOrganizerItemRemove(p OrganizerDeletePayload) {
	if c.db == nil {
		return
	}
	if err := c.db.RemoveOrganizerItem(p.ID); err != nil {
		slog.Warn("team client: failed to apply remote item remove", "err", err)
		return
	}
	c.bus.Publish(events.Event{Type: events.EventOrganizerItemRemoved, Data: map[string]int64{"id": p.ID}})
}

func (c *Client) applyRemoteOrganizerItemsReorder(p OrganizerReorderPayload) {
	if c.db == nil {
		return
	}
	var updates []storage.ReorderItemUpdate
	if err := json.Unmarshal(p.Data, &updates); err != nil {
		return
	}
	if err := c.db.ReorderOrganizerItems(updates); err != nil {
		slog.Warn("team client: failed to apply remote items reorder", "err", err)
		return
	}
	c.bus.Publish(events.Event{Type: events.EventOrganizerItemsReordered, Data: map[string]int64{"folder_id": p.FolderID}})
}

// AuthError is returned when the server rejects the team.auth message.
type AuthError struct {
	Message string
}

func (e *AuthError) Error() string { return "team auth failed: " + e.Message }
