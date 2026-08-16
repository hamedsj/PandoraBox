// SPDX-License-Identifier: Apache-2.0
package bodydecode

import (
	"bytes"
	"testing"
)

func TestEncodeDecodeRoundTrip(t *testing.T) {
	payload := []byte(`{"hello":"world","n":42,"arr":[1,2,3],"nested":{"a":"b"}}` +
		" — plus some longer text so compression actually does something meaningful.")

	for _, enc := range []string{"gzip", "deflate", "br", "zstd", "identity", "gzip, br"} {
		enc := enc
		t.Run(enc, func(t *testing.T) {
			compressed, err := Encode(payload, enc)
			if err != nil {
				t.Fatalf("Encode(%q) error: %v", enc, err)
			}
			decoded, err := Decode(compressed, enc)
			if err != nil {
				t.Fatalf("Decode(%q) error: %v", enc, err)
			}
			if !bytes.Equal(decoded, payload) {
				t.Errorf("round-trip mismatch for %q:\n got: %q\nwant: %q", enc, decoded, payload)
			}
		})
	}
}

func TestEncodeUnknownEncodingErrors(t *testing.T) {
	if _, err := Encode([]byte("x"), "snappy"); err == nil {
		t.Error("expected error for unknown encoding, got nil")
	}
}
