package mcp

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/hamedsj5/pandorabox/internal/storage"
	"github.com/mark3labs/mcp-go/mcp"
)

// ── Helpers ───────────────────────────────────────────────────────────────────

// extractHeaderValue returns the first value of a named header from the stored
// JSON headers string (e.g. `{"Content-Encoding":["gzip"]}`).
func extractHeaderValue(headersJSON, key string) string {
	var h map[string][]string
	if err := json.Unmarshal([]byte(headersJSON), &h); err != nil {
		return ""
	}
	lower := strings.ToLower(key)
	for k, vs := range h {
		if strings.ToLower(k) == lower && len(vs) > 0 {
			return vs[0]
		}
	}
	return ""
}

// decodeBody decompresses body bytes based on the Content-Encoding header.
// Supports gzip and deflate (zlib). Returns body unchanged for other encodings.
func decodeBody(body []byte, headersJSON string) []byte {
	if len(body) == 0 {
		return body
	}
	enc := strings.ToLower(strings.TrimSpace(extractHeaderValue(headersJSON, "Content-Encoding")))
	switch enc {
	case "gzip":
		r, err := gzip.NewReader(bytes.NewReader(body))
		if err != nil {
			return body
		}
		defer r.Close()
		out, err := io.ReadAll(r)
		if err != nil {
			return body
		}
		return out
	case "deflate":
		r, err := zlib.NewReader(bytes.NewReader(body))
		if err != nil {
			return body
		}
		defer r.Close()
		out, err := io.ReadAll(r)
		if err != nil {
			return body
		}
		return out
	default:
		return body
	}
}

// toUTF8 converts bytes to a valid UTF-8 string, replacing invalid sequences.
func toUTF8(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	return strings.ToValidUTF8(string(b), "\ufffd")
}

// safeFSName replaces filesystem-unsafe characters in a single path component.
func safeFSName(s string) string {
	unsafe := []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|"}
	for _, c := range unsafe {
		s = strings.ReplaceAll(s, c, "_")
	}
	return s
}

// safeFilePath converts a URL path into a relative filesystem path.
func safeFilePath(urlPath string) string {
	clean := filepath.ToSlash(filepath.Clean("/" + urlPath))
	clean = strings.TrimPrefix(clean, "/")
	if clean == "" || clean == "." {
		return "index"
	}
	parts := strings.Split(clean, "/")
	for i, p := range parts {
		parts[i] = safeFSName(p)
	}
	return filepath.Join(parts...)
}

// ── Tool registration ─────────────────────────────────────────────────────────

func (s *Server) registerAnalysisTools() {
	s.mcp.AddTool(mcp.NewTool("export_responses",
		mcp.WithDescription(`Export captured HTTP response bodies to the local filesystem. Each response is written as a file under dest_dir/{host}/{path}. Optionally decompress gzip/deflate-encoded bodies before writing.`),
		mcp.WithString("dest_dir", mcp.Description("Local directory path to write files into"), mcp.Required()),
		mcp.WithString("host", mcp.Description("Filter by host (substring match)")),
		mcp.WithString("content_type", mcp.Description("Filter by Content-Type substring (e.g. \"javascript\", \"html\")")),
		mcp.WithNumber("status_min", mcp.Description("Minimum response status code")),
		mcp.WithNumber("status_max", mcp.Description("Maximum response status code")),
		mcp.WithBoolean("decoded", mcp.Description("Decompress gzip/deflate bodies before writing (default true)")),
	), s.toolExportResponses)

	s.mcp.AddTool(mcp.NewTool("grep_responses",
		mcp.WithDescription(`Search captured HTTP response bodies using a regular expression. Returns matching lines with optional context lines, similar to grep -C.`),
		mcp.WithString("pattern", mcp.Description("Regular expression pattern to search for"), mcp.Required()),
		mcp.WithString("host", mcp.Description("Filter by host (substring match)")),
		mcp.WithString("content_type", mcp.Description("Filter by Content-Type substring (e.g. \"javascript\")")),
		mcp.WithNumber("context_lines", mcp.Description("Lines of context before and after each match (0–10, default 2)")),
	), s.toolGrepResponses)

	s.mcp.AddTool(mcp.NewTool("get_response_headers_summary",
		mcp.WithDescription(`Audit response headers across captured traffic. Returns headers grouped by name and flags which security headers (CSP, HSTS, X-Frame-Options, etc.) are missing from each response.`),
		mcp.WithString("host", mcp.Description("Filter by host (substring match)")),
	), s.toolGetResponseHeadersSummary)
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

func (s *Server) toolExportResponses(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	args := req.Params.Arguments

	destDir, ok := args["dest_dir"].(string)
	if !ok || destDir == "" {
		return nil, fmt.Errorf("dest_dir required")
	}

	filter := storage.RequestFilter{Limit: 50000}
	if v, ok := args["host"].(string); ok && v != "" {
		filter.Host = v
	}
	if v, ok := args["content_type"].(string); ok && v != "" {
		filter.ContentType = v
	}
	if v, ok := args["status_min"].(float64); ok {
		filter.StatusMin = int(v)
	}
	if v, ok := args["status_max"].(float64); ok {
		filter.StatusMax = int(v)
	}
	decode := true
	if v, ok := args["decoded"].(bool); ok {
		decode = v
	}

	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}

	requests, _, err := db.ListRequestsWithBodies(filter)
	if err != nil {
		return nil, err
	}

	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return nil, fmt.Errorf("cannot create dest_dir: %w", err)
	}

	type exportedItem struct {
		ID        int64  `json:"id"`
		Host      string `json:"host"`
		Path      string `json:"path"`
		LocalPath string `json:"local_path"`
		Size      int    `json:"size"`
	}
	type skippedItem struct {
		ID     int64  `json:"id"`
		Host   string `json:"host"`
		Path   string `json:"path"`
		Reason string `json:"reason"`
	}

	var exported []exportedItem
	var skipped []skippedItem
	usedPaths := map[string]int{}

	for _, r := range requests {
		if r.Response == nil {
			skipped = append(skipped, skippedItem{r.ID, r.Host, r.Path, "no response"})
			continue
		}

		body := r.Response.Body
		if decode {
			body = decodeBody(body, r.Response.Headers)
		}

		relPath := safeFilePath(r.Path)
		localPath := filepath.Join(destDir, safeFSName(r.Host), relPath)

		// Resolve name collisions
		if count := usedPaths[localPath]; count > 0 {
			ext := filepath.Ext(localPath)
			base := strings.TrimSuffix(localPath, ext)
			localPath = fmt.Sprintf("%s_%d%s", base, count+1, ext)
		}
		usedPaths[localPath]++

		if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
			skipped = append(skipped, skippedItem{r.ID, r.Host, r.Path, err.Error()})
			continue
		}
		if err := os.WriteFile(localPath, body, 0o644); err != nil {
			skipped = append(skipped, skippedItem{r.ID, r.Host, r.Path, err.Error()})
			continue
		}

		exported = append(exported, exportedItem{
			ID:        r.ID,
			Host:      r.Host,
			Path:      r.Path,
			LocalPath: localPath,
			Size:      len(body),
		})
	}

	return jsonResult(map[string]interface{}{
		"exported":       exported,
		"skipped":        skipped,
		"total_exported": len(exported),
		"total_skipped":  len(skipped),
	})
}

func (s *Server) toolGrepResponses(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	args := req.Params.Arguments

	pattern, ok := args["pattern"].(string)
	if !ok || pattern == "" {
		return nil, fmt.Errorf("pattern required")
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("invalid pattern: %w", err)
	}

	filter := storage.RequestFilter{Limit: 10000}
	if v, ok := args["host"].(string); ok && v != "" {
		filter.Host = v
	}
	if v, ok := args["content_type"].(string); ok && v != "" {
		filter.ContentType = v
	}

	contextLines := 2
	if v, ok := args["context_lines"].(float64); ok {
		contextLines = int(v)
		if contextLines > 10 {
			contextLines = 10
		}
		if contextLines < 0 {
			contextLines = 0
		}
	}

	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}

	requests, _, err := db.ListRequestsWithBodies(filter)
	if err != nil {
		return nil, err
	}

	type matchEntry struct {
		ID      int64  `json:"id"`
		Host    string `json:"host"`
		Path    string `json:"path"`
		Line    int    `json:"line"`
		Column  int    `json:"column"`
		Snippet string `json:"snippet"`
	}

	var matches []matchEntry
	const maxMatches = 500

	for _, r := range requests {
		if r.Response == nil || len(matches) >= maxMatches {
			break
		}

		body := decodeBody(r.Response.Body, r.Response.Headers)
		text := toUTF8(body)
		lines := strings.Split(text, "\n")

		for lineIdx, line := range lines {
			if len(matches) >= maxMatches {
				break
			}
			loc := re.FindStringIndex(line)
			if loc == nil {
				continue
			}

			start := lineIdx - contextLines
			if start < 0 {
				start = 0
			}
			end := lineIdx + contextLines + 1
			if end > len(lines) {
				end = len(lines)
			}

			matches = append(matches, matchEntry{
				ID:      r.ID,
				Host:    r.Host,
				Path:    r.Path,
				Line:    lineIdx + 1,
				Column:  loc[0] + 1,
				Snippet: strings.Join(lines[start:end], "\n"),
			})
		}
	}

	return jsonResult(map[string]interface{}{
		"matches": matches,
		"total":   len(matches),
	})
}

var securityHeaderNames = []string{
	"Content-Security-Policy",
	"Strict-Transport-Security",
	"X-Frame-Options",
	"X-Content-Type-Options",
	"Referrer-Policy",
	"Permissions-Policy",
	"X-XSS-Protection",
}

func (s *Server) toolGetResponseHeadersSummary(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}

	host, _ := req.Params.Arguments["host"].(string)

	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}

	var queryArgs []interface{}
	whereClause := "WHERE resp.id IS NOT NULL"
	if host != "" {
		whereClause += " AND r.host LIKE ?"
		queryArgs = append(queryArgs, "%"+host+"%")
	}

	rows, err := db.Query(fmt.Sprintf(`
		SELECT r.id, r.host, r.path, resp.headers
		FROM requests r
		JOIN responses resp ON resp.request_id = r.id
		%s
		ORDER BY r.id DESC
		LIMIT 10000`, whereClause), queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type headerEntry struct {
		ID    int64  `json:"id"`
		Path  string `json:"path"`
		Value string `json:"value"`
	}
	type missingEntry struct {
		ID      int64    `json:"id"`
		Host    string   `json:"host"`
		Path    string   `json:"path"`
		Missing []string `json:"missing"`
	}

	const maxPerHeader = 100
	const maxMissing = 100

	byHeader := map[string][]headerEntry{}
	var missingSecurity []missingEntry

	for rows.Next() {
		var id int64
		var reqHost, path string
		var headersJSON sql.NullString
		if err := rows.Scan(&id, &reqHost, &path, &headersJSON); err != nil {
			continue
		}
		if !headersJSON.Valid {
			continue
		}

		var h map[string][]string
		if err := json.Unmarshal([]byte(headersJSON.String), &h); err != nil {
			continue
		}

		// Build canonical lowercase lookup
		lowerH := map[string]bool{}
		for k, vs := range h {
			if len(vs) > 0 {
				lowerH[strings.ToLower(k)] = true
			}
		}

		// Accumulate all headers
		for k, vs := range h {
			if len(vs) == 0 {
				continue
			}
			key := strings.ToLower(k)
			if len(byHeader[key]) < maxPerHeader {
				byHeader[key] = append(byHeader[key], headerEntry{ID: id, Path: path, Value: vs[0]})
			}
		}

		// Check missing security headers
		if len(missingSecurity) < maxMissing {
			var missing []string
			for _, sh := range securityHeaderNames {
				if !lowerH[strings.ToLower(sh)] {
					missing = append(missing, sh)
				}
			}
			if len(missing) > 0 {
				missingSecurity = append(missingSecurity, missingEntry{
					ID:      id,
					Host:    reqHost,
					Path:    path,
					Missing: missing,
				})
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return jsonResult(map[string]interface{}{
		"by_header":                byHeader,
		"missing_security_headers": missingSecurity,
		"security_headers_checked": securityHeaderNames,
	})
}
