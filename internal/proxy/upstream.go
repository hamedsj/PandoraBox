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
	"time"

	utls "github.com/refraction-networking/utls"
	"golang.org/x/net/proxy"
)

// chromeSpec is the Chrome ClientHello spec with ALPN forced to http/1.1.
// Built once at startup: get the full Chrome spec, then patch out h2 from
// the ALPN extension. This preserves the JA3/JA4 fingerprint (cipher suites,
// extensions list, curves, GREASE) while preventing h2 negotiation.
//
// h2 must be excluded because Go's http.Transport performs a (*tls.Conn) type
// assertion when upgrading a connection to h2, which panics on *utls.UConn.
var chromeSpec = func() utls.ClientHelloSpec {
	spec, err := utls.UTLSIdToSpec(utls.HelloChrome_Auto)
	if err != nil {
		panic("utls: failed to load Chrome spec: " + err.Error())
	}
	for _, ext := range spec.Extensions {
		if alpn, ok := ext.(*utls.ALPNExtension); ok {
			alpn.AlpnProtocols = []string{"http/1.1"}
			break
		}
	}
	return spec
}()

// chromeTLSDial wraps an existing TCP connection with a uTLS handshake
// impersonating Chrome's ClientHello. This makes PandoraBox's TLS fingerprint
// (JA3/JA4) indistinguishable from a real Chrome browser, defeating
// fingerprint-based bot detection (e.g. Cloudflare Bot Management).
func chromeTLSDial(ctx context.Context, tcpConn net.Conn, host string) (net.Conn, error) {
	uconn := utls.UClient(tcpConn, &utls.Config{
		ServerName: host,
	}, utls.HelloCustom)
	if err := uconn.ApplyPreset(&chromeSpec); err != nil {
		tcpConn.Close()
		return nil, fmt.Errorf("utls apply preset: %w", err)
	}
	if err := uconn.HandshakeContext(ctx); err != nil {
		tcpConn.Close()
		return nil, err
	}
	return uconn, nil
}

// makeTransport returns an http.Transport configured to route through the
// upstream proxy (if any). The transport is reused to preserve connection
// behavior close to a browser (keep-alive + pooled TLS sessions).
// For TLS connections, uTLS is used to impersonate Chrome's fingerprint.
func (p *Proxy) makeTransport() *http.Transport {
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
		p.transport.CloseIdleConnections()
		p.transport = nil
		p.transportKey = ""
	}

	dialer := &net.Dialer{
		Timeout:   15 * time.Second,
		KeepAlive: 30 * time.Second,
	}
	t := &http.Transport{
		DisableCompression:    true,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          200,
		MaxIdleConnsPerHost:   50,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	if u == nil {
		// Direct connection: plain TCP via dialer, TLS via uTLS Chrome.
		t.DialContext = dialer.DialContext
		t.DialTLSContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, _, err := net.SplitHostPort(addr)
			if err != nil {
				host = addr
			}
			tcpConn, err := dialer.DialContext(ctx, network, addr)
			if err != nil {
				return nil, err
			}
			return chromeTLSDial(ctx, tcpConn, host)
		}
	} else {
		switch u.Scheme {
		case "http", "https":
			// HTTP proxy: Go handles the CONNECT tunnel internally and uses its
			// own TLS stack for the final handshake. DialTLSContext is not
			// invoked for proxy'd HTTPS, so we fall back to the standard TLS
			// config with the minimum required options.
			t.Proxy = http.ProxyURL(u)
			t.DialContext = dialer.DialContext
			t.TLSClientConfig = &tls.Config{
				MinVersion: tls.VersionTLS12,
				NextProtos: []string{"http/1.1"},
			}
		case "socks5", "socks5h":
			// SOCKS5: TCP layer routed via SOCKS5, TLS via uTLS Chrome.
			// Both DialContext (HTTP targets) and DialTLSContext (HTTPS targets)
			// dial through the SOCKS5 proxy.
			auth := socksAuth(u)
			d, err := proxy.SOCKS5("tcp", u.Host, auth, proxy.Direct)
			if err != nil {
				slog.Warn("SOCKS5 dialer failed", "err", err)
				break
			}
			t.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
				return d.Dial(network, addr)
			}
			t.DialTLSContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
				host, _, err := net.SplitHostPort(addr)
				if err != nil {
					host = addr
				}
				tcpConn, err := d.Dial(network, addr)
				if err != nil {
					return nil, err
				}
				return chromeTLSDial(ctx, tcpConn, host)
			}
		default:
			slog.Warn("Unknown upstream proxy scheme", "scheme", u.Scheme)
		}
	}

	p.transport = t
	p.transportKey = key
	return p.transport
}

// dialTCP establishes a TCP connection to host (host:port), routing through the
// configured upstream proxy if any. For HTTPS, wraps the connection with uTLS
// impersonating Chrome's fingerprint.
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
		return chromeTLSDial(context.Background(), conn, hostname)
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
