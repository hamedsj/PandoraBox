// SPDX-License-Identifier: Apache-2.0
package mcp

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	proj "github.com/hamedsj5/pandorabox/internal/project"
)

type flowStepResult struct {
	Status        string            `json:"status"`
	Response      interface{}       `json:"response,omitempty"`
	Error         string            `json:"error,omitempty"`
	ExtractedVars map[string]string `json:"extracted_vars,omitempty"`
}

type flowRunResult struct {
	StepResults   map[string]flowStepResult `json:"step_results"`
	Variables     map[string]string         `json:"variables"`
	Status        string                    `json:"status"`
	CurrentStepID string                    `json:"current_step_id,omitempty"`
}

var flowVarPattern = regexp.MustCompile(`\{\{(\w+)\}\}`)

func (s *Server) runFlowByID(ctx context.Context, flowID string, seedVars map[string]string) (*flowRunResult, error) {
	mgr := s.getProject()
	if mgr == nil {
		return nil, fmt.Errorf("no project loaded")
	}

	var selected *proj.Flow
	for i := range mgr.Config().Flows {
		flow := mgr.Config().Flows[i]
		if flow.ID == flowID {
			selected = &flow
			break
		}
	}
	if selected == nil {
		return nil, fmt.Errorf("flow not found")
	}

	variables := map[string]string{}
	for k, v := range selected.Variables {
		variables[k] = v
	}
	for k, v := range seedVars {
		variables[k] = v
	}

	result := &flowRunResult{
		StepResults: make(map[string]flowStepResult, len(selected.Steps)),
		Variables:   variables,
		Status:      "running",
	}

	for _, step := range selected.Steps {
		result.StepResults[step.ID] = flowStepResult{Status: "pending"}
	}

	var lastResponse interface{}

	for _, step := range selected.Steps {
		select {
		case <-ctx.Done():
			result.Status = "error"
			result.CurrentStepID = step.ID
			current := result.StepResults[step.ID]
			current.Status = "skipped"
			result.StepResults[step.ID] = current
			return result, ctx.Err()
		default:
		}

		result.CurrentStepID = step.ID
		current := result.StepResults[step.ID]
		current.Status = "running"
		result.StepResults[step.ID] = current

		switch step.Type {
		case "request":
			raw, err := base64.StdEncoding.DecodeString(step.Raw)
			if err != nil {
				current.Status = "error"
				current.Error = "invalid step raw base64: " + err.Error()
				result.StepResults[step.ID] = current
				result.Status = "error"
				return result, nil
			}
			interpolated := interpolateFlowVars(string(raw), variables)
			replay, err := s.proxy.ReplayRequest(0, nil, nil, "", []byte(interpolated), "")
			if err != nil {
				current.Status = "error"
				current.Error = err.Error()
				result.StepResults[step.ID] = current
				result.Status = "error"
				return result, nil
			}
			current.Status = "done"
			current.Response = replay
			result.StepResults[step.ID] = current
			lastResponse = replay

		case "process":
			extracted, err := executeFlowProcessStep(ctx, step.Code, lastResponse, variables)
			if err != nil {
				current.Status = "error"
				current.Error = err.Error()
				result.StepResults[step.ID] = current
				result.Status = "error"
				return result, nil
			}
			for k, v := range extracted {
				variables[k] = v
			}
			current.Status = "done"
			current.ExtractedVars = extracted
			result.StepResults[step.ID] = current

		default:
			current.Status = "error"
			current.Error = "unsupported flow step type: " + step.Type
			result.StepResults[step.ID] = current
			result.Status = "error"
			return result, nil
		}
	}

	result.Status = "done"
	result.CurrentStepID = ""
	result.Variables = variables
	return result, nil
}

func interpolateFlowVars(template string, vars map[string]string) string {
	return flowVarPattern.ReplaceAllStringFunc(template, func(match string) string {
		sub := flowVarPattern.FindStringSubmatch(match)
		if len(sub) != 2 {
			return match
		}
		if value, ok := vars[sub[1]]; ok {
			return value
		}
		return match
	})
}

func executeFlowProcessStep(ctx context.Context, code string, replay interface{}, variables map[string]string) (map[string]string, error) {
	headers := map[string]string{}
	body := ""
	status := 0
	if replayMap, ok := replayToMap(replay); ok {
		if responseMap, ok := replayMap["response"].(map[string]interface{}); ok {
			if v, ok := responseMap["status_code"].(float64); ok {
				status = int(v)
			}
			if rawHeaders, ok := responseMap["headers"].(string); ok && rawHeaders != "" {
				_ = json.Unmarshal([]byte(rawHeaders), &headers)
			}
			if rawBody, ok := responseMap["body"].(string); ok {
				body = rawBody
			}
		}
	}

	inputJSON, err := json.Marshal(map[string]interface{}{
		"response": map[string]interface{}{
			"status":  status,
			"headers": headers,
			"body":    body,
		},
		"variables": variables,
	})
	if err != nil {
		return nil, err
	}

	tmpFile, err := os.CreateTemp("", "pandora_flow_*.py")
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(buildFlowExecScript(code)); err != nil {
		tmpFile.Close()
		return nil, err
	}
	if err := tmpFile.Close(); err != nil {
		return nil, err
	}

	py3, err := exec.LookPath("python3")
	if err != nil {
		return nil, fmt.Errorf("python3 not found in PATH")
	}

	cmdCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, py3, tmpFile.Name())
	cmd.Stdin = bytes.NewReader(inputJSON)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("%s", msg)
	}

	var parsed struct {
		Variables map[string]string `json:"variables"`
		Error     string            `json:"error"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &parsed); err != nil {
		return nil, fmt.Errorf("invalid python output: %s", strings.TrimSpace(stdout.String()))
	}
	if parsed.Error != "" {
		return nil, fmt.Errorf("%s", strings.TrimSpace(parsed.Error))
	}
	if parsed.Variables == nil {
		parsed.Variables = map[string]string{}
	}
	return parsed.Variables, nil
}

func buildFlowExecScript(userCode string) string {
	return fmt.Sprintf(`import sys, json
_stdout = sys.stdout
sys.stdout = sys.stderr

%s

inp = json.loads(sys.stdin.read())

class _Obj:
    def __init__(self, d):
        self.__dict__.update(d)

class _Context:
    pass

ctx = _Context()
resp_data = inp.get('response', {})
ctx.response = _Obj({
    'status': resp_data.get('status', 0),
    'headers': resp_data.get('headers', {}),
    'body': resp_data.get('body', ''),
})
ctx.variables = inp.get('variables', {})

try:
    result = process(ctx)
    if result is None:
        result = {}
    _stdout.write(json.dumps({"variables": result.get("variables", {}), "error": ""}) + "\n")
    _stdout.flush()
except Exception as e:
    import traceback
    _stdout.write(json.dumps({"variables": {}, "error": str(e) + "\n" + traceback.format_exc()}) + "\n")
    _stdout.flush()
`, userCode)
}

func replayToMap(v interface{}) (map[string]interface{}, bool) {
	switch value := v.(type) {
	case map[string]interface{}:
		return value, true
	default:
		data, err := json.Marshal(value)
		if err != nil {
			return nil, false
		}
		var decoded map[string]interface{}
		if err := json.Unmarshal(data, &decoded); err != nil {
			return nil, false
		}
		return decoded, true
	}
}
