// SPDX-License-Identifier: Apache-2.0
// Package intruder — marker-driven request fuzzing, usable by the REST API
// (and therefore the CLI) without the legacy MCP server. Ported from
// internal/mcp/intruder.go; ported rather than shared so internal/mcp stays
// untouched and this Manager has no MCP dependency.
package intruder

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hamedsj5/pandorabox/internal/events"
	"github.com/hamedsj5/pandorabox/internal/proxy"
)

const jobRetention = 30 * time.Minute

type Result struct {
	Index    int      `json:"index"`
	Payloads []string `json:"payloads"`
	Status   int      `json:"status"`
	Length   int64    `json:"length_bytes"`
	TimeMs   int64    `json:"time_ms"`
	Error    string   `json:"error,omitempty"`
}

type Job struct {
	ID        string
	CreatedAt time.Time
	StartedAt time.Time
	EndedAt   time.Time
	Status    string // running | done | cancelled
	Total     int
	Completed int
	Results   []Result
	cancel    context.CancelFunc
	mu        sync.Mutex
}

type StatusSnapshot struct {
	JobID       string  `json:"job_id"`
	Status      string  `json:"status"`
	Total       int     `json:"total"`
	Completed   int     `json:"completed"`
	ProgressPct float64 `json:"progress_pct"`
	StartedAt   string  `json:"started_at"`
	EndedAt     string  `json:"ended_at,omitempty"`
}

type ResultsPage struct {
	JobID          string   `json:"job_id"`
	Status         string   `json:"status"`
	Results        []Result `json:"results"`
	HasMore        bool     `json:"has_more"`
	NextAfterIndex int      `json:"next_after_index"`
}

type Manager struct {
	proxy *proxy.Proxy
	bus   *events.Bus
	jobs  sync.Map // job id → *Job
}

func NewManager(p *proxy.Proxy, bus *events.Bus) *Manager {
	return &Manager{proxy: p, bus: bus}
}

// Start parses the §marker§ template, builds the payload variants for the
// given attack type, and kicks off the worker goroutine. Returns immediately.
func (m *Manager) Start(requestID int64, template string, attackType string, payloadSets [][]string, concurrency int) (*Job, error) {
	if attackType == "" {
		attackType = "sniper"
	}
	if concurrency < 1 {
		concurrency = 5
	}
	if concurrency > 20 {
		concurrency = 20
	}

	tokens := strings.Split(template, "§")
	numMarkers := len(tokens) / 2
	if numMarkers == 0 {
		return nil, fmt.Errorf("no §markers§ found in raw template; wrap injection points in § characters")
	}

	defaults := make([]string, numMarkers)
	for i := 0; i < numMarkers; i++ {
		defaults[i] = tokens[i*2+1]
	}
	for len(payloadSets) < numMarkers {
		payloadSets = append(payloadSets, []string{})
	}

	variants, err := buildVariants(attackType, numMarkers, defaults, payloadSets)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	job := &Job{
		ID:        uuid.NewString(),
		CreatedAt: time.Now(),
		StartedAt: time.Now(),
		Status:    "running",
		Total:     len(variants),
		cancel:    cancel,
	}
	m.jobs.Store(job.ID, job)
	time.AfterFunc(jobRetention, func() { m.jobs.Delete(job.ID) })

	if m.bus != nil {
		m.bus.Publish(events.Event{
			Type: events.EventIntruderJobStarted,
			Data: map[string]any{
				"job_id": job.ID, "total": job.Total, "request_id": requestID,
				"attack_type": attackType, "started_at": job.StartedAt.UTC().Format(time.RFC3339Nano),
			},
		})
	}

	go m.run(ctx, job, requestID, tokens, variants, concurrency)
	return job, nil
}

func (m *Manager) run(ctx context.Context, job *Job, requestID int64, tokens []string, variants [][]string, concurrency int) {
	defer func() {
		job.mu.Lock()
		job.EndedAt = time.Now()
		finalStatus := job.Status
		if finalStatus == "running" {
			finalStatus = "done"
			job.Status = "done"
		}
		completed := job.Completed
		total := job.Total
		job.mu.Unlock()

		if m.bus != nil {
			evtType := events.EventIntruderJobCompleted
			if finalStatus == "cancelled" {
				evtType = events.EventIntruderJobCancelled
			}
			m.bus.Publish(events.Event{
				Type: evtType,
				Data: map[string]any{"job_id": job.ID, "status": finalStatus, "completed": completed, "total": total},
			})
		}
	}()

	if len(variants) == 0 {
		job.mu.Lock()
		job.Status = "done"
		job.mu.Unlock()
		return
	}

	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	job.mu.Lock()
	job.Results = make([]Result, len(variants))
	job.mu.Unlock()

	var (
		progressMu      sync.Mutex
		lastEmitted     int
		lastEmittedTime time.Time
	)
	emitProgress := func(force bool) {
		if m.bus == nil {
			return
		}
		job.mu.Lock()
		completed := job.Completed
		total := job.Total
		job.mu.Unlock()
		progressMu.Lock()
		if !force && time.Since(lastEmittedTime) < 250*time.Millisecond && completed-lastEmitted < total/20+1 {
			progressMu.Unlock()
			return
		}
		lastEmitted = completed
		lastEmittedTime = time.Now()
		progressMu.Unlock()
		m.bus.Publish(events.Event{
			Type: events.EventIntruderJobProgress,
			Data: map[string]any{"job_id": job.ID, "completed": completed, "total": total},
		})
	}

	for i, v := range variants {
		select {
		case <-ctx.Done():
			job.mu.Lock()
			job.Status = "cancelled"
			job.mu.Unlock()
			wg.Wait()
			return
		default:
		}
		wg.Add(1)
		go func(idx int, payloads []string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			rawBytes := []byte(substituteMarkers(tokens, payloads))
			start := time.Now()
			replay, err := m.proxy.ReplayRequest(requestID, nil, nil, "", rawBytes, "")
			elapsed := time.Since(start).Milliseconds()

			r := Result{Index: idx, Payloads: payloads, TimeMs: elapsed}
			if err != nil {
				r.Error = err.Error()
			} else if replay != nil && replay.Response != nil {
				r.Status = replay.Response.StatusCode
				r.Length = replay.Response.SizeBytes
			}
			job.mu.Lock()
			job.Results[idx] = r
			job.Completed++
			job.mu.Unlock()
			emitProgress(false)
		}(i, v)
	}
	wg.Wait()
	emitProgress(true)
}

func (m *Manager) getJob(id string) (*Job, bool) {
	v, ok := m.jobs.Load(id)
	if !ok {
		return nil, false
	}
	return v.(*Job), true
}

func (m *Manager) Status(id string) (StatusSnapshot, bool) {
	job, ok := m.getJob(id)
	if !ok {
		return StatusSnapshot{}, false
	}
	job.mu.Lock()
	defer job.mu.Unlock()
	pct := 0.0
	if job.Total > 0 {
		pct = float64(job.Completed) * 100 / float64(job.Total)
	}
	return StatusSnapshot{
		JobID:       job.ID,
		Status:      job.Status,
		Total:       job.Total,
		Completed:   job.Completed,
		ProgressPct: pct,
		StartedAt:   job.StartedAt.UTC().Format(time.RFC3339Nano),
		EndedAt:     isoOrEmpty(job.EndedAt),
	}, true
}

func (m *Manager) Results(id string, afterIndex, limit int) (ResultsPage, bool) {
	job, ok := m.getJob(id)
	if !ok {
		return ResultsPage{}, false
	}
	if limit <= 0 {
		limit = 500
	}
	job.mu.Lock()
	defer job.mu.Unlock()
	out := make([]Result, 0, limit)
	for _, r := range job.Results {
		if r.Index <= afterIndex {
			continue
		}
		out = append(out, r)
		if len(out) >= limit {
			break
		}
	}
	nextAfter := afterIndex
	if n := len(out); n > 0 {
		nextAfter = out[n-1].Index
	}
	hasMore := len(out) >= limit && job.Completed > nextAfter
	return ResultsPage{
		JobID:          job.ID,
		Status:         job.Status,
		Results:        out,
		HasMore:        hasMore,
		NextAfterIndex: nextAfter,
	}, true
}

func (m *Manager) Cancel(id string) bool {
	job, ok := m.getJob(id)
	if !ok {
		return false
	}
	job.cancel()
	return true
}

func buildVariants(attackType string, numMarkers int, defaults []string, payloadSets [][]string) ([][]string, error) {
	var variants [][]string
	switch attackType {
	case "sniper":
		ps := payloadSets[0]
		for pos := 0; pos < numMarkers; pos++ {
			for _, p := range ps {
				v := make([]string, numMarkers)
				copy(v, defaults)
				v[pos] = p
				variants = append(variants, v)
			}
		}
	case "battering_ram":
		ps := payloadSets[0]
		for _, p := range ps {
			v := make([]string, numMarkers)
			for i := range v {
				v[i] = p
			}
			variants = append(variants, v)
		}
	case "pitchfork":
		minLen := 0
		if len(payloadSets[0]) > 0 {
			minLen = len(payloadSets[0])
		}
		for j := 1; j < numMarkers; j++ {
			if j < len(payloadSets) && len(payloadSets[j]) > 0 {
				if minLen == 0 || len(payloadSets[j]) < minLen {
					minLen = len(payloadSets[j])
				}
			}
		}
		for i := 0; i < minLen; i++ {
			v := make([]string, numMarkers)
			copy(v, defaults)
			for j := 0; j < numMarkers; j++ {
				if j < len(payloadSets) && i < len(payloadSets[j]) {
					v[j] = payloadSets[j][i]
				}
			}
			variants = append(variants, v)
		}
	case "cluster_bomb":
		type activeSlot struct {
			pos      int
			payloads []string
		}
		var actives []activeSlot
		for j := 0; j < numMarkers; j++ {
			if j < len(payloadSets) && len(payloadSets[j]) > 0 {
				actives = append(actives, activeSlot{j, payloadSets[j]})
			}
		}
		if len(actives) == 0 {
			return nil, fmt.Errorf("cluster_bomb requires at least one non-empty payload set")
		}
		indices := make([]int, len(actives))
		for {
			v := make([]string, numMarkers)
			copy(v, defaults)
			for i, ap := range actives {
				v[ap.pos] = ap.payloads[indices[i]]
			}
			variants = append(variants, v)

			carry := true
			for i := len(actives) - 1; i >= 0 && carry; i-- {
				indices[i]++
				if indices[i] >= len(actives[i].payloads) {
					indices[i] = 0
				} else {
					carry = false
				}
			}
			if carry {
				break
			}
		}
	default:
		return nil, fmt.Errorf("unknown attack_type %q; valid: sniper, battering_ram, pitchfork, cluster_bomb", attackType)
	}
	return variants, nil
}

// substituteMarkers reconstructs the HTTP template with the given payloads
// substituted at each §marker§ position. tokens is strings.Split(template, "§").
func substituteMarkers(tokens []string, payloads []string) string {
	var sb strings.Builder
	mi := 0
	for i, tok := range tokens {
		if i%2 == 0 {
			sb.WriteString(tok)
		} else {
			if mi < len(payloads) {
				sb.WriteString(payloads[mi])
			} else {
				sb.WriteString(tok)
			}
			mi++
		}
	}
	return sb.String()
}

func isoOrEmpty(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}
