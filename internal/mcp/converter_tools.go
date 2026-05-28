// Package mcp — converter_tools.go: encoder/decoder/hash tools and saved
// conversion stacks. Migrated to the registry.
package mcp

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/hamedsj5/pandorabox/internal/converter"
	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerConverterTools() {
	s.register(ToolSpec{
		Name:     "converter_list_algorithms",
		Category: CatConverter,
		Behavior: BehaviorReadOnly,
		Summary:  "List every available transform/encoder/decoder/hash algorithm.",
		Handler:  s.toolConverterListAlgorithms,
	})

	s.register(ToolSpec{
		Name:     "converter_transform",
		Category: CatConverter,
		Behavior: BehaviorReadOnly,
		Summary:  "Apply one algorithm to input text.",
		Description: "Example: converter_transform(input=\"aGVsbG8=\", algorithm=\"base64_decode\") → \"hello\". " +
			"Use converter_list_algorithms to discover ids.",
		Options: []mcp.ToolOption{
			mcp.WithString("input", mcp.Description("Input text to transform."), mcp.Required()),
			mcp.WithString("algorithm", mcp.Description("Algorithm id, e.g. \"base64_decode\", \"sha256\", \"url_decode\"."), mcp.Required()),
		},
		Handler: s.toolConverterTransform,
	})

	s.register(ToolSpec{
		Name:     "converter_get_stacks",
		Category: CatConverter,
		Behavior: BehaviorReadOnly,
		Summary:  "Get the saved conversion stacks for this project.",
		Handler:  s.toolConverterGetStacks,
	})

	s.register(ToolSpec{
		Name:     "converter_save_stacks",
		Category: CatConverter,
		Behavior: BehaviorMutating,
		Summary:  "Replace the saved conversion stacks for this project.",
		Options: []mcp.ToolOption{
			mcp.WithArray("stacks", mcp.Description("Array of ConvertStack objects."), mcp.Items(map[string]any{"type": "object"})),
			mcp.WithString("stacks_json", mcp.Description("Legacy stringified ConvertStack array. Prefer `stacks`.")),
		},
		Handler: s.toolConverterSaveStacks,
	})

	s.register(ToolSpec{
		Name:     "converter_run_stack",
		Category: CatConverter,
		Behavior: BehaviorReadOnly,
		Summary:  "Run a saved stack (by id) or an ad-hoc stack against input text.",
		Description: "Pass `stack_id` for a saved stack OR `stack` (object) / `stack_json` (legacy) for ad-hoc execution.",
		Options: []mcp.ToolOption{
			mcp.WithString("input", mcp.Description("Input text."), mcp.Required()),
			mcp.WithString("stack_id", mcp.Description("Saved stack id from converter_get_stacks.")),
			mcp.WithObject("stack", mcp.Description("Ad-hoc ConvertStack object.")),
			mcp.WithString("stack_json", mcp.Description("Legacy stringified ConvertStack. Prefer `stack`.")),
		},
		Handler: s.toolConverterRunStack,
	})
}

func (s *Server) toolConverterListAlgorithms(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	return map[string]any{"algorithms": converter.Algorithms()}, nil
}

func (s *Server) toolConverterTransform(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	input := argString(req, "input")
	algorithm, err := argRequiredString(req, "algorithm")
	if err != nil {
		return nil, err
	}
	out, err := converter.Transform(input, algorithm)
	if err != nil {
		return nil, err
	}
	return map[string]any{"output": out}, nil
}

func (s *Server) toolConverterGetStacks(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	p := s.getProject()
	if p == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	return map[string]any{
		"stacks": normalizeMCPConverterConfig(p.Config().Converter).Stacks,
	}, nil
}

func (s *Server) toolConverterSaveStacks(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	p := s.getProject()
	if p == nil {
		return nil, fmt.Errorf("no project loaded")
	}
	var stacks []proj.ConvertStack
	present, err := argInto(req, "stacks", &stacks)
	if !present {
		present, err = argInto(req, "stacks_json", &stacks)
	}
	if err != nil {
		return nil, err
	}
	if !present {
		return nil, fmt.Errorf("`stacks` (array) or `stacks_json` is required")
	}
	cfg := p.Config()
	cfg.Converter = normalizeMCPConverterConfig(proj.ConverterConfig{Stacks: stacks})
	if err := p.Save(cfg); err != nil {
		return nil, err
	}
	return map[string]any{"stacks": cfg.Converter.Stacks}, nil
}

func (s *Server) toolConverterRunStack(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	input := argString(req, "input")
	stackID := argString(req, "stack_id")

	var stack *proj.ConvertStack
	{
		var parsed proj.ConvertStack
		present, err := argInto(req, "stack", &parsed)
		if !present {
			present, err = argInto(req, "stack_json", &parsed)
		}
		if err != nil {
			return nil, err
		}
		if present {
			sn := normalizeMCPStack(parsed)
			stack = &sn
		}
	}
	if stack == nil {
		if stackID == "" {
			return nil, fmt.Errorf("either `stack_id` (saved) or `stack` (ad-hoc) is required")
		}
		p := s.getProject()
		if p == nil {
			return nil, fmt.Errorf("no project loaded")
		}
		for _, st := range normalizeMCPConverterConfig(p.Config().Converter).Stacks {
			if st.ID == stackID {
				cp := st
				stack = &cp
				break
			}
		}
		if stack == nil {
			return nil, fmt.Errorf("stack %q not found", stackID)
		}
	}

	cur := input
	for _, step := range stack.Steps {
		if !step.Enabled {
			continue
		}
		out, err := converter.Transform(cur, step.Algorithm)
		if err != nil {
			return nil, fmt.Errorf("step %s failed: %w", step.ID, err)
		}
		cur = out
	}
	return map[string]any{"stack": stack, "output": cur}, nil
}

func normalizeMCPConverterConfig(in proj.ConverterConfig) proj.ConverterConfig {
	out := proj.ConverterConfig{Stacks: make([]proj.ConvertStack, 0, len(in.Stacks))}
	for _, s := range in.Stacks {
		out.Stacks = append(out.Stacks, normalizeMCPStack(s))
	}
	return out
}

func normalizeMCPStack(s proj.ConvertStack) proj.ConvertStack {
	if s.ID == "" {
		s.ID = uuid.NewString()
	}
	if s.Name == "" {
		s.Name = "New Stack"
	}
	if s.Steps == nil {
		s.Steps = []proj.ConvertStep{}
	}
	for i := range s.Steps {
		if s.Steps[i].ID == "" {
			s.Steps[i].ID = uuid.NewString()
		}
		if s.Steps[i].Algorithm == "" {
			s.Steps[i].Algorithm = "base64_decode"
		}
	}
	return s
}
