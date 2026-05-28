// SPDX-License-Identifier: Apache-2.0
package mcp

import (
	"testing"

	"github.com/hamedsj5/pandorabox/internal/config"
	"github.com/hamedsj5/pandorabox/internal/events"
)

func TestRegisteredToolSpecsAreDocumentable(t *testing.T) {
	registry = &Registry{}
	NewServer(&config.Config{MCPPort: 9090}, nil, events.NewBus(), nil, nil, nil)

	specs := registry.Specs()
	if len(specs) == 0 {
		t.Fatal("expected registered MCP tool specs")
	}

	seen := map[string]bool{}
	for _, spec := range specs {
		if spec.Name == "" {
			t.Fatal("tool spec with empty Name")
		}
		if seen[spec.Name] {
			t.Fatalf("duplicate tool name %q", spec.Name)
		}
		seen[spec.Name] = true
		if spec.Category == "" {
			t.Fatalf("%s has empty Category", spec.Name)
		}
		if spec.Summary == "" {
			t.Fatalf("%s has empty Summary", spec.Name)
		}
		if spec.Behavior != BehaviorReadOnly && spec.Behavior != BehaviorMutating && spec.Behavior != BehaviorDestructive {
			t.Fatalf("%s has invalid Behavior %d", spec.Name, spec.Behavior)
		}
	}
}
