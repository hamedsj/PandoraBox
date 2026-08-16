// SPDX-License-Identifier: Apache-2.0
package bodydecode

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"fmt"

	"github.com/andybalholm/brotli"
	"github.com/klauspost/compress/zstd"
)

// Encode re-compresses body according to a comma-separated Content-Encoding
// value, the inverse of Decode. Encodings are applied in header order (the
// first token is applied first), so a body decoded from "gzip" round-trips back
// to "gzip". It returns an error if any token is unknown, so callers can fall
// back to stripping Content-Encoding and sending identity.
func Encode(body []byte, encoding string) ([]byte, error) {
	if len(body) == 0 {
		return body, nil
	}
	encoded := body
	for _, enc := range ParseEncodings(encoding) {
		out, err := encodeStep(encoded, enc)
		if err != nil {
			return nil, fmt.Errorf("encode %s: %w", enc, err)
		}
		encoded = out
	}
	return encoded, nil
}

func encodeStep(body []byte, encoding string) ([]byte, error) {
	switch encoding {
	case "", "identity":
		return body, nil
	case "gzip", "x-gzip":
		var buf bytes.Buffer
		w := gzip.NewWriter(&buf)
		if _, err := w.Write(body); err != nil {
			return nil, err
		}
		if err := w.Close(); err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	case "deflate":
		// Match the zlib-wrapped form most servers emit (Decode reads both).
		var buf bytes.Buffer
		w := zlib.NewWriter(&buf)
		if _, err := w.Write(body); err != nil {
			return nil, err
		}
		if err := w.Close(); err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	case "br":
		var buf bytes.Buffer
		w := brotli.NewWriter(&buf)
		if _, err := w.Write(body); err != nil {
			return nil, err
		}
		if err := w.Close(); err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	case "zstd":
		var buf bytes.Buffer
		w, err := zstd.NewWriter(&buf)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(body); err != nil {
			return nil, err
		}
		if err := w.Close(); err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	default:
		return nil, fmt.Errorf("unsupported content-encoding: %s", encoding)
	}
}
