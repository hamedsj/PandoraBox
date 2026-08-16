// SPDX-License-Identifier: Apache-2.0
package api

import (
	"bytes"
	"encoding/json"
	"net/http"

	"github.com/hamedsj5/pandorabox/internal/bodydecode"
	"github.com/hamedsj5/pandorabox/internal/proxy"
)

// testMiddleware handles POST /api/middleware/test — dry-runs a single Python
// middleware script against a captured request or response and returns the
// result, any raised error, and the script's stderr/print output (tracebacks
// included). It never touches the live middleware graph.
func (s *Server) testMiddleware(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code      string `json:"code"`
		Type      string `json:"type"` // "request" | "response"
		RequestID int64  `json:"request_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if in.Code == "" {
		writeError(w, http.StatusBadRequest, "code is required")
		return
	}
	if in.Type != "response" {
		in.Type = "request"
	}
	req, err := s.getDB().GetRequest(in.RequestID)
	if err != nil || req == nil {
		writeError(w, http.StatusNotFound, "request not found")
		return
	}

	var seed proxy.MiddlewareTestResult
	var headers http.Header
	var body []byte
	if in.Type == "response" {
		if req.Response == nil {
			writeError(w, http.StatusBadRequest, "request has no captured response")
			return
		}
		seed.StatusCode = req.Response.StatusCode
		seed.StatusText = req.Response.StatusText
		headers = http.Header(parseHeaderJSON(req.Response.Headers))
		// Runtime now hands middleware the decompressed body — feed the same here.
		body = bodydecode.DecodeFromHeaders(req.Response.Body, []byte(req.Response.Headers))
	} else {
		seed.Method = req.Method
		seed.URL = req.Scheme + "://" + req.Host + req.Path
		if req.Query != "" {
			seed.URL += "?" + req.Query
		}
		headers = http.Header(parseHeaderJSON(req.Headers))
		body = bodydecode.DecodeFromHeaders(req.Body, []byte(req.Headers))
	}

	res := proxy.RunMiddlewareTest(in.Type, in.Code, seed, headers, body)

	// body is already decoded above; present before/after as text (truncated).
	beforeBody := body
	afterBody := res.Body
	out := map[string]interface{}{
		"started":         res.Started,
		"ok":              res.OK,
		"error":           res.Error,
		"console":         res.Console,
		"body_changed":    !bytes.Equal(body, res.Body),
		"headers_changed": !headersEqual(headers, res.Headers),
		"body_before":     truncStr(string(beforeBody), 400),
		"body_after":      truncStr(string(afterBody), 400),
	}
	if in.Type == "response" {
		out["status_before"] = seed.StatusCode
		out["status_after"] = res.StatusCode
	} else {
		out["method_before"], out["method_after"] = seed.Method, res.Method
		out["url_before"], out["url_after"] = seed.URL, res.URL
	}

	writeJSON(w, http.StatusOK, out)
}

func headersEqual(a, b http.Header) bool {
	if len(a) != len(b) {
		return false
	}
	for k, av := range a {
		bv, ok := b[k]
		if !ok || len(av) != len(bv) {
			return false
		}
		for i := range av {
			if av[i] != bv[i] {
				return false
			}
		}
	}
	return true
}
