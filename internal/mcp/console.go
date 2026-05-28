// Package mcp — console.go: captures `console.output` events emitted by the
// Python middleware runner and flow execution, and exposes them through the
// `console_get_output` tool with cursor-style pagination.
package mcp

import (
	"context"

	"github.com/hamedsj5/pandorabox/internal/events"
	"github.com/mark3labs/mcp-go/mcp"
)

const maxConsoleEntries = 2000

// consoleEntry wraps the bus event with a monotonic id used by `since_id` so
// callers can poll for new entries without re-scanning the whole buffer.
type consoleEntry struct {
	ID int64 `json:"id"`
	events.ConsoleOutputData
}

func (s *Server) startConsoleCapture() {
	if s.bus == nil {
		return
	}

	sub := s.bus.Subscribe()
	go func() {
		defer s.bus.Unsubscribe(sub)
		var nextID int64
		for evt := range sub {
			if evt.Type != events.EventConsoleOutput {
				continue
			}
			data, ok := evt.Data.(events.ConsoleOutputData)
			if !ok {
				continue
			}
			nextID++
			entry := consoleEntry{ID: nextID, ConsoleOutputData: data}
			s.consoleMu.Lock()
			s.consoleEntries = append(s.consoleEntries, entry)
			if len(s.consoleEntries) > maxConsoleEntries {
				s.consoleEntries = append([]consoleEntry(nil), s.consoleEntries[len(s.consoleEntries)-maxConsoleEntries:]...)
			}
			s.consoleMu.Unlock()
		}
	}()
}

func (s *Server) toolGetConsoleOutput(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	source := argString(req, "source")
	since := argString(req, "since") // RFC3339(nano) timestamp
	sinceID, _ := argInt64(req, "since_id")
	limit := 200
	if v, ok := argInt64(req, "limit"); ok && v > 0 {
		limit = int(v)
	}
	if limit > maxConsoleEntries {
		limit = maxConsoleEntries
	}

	s.consoleMu.RLock()
	entries := append([]consoleEntry(nil), s.consoleEntries...)
	s.consoleMu.RUnlock()

	filtered := make([]consoleEntry, 0, len(entries))
	for _, e := range entries {
		if source != "" && e.Source != source {
			continue
		}
		if sinceID > 0 && e.ID <= sinceID {
			continue
		}
		if since != "" && e.Timestamp <= since {
			continue
		}
		filtered = append(filtered, e)
	}

	hasMore := len(filtered) > limit
	if hasMore {
		filtered = filtered[len(filtered)-limit:]
	}
	var nextID int64
	if n := len(filtered); n > 0 {
		nextID = filtered[n-1].ID
	}

	return map[string]any{
		"entries":      filtered,
		"count":        len(filtered),
		"has_more":     hasMore,
		"next_since_id": nextID,
	}, nil
}
