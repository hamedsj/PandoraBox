// SPDX-License-Identifier: Apache-2.0
package api

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/hamedsj5/pandorabox/internal/bodydecode"
)

// testMatchReplace handles GET /api/matchreplace/test?request_id=N — evaluates
// every configured match & replace rule against a captured request/response and
// reports, per rule, whether it would fire and why. This answers "my rule isn't
// working — is the pattern wrong, or is the rule not being evaluated at all?".
func (s *Server) testMatchReplace(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("request_id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "request_id is required")
		return
	}
	req, err := s.getDB().GetRequest(id)
	if err != nil || req == nil {
		writeError(w, http.StatusNotFound, "request not found")
		return
	}

	rules := s.proxy.MatchReplaceRules()

	type ruleResult struct {
		ID         int    `json:"id"`
		Name       string `json:"name,omitempty"`
		Target     string `json:"target"`
		Enabled    bool   `json:"enabled"`
		Applicable bool   `json:"applicable"` // target's data exists on this request
		Matched    bool   `json:"matched"`
		Detail     string `json:"detail"`
		Before     string `json:"before,omitempty"`
		After      string `json:"after,omitempty"`
	}
	results := make([]ruleResult, 0, len(rules))

	reqURL := req.Scheme + "://" + req.Host + req.Path
	if req.Query != "" {
		reqURL += "?" + req.Query
	}
	reqBody := string(bodydecode.DecodeFromHeaders(req.Body, []byte(req.Headers)))
	var resBody, resHeaders string
	hasResp := req.Response != nil
	if hasResp {
		resBody = string(bodydecode.DecodeFromHeaders(req.Response.Body, []byte(req.Response.Headers)))
		resHeaders = req.Response.Headers
	}

	for _, rule := range rules {
		res := ruleResult{ID: rule.ID, Name: rule.Name, Target: rule.Target, Enabled: rule.Enabled}

		if !rule.Enabled {
			res.Detail = "rule is disabled — not evaluated at runtime"
			results = append(results, res)
			continue
		}

		var value string
		switch rule.Target {
		case "req-url":
			res.Applicable, value = true, reqURL
		case "req-header":
			res.Applicable, value = true, headerLines(req.Headers)
		case "req-body":
			res.Applicable, value = true, reqBody
		case "res-header":
			res.Applicable, value = hasResp, resHeaders
			value = headerLines(resHeaders)
		case "res-body":
			res.Applicable, value = hasResp, resBody
		default:
			res.Detail = "unknown target " + rule.Target
			results = append(results, res)
			continue
		}

		if !res.Applicable {
			res.Detail = "no response captured for this request — response rule can't be evaluated"
			results = append(results, res)
			continue
		}

		matched, after, detail := evalRule(rule.Match, rule.Replace, rule.IsRegex, value)
		res.Matched = matched
		res.Detail = detail
		if matched {
			res.Before = truncStr(value, 200)
			res.After = truncStr(after, 200)
		}
		results = append(results, res)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"request_id": id,
		"rule_count": len(rules),
		"rules":      results,
	})
}

// evalRule reports whether a match pattern hits `value`, the transformed result,
// and a human explanation.
func evalRule(match, replace string, isRegex bool, value string) (bool, string, string) {
	if match == "" {
		return true, replace, "empty match — replaces the entire target"
	}
	if isRegex {
		re, err := regexp.Compile(match)
		if err != nil {
			return false, value, "invalid regex: " + err.Error()
		}
		if !re.MatchString(value) {
			return false, value, "regex did not match the target text"
		}
		return true, re.ReplaceAllString(value, replace), "regex matched"
	}
	if !strings.Contains(value, match) {
		return false, value, "literal pattern not found in the target text"
	}
	return true, strings.ReplaceAll(value, match, replace), "literal pattern matched"
}

// headerLines renders stored JSON headers as "Name: Value" lines (how rules see
// them).
func headerLines(headersJSON string) string {
	h := parseHeaderJSON(headersJSON)
	var b strings.Builder
	for name, vals := range h {
		for _, v := range vals {
			b.WriteString(name)
			b.WriteString(": ")
			b.WriteString(v)
			b.WriteString("\n")
		}
	}
	return b.String()
}

func truncStr(s string, max int) string {
	s = strings.NewReplacer("\n", "⏎", "\r", "", "\t", " ").Replace(s)
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}
