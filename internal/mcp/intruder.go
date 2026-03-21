package mcp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerIntruderTools() {
	s.mcp.AddTool(mcp.NewTool("intruder_fuzz",
		mcp.WithDescription(`Run a fuzzing attack on a captured request. Place §markers§ in the raw HTTP to mark injection points, supply payload lists, and choose an attack type. Waits for all requests to complete and returns the full results.

Attack types:
- sniper        — iterates each marker one at a time through all payloads; single payload set; total = markers × payloads
- battering_ram — same payload inserted into all markers simultaneously; single payload set; total = payloads
- pitchfork     — parallel iteration across one set per marker, stops at shortest; total = min(set lengths)
- cluster_bomb  — cartesian product of all payload sets; total = product(set lengths)

Tip: wrap values with § in the raw HTTP before base64-encoding. E.g. "GET /?q=§test§ HTTP/1.1".`),
		mcp.WithNumber("request_id", mcp.Description("ID of the base request (used for host/scheme routing)"), mcp.Required()),
		mcp.WithString("raw_b64", mcp.Description("Base64-encoded raw HTTP request with §markers§ at injection points"), mcp.Required()),
		mcp.WithString("attack_type", mcp.Description(`Attack type: "sniper" (default), "battering_ram", "pitchfork", or "cluster_bomb"`)),
		mcp.WithString("payloads_json", mcp.Description(`JSON array of string arrays — one array per marker. For sniper/battering_ram only the first array is used. Example: [["admin","root"],["pass1","pass2"]]`), mcp.Required()),
		mcp.WithNumber("concurrency", mcp.Description("Max concurrent requests (1–20, default 5)")),
	), s.toolIntruderFuzz)
}

type intruderResult struct {
	Index    int      `json:"index"`
	Payloads []string `json:"payloads"`
	Status   int      `json:"status"`
	Length   int64    `json:"length_bytes"`
	TimeMs   int64    `json:"time_ms"`
	Error    string   `json:"error,omitempty"`
}

func (s *Server) toolIntruderFuzz(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	args := req.Params.Arguments

	requestIDF, ok := args["request_id"].(float64)
	if !ok {
		return nil, fmt.Errorf("request_id required")
	}
	requestID := int64(requestIDF)

	rawB64, ok := args["raw_b64"].(string)
	if !ok || rawB64 == "" {
		return nil, fmt.Errorf("raw_b64 required")
	}
	rawDecoded, err := base64.StdEncoding.DecodeString(rawB64)
	if err != nil {
		rawDecoded, err = base64.RawStdEncoding.DecodeString(rawB64)
		if err != nil {
			return nil, fmt.Errorf("raw_b64: invalid base64: %w", err)
		}
	}
	template := string(rawDecoded)

	attackType := "sniper"
	if v, ok := args["attack_type"].(string); ok && v != "" {
		attackType = v
	}

	payloadsJSON, ok := args["payloads_json"].(string)
	if !ok || payloadsJSON == "" {
		return nil, fmt.Errorf("payloads_json required")
	}
	var payloadSets [][]string
	if err := json.Unmarshal([]byte(payloadsJSON), &payloadSets); err != nil {
		return nil, fmt.Errorf("payloads_json: %w", err)
	}

	concurrency := 5
	if v, ok := args["concurrency"].(float64); ok && v >= 1 {
		concurrency = int(v)
		if concurrency > 20 {
			concurrency = 20
		}
	}

	// Parse markers: tokens[even] = plain text, tokens[odd] = marker default value
	tokens := strings.Split(template, "§")
	numMarkers := len(tokens) / 2
	if numMarkers == 0 {
		return nil, fmt.Errorf("no §markers§ found in raw_b64; wrap injection points in § characters")
	}

	// Extract default values per marker
	defaults := make([]string, numMarkers)
	for i := 0; i < numMarkers; i++ {
		defaults[i] = tokens[i*2+1]
	}

	// Pad payload sets if fewer were provided than markers
	for len(payloadSets) < numMarkers {
		payloadSets = append(payloadSets, []string{})
	}

	type variant struct {
		payloads []string
	}
	var variants []variant

	switch attackType {
	case "sniper":
		ps := payloadSets[0]
		for pos := 0; pos < numMarkers; pos++ {
			for _, p := range ps {
				v := make([]string, numMarkers)
				copy(v, defaults)
				v[pos] = p
				variants = append(variants, variant{v})
			}
		}

	case "battering_ram":
		ps := payloadSets[0]
		for _, p := range ps {
			v := make([]string, numMarkers)
			for i := range v {
				v[i] = p
			}
			variants = append(variants, variant{v})
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
			variants = append(variants, variant{v})
		}

	case "cluster_bomb":
		// Only cycle positions with non-empty payload sets; fixed at default otherwise
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
			variants = append(variants, variant{v})

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
		return nil, fmt.Errorf("unknown attack_type %q; valid values: sniper, battering_ram, pitchfork, cluster_bomb", attackType)
	}

	if len(variants) == 0 {
		return jsonResult(map[string]interface{}{"results": []intruderResult{}, "total": 0})
	}

	// Run all variants with a concurrency-limited goroutine pool
	results := make([]intruderResult, len(variants))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup

	for i, v := range variants {
		wg.Add(1)
		go func(idx int, payloads []string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			rawBytes := []byte(substituteMarkers(tokens, payloads))
			start := time.Now()
			replay, err := s.proxy.ReplayRequest(requestID, nil, nil, "", rawBytes)
			elapsed := time.Since(start).Milliseconds()

			r := intruderResult{
				Index:    idx,
				Payloads: payloads,
				TimeMs:   elapsed,
			}
			if err != nil {
				r.Error = err.Error()
			} else if replay != nil && replay.Response != nil {
				r.Status = replay.Response.StatusCode
				r.Length = replay.Response.SizeBytes
			}
			results[idx] = r
		}(i, v.payloads)
	}
	wg.Wait()

	return jsonResult(map[string]interface{}{
		"results": results,
		"total":   len(results),
	})
}

// substituteMarkers reconstructs the HTTP template with the given payloads substituted
// at each §marker§ position. tokens is strings.Split(template, "§").
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
