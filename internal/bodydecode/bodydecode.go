// Package bodydecode decompresses HTTP message bodies based on their
// Content-Encoding. It is the single source of truth for body decoding,
// shared by the REST API (/api/decode) and the MCP analysis tools.
//
// Supported encodings: gzip (x-gzip), deflate, br (Brotli), zstd, identity.
// Stacked encodings (e.g. "gzip, br") are decoded in reverse order.
package bodydecode

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"compress/zlib"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/andybalholm/brotli"
	"github.com/klauspost/compress/zstd"
)

// ParseEncodings splits a Content-Encoding header value into normalized,
// lower-cased tokens in header order (e.g. "gzip, br" -> ["gzip", "br"]).
func ParseEncodings(encoding string) []string {
	var out []string
	for _, part := range strings.Split(encoding, ",") {
		normalized := strings.ToLower(strings.TrimSpace(part))
		if normalized != "" {
			out = append(out, normalized)
		}
	}
	return out
}

// EncodingsFromHeaders extracts the Content-Encoding tokens from the stored
// JSON headers string (e.g. `{"Content-Encoding":["gzip, br"]}`).
func EncodingsFromHeaders(headersJSON string) []string {
	var h map[string][]string
	if err := json.Unmarshal([]byte(headersJSON), &h); err != nil {
		return nil
	}
	for k, vs := range h {
		if !strings.EqualFold(k, "Content-Encoding") {
			continue
		}
		var out []string
		for _, v := range vs {
			out = append(out, ParseEncodings(v)...)
		}
		return out
	}
	return nil
}

func gunzip(body []byte) ([]byte, error) {
	r, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

func inflate(body []byte) ([]byte, error) {
	if r, err := zlib.NewReader(bytes.NewReader(body)); err == nil {
		defer r.Close()
		return io.ReadAll(r)
	}
	// Some servers send raw DEFLATE streams without the zlib wrapper.
	fr := flate.NewReader(bytes.NewReader(body))
	defer fr.Close()
	return io.ReadAll(fr)
}

func brotliDecode(body []byte) ([]byte, error) {
	return io.ReadAll(brotli.NewReader(bytes.NewReader(body)))
}

func zstdDecode(body []byte) ([]byte, error) {
	r, err := zstd.NewReader(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

// decodeStep applies a single content-encoding token to body.
func decodeStep(body []byte, encoding string) ([]byte, error) {
	switch encoding {
	case "", "identity":
		return body, nil
	case "gzip", "x-gzip":
		return gunzip(body)
	case "deflate":
		return inflate(body)
	case "br":
		return brotliDecode(body)
	case "zstd":
		return zstdDecode(body)
	default:
		return nil, fmt.Errorf("unsupported content-encoding: %s", encoding)
	}
}

// Decode decompresses body according to the comma-separated Content-Encoding
// value. Stacked encodings are reversed (the last-applied encoding is undone
// first). It returns an error if any known encoding fails or an unknown
// encoding is encountered, so callers can surface a precise message.
func Decode(body []byte, encoding string) ([]byte, error) {
	if len(body) == 0 {
		return body, nil
	}
	encodings := ParseEncodings(encoding)
	decoded := body
	for i := len(encodings) - 1; i >= 0; i-- {
		out, err := decodeStep(decoded, encodings[i])
		if err != nil {
			return nil, fmt.Errorf("decode %s: %w", encodings[i], err)
		}
		decoded = out
	}
	return decoded, nil
}

// DecodeFromHeaders is the lenient variant used where partial/raw output is
// preferable to an error: it reads Content-Encoding from the stored JSON
// headers string and returns the original body unchanged if decoding fails.
func DecodeFromHeaders(body, headersJSON []byte) []byte {
	if len(body) == 0 {
		return body
	}
	encodings := EncodingsFromHeaders(string(headersJSON))
	decoded := body
	for i := len(encodings) - 1; i >= 0; i-- {
		out, err := decodeStep(decoded, encodings[i])
		if err != nil {
			return body
		}
		decoded = out
	}
	return decoded
}
