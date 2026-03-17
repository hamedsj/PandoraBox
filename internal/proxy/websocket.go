package proxy

import (
	"bufio"
	"bytes"
	"compress/flate"
	"encoding/binary"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"strings"

	"github.com/hamedsj5/pitokmonitor/internal/events"
	"github.com/hamedsj5/pitokmonitor/internal/storage"
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
		errCh <- copyWebSocketFrames(upstreamConn, clientBR, "c2s", sessionID, db, p.bus, deflate)
	}()
	go func() {
		errCh <- copyWebSocketFrames(clientConn, upstreamBR, "s2c", sessionID, db, p.bus, deflate)
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

// copyWebSocketFrames reads WebSocket frames from src, writes them verbatim to
// dst, captures up to 1 MB of each payload for storage, and publishes events.
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
) error {
	var decomp *wsDecompressor
	if deflate {
		decomp = &wsDecompressor{}
	}

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
		var extBytes []byte
		var payloadLen int64
		switch baseLen {
		case 126:
			extBytes = make([]byte, 2)
			if _, err := io.ReadFull(src, extBytes); err != nil {
				return err
			}
			payloadLen = int64(binary.BigEndian.Uint16(extBytes))
		case 127:
			extBytes = make([]byte, 8)
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

		// ── Write header bytes to dst immediately ────────────────────────────
		if _, err := dst.Write(hdr[:]); err != nil {
			return err
		}
		if len(extBytes) > 0 {
			if _, err := dst.Write(extBytes); err != nil {
				return err
			}
		}
		if len(maskKey) > 0 {
			if _, err := dst.Write(maskKey); err != nil {
				return err
			}
		}

		// ── Stream payload: capture first 1 MB, forward the rest ─────────────
		var captureBuf bytes.Buffer
		truncated := false

		if payloadLen > 0 {
			captureN := payloadLen
			if captureN > wsMaxCapture {
				captureN = wsMaxCapture
				truncated = true
			}

			// Forward-and-capture the first captureN bytes.
			if _, err := io.CopyN(io.MultiWriter(dst, &captureBuf), src, captureN); err != nil {
				return err
			}

			// Forward the remainder without capturing.
			if truncated {
				if _, err := io.CopyN(dst, src, payloadLen-wsMaxCapture); err != nil {
					return err
				}
			}
		}

		// ── Unmask captured payload ──────────────────────────────────────────
		payload := captureBuf.Bytes()
		if masked == 1 && len(maskKey) == 4 {
			for i := range payload {
				payload[i] ^= maskKey[i%4]
			}
		}

		// ── Decompress if permessage-deflate and RSV1 is set ─────────────────
		if decomp != nil && rsv1 == 1 && len(payload) > 0 {
			if dec, err := decomp.decompress(payload); err == nil {
				payload = dec
			} else {
				slog.Warn("WS inflate failed", "dir", direction, "opcode", opcode, "payloadLen", len(payload), "err", err)
			}
		}

		// ── Persist and publish ──────────────────────────────────────────────
		frame := &storage.WebSocketFrame{
			SessionID: sessionID,
			Direction: direction,
			Opcode:    opcode,
			Fin:       fin,
			Payload:   payload,
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
