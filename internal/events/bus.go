package events

import (
	"sync"
)

type EventType string

const (
	EventRequestCaptured   EventType = "request.captured"
	EventResponseReceived  EventType = "response.received"
	EventInterceptHeld     EventType = "intercept.held"
	EventInterceptResolved EventType = "intercept.resolved"
	EventProxyStatus       EventType = "proxy.status"
	EventProjectUpdated    EventType = "project.updated"
	EventProjectSwitched   EventType = "project.switched"
	EventRequestDeleted    EventType = "request.deleted"

	EventWebSocketFrame         EventType = "websocket.frame"
	EventWebSocketSessionOpened EventType = "websocket.session.opened"
	EventWebSocketSessionClosed EventType = "websocket.session.closed"

	EventConsoleOutput EventType = "console.output"
)

type ConsoleOutputData struct {
	Source    string `json:"source"` // "middleware" | "flow"
	Text      string `json:"text"`
	Timestamp string `json:"timestamp"` // RFC3339Nano UTC
}

type Event struct {
	Type EventType   `json:"type"`
	Data interface{} `json:"data"`
}

type Subscriber chan Event

type Bus struct {
	mu   sync.RWMutex
	subs map[Subscriber]struct{}
}

func NewBus() *Bus {
	return &Bus{subs: make(map[Subscriber]struct{})}
}

func (b *Bus) Subscribe() Subscriber {
	ch := make(Subscriber, 64)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *Bus) Unsubscribe(ch Subscriber) {
	b.mu.Lock()
	delete(b.subs, ch)
	b.mu.Unlock()
	close(ch)
}

func (b *Bus) Publish(e Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.subs {
		select {
		case ch <- e:
		default:
			// drop if subscriber is full
		}
	}
}
