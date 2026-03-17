package proxy

import (
	"bufio"
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
)

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

	// Impersonate the target server over TLS.
	// NextProtos: only advertise HTTP/1.1 — our request loop below speaks HTTP/1.1.
	// Without this, Chrome may attempt HTTP/2 framing which we don't handle.
	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{*cert},
		NextProtos:   []string{"http/1.1"},
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
