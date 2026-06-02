// SPDX-License-Identifier: Apache-2.0
package proxy

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"time"

	fhttp "github.com/bogdanfinn/fhttp"
	fhttp2 "github.com/bogdanfinn/fhttp/http2"
	butls "github.com/bogdanfinn/utls"
	"golang.org/x/net/proxy"
)

// chromeTLSDial wraps an existing TCP connection with a uTLS handshake whose
// ClientHello is fingerprint-identical to the real browser.
//
// When rawClientHello is non-nil it is the exact ClientHello record the user's
// browser sent (captured in mitm.go); uTLS reconstructs a spec from it, so the
// upstream JA3/JA4 matches whatever browser and version the user actually runs
// — version-proof and brand-proof. uTLS discards the browser's ephemeral
// key_share material and regenerates it per connection, so the handshake is
// valid with our own keys. If the raw hello can't be reproduced (or none was
// captured, e.g. replay/intruder traffic) it falls back to the bundled latest
// Chrome preset.
//
// alpnProtos controls the ALPN extension. Pass []string{"h2", "http/1.1"} to
// match a browser's full fingerprint (important for JA4, which hashes the first
// ALPN value). Pass []string{"http/1.1"} only when the caller knows h2 is
// unavailable (HTTP proxy tunnels).
//
// The spec MUST be built fresh per connection. ApplyPreset mutates extension
// objects in-place (GREASE values, ECDHE KeyShare.Data, etc.). Sharing a spec
// across connections causes the second+ connection to skip key generation and
// send stale key material — the TLS handshake then fails.
func chromeTLSDial(ctx context.Context, tcpConn net.Conn, host string, alpnProtos []string, rawClientHello []byte) (net.Conn, error) {
	spec := specFromClientHello(rawClientHello)
	if spec == nil {
		s, err := butls.UTLSIdToSpec(butls.HelloChrome_Auto)
		if err != nil {
			tcpConn.Close()
			return nil, fmt.Errorf("utls spec: %w", err)
		}
		spec = &s
	}
	for _, ext := range spec.Extensions {
		if alpn, ok := ext.(*butls.ALPNExtension); ok {
			alpn.AlpnProtocols = alpnProtos
			break
		}
	}
	uconn := butls.UClient(tcpConn, &butls.Config{ServerName: host}, butls.HelloCustom, false, false, false)
	if err := uconn.ApplyPreset(spec); err != nil {
		tcpConn.Close()
		return nil, fmt.Errorf("utls apply preset: %w", err)
	}
	if err := uconn.HandshakeContext(ctx); err != nil {
		tcpConn.Close()
		return nil, err
	}
	return uconn, nil
}

// specFromClientHello reconstructs a uTLS spec from a captured browser
// ClientHello record, or returns nil if none/unparseable (caller falls back to
// the bundled Chrome preset).
func specFromClientHello(raw []byte) *butls.ClientHelloSpec {
	if len(raw) == 0 {
		return nil
	}
	fp := &butls.Fingerprinter{}
	spec, err := fp.FingerprintClientHello(raw)
	if err != nil || spec == nil {
		return nil
	}
	return spec
}

// dualTransport tries h2 for HTTPS requests (full Chrome ALPN + h2 fingerprint)
// and falls back to h1 when the server doesn't support h2. Plain HTTP always
// uses h1. Both paths advertise Chrome's ["h2","http/1.1"] ALPN so the JA4
// fingerprint matches regardless of which protocol the server negotiates.
//
// The h2 side uses bogdanfinn/fhttp/http2.Transport which exposes Chrome's
// exact HTTP/2 fingerprint: SETTINGS values, SETTINGS order, connection-level
// WINDOW_UPDATE (15663105), and pseudo-header order (:method, :authority,
// :scheme, :path). Go's standard x/net/http2 does not support these overrides.
type dualTransport struct {
	h2t *fhttp2.Transport
	h1t *http.Transport
}

func (d *dualTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != "https" {
		return d.h1t.RoundTrip(req)
	}

	// Normalize the host: strip the default HTTPS port (443) so that the h2
	// :authority pseudo-header is "host" not "host:443". Chrome always omits
	// the default port. Some Cloudflare endpoints return 400 when they see
	// :authority with the redundant port included.
	req = normalizeRequestHost(req, "https")

	// Buffer the request body before the h2 attempt so we can replay it over
	// h1 if h2 returns an application-level error (e.g. 400 from Cloudflare's
	// challenge endpoint, or a transport-level failure after the body is read).
	var bodyBuf []byte
	if req.Body != nil && req.Body != http.NoBody {
		var err error
		bodyBuf, err = io.ReadAll(req.Body)
		if err != nil {
			return nil, fmt.Errorf("read request body: %w", err)
		}
		req.Body.Close()
		req.Body = io.NopCloser(bytes.NewReader(bodyBuf))
		req.ContentLength = int64(len(bodyBuf))
	}

	resetBody := func() {
		if bodyBuf != nil {
			req.Body = io.NopCloser(bytes.NewReader(bodyBuf))
			req.ContentLength = int64(len(bodyBuf))
		}
	}

	// Convert to fhttp.Request for the Chrome h2 transport.
	freq := toFHTTPRequest(req)
	fresp, err := d.h2t.RoundTrip(freq)
	if err != nil {
		// Fall back to h1 on any h2 transport error: ALPN negotiation failures,
		// stream resets, GOAWAY, header validation rejections, etc. These are all
		// h2-specific protocol errors that h1 does not have. If h1 also fails,
		// its error is more meaningful than the h2 error.
		resetBody()
		return d.h1t.RoundTrip(req)
	}
	resp := fromFHTTPResponse(fresp, req)
	// If h2 returns 400 with no Cf-Ray, the Cloudflare edge rejected the h2
	// framing before creating a Ray ID. Retry over h1.
	if resp.StatusCode == 400 && resp.Header.Get("Cf-Ray") == "-" {
		resp.Body.Close()
		resetBody()
		return d.h1t.RoundTrip(req)
	}
	return resp, nil
}

func (d *dualTransport) CloseIdleConnections() {
	d.h2t.CloseIdleConnections()
	d.h1t.CloseIdleConnections()
}

// normalizeRequestHost returns a shallow copy of req with the default port
// stripped from req.URL.Host and req.Host so that the h2 :authority
// pseudo-header matches what Chrome sends (no redundant port for standard
// ports). A new *http.Request is returned; the original is not modified.
func normalizeRequestHost(req *http.Request, scheme string) *http.Request {
	defaultPort := "443"
	if scheme == "http" {
		defaultPort = "80"
	}
	stripPort := func(hostport string) string {
		h, p, err := net.SplitHostPort(hostport)
		if err != nil {
			return hostport // already no port
		}
		if p == defaultPort {
			return h
		}
		return hostport
	}

	// Only copy if there's actually something to change.
	newHost := stripPort(req.Host)
	newURLHost := ""
	if req.URL != nil {
		newURLHost = stripPort(req.URL.Host)
	}
	if newHost == req.Host && (req.URL == nil || newURLHost == req.URL.Host) {
		return req
	}

	r2 := new(http.Request)
	*r2 = *req
	r2.Host = newHost
	if req.URL != nil {
		u2 := new(url.URL)
		*u2 = *req.URL
		u2.Host = newURLHost
		r2.URL = u2
	}
	return r2
}

// chromeHeaderOrder is the order in which Chrome emits HTTP/2 request headers
// (after the pseudo-headers). Header order is a fingerprinting signal as strong
// as JA3/JA4 — an otherwise-perfect Chrome ClientHello paired with Go's
// unordered map iteration is an obvious tell to Azure / Akamai / Cloudflare.
//
// fhttp's HeaderOrderKey ranks headers present in this list by their index and
// appends any not listed (lowercased, lexicographically) at the end, so adding
// headers here is lossless: nothing is dropped, only reordered to match Chrome.
var chromeHeaderOrder = []string{
	"host",
	"pragma",
	"cache-control",
	"sec-ch-ua",
	"sec-ch-ua-mobile",
	"sec-ch-ua-platform",
	"sec-ch-ua-arch",
	"sec-ch-ua-bitness",
	"sec-ch-ua-full-version",
	"sec-ch-ua-full-version-list",
	"sec-ch-ua-model",
	"sec-ch-ua-platform-version",
	"sec-ch-ua-wow64",
	"device-memory",
	"dpr",
	"viewport-width",
	"rtt",
	"downlink",
	"ect",
	"upgrade-insecure-requests",
	"dnt",
	"user-agent",
	"content-length",
	"content-type",
	"accept",
	"origin",
	"x-requested-with",
	"sec-fetch-site",
	"sec-fetch-mode",
	"sec-fetch-user",
	"sec-fetch-dest",
	"referer",
	"accept-encoding",
	"accept-language",
	"cookie",
	"priority",
}

// toFHTTPRequest converts a standard net/http request to a bogdanfinn/fhttp
// request for use with the Chrome h2 transport. Both types have identical
// field structure (fhttp is a fork of net/http) and share the same primitive
// types. The header map is copied (not aliased) so we can attach the Chrome
// header-order hint without mutating the caller's request.
func toFHTTPRequest(req *http.Request) *fhttp.Request {
	// Copy headers into a fresh fhttp.Header and attach the Chrome header order.
	// fhttp strips the HeaderOrderKey/PHeaderOrderKey magic keys from the wire;
	// they only steer the emitted order.
	fh := make(fhttp.Header, len(req.Header)+1)
	for k, v := range req.Header {
		fh[k] = v
	}
	fh[fhttp.HeaderOrderKey] = chromeHeaderOrder

	freq := &fhttp.Request{
		Method:           req.Method,
		URL:              req.URL,
		Proto:            req.Proto,
		ProtoMajor:       req.ProtoMajor,
		ProtoMinor:       req.ProtoMinor,
		Header:           fh,
		Body:             req.Body,
		GetBody:          req.GetBody,
		ContentLength:    req.ContentLength,
		TransferEncoding: req.TransferEncoding,
		Close:            req.Close,
		Host:             req.Host,
		Trailer:          fhttp.Header(req.Trailer),
	}
	if ctx := req.Context(); ctx != nil {
		freq = freq.WithContext(ctx)
	}
	return freq
}

// fromFHTTPResponse converts a bogdanfinn/fhttp response to a standard
// net/http response. The Body is not copied — the underlying io.ReadCloser
// is the same object.
func fromFHTTPResponse(fresp *fhttp.Response, req *http.Request) *http.Response {
	return &http.Response{
		Status:           fresp.Status,
		StatusCode:       fresp.StatusCode,
		Proto:            fresp.Proto,
		ProtoMajor:       fresp.ProtoMajor,
		ProtoMinor:       fresp.ProtoMinor,
		Header:           http.Header(fresp.Header),
		Body:             fresp.Body,
		ContentLength:    fresp.ContentLength,
		TransferEncoding: fresp.TransferEncoding,
		Close:            fresp.Close,
		Uncompressed:     fresp.Uncompressed,
		Trailer:          http.Header(fresp.Trailer),
		Request:          req,
	}
}

// makeTransport returns an http.RoundTripper configured to route through the
// upstream proxy (if any). For direct connections and SOCKS5 proxies it is a
// dualTransport that tries h2 first (full Chrome fingerprint) and falls back
// to h1. For HTTP proxies it uses a single http.Transport (uTLS is not
// applicable inside a CONNECT tunnel managed by Go's HTTP stack).
func (p *Proxy) makeTransport() http.RoundTripper {
	p.transportMu.Lock()
	defer p.transportMu.Unlock()

	p.upstreamMu.RLock()
	u := p.upstreamURL
	p.upstreamMu.RUnlock()

	key := ""
	if u != nil {
		key = u.String()
	}

	if p.transport != nil && p.transportKey == key {
		return p.transport
	}
	if p.transport != nil {
		closeIdleConns(p.transport)
		p.transport = nil
		p.transportKey = ""
	}

	var rt http.RoundTripper

	if u == nil {
		rt = buildDirect(nil, p.clientHelloFor)
	} else {
		switch u.Scheme {
		case "http", "https":
			// HTTP proxy: Go handles the CONNECT tunnel internally. uTLS is not
			// applicable here — the TLS handshake is inside the tunnel and not
			// visible to Cloudflare's edge for JA3/JA4 checking.
			dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
			t := &http.Transport{
				Proxy:                 http.ProxyURL(u),
				DialContext:           dialer.DialContext,
				DisableCompression:    true,
				ForceAttemptHTTP2:     false,
				MaxIdleConns:          200,
				MaxIdleConnsPerHost:   50,
				IdleConnTimeout:       90 * time.Second,
				TLSHandshakeTimeout:   10 * time.Second,
				ExpectContinueTimeout: 1 * time.Second,
				TLSClientConfig: &tls.Config{
					MinVersion: tls.VersionTLS12,
					NextProtos: []string{"http/1.1"},
				},
			}
			rt = t
		case "socks5", "socks5h":
			auth := socksAuth(u)
			d, err := proxy.SOCKS5("tcp", u.Host, auth, proxy.Direct)
			if err != nil {
				slog.Warn("SOCKS5 dialer failed", "err", err)
				rt = buildDirect(nil, p.clientHelloFor)
			} else {
				dialFn := func(ctx context.Context, network, addr string) (net.Conn, error) {
					return d.Dial(network, addr)
				}
				rt = buildDirect(dialFn, p.clientHelloFor)
			}
		default:
			slog.Warn("Unknown upstream proxy scheme", "scheme", u.Scheme)
			rt = buildDirect(nil, p.clientHelloFor)
		}
	}

	p.transport = rt
	p.transportKey = key
	return p.transport
}

// buildDirect constructs a dualTransport for direct or SOCKS5-routed
// connections. dialFn is the TCP dialer; pass nil to use the default
// net.Dialer. clientHelloFor returns the captured browser ClientHello for a
// host (nil if none) so the upstream handshake mirrors the real browser.
func buildDirect(dialFn func(ctx context.Context, network, addr string) (net.Conn, error), clientHelloFor func(host string) []byte) *dualTransport {
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	if dialFn == nil {
		dialFn = dialer.DialContext
	}
	if clientHelloFor == nil {
		clientHelloFor = func(string) []byte { return nil }
	}

	// Chrome's full ALPN — required for JA4 fingerprint match.
	fullALPN := []string{"h2", "http/1.1"}

	// Chrome HTTP/2 fingerprint (Akamai h2 fingerprint format):
	//   1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p
	// SETTINGS order matches Chrome exactly.
	chromeSettings := map[fhttp2.SettingID]uint32{
		fhttp2.SettingHeaderTableSize:   65536,
		fhttp2.SettingEnablePush:        0,
		fhttp2.SettingInitialWindowSize: 6291456,
		fhttp2.SettingMaxHeaderListSize: 262144,
	}
	chromeSettingsOrder := []fhttp2.SettingID{
		fhttp2.SettingHeaderTableSize,
		fhttp2.SettingEnablePush,
		fhttp2.SettingInitialWindowSize,
		fhttp2.SettingMaxHeaderListSize,
	}

	capturedDial := dialFn // capture for closures

	// h2 transport: uses fhttp/http2 which supports Chrome's exact h2
	// fingerprint parameters unavailable in x/net/http2.
	// DialTLS performs the ALPN check and returns "unexpected ALPN protocol"
	// if the server negotiates http/1.1, triggering the h1 fallback in
	// dualTransport.RoundTrip.
	h2t := &fhttp2.Transport{
		DialTLS: func(network, addr string, _ *butls.Config) (net.Conn, error) {
			host, _, err := net.SplitHostPort(addr)
			if err != nil {
				host = addr
			}
			tcpConn, err := capturedDial(context.Background(), network, addr)
			if err != nil {
				return nil, err
			}
			conn, err := chromeTLSDial(context.Background(), tcpConn, host, fullALPN, clientHelloFor(host))
			if err != nil {
				return nil, err
			}
			// Verify h2 was negotiated. If the server only supports http/1.1,
			// return an error so dualTransport falls back to h1t.
			if sc, ok := conn.(interface {
				ConnectionState() tls.ConnectionState
			}); ok {
				if proto := sc.ConnectionState().NegotiatedProtocol; proto != "h2" {
					conn.Close()
					return nil, fmt.Errorf("http2: unexpected ALPN protocol %q; want %q", proto, "h2")
				}
			}
			return conn, nil
		},
		Settings:           chromeSettings,
		SettingsOrder:      chromeSettingsOrder,
		PseudoHeaderOrder:  []string{":method", ":authority", ":scheme", ":path"},
		ConnectionFlow:     15663105,
		DisableCompression: true,
	}

	// h1 transport: handles servers where h2 is unavailable or failed.
	// Uses HTTP/1.1-only ALPN so the server is forced to negotiate http/1.1.
	// Using fullALPN here was wrong: the server would pick h2, send h2 frames
	// as its connection preface (SETTINGS), and net/http — which skips the h2
	// upgrade path because DialTLSContext returns *butls.UConn not *tls.Conn —
	// would then read those h2 frames as a "malformed HTTP response".
	h1t := &http.Transport{
		DialContext: capturedDial,
		DialTLSContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, _, err := net.SplitHostPort(addr)
			if err != nil {
				host = addr
			}
			tcpConn, err := capturedDial(ctx, network, addr)
			if err != nil {
				return nil, err
			}
			return chromeTLSDial(ctx, tcpConn, host, []string{"http/1.1"}, clientHelloFor(host))
		},
		DisableCompression:    true,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          200,
		MaxIdleConnsPerHost:   50,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	return &dualTransport{h2t: h2t, h1t: h1t}
}

// dialTCP establishes a TCP connection to host (host:port), routing through
// the configured upstream proxy if any. For HTTPS wraps with uTLS Chrome
// using the full Chrome ALPN ["h2","http/1.1"].
//
// For WebSocket connections use dialTCPH1 instead — WebSocket upgrade is an
// HTTP/1.1 mechanism and cannot run on an h2 connection.
func (p *Proxy) dialTCP(host, hostname, scheme string) (net.Conn, error) {
	return p.dialTCPWithALPN(host, hostname, scheme, []string{"h2", "http/1.1"})
}

// dialTCPH1 is like dialTCP but forces HTTP/1.1-only ALPN for HTTPS. Use
// this for WebSocket dials: WebSocket is an HTTP/1.1 Upgrade mechanism and
// will break if the server negotiates h2 via ALPN.
func (p *Proxy) dialTCPH1(host, hostname, scheme string) (net.Conn, error) {
	return p.dialTCPWithALPN(host, hostname, scheme, []string{"http/1.1"})
}

func (p *Proxy) dialTCPWithALPN(host, hostname, scheme string, alpn []string) (net.Conn, error) {
	p.upstreamMu.RLock()
	u := p.upstreamURL
	p.upstreamMu.RUnlock()

	var conn net.Conn
	var err error
	if u == nil {
		conn, err = net.Dial("tcp", host)
	} else {
		switch u.Scheme {
		case "http", "https":
			conn, err = dialViaHTTPProxy(u, host)
		case "socks5", "socks5h":
			d, e := proxy.SOCKS5("tcp", u.Host, socksAuth(u), proxy.Direct)
			if e != nil {
				return nil, e
			}
			conn, err = d.Dial("tcp", host)
		default:
			return nil, fmt.Errorf("unsupported upstream proxy scheme: %s", u.Scheme)
		}
	}
	if err != nil {
		return nil, err
	}

	if scheme == "https" {
		return chromeTLSDial(context.Background(), conn, hostname, alpn, p.clientHelloFor(hostname))
	}
	return conn, nil
}

// dialViaHTTPProxy opens a CONNECT tunnel through an HTTP proxy to target.
func dialViaHTTPProxy(proxyURL *url.URL, target string) (net.Conn, error) {
	conn, err := net.Dial("tcp", proxyURL.Host)
	if err != nil {
		return nil, fmt.Errorf("connect to HTTP proxy: %w", err)
	}

	req := &http.Request{
		Method:     http.MethodConnect,
		URL:        &url.URL{Opaque: target},
		Host:       target,
		Header:     make(http.Header),
		Proto:      "HTTP/1.1",
		ProtoMajor: 1,
		ProtoMinor: 1,
	}
	if proxyURL.User != nil {
		user := proxyURL.User.Username()
		pass, _ := proxyURL.User.Password()
		req.Header.Set("Proxy-Authorization",
			"Basic "+base64.StdEncoding.EncodeToString([]byte(user+":"+pass)))
	}
	if err := req.Write(conn); err != nil {
		conn.Close()
		return nil, err
	}

	resp, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		conn.Close()
		return nil, err
	}
	resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		conn.Close()
		return nil, fmt.Errorf("HTTP proxy CONNECT returned %d", resp.StatusCode)
	}
	return conn, nil
}

// socksAuth extracts SOCKS5 credentials from a proxy URL, or returns nil.
func socksAuth(u *url.URL) *proxy.Auth {
	if u.User == nil {
		return nil
	}
	a := &proxy.Auth{User: u.User.Username()}
	if pw, ok := u.User.Password(); ok {
		a.Password = pw
	}
	return a
}
