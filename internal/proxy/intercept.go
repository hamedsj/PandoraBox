package proxy

import (
	"sort"
	"strings"
	"sync"
)

type InterceptDecision struct {
	Forward     bool
	Drop        bool
	ModifiedRaw []byte
}

type InterceptKind string

const (
	InterceptKindRequest  InterceptKind = "request"
	InterceptKindResponse InterceptKind = "response"
)

// InterceptFilter controls which requests are held. Empty fields match everything.
type InterceptFilter struct {
	Host   string `json:"host"`   // case-insensitive substring match
	Method string `json:"method"` // exact match (case-insensitive); empty = all
	Path   string `json:"path"`   // substring match
	Packet string `json:"packet"` // "both" | "request" | "response"
}

type pendingEntry struct {
	requestID int64
	kind      InterceptKind
	seq       int64
	raw       []byte
	decision  chan InterceptDecision
}

type PendingEntry struct {
	RequestID int64
	Kind      InterceptKind
	Seq       int64
	Raw       []byte
}

type InterceptQueue struct {
	mu      sync.RWMutex
	enabled bool
	filter  InterceptFilter
	pending map[int64]*pendingEntry
	nextSeq int64
}

func NewInterceptQueue() *InterceptQueue {
	return &InterceptQueue{
		pending: make(map[int64]*pendingEntry),
	}
}

func (q *InterceptQueue) IsEnabled() bool {
	q.mu.RLock()
	defer q.mu.RUnlock()
	return q.enabled
}

func (q *InterceptQueue) SetEnabled(v bool) {
	q.mu.Lock()
	q.enabled = v
	q.mu.Unlock()
}

func (q *InterceptQueue) hold(requestID int64, kind InterceptKind, raw []byte) chan InterceptDecision {
	ch := make(chan InterceptDecision, 1)
	q.mu.Lock()
	q.nextSeq++
	q.pending[requestID] = &pendingEntry{
		requestID: requestID,
		kind:      kind,
		seq:       q.nextSeq,
		raw:       raw,
		decision:  ch,
	}
	q.mu.Unlock()
	return ch
}

func (q *InterceptQueue) HoldRequest(requestID int64, raw []byte) chan InterceptDecision {
	return q.hold(requestID, InterceptKindRequest, raw)
}

func (q *InterceptQueue) HoldResponse(requestID int64, raw []byte) chan InterceptDecision {
	return q.hold(requestID, InterceptKindResponse, raw)
}

func (q *InterceptQueue) Resolve(requestID int64, d InterceptDecision) bool {
	q.mu.Lock()
	p, ok := q.pending[requestID]
	if ok {
		delete(q.pending, requestID)
	}
	q.mu.Unlock()
	if ok {
		p.decision <- d
	}
	return ok
}

// GetRawPacket returns a copy of the held packet for one queued request id.
// Returns (nil, false) if the request is not in the queue. Used by the MCP
// intercept_get_editable helper so callers don't have to fetch the captured
// row, decode it and reassemble the raw HTTP packet by hand.
func (q *InterceptQueue) GetRawPacket(requestID int64) ([]byte, bool) {
	q.mu.RLock()
	defer q.mu.RUnlock()
	for _, p := range q.pending {
		if p.requestID == requestID {
			return append([]byte(nil), p.raw...), true
		}
	}
	return nil, false
}

func (q *InterceptQueue) QueueLength() int {
	q.mu.RLock()
	defer q.mu.RUnlock()
	return len(q.pending)
}

func (q *InterceptQueue) ListPending() []int64 {
	items := q.ListPendingEntries()
	ids := make([]int64, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.RequestID)
	}
	return ids
}

func (q *InterceptQueue) ListPendingEntries() []PendingEntry {
	q.mu.RLock()
	defer q.mu.RUnlock()
	items := make([]PendingEntry, 0, len(q.pending))
	for _, p := range q.pending {
		items = append(items, PendingEntry{
			RequestID: p.requestID,
			Kind:      p.kind,
			Seq:       p.seq,
			Raw:       append([]byte(nil), p.raw...),
		})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Seq == items[j].Seq {
			return items[i].Kind < items[j].Kind
		}
		return items[i].Seq < items[j].Seq
	})
	return items
}

func (q *InterceptQueue) SetFilter(f InterceptFilter) {
	f.Packet = normalizePacketFilter(f.Packet)
	q.mu.Lock()
	q.filter = f
	q.mu.Unlock()
}

func (q *InterceptQueue) GetFilter() InterceptFilter {
	q.mu.RLock()
	defer q.mu.RUnlock()
	f := q.filter
	f.Packet = normalizePacketFilter(f.Packet)
	return f
}

// Matches returns true if the request should be held given the current filter.
// An empty filter matches everything.
func (q *InterceptQueue) Matches(host, method, path string, kind InterceptKind) bool {
	q.mu.RLock()
	f := q.filter
	q.mu.RUnlock()

	packet := normalizePacketFilter(f.Packet)
	if packet != "both" && packet != string(kind) {
		return false
	}

	if f.Host != "" && !strings.Contains(strings.ToLower(host), strings.ToLower(f.Host)) {
		return false
	}
	if f.Method != "" && !strings.EqualFold(method, f.Method) {
		return false
	}
	if f.Path != "" && !strings.Contains(path, f.Path) {
		return false
	}
	return true
}

func normalizePacketFilter(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", "both":
		return "both"
	case "request":
		return "request"
	case "response":
		return "response"
	default:
		return "both"
	}
}
