package api

import (
	"log/slog"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/hamedsj5/pandorabox/internal/events"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Hub struct {
	bus     *events.Bus
	mu      sync.Mutex
	clients map[*websocket.Conn]struct{}
}

func NewHub(bus *events.Bus) *Hub {
	h := &Hub{
		bus:     bus,
		clients: make(map[*websocket.Conn]struct{}),
	}
	go h.run()
	return h
}

func (h *Hub) run() {
	sub := h.bus.Subscribe()
	defer h.bus.Unsubscribe(sub)

	for evt := range sub {
		h.broadcast(evt)
	}
}

func (h *Hub) broadcast(evt events.Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for conn := range h.clients {
		if err := conn.WriteJSON(evt); err != nil {
			conn.Close()
			delete(h.clients, conn)
		}
	}
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("WS upgrade", "err", err)
		return
	}

	h.mu.Lock()
	h.clients[conn] = struct{}{}
	h.mu.Unlock()

	// Keep alive - read and discard
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}

	h.mu.Lock()
	delete(h.clients, conn)
	h.mu.Unlock()
	conn.Close()
}
