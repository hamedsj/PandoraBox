// SPDX-License-Identifier: Apache-2.0
package proxy

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hamedsj5/pandorabox/internal/bodydecode"
	"github.com/hamedsj5/pandorabox/internal/config"
	"github.com/hamedsj5/pandorabox/internal/events"
	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/hamedsj5/pandorabox/internal/storage"
)

// TestReplayResponseDecodeReencode verifies, for every supported Content-Encoding
// (gzip, br, zstd, deflate), that a res-body match-replace rule fires against the
// DECOMPRESSED body and the stored response is RE-COMPRESSED to the same encoding
// — i.e. the compression handling is not gzip-only.
func TestReplayResponseDecodeReencode(t *testing.T) {
	plain := []byte(`{"marker": "ORIGINAL", "note": "some longer text so compression is meaningful"}`)

	for _, enc := range []string{"gzip", "br", "zstd", "deflate"} {
		enc := enc
		t.Run(enc, func(t *testing.T) {
			compressed, err := bodydecode.Encode(plain, enc)
			if err != nil {
				t.Fatalf("seed Encode(%q): %v", enc, err)
			}

			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Encoding", enc)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(200)
				_, _ = w.Write(compressed)
			}))
			defer srv.Close()

			db, err := storage.Open(filepath.Join(t.TempDir(), "t.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()

			u, _ := url.Parse(srv.URL)
			id, err := db.SaveRequest(&storage.Request{
				Method: "GET", Scheme: "http", Host: u.Host, Path: "/",
				Headers: `{}`,
			})
			if err != nil {
				t.Fatal(err)
			}

			p := New(&config.Config{}, db, nil, events.NewBus(), NewInterceptQueue())
			// res-body rule that only matches the DECOMPRESSED content.
			p.SetMatchReplace([]proj.MatchReplaceRule{{
				ID: 1, Enabled: true, Target: "res-body", Match: "ORIGINAL", Replace: "REWRITTEN",
			}})

			replay, err := p.ReplayRequest(id, nil, nil, "", nil, "")
			if err != nil {
				t.Fatalf("ReplayRequest: %v", err)
			}
			if replay.Response == nil {
				t.Fatalf("no response; status=%s err=%s", replay.Status, replay.Error)
			}

			// The stored body must still be encoded with the SAME Content-Encoding…
			ceHeader := headerValue(replay.Response.Headers, "Content-Encoding")
			if !strings.EqualFold(ceHeader, enc) {
				t.Errorf("Content-Encoding = %q, want %q (header should be preserved)", ceHeader, enc)
			}
			// …and decoding it must reveal the rule's replacement (proving the rule
			// ran on decompressed content and the body was re-compressed).
			decoded, err := bodydecode.Decode(replay.Response.Body, enc)
			if err != nil {
				t.Fatalf("stored body not valid %s: %v", enc, err)
			}
			if !strings.Contains(string(decoded), "REWRITTEN") {
				t.Errorf("decoded body missing rule replacement; got: %s", decoded)
			}
			if strings.Contains(string(decoded), "ORIGINAL") {
				t.Errorf("rule did not fire — body still contains ORIGINAL: %s", decoded)
			}
		})
	}
}

func headerValue(headersJSON, name string) string {
	h := map[string][]string{}
	_ = json.Unmarshal([]byte(headersJSON), &h)
	for k, v := range h {
		if strings.EqualFold(k, name) && len(v) > 0 {
			return v[0]
		}
	}
	return ""
}
