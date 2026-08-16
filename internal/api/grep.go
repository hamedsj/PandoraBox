// SPDX-License-Identifier: Apache-2.0
package api

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/hamedsj5/pandorabox/internal/bodydecode"
	"github.com/hamedsj5/pandorabox/internal/storage"
)

// grepRequests handles GET /api/requests/grep — searches decoded request and/or
// response bodies for a term and returns matching requests with a snippet.
//
// Query params: q (required), scope=request|response|both (default both),
// regex=true, case=true (case-sensitive), plus the usual host/method/
// content_type/status_min/status_max/limit filters.
func (s *Server) grepRequests(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	term := q.Get("q")
	if term == "" {
		writeError(w, http.StatusBadRequest, "q (search term) is required")
		return
	}

	scope := q.Get("scope")
	if scope != "request" && scope != "response" {
		scope = "both"
	}
	caseSensitive := q.Get("case") == "true"
	useRegex := q.Get("regex") == "true"

	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 {
		limit = 500
	}
	if limit > 5000 {
		limit = 5000
	}
	statusMin, _ := strconv.Atoi(q.Get("status_min"))
	statusMax, _ := strconv.Atoi(q.Get("status_max"))

	// A matcher over decoded body text; returns the first match's byte offset or -1.
	var re *regexp.Regexp
	if useRegex {
		flags := ""
		if !caseSensitive {
			flags = "(?i)"
		}
		compiled, err := regexp.Compile(flags + term)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid regex: "+err.Error())
			return
		}
		re = compiled
	}
	findIndex := func(text string) int {
		if re != nil {
			loc := re.FindStringIndex(text)
			if loc == nil {
				return -1
			}
			return loc[0]
		}
		if caseSensitive {
			return strings.Index(text, term)
		}
		return strings.Index(strings.ToLower(text), strings.ToLower(term))
	}

	// Pull a generous candidate set (filtered server-side), then grep bodies.
	reqs, err := s.getDB().ListRequestsForExport(nil, storage.RequestFilter{
		Host:        q.Get("host"),
		Method:      strings.ToUpper(q.Get("method")),
		ContentType: q.Get("content_type"),
		StatusMin:   statusMin,
		StatusMax:   statusMax,
		Limit:       5000,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	type grepMatch struct {
		ID         int64  `json:"id"`
		Method     string `json:"method"`
		Host       string `json:"host"`
		Path       string `json:"path"`
		StatusCode int    `json:"status_code"`
		Where      string `json:"where"` // "request" | "response"
		Snippet    string `json:"snippet"`
	}
	matches := make([]grepMatch, 0, 32)

	add := func(req *storage.Request, where string, text string, idx int) {
		status := 0
		if req.Response != nil {
			status = req.Response.StatusCode
		}
		matches = append(matches, grepMatch{
			ID: req.ID, Method: req.Method, Host: req.Host, Path: req.Path,
			StatusCode: status, Where: where, Snippet: snippetAround(text, idx, len(term)),
		})
	}

	for _, req := range reqs {
		if len(matches) >= limit {
			break
		}
		if scope == "request" || scope == "both" {
			text := string(bodydecode.DecodeFromHeaders(req.Body, []byte(req.Headers)))
			if idx := findIndex(text); idx >= 0 {
				add(req, "request", text, idx)
				continue
			}
		}
		if (scope == "response" || scope == "both") && req.Response != nil {
			text := string(bodydecode.DecodeFromHeaders(req.Response.Body, []byte(req.Response.Headers)))
			if idx := findIndex(text); idx >= 0 {
				add(req, "response", text, idx)
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"count":   len(matches),
		"matches": matches,
	})
}

// snippetAround returns a single-line context window around a match offset.
func snippetAround(text string, idx, matchLen int) string {
	const ctx = 48
	start := idx - ctx
	if start < 0 {
		start = 0
	}
	end := idx + matchLen + ctx
	if end > len(text) {
		end = len(text)
	}
	snippet := text[start:end]
	// Collapse newlines/tabs so the snippet stays on one line.
	snippet = strings.NewReplacer("\n", "⏎", "\r", "", "\t", " ").Replace(snippet)
	if start > 0 {
		snippet = "…" + snippet
	}
	if end < len(text) {
		snippet = snippet + "…"
	}
	return snippet
}
