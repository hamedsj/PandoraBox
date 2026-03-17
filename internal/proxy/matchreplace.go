package proxy

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	proj "github.com/hamedsj5/pandorabox/internal/project"
)

// doReplace applies a single match→replace transformation to input.
// If match is empty, the entire input is replaced with replace.
func doReplace(input, match, replace string, isRegex bool) string {
	if match == "" {
		return replace
	}
	if isRegex {
		re, err := regexp.Compile(match)
		if err != nil {
			return input // invalid regex — leave unchanged
		}
		return re.ReplaceAllString(input, replace)
	}
	return strings.ReplaceAll(input, match, replace)
}

// applyToRequest applies all request-scoped rules in order.
// Returns potentially modified bodyBytes; modifies req headers/URL in-place.
func applyToRequest(rules []proj.MatchReplaceRule, req *http.Request, body []byte) []byte {
	for _, r := range rules {
		if !r.Enabled {
			continue
		}
		switch r.Target {
		case "req-url":
			newRaw := doReplace(req.URL.String(), r.Match, r.Replace, r.IsRegex)
			if u, err := url.Parse(newRaw); err == nil {
				req.URL = u
			}
		case "req-header":
			applyToHeaders(req.Header, r)
		case "req-body":
			body = []byte(doReplace(string(body), r.Match, r.Replace, r.IsRegex))
		}
	}
	return body
}

// applyToResponse applies all response-scoped rules in order.
// Returns potentially modified bodyBytes; modifies resp headers in-place.
func applyToResponse(rules []proj.MatchReplaceRule, resp *http.Response, body []byte) []byte {
	for _, r := range rules {
		if !r.Enabled {
			continue
		}
		switch r.Target {
		case "res-header":
			applyToHeaders(resp.Header, r)
		case "res-body":
			body = []byte(doReplace(string(body), r.Match, r.Replace, r.IsRegex))
		}
	}
	return body
}

// applyToHeaders operates on each "Name: Value" line individually.
// An empty result after replacement deletes the header.
func applyToHeaders(h http.Header, r proj.MatchReplaceRule) {
	for name, vals := range h {
		var newVals []string
		for _, val := range vals {
			line := fmt.Sprintf("%s: %s", name, val)
			result := doReplace(line, r.Match, r.Replace, r.IsRegex)
			if result == "" {
				continue // delete this header value
			}
			// Parse "Name: Value" back — take everything after first ": "
			if idx := strings.Index(result, ": "); idx >= 0 {
				newVals = append(newVals, result[idx+2:])
			} else {
				newVals = append(newVals, result)
			}
		}
		if len(newVals) == 0 {
			delete(h, name)
		} else {
			h[name] = newVals
		}
	}
}
