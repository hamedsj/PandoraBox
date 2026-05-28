// SPDX-License-Identifier: Apache-2.0
package mcp

import (
	"context"
	"embed"
	"fmt"
	"sort"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
)

//go:embed docs/*.md
var docsFS embed.FS

type docPage struct {
	ID          string
	Title       string
	Description string
	URI         string
	File        string
	Aliases     []string
}

var docPages = []docPage{
	{
		ID:          "overview",
		Title:       "PandoraBox MCP Overview",
		Description: "How PandoraBox MCP is structured, how to discover docs, and how nested JSON arguments work.",
		URI:         "docs://pandorabox/overview",
		File:        "docs/overview.md",
		Aliases:     []string{"getting-started", "start"},
	},
	{
		ID:          "tools",
		Title:       "PandoraBox MCP Tool Reference",
		Description: "Reference for every PandoraBox MCP tool, grouped by capability, with practical usage notes.",
		URI:         "docs://pandorabox/tools",
		File:        "docs/tools.md",
		Aliases:     []string{"tool-reference", "tooling"},
	},
	{
		ID:          "project-schemas",
		Title:       "PandoraBox Project Schemas",
		Description: "Exact JSON shapes used by project, scope, match-replace, middleware, and flow configuration.",
		URI:         "docs://pandorabox/project-schemas",
		File:        "docs/project-schemas.md",
		Aliases:     []string{"schemas", "project", "schema"},
	},
	{
		ID:          "middleware",
		Title:       "PandoraBox Middleware Authoring Guide",
		Description: "How to write Python middleware nodes for HTTP and WebSocket traffic, including packet fields and return semantics.",
		URI:         "docs://pandorabox/middleware",
		File:        "docs/middleware.md",
		Aliases:     []string{"middlewares"},
	},
	{
		ID:          "flows",
		Title:       "PandoraBox Flow Authoring Guide",
		Description: "How to write and run flows, including request steps, process steps, variable interpolation, and Python extraction code.",
		URI:         "docs://pandorabox/flows",
		File:        "docs/flows.md",
		Aliases:     []string{"flow", "workflows"},
	},
	{
		ID:          "coding-api",
		Title:       "PandoraBox Coding API Guide",
		Description: "How to call PandoraBox capabilities from scripts using REST endpoints and the MCP-compatible tool-call API facade.",
		URI:         "docs://pandorabox/coding-api",
		File:        "docs/coding-api.md",
		Aliases:     []string{"api", "rest", "http-api", "code", "programming"},
	},
}

func (s *Server) registerDocs() {
	for _, page := range docPages {
		page := page
		s.mcp.AddResource(mcp.NewResource(
			page.URI,
			page.Title,
			mcp.WithResourceDescription(page.Description),
			mcp.WithMIMEType("text/markdown"),
		), func(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			text, err := readDocPage(page)
			if err != nil {
				return nil, err
			}
			return []mcp.ResourceContents{
				mcp.TextResourceContents{
					URI:      page.URI,
					MIMEType: "text/markdown",
					Text:     text,
				},
			}, nil
		})
	}
}

func readDocPage(page docPage) (string, error) {
	// The "tools" topic is rendered live from the registry so it cannot drift.
	if page.ID == "tools" {
		return RenderToolReference(), nil
	}
	body, err := docsFS.ReadFile(page.File)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", page.File, err)
	}
	return string(body), nil
}

func normalizeDocID(v string) string {
	v = strings.TrimSpace(strings.ToLower(v))
	v = strings.ReplaceAll(v, "_", "-")
	return v
}

func findDocPage(id string) (docPage, bool) {
	id = normalizeDocID(id)
	for _, page := range docPages {
		if page.ID == id {
			return page, true
		}
		for _, alias := range page.Aliases {
			if normalizeDocID(alias) == id {
				return page, true
			}
		}
	}
	return docPage{}, false
}

func listDocTopics() []map[string]string {
	topics := make([]map[string]string, 0, len(docPages))
	for _, page := range docPages {
		topics = append(topics, map[string]string{
			"id":          page.ID,
			"title":       page.Title,
			"description": page.Description,
			"uri":         page.URI,
		})
	}
	sort.Slice(topics, func(i, j int) bool {
		return topics[i]["id"] < topics[j]["id"]
	})
	return topics
}

func (s *Server) toolListDocs(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	return map[string]any{"topics": listDocTopics()}, nil
}

func (s *Server) toolGetDoc(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	id := argString(req, "topic")
	if id == "" {
		id = argString(req, "id")
	}
	if id == "" {
		return nil, fmt.Errorf("`topic` is required (e.g. \"overview\", \"tools\", \"project-schemas\"). Use docs_list to discover topics")
	}
	page, ok := findDocPage(id)
	if !ok {
		return nil, fmt.Errorf("unknown doc topic %q — use docs_list to discover valid topics", id)
	}
	text, err := readDocPage(page)
	if err != nil {
		return nil, err
	}
	return map[string]any{"topic": page.ID, "title": page.Title, "uri": page.URI, "markdown": text}, nil
}
