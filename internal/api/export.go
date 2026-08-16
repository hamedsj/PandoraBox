// SPDX-License-Identifier: Apache-2.0
package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hamedsj5/pandorabox/internal/bodydecode"
	"github.com/hamedsj5/pandorabox/internal/storage"
)

type exportOptions struct {
	Decode            bool
	SkipRequest       bool
	NoResponseHeaders bool
}

// exportRequests handles GET /api/requests/export
// Query params: format=json|har, ids=1,2,3, host, method, search, status_min, status_max, limit
func (s *Server) exportRequests(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	format := q.Get("format")
	if format != "har" {
		format = "json"
	}

	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 {
		limit = 1000
	}
	if limit > 5000 {
		limit = 5000
	}

	var ids []int64
	if idsStr := q.Get("ids"); idsStr != "" {
		for _, part := range strings.Split(idsStr, ",") {
			id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
			if err == nil && id > 0 {
				ids = append(ids, id)
			}
		}
	}

	statusMin, _ := strconv.Atoi(q.Get("status_min"))
	statusMax, _ := strconv.Atoi(q.Get("status_max"))

	filter := storage.RequestFilter{
		Host:      q.Get("host"),
		Method:    strings.ToUpper(q.Get("method")),
		Search:    q.Get("search"),
		StatusMin: statusMin,
		StatusMax: statusMax,
		Limit:     limit,
	}

	opts := exportOptions{
		Decode:            q.Get("decode") == "true",
		SkipRequest:       q.Get("skip_request") == "true",
		NoResponseHeaders: q.Get("no_response_headers") == "true",
	}

	requests, err := s.getDB().ListRequestsForExport(ids, filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	var data interface{}
	if format == "har" {
		data = buildHARExport(requests, opts)
	} else {
		data = buildJSONExport(requests, opts)
	}

	writeJSON(w, http.StatusOK, data)
}

// ── JSON export format ────────────────────────────────────────────────────────

type jsonExportEntry struct {
	ID        int64           `json:"id"`
	Timestamp time.Time       `json:"timestamp"`
	Request   *jsonExportReq  `json:"request,omitempty"`
	Response  *jsonExportResp `json:"response,omitempty"`
}

type jsonExportReq struct {
	Method  string              `json:"method"`
	Scheme  string              `json:"scheme"`
	Host    string              `json:"host"`
	Path    string              `json:"path"`
	Query   string              `json:"query"`
	Headers map[string][]string `json:"headers,omitempty"`
	BodyB64 *string             `json:"body_b64,omitempty"`
	Body    *string             `json:"body,omitempty"`
}

type jsonExportResp struct {
	StatusCode int                 `json:"status_code"`
	StatusText string              `json:"status_text"`
	Headers    map[string][]string `json:"headers,omitempty"`
	BodyB64    *string             `json:"body_b64,omitempty"`
	Body       *string             `json:"body,omitempty"`
	DurationMs int64               `json:"duration_ms"`
	SizeBytes  int64               `json:"size_bytes"`
}

func buildJSONExport(reqs []*storage.Request, opts exportOptions) map[string]interface{} {
	entries := make([]jsonExportEntry, 0, len(reqs))
	for _, req := range reqs {
		e := jsonExportEntry{
			ID:        req.ID,
			Timestamp: req.Timestamp,
		}
		if !opts.SkipRequest {
			er := &jsonExportReq{
				Method: req.Method,
				Scheme: req.Scheme,
				Host:   req.Host,
				Path:   req.Path,
				Query:  req.Query,
			}
			if !opts.NoResponseHeaders {
				er.Headers = parseHeaderJSON(req.Headers)
			}
			setBodyFields(&er.Body, &er.BodyB64, req.Body, req.Headers, opts.Decode)
			e.Request = er
		}
		if req.Response != nil {
			er := &jsonExportResp{
				StatusCode: req.Response.StatusCode,
				StatusText: req.Response.StatusText,
				DurationMs: req.Response.DurationMs,
				SizeBytes:  req.Response.SizeBytes,
			}
			if !opts.NoResponseHeaders {
				er.Headers = parseHeaderJSON(req.Response.Headers)
			}
			setBodyFields(&er.Body, &er.BodyB64, req.Response.Body, req.Response.Headers, opts.Decode)
			e.Response = er
		}
		entries = append(entries, e)
	}
	return map[string]interface{}{
		"version":     "1",
		"tool":        "PandoraBox",
		"exported_at": time.Now().UTC().Format(time.RFC3339),
		"count":       len(entries),
		"entries":     entries,
	}
}

// ── HAR 1.2 export format ─────────────────────────────────────────────────────

func buildHARExport(reqs []*storage.Request, opts exportOptions) map[string]interface{} {
	entries := make([]map[string]interface{}, 0, len(reqs))
	for _, req := range reqs {
		url := req.Scheme + "://" + req.Host + req.Path
		if req.Query != "" {
			url += "?" + req.Query
		}

		reqBody := req.Body
		bodySize := len(reqBody)

		var harHeaders []map[string]string
		if !opts.NoResponseHeaders {
			harHeaders = headersToHAR(req.Headers)
		} else {
			harHeaders = []map[string]string{}
		}

		harReq := map[string]interface{}{
			"method":      req.Method,
			"url":         url,
			"httpVersion": "HTTP/1.1",
			"headers":     harHeaders,
			"queryString": parseQueryString(req.Query),
			"cookies":     []interface{}{},
			"headersSize": -1,
			"bodySize":    bodySize,
		}
		if len(reqBody) > 0 {
			mimeType := firstHeaderValue(req.Headers, "Content-Type")
			if mimeType == "" {
				mimeType = "application/octet-stream"
			}
			postData := map[string]interface{}{"mimeType": mimeType}
			harBodyText(postData, reqBody, req.Headers, opts.Decode)
			harReq["postData"] = postData
		}

		durationMs := 0
		var harResp map[string]interface{}
		if req.Response != nil {
			durationMs = int(req.Response.DurationMs)
			respBody := req.Response.Body
			mimeType := firstHeaderValue(req.Response.Headers, "Content-Type")
			if mimeType == "" {
				mimeType = "application/octet-stream"
			}
			content := map[string]interface{}{
				"size":     req.Response.SizeBytes,
				"mimeType": mimeType,
			}
			if len(respBody) > 0 {
				harBodyText(content, respBody, req.Response.Headers, opts.Decode)
			}

			var respHeaders []map[string]string
			if !opts.NoResponseHeaders {
				respHeaders = headersToHAR(req.Response.Headers)
			} else {
				respHeaders = []map[string]string{}
			}

			harResp = map[string]interface{}{
				"status":      req.Response.StatusCode,
				"statusText":  req.Response.StatusText,
				"httpVersion": "HTTP/1.1",
				"headers":     respHeaders,
				"cookies":     []interface{}{},
				"content":     content,
				"redirectURL": "",
				"headersSize": -1,
				"bodySize":    req.Response.SizeBytes,
			}
		} else {
			harResp = map[string]interface{}{
				"status":      0,
				"statusText":  "",
				"httpVersion": "HTTP/1.1",
				"headers":     []interface{}{},
				"cookies":     []interface{}{},
				"content":     map[string]interface{}{"size": 0, "mimeType": ""},
				"redirectURL": "",
				"headersSize": -1,
				"bodySize":    -1,
			}
		}

		entries = append(entries, map[string]interface{}{
			"startedDateTime": req.Timestamp.UTC().Format(time.RFC3339Nano),
			"time":            durationMs,
			"request":         harReq,
			"response":        harResp,
			"cache":           map[string]interface{}{},
			"timings":         map[string]interface{}{"send": 0, "wait": durationMs, "receive": 0},
		})
	}

	return map[string]interface{}{
		"log": map[string]interface{}{
			"version": "1.2",
			"creator": map[string]interface{}{"name": "PandoraBox", "version": "1.0"},
			"entries": entries,
		},
	}
}

// ── helpers ───────────────────────────────────────────────────────────────────

func parseHeaderJSON(h string) map[string][]string {
	out := map[string][]string{}
	if h == "" {
		return out
	}
	_ = json.Unmarshal([]byte(h), &out)
	return out
}

func bytesToB64Ptr(b []byte) *string {
	if len(b) == 0 {
		return nil
	}
	s := base64.StdEncoding.EncodeToString(b)
	return &s
}

func headersToHAR(h string) []map[string]string {
	parsed := parseHeaderJSON(h)
	out := make([]map[string]string, 0, len(parsed))
	for name, values := range parsed {
		for _, value := range values {
			out = append(out, map[string]string{"name": name, "value": value})
		}
	}
	return out
}

func firstHeaderValue(h, name string) string {
	parsed := parseHeaderJSON(h)
	lname := strings.ToLower(name)
	for k, vals := range parsed {
		if strings.ToLower(k) == lname && len(vals) > 0 {
			return vals[0]
		}
	}
	return ""
}

// setBodyFields decompresses body (when decode=true) and sets either the text
// body pointer or the base64 body pointer depending on UTF-8 validity.
// With decode=false, always sets body_b64 with the raw (possibly compressed) bytes.
// Keeping text vs binary in separate fields lets consumers (CLI files writer,
// HAR importers) handle each correctly without guessing the encoding.
func setBodyFields(bodyPtr **string, b64Ptr **string, body []byte, headersJSON string, decode bool) {
	if len(body) == 0 {
		return
	}
	if !decode {
		*b64Ptr = bytesToB64Ptr(body)
		return
	}
	out := bodydecode.DecodeFromHeaders(body, []byte(headersJSON))
	if utf8.Valid(out) {
		s := string(out)
		*bodyPtr = &s
	} else {
		*b64Ptr = bytesToB64Ptr(out)
	}
}

// harBodyText sets "text" (and optionally "encoding":"base64") on a HAR content
// or postData map. With decode=true it decompresses first; binary results are
// still base64-encoded per HAR spec.
func harBodyText(m map[string]interface{}, body []byte, headersJSON string, decode bool) {
	var out []byte
	if decode {
		out = bodydecode.DecodeFromHeaders(body, []byte(headersJSON))
	} else {
		out = body
	}
	if utf8.Valid(out) {
		m["text"] = string(out)
	} else {
		m["text"] = base64.StdEncoding.EncodeToString(out)
		m["encoding"] = "base64"
	}
}

func parseQueryString(query string) []map[string]string {
	if query == "" {
		return []map[string]string{}
	}
	var out []map[string]string
	for _, pair := range strings.Split(query, "&") {
		parts := strings.SplitN(pair, "=", 2)
		name := parts[0]
		value := ""
		if len(parts) == 2 {
			value = parts[1]
		}
		out = append(out, map[string]string{"name": name, "value": value})
	}
	return out
}
