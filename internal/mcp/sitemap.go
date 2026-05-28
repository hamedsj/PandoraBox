// SPDX-License-Identifier: Apache-2.0
package mcp

import (
	"fmt"
	"sort"
	"strings"

	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/hamedsj5/pandorabox/internal/proxy"
	"github.com/hamedsj5/pandorabox/internal/storage"
)

type sitemapBranchNode struct {
	ID            string        `json:"id"`
	Kind          string        `json:"kind"`
	Label         string        `json:"label"`
	FullPath      string        `json:"full_path"`
	RequestCount  int           `json:"request_count"`
	ResponseCount int           `json:"response_count"`
	Children      []interface{} `json:"children"`
}

type sitemapRequestNode struct {
	ID              string           `json:"id"`
	Kind            string           `json:"kind"`
	Request         *storage.Request `json:"request"`
	OccurrenceCount int              `json:"occurrence_count"`
	ResponseCount   int              `json:"response_count"`
}

type mutableBranchNode struct {
	ID            string
	Kind          string
	Label         string
	FullPath      string
	RequestCount  int
	ResponseCount int
	Branches      map[string]*mutableBranchNode
	Leaves        map[string]*sitemapRequestNode
}

func buildSitemapTree(requests []*storage.Request) []sitemapBranchNode {
	hosts := map[string]*mutableBranchNode{}

	for _, request := range requests {
		hostKey := request.Host
		if hostKey == "" {
			hostKey = "unknown-host"
		}

		hostNode, ok := hosts[hostKey]
		if !ok {
			hostNode = createBranch("host", "host:"+hostKey, hostKey, hostKey)
			hosts[hostKey] = hostNode
		}

		parts := splitPath(request.Path)
		cursor := hostNode
		currentPath := ""
		for _, part := range parts {
			currentPath += "/" + part
			branch, ok := cursor.Branches[part]
			if !ok {
				branch = createBranch("segment", fmt.Sprintf("%s:%s", cursor.ID, currentPath), part, currentPath)
				cursor.Branches[part] = branch
			}
			cursor = branch
		}

		routeKey := fmt.Sprintf("%s://%s%s", request.Scheme, request.Host, defaultPath(request.Path))
		existing, ok := cursor.Leaves[routeKey]
		if ok {
			existing.OccurrenceCount++
			if request.Response != nil {
				existing.ResponseCount++
			}
			if shouldReplaceLeaf(existing.Request, request) {
				existing.Request = request
				existing.ID = fmt.Sprintf("request:%d", request.ID)
			}
			continue
		}

		cursor.Leaves[routeKey] = &sitemapRequestNode{
			ID:              fmt.Sprintf("request:%d", request.ID),
			Kind:            "request",
			Request:         request,
			OccurrenceCount: 1,
			ResponseCount:   boolToInt(request.Response != nil),
		}
	}

	for _, host := range hosts {
		bubbleCounts(host)
	}

	nodes := make([]sitemapBranchNode, 0, len(hosts))
	for _, host := range hosts {
		nodes = append(nodes, finalizeBranch(host))
	}
	sort.Slice(nodes, func(i, j int) bool {
		return strings.Compare(strings.ToLower(nodes[i].Label), strings.ToLower(nodes[j].Label)) < 0
	})
	return nodes
}

func createBranch(kind, id, label, fullPath string) *mutableBranchNode {
	return &mutableBranchNode{
		ID:       id,
		Kind:     kind,
		Label:    label,
		FullPath: fullPath,
		Branches: map[string]*mutableBranchNode{},
		Leaves:   map[string]*sitemapRequestNode{},
	}
}

func finalizeBranch(node *mutableBranchNode) sitemapBranchNode {
	children := make([]interface{}, 0, len(node.Branches)+len(node.Leaves))
	for _, branch := range node.Branches {
		finalized := finalizeBranch(branch)
		children = append(children, finalized)
	}
	for _, leaf := range node.Leaves {
		children = append(children, *leaf)
	}
	sort.Slice(children, func(i, j int) bool {
		leftReq, leftIsReq := children[i].(sitemapRequestNode)
		rightReq, rightIsReq := children[j].(sitemapRequestNode)
		if leftIsReq && rightIsReq {
			return leftReq.Request.ID > rightReq.Request.ID
		}
		if leftIsReq {
			return false
		}
		if rightIsReq {
			return true
		}
		leftBranch := children[i].(sitemapBranchNode)
		rightBranch := children[j].(sitemapBranchNode)
		return strings.Compare(strings.ToLower(leftBranch.Label), strings.ToLower(rightBranch.Label)) < 0
	})

	return sitemapBranchNode{
		ID:            node.ID,
		Kind:          node.Kind,
		Label:         node.Label,
		FullPath:      node.FullPath,
		RequestCount:  node.RequestCount,
		ResponseCount: node.ResponseCount,
		Children:      children,
	}
}

func bubbleCounts(node *mutableBranchNode) (int, int) {
	requestCount := len(node.Leaves)
	responseCount := 0
	for _, leaf := range node.Leaves {
		if leaf.ResponseCount > 0 {
			responseCount++
		}
	}
	for _, child := range node.Branches {
		reqCount, respCount := bubbleCounts(child)
		requestCount += reqCount
		responseCount += respCount
	}
	node.RequestCount = requestCount
	node.ResponseCount = responseCount
	return requestCount, responseCount
}

func splitPath(path string) []string {
	parts := strings.Split(path, "/")
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			filtered = append(filtered, part)
		}
	}
	return filtered
}

func defaultPath(path string) string {
	if path == "" {
		return "/"
	}
	return path
}

func shouldReplaceLeaf(existing, next *storage.Request) bool {
	existing2xx := has2xx(existing)
	next2xx := has2xx(next)
	if !existing2xx && next2xx {
		return true
	}
	return existing2xx == next2xx && next.ID > existing.ID
}

func has2xx(req *storage.Request) bool {
	return req != nil && req.Response != nil && req.Response.StatusCode >= 200 && req.Response.StatusCode < 300
}

func countUniqueRoutes(requests []*storage.Request) int {
	seen := map[string]struct{}{}
	for _, request := range requests {
		seen[fmt.Sprintf("%s://%s%s", request.Scheme, request.Host, defaultPath(request.Path))] = struct{}{}
	}
	return len(seen)
}

func countResponses(requests []*storage.Request) int {
	count := 0
	for _, request := range requests {
		if request.Response != nil {
			count++
		}
	}
	return count
}

func filterInScopeRequests(requests []*storage.Request, cfg proj.ScopeConfig) []*storage.Request {
	scope := &proxy.ScopeChecker{}
	scope.SetConfig(cfg)
	filtered := make([]*storage.Request, 0, len(requests))
	for _, request := range requests {
		if scope.InScope(request.Host, request.Path) {
			filtered = append(filtered, request)
		}
	}
	return filtered
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
