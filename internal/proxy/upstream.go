package proxy

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	utls "github.com/refraction-networking/utls"
	"golang.org/x/net/http2"
	"golang.org/x/net/proxy"
)

// chromeTLSDial wraps an existing TCP connection with a uTLS handshake
// impersonating Chrome's ClientHello. This makes PandoraBox's TLS fingerprint
// (JA3/JA4) indistinguishable from a real Chrome browser, defeating
// fingerprint-based bot detection (e.g. Cloudflare Bot Management).
//
// alpnProtos controls the ALPN extension. Pass []string{"h2", "http/1.1"} to
// match Chrome's full fingerprint (important for JA4, which includes the first
// ALPN value). Pass []string{"http/1.1"} only when the caller knows the server
// will negotiate h1 and cannot handle h2.
//
// The spec MUST be built fresh per connection. ApplyPreset mutates extension
// objects in-place (GREASE values, ECDHE KeyShare.Data, etc.). Sharing a spec
// across connections causes the second+ connection to skip key generation
// (len(Data)>1 guard) and send stale key material — the TLS handshake then
// fails because the client has no matching private key for the public key it
// advertised.
//
// h2 support: Go's http.Transport does a (*tls.Conn) type assertion when
// upgrading to h2, which panics on *utls.UConn. Therefore h2 is handled by
// golang.org/x/net/http2.Transport which accepts net.Conn via interface. When
// http.Transport is used as an h1 fallback, it skips TLSNextProto because the
// returned conn is not *tls.Conn, so it falls through to HTTP/1.1 safely.
func chromeTLSDial(ctx context.Context, tcpConn net.Conn, host string, alpnProtos []string) (net.Conn, error) {
	spec, err := utls.UTLSIdToSpec(utls.HelloChrome_Auto)
	if err != nil {
		tcpConn.Close()
		return nil, fmt.Errorf("utls spec: %w", err)
	}
	for _, ext := range spec.Extensions {
		if alpn, ok := ext.(*utls.ALPNExtension); ok {
			alpn.AlpnProtocols = alpnProtos
			break
		}
	}
	uconn := utls.UClient(tcpConn, &utls.Config{
		ServerName: host,
	}, utls.HelloCustom)
	if err := uconn.ApplyPreset(&spec); err != nil {
		tcpConn.Close()
		return nil, fmt.Errorf("utls apply preset: %w", err)
	}
	if err := uconn.HandshakeContext(ctx); err != nil {
		tcpConn.Close()
		return nil, err
	}
	return uconn, nil
}

// dualTransport tries h2 for HTTPS requests (full Chrome ALPN fingerprint) and
// falls back to h1 when the server doesn't support h2. Plain HTTP requests
// always use h1. Both paths advertise Chrome's ["h2","http/1.1"] ALPN so the
// JA4 fingerprint matches regardless of which protocol the server negotiates.
type dualTransport struct {
	h2t *http2.Transport
	h1t *http.Transport
}

func (d *dualTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != "https" {
		return d.h1t.RoundTrip(req)
	}
	resp, err := d.h2t.RoundTrip(req)
	if err != nil && isALPNError(err) {
		return d.h1t.RoundTrip(req)
	}
	return resp, err
}

func (d *dualTransport) CloseIdleConnections() {
	d.h2t.CloseIdleConnections()
	d.h1t.CloseIdleConnections()
}

// isALPNError reports whether err is the "unexpected ALPN protocol" error that
// http2.Transport returns when the server negotiates http/1.1 instead of h2.
func isALPNError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "unexpected ALPN protocol")
}

// makeTransport returns an http.RoundTripper configured to route through the
// upstream proxy (if any). For direct connections and SOCKS5 proxies it is a
// dualTransport that tries h2 first (full Chrome ALPN) and falls back to h1.
// For HTTP proxies it uses a single http.Transport (uTLS is not applicable
// inside a CONNECT tunnel managed by Go's HTTP stack).
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
		// Direct connection.
		rt = buildDirect(nil)
	} else {
		switch u.Scheme {
		case "http", "https":
			// HTTP proxy: Go handles the CONNECT tunnel internally. uTLS is not
			// applicable here (the TLS handshake is inside the tunnel, not visible
			// to Cloudflare's edge). Use standard TLS with minimal config.
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
				rt = buildDirect(nil) // fallback to direct
			} else {
				dialFn := func(ctx context.Context, network, addr string) (net.Conn, error) {
					return d.Dial(network, addr)
				}
				rt = buildDirect(dialFn)
			}
		default:
			slog.Warn("Unknown upstream proxy scheme", "scheme", u.Scheme)
			rt = buildDirect(nil)
		}
	}

	p.transport = rt
	p.transportKey = key
	return p.transport
}

// buildDirect constructs a dualTransport for direct or SOCKS5-routed connections.
// dialFn is the TCP dialer; pass nil to use the default net.Dialer.
func buildDirect(dialFn func(ctx context.Context, network, addr string) (net.Conn, error)) *dualTransport {
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	if dialFn == nil {
		dialFn = dialer.DialContext
	}

	// Chrome's full ALPN list — required for JA4 fingerprint match.
	fullALPN := []string{"h2", "http/1.1"}

	// h2 transport: handles servers that negotiate h2.
	// DialTLSContext returns *utls.UConn which implements net.Conn and
	// ConnectionState() tls.ConnectionState — enough for http2.Transport.
	h2t := &http2.Transport{
		DialTLSContext: func(ctx context.Context, network, addr string, _ *tls.Config) (net.Conn, error) {
			host, _, err := net.SplitHostPort(addr)
			if err != nil {
				host = addr
			}
			tcpConn, err := dialFn(ctx, network, addr)
			if err != nil {
				return nil, err
			}
			return chromeTLSDial(ctx, tcpConn, host, fullALPN)
		},
		AllowHTTP: false,
	}

	// h1 transport: handles servers that negotiate http/1.1.
	// Also advertises ["h2","http/1.1"] in ALPN so the JA4 fingerprint still
	// matches Chrome — the server will negotiate "http/1.1" and we use h1
	// framing. Because DialTLSContext returns *utls.UConn (not *tls.Conn),
	// http.Transport skips the TLSNextProto h2-upgrade check entirely.
	h1t := &http.Transport{
		DialContext: dialFn,
		DialTLSContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, _, err := net.SplitHostPort(addr)
			if err != nil {
				host = addr
			}
			tcpConn, err := dialFn(ctx, network, addr)
			if err != nil {
				return nil, err
			}
			return chromeTLSDial(ctx, tcpConn, host, fullALPN)
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

// dialTCP establishes a TCP connection to host (host:port), routing through the
// configured upstream proxy if any. For HTTPS, wraps the connection with uTLS
// impersonating Chrome's fingerprint (full ALPN for JA4 match).
func (p *Proxy) dialTCP(host, hostname, scheme string) (net.Conn, error) {
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
		return chromeTLSDial(context.Background(), conn, hostname, []string{"h2", "http/1.1"})
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
