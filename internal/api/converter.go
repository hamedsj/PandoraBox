// SPDX-License-Identifier: Apache-2.0
package api

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/hamedsj5/pandorabox/internal/converter"
	proj "github.com/hamedsj5/pandorabox/internal/project"
)

func (s *Server) getConverterConfig(w http.ResponseWriter, r *http.Request) {
	s.projectMu.RLock()
	mgr := s.project
	s.projectMu.RUnlock()
	if mgr == nil {
		writeError(w, http.StatusServiceUnavailable, "no project loaded")
		return
	}
	cfg := mgr.Config()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"config":     normalizeConverterConfig(cfg.Converter),
		"algorithms": converter.Algorithms(),
	})
}

func (s *Server) updateConverterConfig(w http.ResponseWriter, r *http.Request) {
	s.projectMu.RLock()
	mgr := s.project
	s.projectMu.RUnlock()
	if mgr == nil {
		writeError(w, http.StatusServiceUnavailable, "no project loaded")
		return
	}

	var body struct {
		Config proj.ConverterConfig `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	cfg := mgr.Config()
	cfg.Converter = normalizeConverterConfig(body.Config)
	if err := mgr.Save(cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.publishProjectUpdated()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"config":     cfg.Converter,
		"algorithms": converter.Algorithms(),
	})
}

func (s *Server) converterTransform(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Input     string `json:"input"`
		Algorithm string `json:"algorithm"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	out, err := converter.Transform(body.Input, body.Algorithm)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"output": out})
}

func (s *Server) converterRunStack(w http.ResponseWriter, r *http.Request) {
	s.projectMu.RLock()
	mgr := s.project
	s.projectMu.RUnlock()
	if mgr == nil {
		writeError(w, http.StatusServiceUnavailable, "no project loaded")
		return
	}

	var body struct {
		Input   string            `json:"input"`
		StackID string            `json:"stack_id"`
		Stack   *proj.ConvertStack `json:"stack"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var stack *proj.ConvertStack
	if body.Stack != nil {
		sv := normalizeStack(*body.Stack)
		stack = &sv
	} else if body.StackID != "" {
		cfg := normalizeConverterConfig(mgr.Config().Converter)
		for i := range cfg.Stacks {
			if cfg.Stacks[i].ID == body.StackID {
				stack = &cfg.Stacks[i]
				break
			}
		}
	}
	if stack == nil {
		writeError(w, http.StatusBadRequest, "stack not found")
		return
	}

	cur := body.Input
	for i, step := range stack.Steps {
		if !step.Enabled {
			continue
		}
		out, err := converter.Transform(cur, step.Algorithm)
		if err != nil {
			writeError(w, http.StatusBadRequest, "step "+step.ID+" failed: "+err.Error())
			return
		}
		cur = out
		_ = i
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"stack":  stack,
		"output": cur,
	})
}

func normalizeConverterConfig(in proj.ConverterConfig) proj.ConverterConfig {
	out := proj.ConverterConfig{Stacks: make([]proj.ConvertStack, 0, len(in.Stacks))}
	for _, s := range in.Stacks {
		out.Stacks = append(out.Stacks, normalizeStack(s))
	}
	return out
}

func normalizeStack(s proj.ConvertStack) proj.ConvertStack {
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
