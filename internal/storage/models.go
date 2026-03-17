package storage

import "time"

type Request struct {
	ID        int64     `json:"id"`
	Method    string    `json:"method"`
	Scheme    string    `json:"scheme"`
	Host      string    `json:"host"`
	Path      string    `json:"path"`
	Query     string    `json:"query"`
	Headers   string    `json:"headers"` // JSON
	Body      []byte    `json:"body"`
	Raw       []byte    `json:"raw,omitempty"`
	Timestamp time.Time `json:"timestamp"`
	Tags      string    `json:"tags"` // JSON array

	Response *Response `json:"response,omitempty"`
}

type Response struct {
	ID         int64     `json:"id"`
	RequestID  int64     `json:"request_id"`
	StatusCode int       `json:"status_code"`
	StatusText string    `json:"status_text"`
	Headers    string    `json:"headers"` // JSON
	Body       []byte    `json:"body"`
	Raw        []byte    `json:"raw,omitempty"`
	DurationMs int64     `json:"duration_ms"`
	SizeBytes  int64     `json:"size_bytes"`
	Timestamp  time.Time `json:"timestamp"`
}

type Replay struct {
	ID              int64     `json:"id"`
	OriginRequestID *int64    `json:"origin_request_id"`
	RequestID       int64     `json:"request_id"`
	ResponseID      *int64    `json:"response_id"`
	Status          string    `json:"status"` // pending|done|error
	Error           string    `json:"error"`
	CreatedAt       time.Time `json:"created_at"`

	Request  *Request  `json:"request,omitempty"`
	Response *Response `json:"response,omitempty"`
}

type WebSocketSession struct {
	ID        int64      `json:"id"`
	RequestID int64      `json:"request_id"`
	CreatedAt time.Time  `json:"created_at"`
	ClosedAt  *time.Time `json:"closed_at"`
}

type WebSocketFrame struct {
	ID        int64     `json:"id"`
	SessionID int64     `json:"session_id"`
	Direction string    `json:"direction"` // "c2s" | "s2c"
	Opcode    int       `json:"opcode"`
	Fin       int       `json:"fin"`
	Payload   []byte    `json:"payload"`
	Length    int       `json:"length"`
	Truncated bool      `json:"truncated"`
	Timestamp time.Time `json:"timestamp"`
}

type InterceptEntry struct {
	ID          int64      `json:"id"`
	RequestID   int64      `json:"request_id"`
	State       string     `json:"state"` // held|forwarded|dropped|modified
	ModifiedRaw []byte     `json:"-"`
	CreatedAt   time.Time  `json:"created_at"`
	ResolvedAt  *time.Time `json:"resolved_at"`

	Request *Request `json:"request,omitempty"`
}
