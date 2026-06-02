// SPDX-License-Identifier: Apache-2.0
package proxy

import (
	"net/http"
	"testing"

	fhttp "github.com/bogdanfinn/fhttp"
)

// toFHTTPRequest must attach Chrome's header-order hint (so the h2 transport
// emits headers in Chrome's order, not Go's map order) without mutating the
// caller's request headers or dropping any.
func TestToFHTTPRequestSetsChromeHeaderOrder(t *testing.T) {
	req, err := http.NewRequest("GET", "https://example.com/", nil)
	if err != nil {
		t.Fatal(err)
	}
	// Deliberately scrambled relative to Chrome's order.
	req.Header.Set("Cookie", "a=1")
	req.Header.Set("Accept", "text/html")
	req.Header.Set("User-Agent", "ua")
	req.Header.Set("X-Custom", "1") // not in the Chrome list

	freq := toFHTTPRequest(req)

	order, ok := freq.Header[fhttp.HeaderOrderKey]
	if !ok {
		t.Fatal("HeaderOrderKey not set on fhttp request")
	}
	if len(order) == 0 || order[0] != "host" {
		t.Fatalf("unexpected header order head: %v", order)
	}

	// The original request must be untouched (no magic key leaked into storage).
	if _, leaked := req.Header[fhttp.HeaderOrderKey]; leaked {
		t.Fatal("HeaderOrderKey leaked into the source request header")
	}

	// Every original header must survive the copy.
	for _, k := range []string{"Cookie", "Accept", "User-Agent", "X-Custom"} {
		if freq.Header.Get(k) == "" {
			t.Fatalf("header %q was dropped in conversion", k)
		}
	}

	// user-agent must rank before accept before cookie in the order list.
	idx := func(name string) int {
		for i, v := range order {
			if v == name {
				return i
			}
		}
		return -1
	}
	if !(idx("user-agent") < idx("accept") && idx("accept") < idx("cookie")) {
		t.Fatalf("chrome order ranking wrong: ua=%d accept=%d cookie=%d",
			idx("user-agent"), idx("accept"), idx("cookie"))
	}
}

// specFromClientHello must return nil for empty/garbage input so chromeTLSDial
// safely falls back to the bundled Chrome preset instead of failing the dial.
func TestSpecFromClientHelloFallback(t *testing.T) {
	if specFromClientHello(nil) != nil {
		t.Fatal("nil input should yield nil spec (fallback)")
	}
	if specFromClientHello([]byte{0x16, 0x03, 0x01, 0x00, 0x05, 0xde, 0xad, 0xbe, 0xef, 0x00}) != nil {
		t.Fatal("garbage input should yield nil spec (fallback)")
	}
}
