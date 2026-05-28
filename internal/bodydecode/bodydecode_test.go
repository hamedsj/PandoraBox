// SPDX-License-Identifier: Apache-2.0
package bodydecode

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"compress/zlib"
	"testing"

	"github.com/andybalholm/brotli"
	"github.com/klauspost/compress/zstd"
)

func TestDecodeRoundTrips(t *testing.T) {
	plain := []byte("PandoraBox decodes compressed HTTP bodies.\n")
	tests := []struct {
		name     string
		encoding string
		encode   func([]byte) []byte
	}{
		{name: "gzip", encoding: "gzip", encode: gzipBody},
		{name: "x-gzip", encoding: "x-gzip", encode: gzipBody},
		{name: "deflate zlib", encoding: "deflate", encode: zlibBody},
		{name: "deflate raw", encoding: "deflate", encode: rawDeflateBody},
		{name: "brotli", encoding: "br", encode: brotliBody},
		{name: "zstd", encoding: "zstd", encode: zstdBody},
		{name: "identity", encoding: "identity", encode: func(b []byte) []byte { return b }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Decode(tt.encode(plain), tt.encoding)
			if err != nil {
				t.Fatalf("Decode() error = %v", err)
			}
			if !bytes.Equal(got, plain) {
				t.Fatalf("Decode() = %q, want %q", got, plain)
			}
		})
	}
}

func TestDecodeStackedEncodings(t *testing.T) {
	plain := []byte("stacked encodings are decoded in reverse order")
	body := brotliBody(gzipBody(plain))

	got, err := Decode(body, "gzip, br")
	if err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if !bytes.Equal(got, plain) {
		t.Fatalf("Decode() = %q, want %q", got, plain)
	}
}

func TestDecodeFromHeadersFallsBackOnBadBody(t *testing.T) {
	body := []byte("not actually gzip")
	headers := []byte(`{"Content-Encoding":["gzip"]}`)

	got := DecodeFromHeaders(body, headers)
	if !bytes.Equal(got, body) {
		t.Fatalf("DecodeFromHeaders() = %q, want original %q", got, body)
	}
}

func gzipBody(in []byte) []byte {
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	if _, err := w.Write(in); err != nil {
		panic(err)
	}
	if err := w.Close(); err != nil {
		panic(err)
	}
	return b.Bytes()
}

func zlibBody(in []byte) []byte {
	var b bytes.Buffer
	w := zlib.NewWriter(&b)
	if _, err := w.Write(in); err != nil {
		panic(err)
	}
	if err := w.Close(); err != nil {
		panic(err)
	}
	return b.Bytes()
}

func rawDeflateBody(in []byte) []byte {
	var b bytes.Buffer
	w, err := flate.NewWriter(&b, flate.DefaultCompression)
	if err != nil {
		panic(err)
	}
	if _, err := w.Write(in); err != nil {
		panic(err)
	}
	if err := w.Close(); err != nil {
		panic(err)
	}
	return b.Bytes()
}

func brotliBody(in []byte) []byte {
	var b bytes.Buffer
	w := brotli.NewWriter(&b)
	if _, err := w.Write(in); err != nil {
		panic(err)
	}
	if err := w.Close(); err != nil {
		panic(err)
	}
	return b.Bytes()
}

func zstdBody(in []byte) []byte {
	var b bytes.Buffer
	w, err := zstd.NewWriter(&b)
	if err != nil {
		panic(err)
	}
	if _, err := w.Write(in); err != nil {
		panic(err)
	}
	if err := w.Close(); err != nil {
		panic(err)
	}
	return b.Bytes()
}
