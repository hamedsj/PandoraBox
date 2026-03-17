package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/hamedsj5/pandorabox/internal/events"
)

type flowExecRequest struct {
	Code      string            `json:"code"`
	Response  flowExecResponse  `json:"response"`
	Variables map[string]string `json:"variables"`
}

type flowExecResponse struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

type flowExecResult struct {
	Variables map[string]string `json:"variables"`
	Error     string            `json:"error"`
}

func (s *Server) execFlowStep(w http.ResponseWriter, r *http.Request) {
	var req flowExecRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Build Python script embedding user code
	script := buildFlowExecScript(req.Code)

	// Write to temp file
	tmpFile, err := os.CreateTemp("", "pandora_flow_*.py")
	if err != nil {
		writeJSON(w, http.StatusOK, flowExecResult{Error: err.Error()})
		return
	}
	defer os.Remove(tmpFile.Name())
	if _, err := tmpFile.WriteString(script); err != nil {
		writeJSON(w, http.StatusOK, flowExecResult{Error: err.Error()})
		return
	}
	tmpFile.Close()

	// Check python3 exists
	py3, err := exec.LookPath("python3")
	if err != nil {
		writeJSON(w, http.StatusOK, flowExecResult{Error: "python3 not found in PATH"})
		return
	}

	// Build input JSON for the script
	inputJSON, _ := json.Marshal(map[string]interface{}{
		"response": map[string]interface{}{
			"status":  req.Response.Status,
			"headers": req.Response.Headers,
			"body":    req.Response.Body,
		},
		"variables": req.Variables,
	})

	// Run with 10s timeout
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, py3, tmpFile.Name())
	cmd.Stdin = bytes.NewReader(inputJSON)

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		writeJSON(w, http.StatusOK, flowExecResult{Error: err.Error()})
		return
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		writeJSON(w, http.StatusOK, flowExecResult{Error: err.Error()})
		return
	}

	if err := cmd.Start(); err != nil {
		writeJSON(w, http.StatusOK, flowExecResult{Error: err.Error()})
		return
	}

	// Collect stderr lines and publish as console events
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderrPipe)
		for scanner.Scan() {
			line := scanner.Text()
			s.bus.Publish(events.Event{
				Type: events.EventConsoleOutput,
				Data: events.ConsoleOutputData{
					Source:    "flow",
					Text:      line,
					Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
				},
			})
		}
	}()

	out, err := io.ReadAll(stdoutPipe)
	wg.Wait()

	if err2 := cmd.Wait(); err2 != nil && err == nil {
		err = err2
	}
	if err != nil {
		writeJSON(w, http.StatusOK, flowExecResult{Error: err.Error()})
		return
	}

	var result flowExecResult
	if err := json.Unmarshal(out, &result); err != nil {
		writeJSON(w, http.StatusOK, flowExecResult{Error: "invalid python output: " + string(out)})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func buildFlowExecScript(userCode string) string {
	return fmt.Sprintf(`import sys, json
_stdout = sys.stdout
sys.stdout = sys.stderr  # user prints -> stderr (captured for Console)

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
