package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"

	"github.com/hamedsj5/pandorabox/internal/bodydecode"
)

// decodeBody decompresses a base64-encoded body using the given Content-Encoding.
// It lets the browser UI read encodings the platform can't (Brotli, zstd) by
// delegating to the Go decoders. Mirrors the Electron window.electron.decodeBody
// contract: { data, encoding } -> { base64 } | { error }.
func (s *Server) decodeBody(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Data     string `json:"data"`     // base64-encoded compressed bytes
		Encoding string `json:"encoding"` // Content-Encoding value, e.g. "br" or "gzip, br"
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	raw, err := base64.StdEncoding.DecodeString(body.Data)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid base64 data: "+err.Error())
		return
	}

	decoded, err := bodydecode.Decode(raw, body.Encoding)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"base64": base64.StdEncoding.EncodeToString(decoded),
	})
}
