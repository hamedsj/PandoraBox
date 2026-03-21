package team

import "encoding/json"

// Wire message types — all messages use the shape { "type": string, "data": object }.
const (
	// Client → Server
	MsgAuth       = "team.auth"        // first message after TCP connect
	MsgConfigPush = "team.config.push" // debounced project config update

	// Server → Client
	MsgAuthOK       = "team.auth.ok"       // successful auth — sends full state
	MsgAuthError    = "team.auth.error"    // bad password or duplicate user
	MsgConfigUpdate = "team.config.update" // server accepted a new config version
	MsgMemberJoined = "team.member.joined" // new member authenticated
	MsgMemberLeft   = "team.member.left"   // member disconnected

	// Both directions (prefixed to avoid collision with app events)
	MsgRequestCaptured = "team.request.captured" // C→S: forward; S→*: fan-out
	MsgPing            = "team.ping"
	MsgPong            = "team.pong"
)

// Envelope is the top-level wrapper for all wire messages.
type Envelope struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// Member describes a team participant, sent in every presence-related message.
type Member struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Color       string `json:"color"`
	Online      bool   `json:"online"`
}

// --- Client → Server payloads ---

// AuthPayload is the body of a team.auth message.
type AuthPayload struct {
	Password    string `json:"password"`
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Color       string `json:"color"` // preferred accent color
}

// ConfigPushPayload is the body of a team.config.push message.
type ConfigPushPayload struct {
	Version int64           `json:"version"`
	Config  json.RawMessage `json:"config"` // project.Config JSON
}

// RequestCapturedPayload is the body of team.request.captured (both directions).
type RequestCapturedPayload struct {
	UserID  string          `json:"user_id"`
	Request json.RawMessage `json:"request"` // storage.Request JSON (raw bytes omitted)
}

// --- Server → Client payloads ---

// AuthOKPayload is the body of team.auth.ok.
type AuthOKPayload struct {
	Members       []Member        `json:"members"`
	ConfigVersion int64           `json:"config_version"`
	Config        json.RawMessage `json:"config"` // current authoritative project.Config
}

// AuthErrorPayload is the body of team.auth.error.
type AuthErrorPayload struct {
	Message string `json:"message"`
}

// MemberEventPayload is the body of team.member.joined and team.member.left.
type MemberEventPayload struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Color       string `json:"color"`
}

// ConfigUpdatePayload is the body of team.config.update.
type ConfigUpdatePayload struct {
	Version   int64           `json:"version"`
	ChangedBy string          `json:"changed_by"`
	Config    json.RawMessage `json:"config"`
}

// PingPayload / PongPayload are for heartbeat messages.
type PingPayload struct {
	TS string `json:"ts"` // RFC3339 timestamp
}

// ─── Organizer sync message types ────────────────────────────────────────────

const (
	MsgOrganizerFolderCreated    = "team.organizer.folder.created"
	MsgOrganizerFolderUpdated    = "team.organizer.folder.updated"
	MsgOrganizerFolderDeleted    = "team.organizer.folder.deleted"
	MsgOrganizerFoldersReordered = "team.organizer.folders.reordered"
	MsgOrganizerItemAdded        = "team.organizer.item.added"
	MsgOrganizerItemUpdated      = "team.organizer.item.updated"
	MsgOrganizerItemRemoved      = "team.organizer.item.removed"
	MsgOrganizerItemsReordered   = "team.organizer.items.reordered"
)

// OrganizerMutationPayload wraps any organizer create/update for relay.
type OrganizerMutationPayload struct {
	UserID string          `json:"user_id"`
	Data   json.RawMessage `json:"data"`
}

// OrganizerDeletePayload is used for folder.deleted and item.removed.
type OrganizerDeletePayload struct {
	UserID string `json:"user_id"`
	ID     int64  `json:"id"`
}

// OrganizerReorderPayload carries new sort_order assignments.
type OrganizerReorderPayload struct {
	UserID   string          `json:"user_id"`
	FolderID int64           `json:"folder_id,omitempty"` // set for item reorders
	Data     json.RawMessage `json:"data"`                // []ReorderFolderUpdate or []ReorderItemUpdate
}

// encode marshals an Envelope with the given type and payload.
func encode(msgType string, payload interface{}) ([]byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(Envelope{Type: msgType, Data: data})
}

// decode parses an Envelope from raw bytes.
func decode(raw []byte) (Envelope, error) {
	var env Envelope
	err := json.Unmarshal(raw, &env)
	return env, err
}
