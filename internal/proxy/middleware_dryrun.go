// SPDX-License-Identifier: Apache-2.0
package proxy

import (
	"net/http"
	"time"

	"github.com/hamedsj5/pandorabox/internal/events"
	proj "github.com/hamedsj5/pandorabox/internal/project"
)

// MiddlewareTestResult is the outcome of dry-running one middleware script
// against a captured request or response.
type MiddlewareTestResult struct {
	Started    bool        `json:"started"` // Python subprocess launched
	OK         bool        `json:"ok"`      // script ran without raising
	Error      string      `json:"error,omitempty"`
	Console    []string    `json:"console"` // stderr + user print() output (tracebacks land here)
	Method     string      `json:"method,omitempty"`
	URL        string      `json:"url,omitempty"`
	StatusCode int         `json:"status_code,omitempty"`
	StatusText string      `json:"status_text,omitempty"`
	Headers    http.Header `json:"-"`
	Body       []byte      `json:"-"`
}

// RunMiddlewareTest launches a throwaway middleware runner with a single node
// (the given code) and feeds it one captured request or response, returning what
// the script produced plus any error/console output. nodeType is "request" or
// "response". It never mutates the live middleware graph.
func RunMiddlewareTest(nodeType, code string, in MiddlewareTestResult, headers http.Header, body []byte) MiddlewareTestResult {
	bus := events.NewBus()
	sub := bus.Subscribe()
	var console []string
	done := make(chan struct{})
	go func() {
		for ev := range sub {
			if ev.Type != events.EventConsoleOutput {
				continue
			}
			if d, ok := ev.Data.(events.ConsoleOutputData); ok {
				console = append(console, d.Text)
			}
		}
		close(done)
	}()

	runner := NewMiddlewareRunner()
	runner.SetBus(bus)
	runner.SetConfig(proj.MiddlewareConfig{
		Enabled: true,
		Nodes: []proj.MiddlewareNode{{
			ID: "test", Type: nodeType, Name: "test", Enabled: true, Code: code,
		}},
	})

	out := MiddlewareTestResult{Started: runner.Started()}

	if out.Started {
		switch nodeType {
		case "response":
			code, text, h, b, err := runner.ProcessResponse(in.StatusCode, in.StatusText, headers, body)
			out.StatusCode, out.StatusText, out.Headers, out.Body = code, text, h, b
			if err != nil {
				out.Error = err.Error()
			} else {
				out.OK = true
			}
		default: // request
			method, u, h, b, err := runner.ProcessRequest(in.Method, in.URL, headers, body)
			out.Method, out.URL, out.Headers, out.Body = method, u, h, b
			if err != nil {
				out.Error = err.Error()
			} else {
				out.OK = true
			}
		}
	} else {
		out.Error = "middleware did not start (is python3 installed and on PATH?)"
	}

	runner.Stop()
	// Let stderr drain briefly so tracebacks/prints are captured.
	time.Sleep(50 * time.Millisecond)
	bus.Unsubscribe(sub)
	<-done
	out.Console = console
	return out
}
