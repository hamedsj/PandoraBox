package proxy

import (
	"bufio"
	"bytes"
	"compress/flate"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"strings"

	"github.com/hamedsj5/pandorabox/internal/events"
	"github.com/hamedsj5/pandorabox/internal/storage"
)

const wsMaxCapture = 1 * 1024 * 1024 // 1 MB payload capture limit

// handleWebSocketUpgrade takes over a connection after detecting an HTTP Upgrade
// to WebSocket. It dials upstream, relays the 101 handshake, persists the
// session and all frames to the database, and publishes live events.
func (p *Proxy) handleWebSocketUpgrade(
	clientConn net.Conn,
	clientBR *bufio.Reader,
	req *http.Request,
	scheme string,
) error {
	// Prefer req.URL.Host — mitm.go sets this to "host:port" from the CONNECT
	// target, so it always includes the port. req.Host is the browser's Host
	// header, which omits the port for default ports (443, 80).
	host := req.URL.Host
	if host == "" {
		host = req.Host
	}

	hostname := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		hostname = h
	}

	// Out-of-scope: pass through without storage.
	if !p.scope.InScope(host, req.URL.Path) {
		return p.proxyWebSocketRaw(clientConn, clientBR, req, host, scheme)
	}

	// Capture upgrade request.
	headersJSON, _ := json.Marshal(req.Header)
	var bodyBytes []byte
	if req.Body != nil {
		bodyBytes, _ = io.ReadAll(req.Body)
	}
	rawReq, _ := httputil.DumpRequest(req, false) // headers only; body is empty for upgrades

	captured := &storage.Request{
		Method:  req.Method,
		Scheme:  scheme,
		Host:    host,
		Path:    req.URL.Path,
		Query:   req.URL.RawQuery,
		Headers: string(headersJSON),
		Body:    bodyBytes,
		Raw:     rawReq,
		Tags:    `["websocket"]`,
	}

	db := p.getDB()
	reqID, err := db.SaveRequest(captured)
	if err != nil {
		return err
	}
	captured.ID = reqID
	p.requestCount.Add(1)

	// Dial upstream.
	upstreamConn, err := p.dialTCP(host, hostname, scheme)
	if err != nil {
		slog.Error("WS upstream dial failed", "host", host, "err", err)
		return err
	}
	defer upstreamConn.Close()

	// Forward upgrade request upstream. Do NOT strip Upgrade/Connection/Sec-WebSocket-*
	// headers — they are required for the handshake.
	req.RequestURI = req.URL.RequestURI()
	if err := req.Write(upstreamConn); err != nil {
		return err
	}

	// Read 101 from upstream.
	upstreamBR := bufio.NewReader(upstreamConn)
	resp, err := http.ReadResponse(upstreamBR, req)
	if err != nil {
		return err
	}

	respHeadersJSON, _ := json.Marshal(resp.Header)

	// If upstream declined (non-101), save and forward the error response.
	if resp.StatusCode != http.StatusSwitchingProtocols {
		respRecord := &storage.Response{
			RequestID:  reqID,
			StatusCode: resp.StatusCode,
			StatusText: resp.Status,
			Headers:    string(respHeadersJSON),
		}
		db.SaveResponse(respRecord)
		captured.Response = respRecord
		p.bus.Publish(events.Event{Type: events.EventRequestCaptured, Data: captured})
		resp.Write(clientConn)
		return nil
	}

	// Save 101 response.
	respRecord := &storage.Response{
		RequestID:  reqID,
		StatusCode: 101,
		StatusText: resp.Status,
		Headers:    string(respHeadersJSON),
	}
	respID, _ := db.SaveResponse(respRecord)
	respRecord.ID = respID
	captured.Response = respRecord

	p.bus.Publish(events.Event{Type: events.EventRequestCaptured, Data: captured})

	// Forward 101 to client.
	if err := resp.Write(clientConn); err != nil {
		return err
	}

	// Open WebSocket session.
	sessionID, err := db.SaveWebSocketSession(reqID)
	if err != nil {
		return err
	}

	p.bus.Publish(events.Event{
		Type: events.EventWebSocketSessionOpened,
		Data: map[string]interface{}{"session_id": sessionID, "request_id": reqID},
	})

	// Detect permessage-deflate compression extension.
	deflate := strings.Contains(
		strings.ToLower(resp.Header.Get("Sec-WebSocket-Extensions")),
		"permessage-deflate",
	)

	// Relay frames in both directions concurrently.
	errCh := make(chan error, 2)
	go func() {
		errCh <- copyWebSocketFrames(upstreamConn, clientBR, "c2s", sessionID, db, p.bus, deflate, p)
	}()
	go func() {
		errCh <- copyWebSocketFrames(clientConn, upstreamBR, "s2c", sessionID, db, p.bus, deflate, p)
	}()

	// Wait for either direction to finish (connection closed or error).
	<-errCh

	db.CloseWebSocketSession(sessionID)
	p.bus.Publish(events.Event{
		Type: events.EventWebSocketSessionClosed,
		Data: map[string]interface{}{"session_id": sessionID, "request_id": reqID},
	})

	return nil
}

// copyWebSocketFrames reads WebSocket frames from src, applies middleware to
// data frames, writes them to dst, captures up to 1 MB for storage, and
// publishes events.
// If deflate is true (permessage-deflate was negotiated), compressed frames
// (RSV1=1) are decompressed before storage so payloads are human-readable.
func copyWebSocketFrames(
	dst io.Writer,
	src io.Reader,
	direction string,
	sessionID int64,
	db *storage.DB,
	bus *events.Bus,
	deflate bool,
	proxy *Proxy,
) error {
	var decomp *wsDecompressor
	if deflate {
		decomp = &wsDecompressor{}
	}

	// Middleware direction key: c2s -> ws_c2s, s2c -> ws_s2c
	mwDir := "ws_" + direction

	for {
		// ── Read the 2-byte fixed header ────────────────────────────────────
		var hdr [2]byte
		if _, err := io.ReadFull(src, hdr[:]); err != nil {
			return err
		}

		fin := int((hdr[0] >> 7) & 1)
		rsv1 := (hdr[0] >> 6) & 1
		opcode := int(hdr[0] & 0x0F)
		masked := (hdr[1] >> 7) & 1
		baseLen := int64(hdr[1] & 0x7F)

		// ── Read extended payload length ─────────────────────────────────────
		var payloadLen int64
		switch baseLen {
		case 126:
			extBytes := make([]byte, 2)
			if _, err := io.ReadFull(src, extBytes); err != nil {
				return err
			}
			payloadLen = int64(binary.BigEndian.Uint16(extBytes))
		case 127:
			extBytes := make([]byte, 8)
			if _, err := io.ReadFull(src, extBytes); err != nil {
				return err
			}
			payloadLen = int64(binary.BigEndian.Uint64(extBytes))
		default:
			payloadLen = baseLen
		}

		// ── Read masking key (client→server frames are always masked) ────────
		var maskKey []byte
		if masked == 1 {
			maskKey = make([]byte, 4)
			if _, err := io.ReadFull(src, maskKey); err != nil {
				return err
			}
		}

		// ── Read full payload into memory ────────────────────────────────────
		var rawPayload []byte
		if payloadLen > 0 {
			rawPayload = make([]byte, payloadLen)
			if _, err := io.ReadFull(src, rawPayload); err != nil {
				return err
			}
		}

		// ── Unmask payload ───────────────────────────────────────────────────
		payload := make([]byte, len(rawPayload))
		copy(payload, rawPayload)
		if masked == 1 && len(maskKey) == 4 {
			for i := range payload {
				payload[i] ^= maskKey[i%4]
			}
		}

		// ── Decompress if permessage-deflate and RSV1 is set ─────────────────
		storedPayload := payload
		if decomp != nil && rsv1 == 1 && len(payload) > 0 {
			if dec, err := decomp.decompress(payload); err == nil {
				storedPayload = dec
			} else {
				slog.Warn("WS inflate failed", "dir", direction, "opcode", opcode, "payloadLen", len(payload), "err", err)
			}
		}

		// ── Apply middleware to data frames (text=1, binary=2) ───────────────
		outPayload := payload
		if proxy != nil && (opcode == 1 || opcode == 2) {
			if mw := proxy.getMiddlewareRunner(); mw != nil {
				if modified, err := mw.ProcessWSFrame(mwDir, opcode, storedPayload); err != nil {
					slog.Warn("WS middleware error", "dir", direction, "err", err)
				} else {
					outPayload = modified
					storedPayload = modified
				}
			}
		}

		// ── Write frame to dst (re-encode with proper masking) ───────────────
		// c2s frames going to the upstream server must be masked
		// s2c frames going to the browser must NOT be masked
		needsMask := direction == "c2s"
		if err := writeWSFrame(dst, byte(opcode), fin == 1, outPayload, needsMask); err != nil {
			return err
		}

		// ── Truncate captured payload for storage ────────────────────────────
		capturePayload := storedPayload
		truncated := false
		if int64(len(capturePayload)) > wsMaxCapture {
			capturePayload = capturePayload[:wsMaxCapture]
			truncated = true
		}

		// ── Persist and publish ──────────────────────────────────────────────
		frame := &storage.WebSocketFrame{
			SessionID: sessionID,
			Direction: direction,
			Opcode:    opcode,
			Fin:       fin,
			Payload:   capturePayload,
			Length:    int(payloadLen),
			Truncated: truncated,
		}
		db.SaveWebSocketFrame(frame)
		bus.Publish(events.Event{Type: events.EventWebSocketFrame, Data: frame})

		// Close frame signals end of connection.
		if opcode == 0x8 {
			return nil
		}
	}
}

// writeWSFrame encodes and writes a single WebSocket frame to w.
// If mask is true, the payload is masked with a random 4-byte key (required
// for client-to-server frames per RFC 6455 §5.3).
func writeWSFrame(w io.Writer, opcode byte, fin bool, payload []byte, mask bool) error {
	b0 := opcode
	if fin {
		b0 |= 0x80
	}

	payLen := len(payload)

	var b1 byte
	if mask {
		b1 = 0x80
	}

	var header []byte
	switch {
	case payLen <= 125:
		header = []byte{b0, b1 | byte(payLen)}
	case payLen <= 0xFFFF:
		header = []byte{b0, b1 | 126, byte(payLen >> 8), byte(payLen)}
	default:
		header = make([]byte, 10)
		header[0] = b0
		header[1] = b1 | 127
		for i := 0; i < 8; i++ {
			header[9-i] = byte(payLen >> (8 * i))
		}
	}

	if _, err := w.Write(header); err != nil {
		return err
	}

	if mask {
		maskKey := make([]byte, 4)
		if _, err := io.ReadFull(rand.Reader, maskKey); err != nil {
			return err
		}
		if _, err := w.Write(maskKey); err != nil {
			return err
		}
		masked := make([]byte, len(payload))
		for i, b := range payload {
			masked[i] = b ^ maskKey[i%4]
		}
		_, err := w.Write(masked)
		return err
	}

	_, err := w.Write(payload)
	return err
}

// wsDecompressor maintains DEFLATE decompressor state across WebSocket messages.
//
// permessage-deflate (RFC 7692) strips the trailing \x00\x00\xff\xff sync-flush
// marker from each compressed message. When context takeover is in effect (the
// default — no_context_takeover was NOT negotiated), messages share a 32 KB LZ77
// sliding window, so a fresh flate.Reader per message fails with "corrupt input".
//
// We fix this by reusing a single flate.Reader via the flate.Resetter interface,
// re-seeding it with the last 32 KB of decompressed output (the LZ77 window) on
// each Reset call. This correctly handles both context-takeover and stateless
// (no_context_takeover) sessions.
type wsDecompressor struct {
	dict []byte       // last ≤32 KB of decompressed output (the LZ77 window)
	fr   io.ReadCloser // persistent flate reader; nil until first use
}

var syncFlushTail = []byte{0x00, 0x00, 0xff, 0xff}

func (d *wsDecompressor) decompress(compressed []byte) ([]byte, error) {
	src := io.MultiReader(
		bytes.NewReader(compressed),
		bytes.NewReader(syncFlushTail),
	)
	if d.fr == nil {
		d.fr = flate.NewReaderDict(src, d.dict)
	} else {
		if err := d.fr.(flate.Resetter).Reset(src, d.dict); err != nil {
			return nil, err
		}
	}

	output, err := io.ReadAll(d.fr)
	// io.ErrUnexpectedEOF is expected: after the sync-flush the underlying
	// MultiReader is exhausted, which looks like a truncated stream to flate.
	if err == io.ErrUnexpectedEOF {
		err = nil
	}
	if err != nil {
		return nil, err
	}

	// Advance the LZ77 window dictionary for the next message.
	if n := len(output); n > 32768 {
		d.dict = append(d.dict[:0], output[n-32768:]...)
	} else {
		d.dict = append(d.dict[:0], output...)
	}
	return output, nil
}

// proxyWebSocketRaw passes through a WebSocket upgrade for out-of-scope hosts
// without any storage or event publishing.
func (p *Proxy) proxyWebSocketRaw(
	clientConn net.Conn,
	clientBR *bufio.Reader,
	req *http.Request,
	host, scheme string,
) error {
	hostname := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		hostname = h
	}

	upstreamConn, err := p.dialTCP(host, hostname, scheme)
	if err != nil {
		return err
	}
	defer upstreamConn.Close()

	req.RequestURI = req.URL.RequestURI()
	if err := req.Write(upstreamConn); err != nil {
		return err
	}

	upstreamBR := bufio.NewReader(upstreamConn)
	resp, err := http.ReadResponse(upstreamBR, req)
	if err != nil {
		return err
	}
	if err := resp.Write(clientConn); err != nil {
		return err
	}

	errCh := make(chan error, 2)
	go func() { _, e := io.Copy(upstreamConn, clientBR); errCh <- e }()
	go func() { _, e := io.Copy(clientConn, upstreamBR); errCh <- e }()
	<-errCh
	return nil
}
