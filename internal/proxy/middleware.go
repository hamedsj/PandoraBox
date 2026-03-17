package proxy

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hamedsj5/pitokmonitor/internal/events"
	proj "github.com/hamedsj5/pitokmonitor/internal/project"
)

// Ensure crypto/rand is used (writeWSFrame uses it).
var _ = rand.Reader

type middlewareCall struct {
	payload []byte
	respCh  chan middlewareResult
}

type middlewareResult struct {
	payload []byte
	err     error
}

// MiddlewareRunner manages a persistent Python subprocess that processes
// HTTP and WebSocket packets through user-defined node chains.
type MiddlewareRunner struct {
	mu         sync.Mutex
	cfg        proj.MiddlewareConfig
	scriptHash [32]byte
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	stdout     *bufio.Reader
	callCh     chan middlewareCall
	stopCh     chan struct{}
	started    bool
	bus        *events.Bus
}

func (r *MiddlewareRunner) SetBus(b *events.Bus) {
	r.mu.Lock()
	r.bus = b
	r.mu.Unlock()
}

func NewMiddlewareRunner() *MiddlewareRunner {
	return &MiddlewareRunner{
		callCh: make(chan middlewareCall, 32),
	}
}

// SetConfig updates the middleware configuration and restarts the Python
// subprocess if the generated script has changed.
func (r *MiddlewareRunner) SetConfig(cfg proj.MiddlewareConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()

	script := r.buildScriptForConfig(cfg)
	newHash := sha256.Sum256([]byte(script))

	if newHash == r.scriptHash && r.started {
		r.cfg = cfg
		return
	}

	r.stopLocked()

	r.cfg = cfg
	r.scriptHash = newHash

	if !cfg.Enabled {
		return
	}

	hasEnabled := false
	for _, n := range cfg.Nodes {
		if n.Enabled {
			hasEnabled = true
			break
		}
	}
	if !hasEnabled {
		return
	}

	if err := r.startLocked(script); err != nil {
		slog.Warn("Middleware: failed to start Python process", "err", err)
	}
}

// ProcessRequest passes an HTTP request through the middleware chain.
func (r *MiddlewareRunner) ProcessRequest(method, rawURL string, headers http.Header, body []byte) (string, string, http.Header, []byte, error) {
	r.mu.Lock()
	started := r.started
	r.mu.Unlock()
	if !started {
		return method, rawURL, headers, body, nil
	}

	hdrsMap := headersToMap(headers)
	resp, err := r.call("request", map[string]any{
		"method":   method,
		"url":      rawURL,
		"headers":  hdrsMap,
		"body_b64": base64.StdEncoding.EncodeToString(body),
	})
	if err != nil {
		return method, rawURL, headers, body, err
	}
	if ok, _ := resp["ok"].(bool); !ok {
		errMsg, _ := resp["error"].(string)
		return method, rawURL, headers, body, fmt.Errorf("middleware error: %s", errMsg)
	}

	newMethod, _ := resp["method"].(string)
	newURL, _ := resp["url"].(string)
	newBody := decodeB64Field(resp, "body_b64")
	newHeaders := mapToHeaders(resp["headers"])

	if newMethod == "" {
		newMethod = method
	}
	if newURL == "" {
		newURL = rawURL
	}

	return newMethod, newURL, newHeaders, newBody, nil
}

// ProcessResponse passes an HTTP response through the middleware chain.
func (r *MiddlewareRunner) ProcessResponse(statusCode int, statusText string, headers http.Header, body []byte) (int, string, http.Header, []byte, error) {
	r.mu.Lock()
	started := r.started
	r.mu.Unlock()
	if !started {
		return statusCode, statusText, headers, body, nil
	}

	hdrsMap := headersToMap(headers)
	resp, err := r.call("response", map[string]any{
		"status_code": statusCode,
		"status_text": statusText,
		"headers":     hdrsMap,
		"body_b64":    base64.StdEncoding.EncodeToString(body),
	})
	if err != nil {
		return statusCode, statusText, headers, body, err
	}
	if ok, _ := resp["ok"].(bool); !ok {
		errMsg, _ := resp["error"].(string)
		return statusCode, statusText, headers, body, fmt.Errorf("middleware error: %s", errMsg)
	}

	newCode := statusCode
	if v, ok := resp["status_code"].(float64); ok {
		newCode = int(v)
	}
	newText, _ := resp["status_text"].(string)
	if newText == "" {
		newText = statusText
	}
	newBody := decodeB64Field(resp, "body_b64")
	newHeaders := mapToHeaders(resp["headers"])

	return newCode, newText, newHeaders, newBody, nil
}

// ProcessWSFrame passes a WebSocket frame through the middleware chain.
// direction must be "ws_c2s" or "ws_s2c".
func (r *MiddlewareRunner) ProcessWSFrame(direction string, opcode int, payload []byte) ([]byte, error) {
	r.mu.Lock()
	started := r.started
	r.mu.Unlock()
	if !started {
		return payload, nil
	}

	resp, err := r.call(direction, map[string]any{
		"opcode":      opcode,
		"payload_b64": base64.StdEncoding.EncodeToString(payload),
	})
	if err != nil {
		return payload, err
	}
	if ok, _ := resp["ok"].(bool); !ok {
		errMsg, _ := resp["error"].(string)
		return payload, fmt.Errorf("middleware error: %s", errMsg)
	}

	return decodeB64Field(resp, "payload_b64"), nil
}

// Stop shuts down the Python subprocess.
func (r *MiddlewareRunner) Stop() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stopLocked()
}

func (r *MiddlewareRunner) stopLocked() {
	if !r.started {
		return
	}
	r.started = false
	close(r.stopCh)
	if r.stdin != nil {
		r.stdin.Close()
	}
	if r.cmd != nil {
		r.cmd.Wait()
	}
	r.callCh = make(chan middlewareCall, 32)
}

func (r *MiddlewareRunner) startLocked(script string) error {
	if _, err := exec.LookPath("python3"); err != nil {
		return fmt.Errorf("python3 not found: %w", err)
	}

	tmpFile, err := os.CreateTemp("", "pitok_mw_*.py")
	if err != nil {
		return fmt.Errorf("create temp script: %w", err)
	}
	if _, err := tmpFile.WriteString(script); err != nil {
		tmpFile.Close()
		return err
	}
	tmpFile.Close()

	cmd := exec.Command("python3", tmpFile.Name())
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	r.cmd = cmd
	r.stdin = stdin
	r.stdout = bufio.NewReader(stdoutPipe)
	r.stopCh = make(chan struct{})
	r.started = true

	go r.dispatch()
	go r.readStderr(stderrPipe)
	return nil
}

func (r *MiddlewareRunner) readStderr(rc io.ReadCloser) {
	defer rc.Close()
	scanner := bufio.NewScanner(rc)
	for scanner.Scan() {
		line := scanner.Text()
		r.mu.Lock()
		bus := r.bus
		r.mu.Unlock()
		if bus != nil {
			bus.Publish(events.Event{
				Type: events.EventConsoleOutput,
				Data: events.ConsoleOutputData{
					Source:    "middleware",
					Text:      line,
					Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
				},
			})
		} else {
			slog.Debug("Middleware stderr", "line", line)
		}
	}
}

func (r *MiddlewareRunner) dispatch() {
	for {
		select {
		case <-r.stopCh:
			return
		case call, ok := <-r.callCh:
			if !ok {
				return
			}
			r.mu.Lock()
			stdin := r.stdin
			stdout := r.stdout
			r.mu.Unlock()

			if stdin == nil || stdout == nil {
				call.respCh <- middlewareResult{err: fmt.Errorf("process not running")}
				continue
			}

			_, err := stdin.Write(append(call.payload, '\n'))
			if err != nil {
				call.respCh <- middlewareResult{err: err}
				continue
			}

			line, err := stdout.ReadBytes('\n')
			if err != nil {
				call.respCh <- middlewareResult{err: err}
				continue
			}

			call.respCh <- middlewareResult{payload: line}
		}
	}
}

func (r *MiddlewareRunner) call(msgType string, fields map[string]any) (map[string]any, error) {
	r.mu.Lock()
	started := r.started
	r.mu.Unlock()
	if !started {
		return nil, nil
	}

	fields["id"] = uuid.New().String()
	fields["type"] = msgType

	data, err := json.Marshal(fields)
	if err != nil {
		return nil, err
	}

	respCh := make(chan middlewareResult, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	select {
	case r.callCh <- middlewareCall{payload: data, respCh: respCh}:
	case <-ctx.Done():
		return nil, fmt.Errorf("middleware call queue full")
	}

	select {
	case result := <-respCh:
		if result.err != nil {
			return nil, result.err
		}
		var out map[string]any
		if err := json.Unmarshal(bytes.TrimSpace(result.payload), &out); err != nil {
			return nil, err
		}
		return out, nil
	case <-ctx.Done():
		slog.Warn("Middleware: call timed out, killing process")
		r.mu.Lock()
		if r.cmd != nil {
			r.cmd.Process.Kill()
		}
		r.mu.Unlock()
		return nil, fmt.Errorf("middleware call timed out")
	}
}

// topoSort returns the enabled nodes of the given type in topological order.
func topoSort(nodes []proj.MiddlewareNode, edges []proj.MiddlewareEdge, nodeType string) []proj.MiddlewareNode {
	var filtered []proj.MiddlewareNode
	idxMap := map[string]int{}
	for _, n := range nodes {
		if n.Enabled && n.Type == nodeType {
			idxMap[n.ID] = len(filtered)
			filtered = append(filtered, n)
		}
	}
	if len(filtered) == 0 {
		return nil
	}

	inDegree := make([]int, len(filtered))
	adj := make([][]int, len(filtered))

	for _, e := range edges {
		si, sok := idxMap[e.Source]
		ti, tok := idxMap[e.Target]
		if sok && tok {
			adj[si] = append(adj[si], ti)
			inDegree[ti]++
		}
	}

	var queue []int
	for i, d := range inDegree {
		if d == 0 {
			queue = append(queue, i)
		}
	}

	var result []proj.MiddlewareNode
	visited := make([]bool, len(filtered))
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if visited[cur] {
			continue
		}
		visited[cur] = true
		result = append(result, filtered[cur])
		for _, next := range adj[cur] {
			inDegree[next]--
			if inDegree[next] == 0 {
				queue = append(queue, next)
			}
		}
	}

	// Append any unvisited (isolated) nodes
	for i, n := range filtered {
		if !visited[i] {
			result = append(result, n)
		}
	}

	return result
}

func sanitizeID(s string) string {
	var b strings.Builder
	for _, c := range s {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' {
			b.WriteRune(c)
		} else {
			b.WriteRune('_')
		}
	}
	return b.String()
}

func (r *MiddlewareRunner) buildScriptForConfig(cfg proj.MiddlewareConfig) string {
	types := []string{"request", "response", "ws_c2s", "ws_s2c"}
	chains := map[string][]proj.MiddlewareNode{}
	for _, t := range types {
		chains[t] = topoSort(cfg.Nodes, cfg.Edges, t)
	}

	var sb strings.Builder

	sb.WriteString("import sys, json, base64, traceback\n\n")
	sb.WriteString("class Packet:\n    def __init__(self, **kw):\n        self.__dict__.update(kw)\n\n")
	sb.WriteString("# -- Node definitions --\n")

	for _, t := range types {
		for _, n := range chains[t] {
			fnName := fmt.Sprintf("mw_node_%s_%s", sanitizeID(n.ID), sanitizeID(n.Name))
			code := strings.Replace(n.Code, "def process(", "def "+fnName+"(", 1)
			sb.WriteString(code)
			sb.WriteString("\n\n")
		}
	}

	sb.WriteString("# -- Dispatch chains --\n")
	for _, t := range types {
		varName := strings.ToUpper(strings.ReplaceAll(t, "-", "_")) + "_CHAIN"
		sb.WriteString(varName + " = [")
		for i, n := range chains[t] {
			if i > 0 {
				sb.WriteString(", ")
			}
			fnName := fmt.Sprintf("mw_node_%s_%s", sanitizeID(n.ID), sanitizeID(n.Name))
			sb.WriteString(fnName)
		}
		sb.WriteString("]\n")
	}

	sb.WriteString(`
CHAINS = {
    "request":  REQUEST_CHAIN,
    "response": RESPONSE_CHAIN,
    "ws_c2s":   WS_C2S_CHAIN,
    "ws_s2c":   WS_S2C_CHAIN,
}

def run_chain(chain, packet):
    for fn in chain:
        try:
            r = fn(packet)
            if r is not None:
                packet = r
        except Exception:
            traceback.print_exc(file=sys.stderr)
    return packet

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    msg = {}
    try:
        msg = json.loads(line)
        t = msg["type"]
        body  = base64.b64decode(msg.get("body_b64","") or "")
        pay   = base64.b64decode(msg.get("payload_b64","") or "")
        hdrs  = msg.get("headers", {})

        if t == "request":
            p = Packet(method=msg["method"], url=msg["url"],
                       headers=hdrs, body=body)
            p = run_chain(CHAINS["request"], p)
            out = {"id":msg["id"],"ok":True,"method":p.method,"url":p.url,
                   "headers":p.headers,
                   "body_b64":base64.b64encode(p.body).decode(),"error":""}
        elif t == "response":
            p = Packet(status_code=msg["status_code"],status_text=msg["status_text"],
                       headers=hdrs, body=body)
            p = run_chain(CHAINS["response"], p)
            out = {"id":msg["id"],"ok":True,"status_code":p.status_code,
                   "status_text":p.status_text,"headers":p.headers,
                   "body_b64":base64.b64encode(p.body).decode(),"error":""}
        elif t in ("ws_c2s","ws_s2c"):
            p = Packet(direction=t, opcode=msg["opcode"], payload=pay)
            p = run_chain(CHAINS[t], p)
            out = {"id":msg["id"],"ok":True,
                   "payload_b64":base64.b64encode(p.payload).decode(),"error":""}
        else:
            out = {"id":msg.get("id",""),"ok":False,"error":f"unknown type {t}"}
        print(json.dumps(out), flush=True)
    except Exception as e:
        print(json.dumps({"id":msg.get("id",""),"ok":False,
                          "error":str(e),"trace":traceback.format_exc()}),flush=True)
`)

	return sb.String()
}

func headersToMap(h http.Header) map[string][]string {
	m := make(map[string][]string)
	for k, v := range h {
		m[k] = v
	}
	return m
}

func mapToHeaders(v any) http.Header {
	h := make(http.Header)
	if m, ok := v.(map[string]any); ok {
		for k, vals := range m {
			switch vv := vals.(type) {
			case []any:
				for _, s := range vv {
					if str, ok := s.(string); ok {
						h.Add(k, str)
					}
				}
			case string:
				h.Set(k, vv)
			}
		}
	}
	return h
}

func decodeB64Field(m map[string]any, key string) []byte {
	s, _ := m[key].(string)
	if s == "" {
		return []byte{}
	}
	b, _ := base64.StdEncoding.DecodeString(s)
	return b
}
