// SPDX-License-Identifier: Apache-2.0
// Package mcp — intruder.go: marker-driven request fuzzing.
//
// Two interfaces:
//   - Synchronous (intruder_fuzz, deprecated alias `intruder_run_sync`): runs
//     every variant and returns the complete result set in one call. Suitable
//     for small payload sets only.
//   - Asynchronous (intruder_start / _status / _results / _cancel): starts the
//     job in the background and lets callers poll for progress and incremental
//     results. The result of choice for any non-trivial run because it doesn't
//     hold the MCP call open and supports cancellation.
package mcp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hamedsj5/pandorabox/internal/events"
	"github.com/mark3labs/mcp-go/mcp"
)

const intruderJobRetention = 30 * time.Minute

func (s *Server) registerIntruderTools() {
	s.register(ToolSpec{
		Name:      "intruder_fuzz",
		Category:  CatIntruder,
		Behavior:  BehaviorMutating,
		OpenWorld: true,
		Summary:   "Run a marker-driven fuzz attack synchronously and return all results when finished.",
		Description: `Wrap injection points in §markers§ in the raw HTTP packet (before base64-encoding) and supply payload lists.

Attack types:
  - sniper        — iterate one marker at a time across one payload set; total = markers × payloads.
  - battering_ram — same payload at every marker; total = payloads.
  - pitchfork     — parallel iteration, one set per marker, stops at shortest; total = min(set lengths).
  - cluster_bomb  — cartesian product of all sets; total = product(set lengths).

WARNING: this call blocks until every variant is sent. For non-trivial runs use intruder_start
instead so the call returns immediately and you can poll for results.`,
		Options: []mcp.ToolOption{
			mcp.WithNumber("request_id", mcp.Description("Captured request id used for host/scheme routing."), mcp.Required()),
			mcp.WithString("raw_text", mcp.Description("Raw HTTP/1.1 request with §markers§ at injection points. Preferred over raw_b64.")),
			mcp.WithString("raw_b64", mcp.Description("Legacy base64-encoded raw HTTP/1.1 request with §markers§ markers.")),
			mcp.WithString("attack_type", mcp.Description(`"sniper" (default), "battering_ram", "pitchfork", or "cluster_bomb".`)),
			mcp.WithArray("payloads", mcp.Description("Array of payload arrays — one per marker. For sniper/battering_ram only the first array is used."), mcp.Items(map[string]any{"type": "array"})),
			mcp.WithString("payloads_json", mcp.Description("Legacy stringified payload array. Prefer `payloads`.")),
			mcp.WithNumber("concurrency", mcp.Description("Max concurrent requests (1–20, default 5).")),
		},
		Handler: s.toolIntruderFuzz,
	})

	s.register(ToolSpec{
		Name:      "intruder_start",
		Category:  CatIntruder,
		Behavior:  BehaviorMutating,
		OpenWorld: true,
		Summary:   "Start a fuzzing attack in the background and return a job id immediately.",
		Description: `Same parameters as intruder_fuzz, but returns a job_id without waiting for completion.

Workflow:
  1. intruder_start(...) → {job_id, total_variants}
  2. intruder_status(job_id) → {status, completed, total, progress_pct}
  3. intruder_results(job_id, after_index=N) → incremental results
  4. intruder_cancel(job_id) when done or to abort early.`,
		Options: []mcp.ToolOption{
			mcp.WithNumber("request_id", mcp.Description("Captured request id used for host/scheme routing."), mcp.Required()),
			mcp.WithString("raw_text", mcp.Description("Raw HTTP/1.1 request with §markers§ at injection points.")),
			mcp.WithString("raw_b64", mcp.Description("Legacy base64-encoded raw HTTP/1.1 request with §markers§.")),
			mcp.WithString("attack_type", mcp.Description(`"sniper" (default), "battering_ram", "pitchfork", or "cluster_bomb".`)),
			mcp.WithArray("payloads", mcp.Description("Array of payload arrays."), mcp.Items(map[string]any{"type": "array"})),
			mcp.WithString("payloads_json", mcp.Description("Legacy stringified payload array.")),
			mcp.WithNumber("concurrency", mcp.Description("Max concurrent requests (1–20, default 5).")),
		},
		Handler: s.toolIntruderStart,
	})

	s.register(ToolSpec{
		Name:     "intruder_status",
		Category: CatIntruder,
		Behavior: BehaviorReadOnly,
		Summary:  "Get the status and progress of a running intruder job.",
		Options: []mcp.ToolOption{
			mcp.WithString("job_id", mcp.Description("Job id returned by intruder_start."), mcp.Required()),
		},
		Handler: s.toolIntruderStatus,
	})

	s.register(ToolSpec{
		Name:     "intruder_results",
		Category: CatIntruder,
		Behavior: BehaviorReadOnly,
		Summary:  "Get accumulated results for an intruder job (incremental polling supported).",
		Options: []mcp.ToolOption{
			mcp.WithString("job_id", mcp.Description("Job id returned by intruder_start."), mcp.Required()),
			mcp.WithNumber("after_index", mcp.Description("Return only results with index > after_index (cursor).")),
			mcp.WithNumber("limit", mcp.Description("Maximum results to return (default 500).")),
		},
		Handler: s.toolIntruderResults,
	})

	s.register(ToolSpec{
		Name:     "intruder_cancel",
		Category: CatIntruder,
		Behavior: BehaviorMutating,
		Summary:  "Cancel a running intruder job and release its resources.",
		Options: []mcp.ToolOption{
			mcp.WithString("job_id", mcp.Description("Job id returned by intruder_start."), mcp.Required()),
		},
		Handler: s.toolIntruderCancel,
	})
}

// ── Types ────────────────────────────────────────────────────────────────────

type intruderResult struct {
	Index    int      `json:"index"`
	Payloads []string `json:"payloads"`
	Status   int      `json:"status"`
	Length   int64    `json:"length_bytes"`
	TimeMs   int64    `json:"time_ms"`
	Error    string   `json:"error,omitempty"`
}

type intruderJob struct {
	id        string
	createdAt time.Time
	startedAt time.Time
	endedAt   time.Time
	status    string // running | done | cancelled | error
	total     int
	completed int
	results   []intruderResult
	cancel    context.CancelFunc
	mu        sync.Mutex
}

// ── Synchronous handler (intruder_fuzz) ──────────────────────────────────────

func (s *Server) toolIntruderFuzz(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	job, err := s.startIntruderJob(ctx, req)
	if err != nil {
		return nil, err
	}
	// Wait for completion. Cancellation honoured.
	for {
		job.mu.Lock()
		done := job.status != "running"
		job.mu.Unlock()
		if done {
			break
		}
		select {
		case <-ctx.Done():
			job.cancel()
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	job.mu.Lock()
	defer job.mu.Unlock()
	return map[string]any{
		"job_id":  job.id,
		"status":  job.status,
		"total":   job.total,
		"results": job.results,
	}, nil
}

// ── Async handlers ───────────────────────────────────────────────────────────

func (s *Server) toolIntruderStart(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	job, err := s.startIntruderJob(ctx, req)
	if err != nil {
		return nil, err
	}
	return map[string]any{"job_id": job.id, "total": job.total, "status": "running"}, nil
}

func (s *Server) toolIntruderStatus(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	jobID, err := argRequiredString(req, "job_id")
	if err != nil {
		return nil, err
	}
	job, ok := s.getIntruderJob(jobID)
	if !ok {
		return nil, fmt.Errorf("job %q not found (expired or cancelled)", jobID)
	}
	job.mu.Lock()
	defer job.mu.Unlock()
	pct := 0.0
	if job.total > 0 {
		pct = float64(job.completed) * 100 / float64(job.total)
	}
	return map[string]any{
		"job_id":       job.id,
		"status":       job.status,
		"total":        job.total,
		"completed":    job.completed,
		"progress_pct": pct,
		"started_at":   job.startedAt.UTC().Format(time.RFC3339Nano),
		"ended_at":     iso(job.endedAt),
	}, nil
}

func (s *Server) toolIntruderResults(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	jobID, err := argRequiredString(req, "job_id")
	if err != nil {
		return nil, err
	}
	job, ok := s.getIntruderJob(jobID)
	if !ok {
		return nil, fmt.Errorf("job %q not found (expired or cancelled)", jobID)
	}
	afterIdx, _ := argInt64(req, "after_index")
	limit := 500
	if v, ok := argInt64(req, "limit"); ok && v > 0 {
		limit = int(v)
	}

	job.mu.Lock()
	defer job.mu.Unlock()
	out := make([]intruderResult, 0, limit)
	for _, r := range job.results {
		if int64(r.Index) <= afterIdx {
			continue
		}
		out = append(out, r)
		if len(out) >= limit {
			break
		}
	}
	var nextAfter int
	if n := len(out); n > 0 {
		nextAfter = out[n-1].Index
	} else {
		nextAfter = int(afterIdx)
	}
	hasMore := len(out) >= limit && job.completed > nextAfter
	return map[string]any{
		"job_id":          job.id,
		"status":          job.status,
		"results":         out,
		"has_more":        hasMore,
		"next_after_index": nextAfter,
	}, nil
}

func (s *Server) toolIntruderCancel(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	jobID, err := argRequiredString(req, "job_id")
	if err != nil {
		return nil, err
	}
	job, ok := s.getIntruderJob(jobID)
	if !ok {
		return nil, fmt.Errorf("job %q not found", jobID)
	}
	job.cancel()
	return map[string]any{"job_id": jobID, "cancelled": true}, nil
}

// ── Job table ────────────────────────────────────────────────────────────────

func (s *Server) getIntruderJob(id string) (*intruderJob, bool) {
	v, ok := s.intruderJobs.Load(id)
	if !ok {
		return nil, false
	}
	return v.(*intruderJob), true
}

// startIntruderJob parses args + builds variants and kicks off the worker
// goroutine. Returns immediately. Caller decides whether to wait synchronously
// (intruder_fuzz) or return the job id (intruder_start).
func (s *Server) startIntruderJob(parent context.Context, req mcp.CallToolRequest) (*intruderJob, error) {
	requestID, err := argRequiredInt64(req, "request_id")
	if err != nil {
		return nil, err
	}

	// Raw template: prefer text, accept legacy base64.
	var template string
	if v := argString(req, "raw_text"); v != "" {
		template = v
	} else if v := argString(req, "raw_b64"); v != "" {
		dec, err := base64.StdEncoding.DecodeString(v)
		if err != nil {
			dec, err = base64.RawStdEncoding.DecodeString(v)
			if err != nil {
				return nil, fmt.Errorf("raw_b64: invalid base64: %w", err)
			}
		}
		template = string(dec)
	} else {
		return nil, fmt.Errorf("either `raw_text` (plain HTTP/1.1) or `raw_b64` (legacy base64) is required")
	}

	attackType := "sniper"
	if v := argString(req, "attack_type"); v != "" {
		attackType = v
	}

	// Payloads: native array of arrays or legacy *_json.
	var payloadSets [][]string
	if arr, ok := argArray(req, "payloads"); ok {
		for _, item := range arr {
			inner, _ := item.([]any)
			set := make([]string, 0, len(inner))
			for _, v := range inner {
				if s, ok := v.(string); ok {
					set = append(set, s)
				} else {
					b, _ := json.Marshal(v)
					set = append(set, string(b))
				}
			}
			payloadSets = append(payloadSets, set)
		}
	} else if _, err := argInto(req, "payloads_json", &payloadSets); err != nil {
		return nil, err
	}
	if len(payloadSets) == 0 {
		return nil, fmt.Errorf("`payloads` (array of arrays) or `payloads_json` is required")
	}

	concurrency := 5
	if v, ok := argInt64(req, "concurrency"); ok && v >= 1 {
		concurrency = int(v)
		if concurrency > 20 {
			concurrency = 20
		}
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

	// Allocate the job.
	ctx, cancel := context.WithCancel(context.Background())
	_ = parent // explicit: jobs are not cancelled when the originating call ends.
	job := &intruderJob{
		id:        uuid.NewString(),
		createdAt: time.Now(),
		startedAt: time.Now(),
		status:    "running",
		total:     len(variants),
		cancel:    cancel,
	}
	s.intruderJobs.Store(job.id, job)

	// Schedule cleanup so the job table doesn't grow forever.
	time.AfterFunc(intruderJobRetention, func() { s.intruderJobs.Delete(job.id) })

	// Tell the UI a job is starting so it can open the panel / show a banner
	// without the user being on the Intruder page when start was called.
	if s.bus != nil {
		s.bus.Publish(events.Event{
			Type: events.EventIntruderJobStarted,
			Data: map[string]any{"job_id": job.id, "total": job.total, "request_id": requestID, "attack_type": "", "started_at": job.startedAt.UTC().Format(time.RFC3339Nano)},
		})
	}

	go s.runIntruderJob(ctx, job, requestID, tokens, variants, concurrency)
	return job, nil
}

func (s *Server) runIntruderJob(ctx context.Context, job *intruderJob, requestID int64, tokens []string, variants [][]string, concurrency int) {
	defer func() {
		job.mu.Lock()
		job.endedAt = time.Now()
		finalStatus := job.status
		if finalStatus == "running" {
			finalStatus = "done"
			job.status = "done"
		}
		completed := job.completed
		total := job.total
		job.mu.Unlock()

		// Final notification — UI uses this to flip the panel out of "running".
		if s.bus != nil {
			evtType := events.EventIntruderJobCompleted
			if finalStatus == "cancelled" {
				evtType = events.EventIntruderJobCancelled
			}
			s.bus.Publish(events.Event{
				Type: evtType,
				Data: map[string]any{
					"job_id":    job.id,
					"status":    finalStatus,
					"completed": completed,
					"total":     total,
				},
			})
		}
	}()

	if len(variants) == 0 {
		job.mu.Lock()
		job.status = "done"
		job.mu.Unlock()
		return
	}

	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	job.mu.Lock()
	job.results = make([]intruderResult, len(variants))
	job.mu.Unlock()

	// Coalesce progress notifications so a 10k-payload run doesn't flood the WS.
	// Send at most one every 250 ms; the UI re-renders smoothly on this cadence.
	var (
		progressMu      sync.Mutex
		lastEmitted     int
		lastEmittedTime time.Time
	)
	emitProgress := func(force bool) {
		if s.bus == nil {
			return
		}
		job.mu.Lock()
		completed := job.completed
		total := job.total
		job.mu.Unlock()
		progressMu.Lock()
		if !force && time.Since(lastEmittedTime) < 250*time.Millisecond && completed-lastEmitted < total/20+1 {
			progressMu.Unlock()
			return
		}
		lastEmitted = completed
		lastEmittedTime = time.Now()
		progressMu.Unlock()
		s.bus.Publish(events.Event{
			Type: events.EventIntruderJobProgress,
			Data: map[string]any{"job_id": job.id, "completed": completed, "total": total},
		})
	}

	for i, v := range variants {
		select {
		case <-ctx.Done():
			job.mu.Lock()
			job.status = "cancelled"
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
			replay, err := s.proxy.ReplayRequest(requestID, nil, nil, "", rawBytes)
			elapsed := time.Since(start).Milliseconds()

			r := intruderResult{Index: idx, Payloads: payloads, TimeMs: elapsed}
			if err != nil {
				r.Error = err.Error()
			} else if replay != nil && replay.Response != nil {
				r.Status = replay.Response.StatusCode
				r.Length = replay.Response.SizeBytes
			}
			job.mu.Lock()
			job.results[idx] = r
			job.completed++
			job.mu.Unlock()
			emitProgress(false)
		}(i, v)
	}
	wg.Wait()
	// Force one final progress event in case the throttled one was skipped.
	emitProgress(true)
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
				sb.WriteString(tok) // fallback to default
			}
			mi++
		}
	}
	return sb.String()
}

func iso(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}
