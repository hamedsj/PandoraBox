// SPDX-License-Identifier: Apache-2.0
package proxy

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
)

// prefixConn replays an in-memory prefix (the captured ClientHello record) to
// the first reads, then transparently delegates to the underlying conn. This
// lets us peek the browser's ClientHello without consuming it from the TLS
// server handshake that follows.
type prefixConn struct {
	net.Conn
	prefix *bytes.Reader
}

func (c *prefixConn) Read(p []byte) (int, error) {
	if c.prefix != nil && c.prefix.Len() > 0 {
		return c.prefix.Read(p)
	}
	return c.Conn.Read(p)
}

// captureClientHello reads the first TLS record (the ClientHello) from conn so
// its exact fingerprint can be replayed upstream, and returns a conn that
// replays those bytes so the local TLS handshake still sees them. On any read
// hiccup it returns nil raw + a conn that still replays whatever was read, so
// the handshake is never corrupted.
func captureClientHello(conn net.Conn) (raw []byte, wrapped net.Conn) {
	hdr := make([]byte, 5)
	if _, err := io.ReadFull(conn, hdr); err != nil {
		return nil, &prefixConn{Conn: conn, prefix: bytes.NewReader(hdr[:0])}
	}
	rec := hdr
	const recordTypeHandshake = 0x16
	if hdr[0] == recordTypeHandshake {
		n := int(hdr[3])<<8 | int(hdr[4])
		if n > 0 && n <= 16384 {
			body := make([]byte, n)
			if _, err := io.ReadFull(conn, body); err == nil {
				rec = append(rec, body...)
				return rec, &prefixConn{Conn: conn, prefix: bytes.NewReader(rec)}
			} else {
				rec = append(rec, body...) // partial: replay what we have, skip capture
			}
		}
	}
	return nil, &prefixConn{Conn: conn, prefix: bytes.NewReader(rec)}
}

func (p *Proxy) handleCONNECT(conn net.Conn, br *bufio.Reader, req *http.Request) {
	host := req.Host

	hostname := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		hostname = h
	}

	// Acknowledge the CONNECT tunnel
	fmt.Fprintf(conn, "HTTP/1.1 200 Connection Established\r\n\r\n")

	cert, err := p.certCache.Get(hostname)
	if err != nil {
		slog.Error("Failed to get leaf cert", "host", hostname, "err", err)
		return
	}

	// Capture the browser's real ClientHello so the upstream dial can replay its
	// exact JA3/JA4 fingerprint. Session tickets are disabled so the browser
	// never resumes via a PSK (which we couldn't forward to the real server) —
	// every captured hello is a clean "cold" handshake we can faithfully mirror.
	rawHello, conn := captureClientHello(conn)
	if len(rawHello) > 0 {
		p.storeClientHello(hostname, rawHello)
	}

	// Impersonate the target server over TLS.
	// NextProtos: only advertise HTTP/1.1 — our request loop below speaks HTTP/1.1.
	// Without this, Chrome may attempt HTTP/2 framing which we don't handle.
	tlsCfg := &tls.Config{
		Certificates:           []tls.Certificate{*cert},
		NextProtos:             []string{"http/1.1"},
		SessionTicketsDisabled: true,
	}
	tlsConn := tls.Server(conn, tlsCfg)
	if err := tlsConn.Handshake(); err != nil {
		slog.Debug("TLS handshake failed", "host", hostname, "err", err)
		return
	}
	defer tlsConn.Close()

	tlsBR := bufio.NewReader(tlsConn)
	for {
		clientReq, err := http.ReadRequest(tlsBR)
		if err != nil {
			return
		}

		clientReq.URL.Host = host
		clientReq.URL.Scheme = "https"
		if clientReq.Host == "" {
			clientReq.Host = host
		}

		if strings.EqualFold(clientReq.Header.Get("Upgrade"), "websocket") {
			p.handleWebSocketUpgrade(tlsConn, tlsBR, clientReq, "https")
			return
		}

		resp, _, err := p.roundTrip(clientReq, "https")
		if err != nil {
			slog.Debug("Upstream failed", "host", clientReq.Host, "method", clientReq.Method, "path", clientReq.URL.Path, "err", err)
			// Write a 502 for this specific request but keep the tunnel alive —
			// a single upstream failure must not kill every other sub-resource.
			fmt.Fprintf(tlsConn, "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n")
			continue
		}

		resp.Write(tlsConn)
		resp.Body.Close()

		// If either side signalled Connection: close, tear down the tunnel.
		if resp.Close || clientReq.Close {
			return
		}
	}
}
