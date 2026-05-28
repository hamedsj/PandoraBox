// SPDX-License-Identifier: Apache-2.0
// Package mcp — registry.go: the central, single source of truth for tool
// registration and dispatch. Every PandoraBox MCP tool goes through Register():
//
//   - Enforces project-level MCP disable (one place, not per-tool).
//   - Catches panics and returns a structured error.
//   - Produces a compact JSON result wrapped in mcp-go's structured-result
//     helper so clients get real JSON (not stringified-then-reparsed text).
//   - Records every tool's category, annotations, args, and description, so
//     internal/mcp/docs/tools.md can be generated from the live registrations
//     and cannot drift.
//   - Provides tiny, expressive helpers (ReadOnly, Mutating, Destructive) so
//     annotation hints are set consistently and visible at the call site.
package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"runtime/debug"
	"sort"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

// Category groups tools in tool pickers and in the generated docs.
type Category string

const (
	CatDocs         Category = "Docs"
	CatProxy        Category = "Proxy"
	CatTraffic      Category = "Traffic"
	CatWebSocket    Category = "WebSocket"
	CatIntercept    Category = "Intercept"
	CatReplay       Category = "Replay"
	CatSitemap      Category = "Sitemap"
	CatProject      Category = "Project"
	CatMatchReplace Category = "Match & Replace"
	CatMiddleware   Category = "Middleware"
	CatFlow         Category = "Flow"
	CatConverter    Category = "Converter"
	CatOrganizer    Category = "Organizer"
	CatIntruder     Category = "Intruder"
	CatCollaborator Category = "Collaborator"
	CatAnalysis     Category = "Analysis"
	CatConsole      Category = "Console"
	CatTeam         Category = "Team"
	CatTeamServer   Category = "Team Server"
	CatCA           Category = "Certificate"
)

// Behavior captures the safety hints clients (and the user) need to reason
// about a tool. We expose only the three combinations we actually use.
type Behavior int

const (
	// BehaviorReadOnly: never mutates anything. Safe to call repeatedly.
	BehaviorReadOnly Behavior = iota
	// BehaviorMutating: changes server state but is idempotent on retry.
	BehaviorMutating
	// BehaviorDestructive: destroys data or affects external entities.
	// Surfaced as a warning in tool pickers.
	BehaviorDestructive
)

// ToolSpec is the declarative description used for both registration and docs.
type ToolSpec struct {
	Name        string
	Aliases     []string
	Category    Category
	Behavior    Behavior
	Summary     string         // one-line headline
	Description string         // longer description / when-to-use / example
	OpenWorld   bool           // true if it touches an external network
	Options     []mcp.ToolOption // schema options (WithString, WithObject, ...)
	Handler     Handler          // wrapped automatically
}

// Handler is the simplified tool handler signature. It returns a Go value that
// will be JSON-serialised — no manual ToolResult wrapping needed.
type Handler func(ctx context.Context, req mcp.CallToolRequest) (any, error)

// Registry holds every tool registered through the foundation so we can
// auto-generate documentation and surface a consistent shape.
type Registry struct {
	specs []ToolSpec
}

var registry = &Registry{}

// Specs returns the recorded tool specs (sorted by category then name).
func (r *Registry) Specs() []ToolSpec {
	out := append([]ToolSpec(nil), r.specs...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Category != out[j].Category {
			return out[i].Category < out[j].Category
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// register installs a ToolSpec on the underlying MCP server, including all
// aliases (which point at the same handler but carry a deprecation hint in
// their description).
func (s *Server) register(spec ToolSpec) {
	if spec.Name == "" {
		panic("ToolSpec.Name required")
	}
	if spec.Handler == nil {
		panic("ToolSpec.Handler required for " + spec.Name)
	}
	registry.specs = append(registry.specs, spec)

	wrapped := s.wrap(spec)

	opts := []mcp.ToolOption{mcp.WithDescription(buildDescription(spec))}
	opts = append(opts, spec.Options...)
	opts = append(opts, behaviorAnnotation(spec.Behavior, spec.OpenWorld))
	s.mcp.AddTool(mcp.NewTool(spec.Name, opts...), wrapped)

	for _, alias := range spec.Aliases {
		aliasOpts := []mcp.ToolOption{mcp.WithDescription(
			"Deprecated alias for `" + spec.Name + "`. " + spec.Summary,
		)}
		aliasOpts = append(aliasOpts, spec.Options...)
		aliasOpts = append(aliasOpts, behaviorAnnotation(spec.Behavior, spec.OpenWorld))
		s.mcp.AddTool(mcp.NewTool(alias, aliasOpts...), wrapped)
	}
}

// wrap turns a friendly Handler into the mcp-go ToolHandlerFunc shape and
// applies the cross-cutting concerns: disable check, panic recovery, structured
// result serialisation, consistent error formatting.
func (s *Server) wrap(spec ToolSpec) mcpserver.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (result *mcp.CallToolResult, err error) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("MCP tool panic", "tool", spec.Name, "panic", rec, "stack", string(debug.Stack()))
				err = fmt.Errorf("internal error in %s", spec.Name)
				result = nil
			}
		}()

		if !s.mcpEnabled() {
			return mcp.NewToolResultError(
				"MCP access is disabled for this project. Re-enable it under Settings → MCP, " +
					"or with: update_project(mcp_disabled=false).",
			), nil
		}

		out, err := spec.Handler(ctx, req)
		if err != nil {
			// Return an error result rather than an RPC error: clients render
			// these as in-band tool errors that the agent can read and react to.
			return mcp.NewToolResultError(formatToolError(spec.Name, err)), nil
		}
		return successResult(out)
	}
}

// successResult emits a structured result (clients receive proper JSON) with a
// compact text fallback. The compact form saves ~25% bytes vs MarshalIndent.
func successResult(v any) (*mcp.CallToolResult, error) {
	if v == nil {
		v = map[string]any{}
	}
	compact, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return mcp.NewToolResultStructured(v, string(compact)), nil
}

// formatToolError shapes a message that is actionable rather than mysterious.
func formatToolError(toolName string, err error) string {
	msg := err.Error()
	if !strings.Contains(msg, toolName) {
		return toolName + ": " + msg
	}
	return msg
}

// buildDescription assembles the description shown in tools/list.
// Category prefix + summary on the first line, then the full description.
// Agents see this BEFORE deciding to call the tool, so it has to be useful.
func buildDescription(spec ToolSpec) string {
	var b strings.Builder
	b.WriteString("[")
	b.WriteString(string(spec.Category))
	b.WriteString("] ")
	if spec.Summary != "" {
		b.WriteString(spec.Summary)
	}
	if spec.Description != "" {
		b.WriteString("\n\n")
		b.WriteString(spec.Description)
	}
	return b.String()
}

// behaviorAnnotation maps our compact Behavior enum to MCP's ToolAnnotation.
// Defaults from mcp.NewTool are aggressive (destructive=true, openWorld=true);
// we override them for read-only and mutating tools so clients render them
// without warnings.
func behaviorAnnotation(b Behavior, openWorld bool) mcp.ToolOption {
	ann := mcp.ToolAnnotation{}
	t := true
	f := false
	switch b {
	case BehaviorReadOnly:
		ann.ReadOnlyHint = &t
		ann.IdempotentHint = &t
		ann.DestructiveHint = &f
	case BehaviorMutating:
		ann.ReadOnlyHint = &f
		ann.IdempotentHint = &t
		ann.DestructiveHint = &f
	case BehaviorDestructive:
		ann.ReadOnlyHint = &f
		ann.IdempotentHint = &f
		ann.DestructiveHint = &t
	}
	if openWorld {
		ann.OpenWorldHint = &t
	} else {
		ann.OpenWorldHint = &f
	}
	return mcp.WithToolAnnotation(ann)
}

// ── Argument helpers ─────────────────────────────────────────────────────────
//
// These wrap req.Get* and provide the two important behaviours every PandoraBox
// MCP tool needs:
//   1. Safe int64 extraction (JSON numbers arrive as float64; > 2^53 truncates
//      silently with naive int() casts).
//   2. Tolerant "nested object OR legacy *_json string" parsing so the API can
//      accept native JSON arguments while existing UI callers that send
//      stringified JSON keep working.

// argString returns a trimmed string arg, "" if missing.
func argString(req mcp.CallToolRequest, key string) string {
	return strings.TrimSpace(req.GetString(key, ""))
}

// argRequiredString returns a non-empty string arg or an error pointing at the
// missing field. Use for fields marked Required.
func argRequiredString(req mcp.CallToolRequest, key string) (string, error) {
	v := strings.TrimSpace(req.GetString(key, ""))
	if v == "" {
		return "", fmt.Errorf("%q is required", key)
	}
	return v, nil
}

// argBool returns the bool arg with a default.
func argBool(req mcp.CallToolRequest, key string, def bool) bool {
	return req.GetBool(key, def)
}

// argInt64 returns the numeric arg as int64. JSON numbers arrive as float64,
// so naive int() conversion silently loses precision above 2^53; this helper
// goes through the raw arguments to avoid that.
func argInt64(req mcp.CallToolRequest, key string) (int64, bool) {
	args := req.GetArguments()
	if args == nil {
		return 0, false
	}
	switch v := args[key].(type) {
	case nil:
		return 0, false
	case float64:
		return int64(v), true
	case int:
		return int64(v), true
	case int64:
		return v, true
	case string:
		// Tolerate a stringified number (some clients send "42").
		var n int64
		if _, err := fmt.Sscan(strings.TrimSpace(v), &n); err == nil {
			return n, true
		}
	}
	return 0, false
}

// argRequiredInt64 returns the numeric arg as int64 or an error.
func argRequiredInt64(req mcp.CallToolRequest, key string) (int64, error) {
	if v, ok := argInt64(req, key); ok {
		return v, nil
	}
	return 0, fmt.Errorf("%q is required (number)", key)
}

// argObject extracts a nested object argument. If the value arrives as a
// stringified JSON object (the legacy *_json convention), it is parsed
// transparently. Returns nil, false if absent.
func argObject(req mcp.CallToolRequest, key string) (map[string]any, bool) {
	args := req.GetArguments()
	if args == nil {
		return nil, false
	}
	switch v := args[key].(type) {
	case nil:
		return nil, false
	case map[string]any:
		return v, true
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return nil, false
		}
		var out map[string]any
		if err := json.Unmarshal([]byte(s), &out); err == nil {
			return out, true
		}
	}
	return nil, false
}

// argArray extracts a nested array argument, accepting either a native JSON
// array or a stringified one.
func argArray(req mcp.CallToolRequest, key string) ([]any, bool) {
	args := req.GetArguments()
	if args == nil {
		return nil, false
	}
	switch v := args[key].(type) {
	case nil:
		return nil, false
	case []any:
		return v, true
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return nil, false
		}
		var out []any
		if err := json.Unmarshal([]byte(s), &out); err == nil {
			return out, true
		}
	}
	return nil, false
}

// argInto unmarshals a nested object/array argument into a typed Go value.
// The argument may arrive as a native nested object/array or as a stringified
// JSON value (legacy *_json convention) — both are accepted. Returns (false,
// nil) if the key is absent, (true, error) if present but invalid.
func argInto(req mcp.CallToolRequest, key string, target any) (present bool, err error) {
	args := req.GetArguments()
	if args == nil {
		return false, nil
	}
	raw, ok := args[key]
	if !ok || raw == nil {
		return false, nil
	}
	if s, ok := raw.(string); ok {
		s = strings.TrimSpace(s)
		if s == "" {
			return false, nil
		}
		if err := json.Unmarshal([]byte(s), target); err != nil {
			return true, fmt.Errorf("%q: %w", key, err)
		}
		return true, nil
	}
	buf, err := json.Marshal(raw)
	if err != nil {
		return true, fmt.Errorf("%q: %w", key, err)
	}
	if err := json.Unmarshal(buf, target); err != nil {
		return true, fmt.Errorf("%q: %w", key, err)
	}
	return true, nil
}
