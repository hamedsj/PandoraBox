package proxy

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/hamedsj5/pitokmonitor/internal/events"
	"github.com/hamedsj5/pitokmonitor/internal/storage"
)

// hopByHopHeaders are connection-scoped headers that must never be forwarded
// between proxy hops, per RFC 7230 §6.1.
var hopByHopHeaders = []string{
	"Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization",
	"TE", "Trailers", "Transfer-Encoding", "Upgrade",
	"Proxy-Connection", // non-standard but widely sent
}

// removeHopByHop strips hop-by-hop headers from h.
// It also removes any headers named in the Connection header value itself.
func removeHopByHop(h http.Header) {
	// RFC 7230 §6.1: headers listed in Connection must also be removed.
	for _, v := range h["Connection"] {
		for _, name := range strings.Split(v, ",") {
			h.Del(strings.TrimSpace(name))
		}
	}
	for _, name := range hopByHopHeaders {
		h.Del(name)
	}
}

func (p *Proxy) roundTrip(req *http.Request, scheme string) (*http.Response, *storage.Request, error) {
	// Capture raw request before we strip headers
	rawReq, _ := httputil.DumpRequest(req, true)

	// Snapshot headers and body for storage
	headersJSON, _ := json.Marshal(req.Header)
	var bodyBytes []byte
	if req.Body != nil {
		bodyBytes, _ = io.ReadAll(req.Body)
		req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
	}

	captured := &storage.Request{
		Method:  req.Method,
		Scheme:  scheme,
		Host:    req.Host,
		Path:    req.URL.Path,
		Query:   req.URL.RawQuery,
		Headers: string(headersJSON),
		Body:    bodyBytes,
		Raw:     rawReq,
	}

	// Fast-forward out-of-scope requests without saving or intercepting
	if !p.scope.InScope(req.Host, req.URL.Path) {
		req.RequestURI = ""
		removeHopByHop(req.Header)
		transport := p.makeTransport()
		resp, err := transport.RoundTrip(req)
		if err != nil {
			return nil, nil, fmt.Errorf("upstream: %w", err)
		}
		respBodyBytes, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		resp.Body = io.NopCloser(bytes.NewReader(respBodyBytes))
		removeHopByHop(resp.Header)
		resp.ContentLength = int64(len(respBodyBytes))
		resp.TransferEncoding = nil
		return resp, nil, nil
	}

	// Handle intercept queue
	if p.intercept.IsEnabled() && p.intercept.Matches(req.Host, req.Method, req.URL.Path) {
		reqID, err := p.getDB().SaveRequest(captured)
		if err != nil {
			return nil, nil, err
		}
		captured.ID = reqID
		p.requestCount.Add(1)

		p.bus.Publish(events.Event{
			Type: events.EventInterceptHeld,
			Data: map[string]interface{}{"request_id": reqID},
		})

		decisionCh := p.intercept.Hold(reqID, rawReq)
		decision := <-decisionCh

		if decision.Drop {
			return nil, captured, fmt.Errorf("request dropped")
		}
		if len(decision.ModifiedRaw) > 0 {
			modReq, err := http.ReadRequest(bufio.NewReader(bytes.NewReader(decision.ModifiedRaw)))
			if err == nil {
				modReq.URL.Host = req.URL.Host
				modReq.URL.Scheme = scheme
				req = modReq
			}
		}

		p.bus.Publish(events.Event{
			Type: events.EventInterceptResolved,
			Data: map[string]interface{}{"request_id": reqID},
		})
	}

	// Apply match-and-replace rules to request
	rules := p.getMatchReplace()
	if len(rules) > 0 {
		bodyBytes = applyToRequest(rules, req, bodyBytes)
		req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		req.ContentLength = int64(len(bodyBytes))
		captured.Body = bodyBytes
	}

	// Apply Python middleware to request
	if mw := p.getMiddlewareRunner(); mw != nil {
		newMethod, newURL, newHeaders, newBody, err := mw.ProcessRequest(
			req.Method, req.URL.String(), req.Header.Clone(), bodyBytes,
		)
		if err != nil {
			slog.Warn("Request middleware error", "err", err)
		} else {
			req.Method = newMethod
			if u, e := url.Parse(newURL); e == nil {
				req.URL = u
			}
			req.Header = newHeaders
			bodyBytes = newBody
			req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			req.ContentLength = int64(len(bodyBytes))
			captured.Body = bodyBytes
		}
	}

	// Prepare request for upstream:
	// - clear RequestURI so http.Transport uses req.URL
	// - strip all hop-by-hop headers (Connection, Keep-Alive, TE, Upgrade, etc.)
	req.RequestURI = ""
	removeHopByHop(req.Header)

	start := time.Now()
	transport := p.makeTransport()
	resp, err := transport.RoundTrip(req)
	if err != nil {
		return nil, captured, fmt.Errorf("upstream: %w", err)
	}

	duration := time.Since(start).Milliseconds()

	// Read and buffer the response body so we can both store it and replay it.
	respBodyBytes, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	// Apply match-and-replace rules to response
	if len(rules) > 0 {
		respBodyBytes = applyToResponse(rules, resp, respBodyBytes)
	}

	// Apply Python middleware to response
	if mw := p.getMiddlewareRunner(); mw != nil {
		newCode, newText, newHeaders, newBody, err := mw.ProcessResponse(
			resp.StatusCode, resp.Status, resp.Header.Clone(), respBodyBytes,
		)
		if err != nil {
			slog.Warn("Response middleware error", "err", err)
		} else {
			resp.StatusCode = newCode
			resp.Status = newText
			resp.Header = newHeaders
			respBodyBytes = newBody
		}
	}

	resp.Body = io.NopCloser(bytes.NewReader(respBodyBytes))

	// Strip hop-by-hop headers from the response before forwarding to the browser.
	removeHopByHop(resp.Header)

	// After buffering we know the exact body size. Override ContentLength and
	// clear TransferEncoding so resp.Write() always uses Content-Length framing
	// instead of chunked, avoiding any browser ambiguity.
	resp.ContentLength = int64(len(respBodyBytes))
	resp.TransferEncoding = nil

	respHeadersJSON, _ := json.Marshal(resp.Header)

	// Save to DB (request may already be saved if intercept was enabled)
	db := p.getDB()
	if captured.ID == 0 {
		reqID, err := db.SaveRequest(captured)
		if err != nil {
			slog.Error("Failed to save request", "err", err)
		} else {
			captured.ID = reqID
			p.requestCount.Add(1)
		}
	}

	if captured.ID > 0 {
		respRecord := &storage.Response{
			RequestID:  captured.ID,
			StatusCode: resp.StatusCode,
			StatusText: resp.Status,
			Headers:    string(respHeadersJSON),
			Body:       respBodyBytes,
			DurationMs: duration,
			SizeBytes:  int64(len(respBodyBytes)),
		}
		respID, err := db.SaveResponse(respRecord)
		if err != nil {
			slog.Error("Failed to save response", "err", err)
		} else {
			respRecord.ID = respID
			captured.Response = respRecord
		}

		p.bus.Publish(events.Event{Type: events.EventRequestCaptured, Data: captured})
		p.bus.Publish(events.Event{Type: events.EventResponseReceived, Data: captured.Response})
	}

	return resp, captured, nil
}

// SendRequest sends a fresh HTTP request (used by MCP send_request tool).
func (p *Proxy) SendRequest(method, url string, headers map[string]string, body []byte) (*storage.Request, error) {
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	scheme := req.URL.Scheme
	if scheme == "" {
		scheme = "http"
	}
	_, captured, err := p.roundTrip(req, scheme)
	return captured, err
}

// ReplayRequest replays a stored request with optional modifications.
// When reqID == 0 and raw is non-empty, the request is built directly from
// the raw bytes without a DB lookup (used by the Flows feature).
func (p *Proxy) ReplayRequest(reqID int64, modHeaders map[string]string, modBody []byte, modURL string, raw []byte) (*storage.Replay, error) {
	db := p.getDB()

	var req *http.Request
	var newReqCapture *storage.Request
	var err error

	if reqID == 0 && len(raw) > 0 {
		// Build directly from raw bytes using a stub origin with http scheme
		stub := &storage.Request{Scheme: "http"}
		req, newReqCapture, err = buildReplayRequestFromRaw(stub, raw)
		if err != nil {
			return nil, err
		}
	} else {
		orig, dbErr := db.GetRequest(reqID)
		if dbErr != nil || orig == nil {
			return nil, fmt.Errorf("request not found: %d", reqID)
		}
		req, newReqCapture, err = buildReplayRequest(orig, modHeaders, modBody, modURL, raw)
		if err != nil {
			return nil, err
		}
	}

	var originID *int64
	if reqID != 0 {
		originID = &reqID
	}
	replay := &storage.Replay{OriginRequestID: originID, Status: "pending"}

	newReqID, err := db.SaveRequest(newReqCapture)
	if err != nil {
		return nil, err
	}
	newReqCapture.ID = newReqID
	replay.RequestID = newReqID

	replayID, err := db.SaveReplay(replay)
	if err != nil {
		return nil, err
	}
	replay.ID = replayID

	start := time.Now()
	removeHopByHop(req.Header)
	req.RequestURI = ""
	transport := p.makeTransport()
	resp, err := transport.RoundTrip(req)
	if err != nil {
		db.UpdateReplay(replayID, nil, "error", err.Error())
		return replay, err
	}
	defer resp.Body.Close()

	duration := time.Since(start).Milliseconds()
	respBodyBytes, _ := io.ReadAll(resp.Body)
	respHeadersJSON, _ := json.Marshal(resp.Header)

	respRecord := &storage.Response{
		RequestID:  newReqID,
		StatusCode: resp.StatusCode,
		StatusText: resp.Status,
		Headers:    string(respHeadersJSON),
		Body:       respBodyBytes,
		DurationMs: duration,
		SizeBytes:  int64(len(respBodyBytes)),
	}
	respID, _ := db.SaveResponse(respRecord)
	respRecord.ID = respID

	db.UpdateReplay(replayID, &respID, "done", "")

	replay.Status = "done"
	replay.ResponseID = &respID
	replay.Response = respRecord
	replay.Request = newReqCapture

	return replay, nil
}

func buildReplayRequest(orig *storage.Request, modHeaders map[string]string, modBody []byte, modURL string, raw []byte) (*http.Request, *storage.Request, error) {
	if len(raw) > 0 {
		return buildReplayRequestFromRaw(orig, raw)
	}

	targetURL := fmt.Sprintf("%s://%s%s", orig.Scheme, orig.Host, orig.Path)
	if orig.Query != "" {
		targetURL += "?" + orig.Query
	}
	if modURL != "" {
		targetURL = modURL
	}

	body := orig.Body
	if modBody != nil {
		body = modBody
	}

	req, err := http.NewRequest(orig.Method, targetURL, bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}

	var origHeaders map[string][]string
	json.Unmarshal([]byte(orig.Headers), &origHeaders)
	for k, vs := range origHeaders {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	for k, v := range modHeaders {
		req.Header.Set(k, v)
	}

	rawReq, _ := httputil.DumpRequest(req, true)
	headersJSON, _ := json.Marshal(req.Header)

	return req, &storage.Request{
		Method:  req.Method,
		Scheme:  req.URL.Scheme,
		Host:    req.URL.Host,
		Path:    req.URL.Path,
		Query:   req.URL.RawQuery,
		Headers: string(headersJSON),
		Body:    body,
		Raw:     rawReq,
	}, nil
}

func buildReplayRequestFromRaw(orig *storage.Request, raw []byte) (*http.Request, *storage.Request, error) {
	req, err := http.ReadRequest(bufio.NewReader(bytes.NewReader(raw)))
	if err != nil {
		return nil, nil, err
	}

	if req.URL.Scheme == "" {
		req.URL.Scheme = orig.Scheme
	}
	if req.URL.Host == "" {
		if req.Host != "" {
			req.URL.Host = req.Host
		} else {
			req.URL.Host = orig.Host
		}
	}
	if req.Host == "" {
		req.Host = req.URL.Host
	}

	body, err := io.ReadAll(req.Body)
	if err != nil {
		return nil, nil, err
	}
	req.Body = io.NopCloser(bytes.NewReader(body))
	req.ContentLength = int64(len(body))

	headersJSON, _ := json.Marshal(req.Header)
	return req, &storage.Request{
		Method:  req.Method,
		Scheme:  req.URL.Scheme,
		Host:    req.URL.Host,
		Path:    req.URL.Path,
		Query:   req.URL.RawQuery,
		Headers: string(headersJSON),
		Body:    body,
		Raw:     raw,
	}, nil
}
