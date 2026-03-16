package proxy

import (
	"strings"
	"sync"
)

type InterceptDecision struct {
	Forward     bool
	Drop        bool
	ModifiedRaw []byte
}

// InterceptFilter controls which requests are held. Empty fields match everything.
type InterceptFilter struct {
	Host   string `json:"host"`   // case-insensitive substring match
	Method string `json:"method"` // exact match (case-insensitive); empty = all
	Path   string `json:"path"`   // substring match
}

type pendingRequest struct {
	requestID int64
	raw       []byte
	decision  chan InterceptDecision
}

type InterceptQueue struct {
	mu      sync.RWMutex
	enabled bool
	filter  InterceptFilter
	pending map[int64]*pendingRequest
}

func NewInterceptQueue() *InterceptQueue {
	return &InterceptQueue{
		pending: make(map[int64]*pendingRequest),
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

func (q *InterceptQueue) Hold(requestID int64, raw []byte) chan InterceptDecision {
	ch := make(chan InterceptDecision, 1)
	q.mu.Lock()
	q.pending[requestID] = &pendingRequest{requestID: requestID, raw: raw, decision: ch}
	q.mu.Unlock()
	return ch
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

func (q *InterceptQueue) QueueLength() int {
	q.mu.RLock()
	defer q.mu.RUnlock()
	return len(q.pending)
}

func (q *InterceptQueue) ListPending() []int64 {
	q.mu.RLock()
	defer q.mu.RUnlock()
	ids := make([]int64, 0, len(q.pending))
	for id := range q.pending {
		ids = append(ids, id)
	}
	return ids
}

func (q *InterceptQueue) SetFilter(f InterceptFilter) {
	q.mu.Lock()
	q.filter = f
	q.mu.Unlock()
}

func (q *InterceptQueue) GetFilter() InterceptFilter {
	q.mu.RLock()
	defer q.mu.RUnlock()
	return q.filter
}

// Matches returns true if the request should be held given the current filter.
// An empty filter matches everything.
func (q *InterceptQueue) Matches(host, method, path string) bool {
	q.mu.RLock()
	f := q.filter
	q.mu.RUnlock()

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
