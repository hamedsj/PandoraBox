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

	"golang.org/x/net/proxy"
)

// makeTransport returns an http.Transport configured to route through the
// upstream proxy (if any). Called for every HTTP/HTTPS round-trip.
func (p *Proxy) makeTransport() *http.Transport {
	t := &http.Transport{DisableCompression: true}
	p.upstreamMu.RLock()
	u := p.upstreamURL
	p.upstreamMu.RUnlock()
	if u == nil {
		return t
	}

	switch u.Scheme {
	case "http", "https":
		t.Proxy = http.ProxyURL(u)
	case "socks5", "socks5h":
		auth := socksAuth(u)
		d, err := proxy.SOCKS5("tcp", u.Host, auth, proxy.Direct)
		if err != nil {
			slog.Warn("SOCKS5 dialer failed", "err", err)
			return t
		}
		t.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			return d.Dial(network, addr)
		}
	default:
		slog.Warn("Unknown upstream proxy scheme", "scheme", u.Scheme)
	}
	return t
}

// dialTCP establishes a TCP connection to host (host:port), routing through the
// configured upstream proxy if any. If scheme == "https", wraps in TLS using
// hostname as SNI.
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
		tlsConn := tls.Client(conn, &tls.Config{ServerName: hostname})
		if err := tlsConn.Handshake(); err != nil {
			conn.Close()
			return nil, err
		}
		return tlsConn, nil
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
