// SPDX-License-Identifier: Apache-2.0
package proxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"

	"github.com/hamedsj5/pandorabox/internal/config"
	"github.com/hamedsj5/pandorabox/internal/events"
	"github.com/hamedsj5/pandorabox/internal/storage"
)

// TestReplayForwardsBody reproduces the reported bug: replaying a captured POST
// with a JSON body must forward that body to the target (correct Content-Length,
// bytes intact), not send an empty request.
func TestReplayForwardsBody(t *testing.T) {
	// Target echoes back exactly what it received so we can assert on it.
	var gotBody []byte
	var gotCL int64
	var gotCT string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		gotCL = r.ContentLength
		gotCT = r.Header.Get("Content-Type")
		w.WriteHeader(200)
	}))
	defer srv.Close()

	db, err := storage.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	u, _ := url.Parse(srv.URL)
	jsonBody := []byte(`{"user":"admin","password":"hunter2","roles":[1,2,3]}`)

	id, err := db.SaveRequest(&storage.Request{
		Method:  "POST",
		Scheme:  "http",
		Host:    u.Host,
		Path:    "/login",
		Headers: `{"Content-Type":["application/json"],"Content-Length":["` + itoa(len(jsonBody)) + `"]}`,
		Body:    jsonBody,
	})
	if err != nil {
		t.Fatal(err)
	}

	p := New(&config.Config{}, db, nil, events.NewBus(), NewInterceptQueue())

	replay, err := p.ReplayRequest(id, nil, nil, "", nil, "")
	if err != nil {
		t.Fatalf("ReplayRequest error: %v", err)
	}
	if replay.Response == nil {
		t.Fatalf("no response; status=%s err=%s", replay.Status, replay.Error)
	}

	if string(gotBody) != string(jsonBody) {
		t.Errorf("target received wrong body:\n got: %q\nwant: %q", gotBody, jsonBody)
	}
	if gotCL != int64(len(jsonBody)) {
		t.Errorf("target Content-Length = %d, want %d", gotCL, len(jsonBody))
	}
	if gotCT != "application/json" {
		t.Errorf("target Content-Type = %q, want application/json", gotCT)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
