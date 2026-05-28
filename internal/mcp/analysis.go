package mcp

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/hamedsj5/pandorabox/internal/bodydecode"
	"github.com/hamedsj5/pandorabox/internal/storage"
	"github.com/mark3labs/mcp-go/mcp"
)

// ── Helpers ───────────────────────────────────────────────────────────────────

// decodeBody decompresses body bytes based on the Content-Encoding header,
// returning the original body unchanged if decoding fails. The shared
// implementation lives in internal/bodydecode.
func decodeBody(body []byte, headersJSON string) []byte {
	return bodydecode.DecodeFromHeaders(body, []byte(headersJSON))
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

const maxFSComponentBytes = 255
const exportNameHashHexLen = 16

// fitFSComponent shortens an oversized single filesystem component to <=255
// bytes. For final file names, it preserves the original extension when
// possible using "<hash16><ext>".
func fitFSComponent(name string, preserveExt bool) string {
	if len([]byte(name)) <= maxFSComponentBytes {
		return name
	}

	hash := sha256.Sum256([]byte(name))
	shortHash := hex.EncodeToString(hash[:])[:exportNameHashHexLen]

	if preserveExt {
		ext := filepath.Ext(name)
		if ext != "" {
			ext = clipToBytes(ext, 64)
			candidate := shortHash + ext
			if len([]byte(candidate)) <= maxFSComponentBytes {
				return candidate
			}
		}
	}
	return shortHash
}

func clipToBytes(s string, maxBytes int) string {
	if len([]byte(s)) <= maxBytes {
		return s
	}
	var b strings.Builder
	used := 0
	for _, r := range s {
		n := len([]byte(string(r)))
		if used+n > maxBytes {
			break
		}
		b.WriteRune(r)
		used += n
	}
	return b.String()
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
		parts[i] = fitFSComponent(safeFSName(p), i == len(parts)-1)
	}
	return filepath.Join(parts...)
}

// ── Tool registration ─────────────────────────────────────────────────────────

func (s *Server) registerAnalysisTools() {
	s.register(ToolSpec{
		Name:     "analysis_export_responses",
		Aliases:  []string{"export_responses"},
		Category: CatAnalysis,
		Behavior: BehaviorDestructive, // writes files to disk
		Summary:  "Export captured response bodies to the local filesystem under dest_dir/{host}/{path}.",
		Description: "Decompresses gzip/deflate/br/zstd by default. Returns counts and skipped reasons.",
		Options: []mcp.ToolOption{
			mcp.WithString("dest_dir", mcp.Description("Local directory to write files into."), mcp.Required()),
			mcp.WithString("host", mcp.Description("Filter by host (substring).")),
			mcp.WithString("content_type", mcp.Description("Filter by Content-Type substring, e.g. \"javascript\".")),
			mcp.WithNumber("status_min", mcp.Description("Minimum status code.")),
			mcp.WithNumber("status_max", mcp.Description("Maximum status code.")),
			mcp.WithBoolean("decoded", mcp.Description("Decompress gzip/deflate/br/zstd before writing (default true).")),
		},
		Handler: s.toolExportResponses,
	})

	s.register(ToolSpec{
		Name:     "analysis_grep_responses",
		Aliases:  []string{"grep_responses"},
		Category: CatAnalysis,
		Behavior: BehaviorReadOnly,
		Summary:  "Search response bodies with a regular expression (grep -C style).",
		Options: []mcp.ToolOption{
			mcp.WithString("pattern", mcp.Description("Regular expression pattern."), mcp.Required()),
			mcp.WithString("host", mcp.Description("Filter by host (substring).")),
			mcp.WithString("content_type", mcp.Description("Filter by Content-Type substring.")),
			mcp.WithNumber("context_lines", mcp.Description("Lines of context before/after each match (0–10, default 2).")),
		},
		Handler: s.toolGrepResponses,
	})

	s.register(ToolSpec{
		Name:     "analysis_response_headers_summary",
		Aliases:  []string{"get_response_headers_summary"},
		Category: CatAnalysis,
		Behavior: BehaviorReadOnly,
		Summary:  "Audit response headers and flag missing security headers (CSP, HSTS, X-Frame-Options, …).",
		Options: []mcp.ToolOption{
			mcp.WithString("host", mcp.Description("Filter by host (substring).")),
		},
		Handler: s.toolGetResponseHeadersSummary,
	})
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

func (s *Server) toolExportResponses(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	destDir, err := argRequiredString(req, "dest_dir")
	if err != nil {
		return nil, err
	}

	filter := storage.RequestFilter{Limit: 50000}
	if v := argString(req, "host"); v != "" {
		filter.Host = v
	}
	if v := argString(req, "content_type"); v != "" {
		filter.ContentType = v
	}
	if v, ok := argInt64(req, "status_min"); ok {
		filter.StatusMin = int(v)
	}
	if v, ok := argInt64(req, "status_max"); ok {
		filter.StatusMax = int(v)
	}
	decode := argBool(req, "decoded", true)

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
		localPath := filepath.Join(destDir, fitFSComponent(safeFSName(r.Host), false), relPath)

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

	return map[string]any{
		"exported":       exported,
		"skipped":        skipped,
		"total_exported": len(exported),
		"total_skipped":  len(skipped),
	}, nil
}

func (s *Server) toolGrepResponses(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	pattern, err := argRequiredString(req, "pattern")
	if err != nil {
		return nil, err
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("invalid pattern: %w", err)
	}

	filter := storage.RequestFilter{Limit: 10000}
	if v := argString(req, "host"); v != "" {
		filter.Host = v
	}
	if v := argString(req, "content_type"); v != "" {
		filter.ContentType = v
	}

	contextLines := 2
	if v, ok := argInt64(req, "context_lines"); ok {
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

	return map[string]any{"matches": matches, "total": len(matches)}, nil
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

func (s *Server) toolGetResponseHeadersSummary(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	host := argString(req, "host")

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

	return map[string]any{
		"by_header":                byHeader,
		"missing_security_headers": missingSecurity,
		"security_headers_checked": securityHeaderNames,
	}, nil
}
