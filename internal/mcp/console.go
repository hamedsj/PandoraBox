package mcp

import (
	"context"
	"fmt"

	"github.com/hamedsj5/pandorabox/internal/events"
	"github.com/mark3labs/mcp-go/mcp"
)

const maxConsoleEntries = 2000

func (s *Server) startConsoleCapture() {
	if s.bus == nil {
		return
	}

	sub := s.bus.Subscribe()
	go func() {
		defer s.bus.Unsubscribe(sub)
		for evt := range sub {
			if evt.Type != events.EventConsoleOutput {
				continue
			}
			entry, ok := evt.Data.(events.ConsoleOutputData)
			if !ok {
				continue
			}
			s.consoleMu.Lock()
			s.consoleEntries = append(s.consoleEntries, entry)
			if len(s.consoleEntries) > maxConsoleEntries {
				s.consoleEntries = append([]events.ConsoleOutputData(nil), s.consoleEntries[len(s.consoleEntries)-maxConsoleEntries:]...)
			}
			s.consoleMu.Unlock()
		}
	}()
}

func (s *Server) toolGetConsoleOutput(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}

	source, _ := req.Params.Arguments["source"].(string)
	limit := 200
	if raw, ok := req.Params.Arguments["limit"].(float64); ok && raw > 0 {
		limit = int(raw)
	}
	if limit > maxConsoleEntries {
		limit = maxConsoleEntries
	}

	s.consoleMu.RLock()
	entries := append([]events.ConsoleOutputData(nil), s.consoleEntries...)
	s.consoleMu.RUnlock()

	filtered := make([]events.ConsoleOutputData, 0, len(entries))
	for _, entry := range entries {
		if source != "" && entry.Source != source {
			continue
		}
		filtered = append(filtered, entry)
	}
	if len(filtered) > limit {
		filtered = filtered[len(filtered)-limit:]
	}

	return jsonResult(map[string]interface{}{
		"entries": filtered,
		"total":   len(filtered),
	})
}
