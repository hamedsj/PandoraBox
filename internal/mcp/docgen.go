// Package mcp — docgen.go: generates the canonical tool-reference Markdown
// from the live registry, so the embedded `docs/tools.md` resource (returned
// by `docs_get(topic="tools")`) can never drift from the actual registrations.
package mcp

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
)

// RenderToolReference walks every registered ToolSpec and emits a Markdown
// document grouped by category, including each tool's behavior, arguments
// (with native JSON-Schema types), and any aliases.
func RenderToolReference() string {
	specs := registry.Specs()
	if len(specs) == 0 {
		return "# PandoraBox MCP Tool Reference\n\n_No tools registered yet._\n"
	}

	var b strings.Builder
	b.WriteString("# PandoraBox MCP Tool Reference\n\n")
	b.WriteString("_This file is auto-generated from the live tool registrations in `internal/mcp/`. Do not edit by hand._\n\n")
	b.WriteString("Each tool below shows:\n")
	b.WriteString("- **Behavior** — `read-only`, `mutating`, or `destructive` (clients show a warning on destructive tools).\n")
	b.WriteString("- **Open-world** — whether the tool talks to an external network/system.\n")
	b.WriteString("- **Arguments** — every parameter with its JSON-Schema type, requirement, and description.\n")
	b.WriteString("- **Aliases** — deprecated old names that still work.\n\n")
	b.WriteString("Conventions:\n")
	b.WriteString("- Nested objects/arrays accept native JSON. Legacy `*_json` stringified forms are still accepted alongside.\n")
	b.WriteString("- `_id` fields are JSON numbers; PandoraBox extracts them as int64 safely (no float truncation).\n")
	b.WriteString("- Destructive bulk operations support `dry_run=true` and may require `confirm=true` above safety thresholds.\n\n")

	// Group by category in the order categories appear via the sorted Specs().
	byCat := map[Category][]ToolSpec{}
	catOrder := []Category{}
	for _, sp := range specs {
		if _, seen := byCat[sp.Category]; !seen {
			catOrder = append(catOrder, sp.Category)
		}
		byCat[sp.Category] = append(byCat[sp.Category], sp)
	}
	sort.Slice(catOrder, func(i, j int) bool { return catOrder[i] < catOrder[j] })

	// Table of contents.
	b.WriteString("## Categories\n\n")
	for _, cat := range catOrder {
		anchor := slug(string(cat))
		b.WriteString(fmt.Sprintf("- [%s](#%s)\n", cat, anchor))
	}
	b.WriteString("\n---\n\n")

	for _, cat := range catOrder {
		fmt.Fprintf(&b, "## %s\n\n", cat)
		for _, sp := range byCat[cat] {
			renderSpec(&b, sp)
		}
		b.WriteString("\n")
	}
	return b.String()
}

func renderSpec(b *strings.Builder, sp ToolSpec) {
	fmt.Fprintf(b, "### `%s`\n\n", sp.Name)
	fmt.Fprintf(b, "**Behavior:** %s", behaviorLabel(sp.Behavior))
	if sp.OpenWorld {
		b.WriteString(" · external network")
	}
	b.WriteString("\n\n")
	if sp.Summary != "" {
		b.WriteString(sp.Summary)
		b.WriteString("\n\n")
	}
	if sp.Description != "" {
		b.WriteString(sp.Description)
		b.WriteString("\n\n")
	}

	if len(sp.Aliases) > 0 {
		b.WriteString("**Aliases (deprecated):** ")
		for i, a := range sp.Aliases {
			if i > 0 {
				b.WriteString(", ")
			}
			fmt.Fprintf(b, "`%s`", a)
		}
		b.WriteString("\n\n")
	}

	// Build a Tool with just the schema options to extract the JSON Schema.
	tool := mcp.NewTool("__doc__", sp.Options...)
	if len(tool.InputSchema.Properties) == 0 {
		b.WriteString("_No arguments._\n\n")
		return
	}

	b.WriteString("**Arguments:**\n\n")
	b.WriteString("| Name | Type | Required | Description |\n")
	b.WriteString("|------|------|----------|-------------|\n")

	reqSet := map[string]bool{}
	for _, r := range tool.InputSchema.Required {
		reqSet[r] = true
	}
	names := make([]string, 0, len(tool.InputSchema.Properties))
	for k := range tool.InputSchema.Properties {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, name := range names {
		prop, _ := tool.InputSchema.Properties[name].(map[string]any)
		fmt.Fprintf(b, "| `%s` | %s | %s | %s |\n",
			name, schemaTypeOf(prop), boolMark(reqSet[name]), tableEscape(stringOf(prop, "description")))
	}
	b.WriteString("\n")
}

func behaviorLabel(b Behavior) string {
	switch b {
	case BehaviorReadOnly:
		return "read-only · idempotent"
	case BehaviorMutating:
		return "mutating · idempotent"
	case BehaviorDestructive:
		return "**destructive**"
	}
	return "unknown"
}

func schemaTypeOf(prop map[string]any) string {
	if prop == nil {
		return "any"
	}
	t := stringOf(prop, "type")
	if t == "" {
		return "any"
	}
	if t == "array" {
		if items, ok := prop["items"].(map[string]any); ok {
			return "array&lt;" + stringOf(items, "type") + "&gt;"
		}
		return "array"
	}
	return t
}

func stringOf(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func boolMark(v bool) string {
	if v {
		return "**yes**"
	}
	return "no"
}

func tableEscape(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "|", "\\|")
	return s
}

func slug(s string) string {
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, " & ", "-")
	s = strings.ReplaceAll(s, " ", "-")
	return s
}

// debugDumpRegistry is a development aid: returns the registry as JSON so the
// human can verify what was actually registered. Unused in production code
// paths; kept for future test/diagnostic surfaces.
func debugDumpRegistry() string {
	specs := registry.Specs()
	type out struct {
		Name        string   `json:"name"`
		Aliases     []string `json:"aliases,omitempty"`
		Category    Category `json:"category"`
		Behavior    string   `json:"behavior"`
		OpenWorld   bool     `json:"open_world,omitempty"`
		Summary     string   `json:"summary"`
		Description string   `json:"description,omitempty"`
	}
	rows := make([]out, 0, len(specs))
	for _, sp := range specs {
		rows = append(rows, out{
			Name: sp.Name, Aliases: sp.Aliases, Category: sp.Category,
			Behavior: behaviorLabel(sp.Behavior), OpenWorld: sp.OpenWorld,
			Summary: sp.Summary, Description: sp.Description,
		})
	}
	b, _ := json.MarshalIndent(rows, "", "  ")
	return string(b)
}
