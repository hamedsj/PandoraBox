// SPDX-License-Identifier: Apache-2.0
package agentcli

import (
	"context"

	proj "github.com/hamedsj5/pandorabox/internal/project"
)

// fullProjectConfig mirrors the project-config-bearing fields of
// projectInfoResponse (internal/api/project.go). Scope, Match & Replace,
// Middleware, Flows, and Converter are all read/written through GET/PUT
// /api/project — there is no dedicated endpoint per feature — so every
// command group that edits one of these fields fetches the current value,
// mutates it locally, and PUTs just that field back (matching how
// updateProject already does partial updates via pointer fields).
type fullProjectConfig struct {
	Scope        proj.ScopeConfig        `json:"scope"`
	MatchReplace []proj.MatchReplaceRule `json:"match_replace"`
	Middleware   proj.MiddlewareConfig   `json:"middleware"`
	Flows        []proj.Flow             `json:"flows"`
	Converter    proj.ConverterConfig    `json:"converter"`
}

func getProjectConfig(ctx context.Context, c *client) (*fullProjectConfig, error) {
	var cfg fullProjectConfig
	if _, err := c.get(ctx, "/project", nil, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
