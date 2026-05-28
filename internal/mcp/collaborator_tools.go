package mcp

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mark3labs/mcp-go/mcp"
)

// collabSession holds the state for one active Collaborator (interactsh) session.
type collabSession struct {
	Server        string
	CorrelationID string
	SecretKey     string
	PrivateKey    *rsa.PrivateKey
}

func (s *Server) registerCollaboratorTools() {
	s.register(ToolSpec{
		Name:      "collaborator_start",
		Category:  CatCollaborator,
		Behavior:  BehaviorMutating,
		OpenWorld: true,
		Summary:   "Start a new Collaborator (interactsh) session and return its URL.",
		Description: "Embed the returned `url` in your payloads — DNS/HTTP/SMTP/LDAP interactions against it are recorded. " +
			"Use `collaborator_poll` to fetch interactions, `collaborator_generate_url` to create distinct URLs per injection point, " +
			"and `collaborator_stop` to end the session.",
		Options: []mcp.ToolOption{
			mcp.WithString("server", mcp.Description(`Interactsh hostname (default "oast.pro"). Public options: oast.pro, oast.live, oast.site, oast.online, oast.fun, oast.me.`)),
		},
		Handler: s.toolCollaboratorStart,
	})

	s.register(ToolSpec{
		Name:      "collaborator_poll",
		Category:  CatCollaborator,
		Behavior:  BehaviorReadOnly,
		OpenWorld: true,
		Summary:   "Poll an active Collaborator session for new out-of-band interactions.",
		Description: "Returns DNS lookups, HTTP requests, SMTP connections etc. that hit the session's URL since the last poll.",
		Options: []mcp.ToolOption{
			mcp.WithString("session_id", mcp.Description("Session id returned by collaborator_start."), mcp.Required()),
		},
		Handler: s.toolCollaboratorPoll,
	})

	s.register(ToolSpec{
		Name:      "collaborator_stop",
		Category:  CatCollaborator,
		Behavior:  BehaviorDestructive,
		OpenWorld: true,
		Summary:   "Stop a Collaborator session and deregister from the interactsh server.",
		Options: []mcp.ToolOption{
			mcp.WithString("session_id", mcp.Description("Session id returned by collaborator_start."), mcp.Required()),
		},
		Handler: s.toolCollaboratorStop,
	})

	s.register(ToolSpec{
		Name:     "collaborator_generate_url",
		Category: CatCollaborator,
		Behavior: BehaviorReadOnly,
		Summary:  "Generate another unique test URL for an existing Collaborator session.",
		Description: "Same correlation id, new random nonce. Use to distinguish which injection point triggered an interaction.",
		Options: []mcp.ToolOption{
			mcp.WithString("session_id", mcp.Description("Session id returned by collaborator_start."), mcp.Required()),
		},
		Handler: s.toolCollaboratorGenerateURL,
	})
}

// ── Tool handlers ──────────────────────────────────────────────────────────────

func (s *Server) toolCollaboratorStart(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	server := "oast.pro"
	if v := argString(req, "server"); v != "" {
		server = v
	}

	// Generate RSA-2048 key pair
	privKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("key generation failed: %w", err)
	}

	// Export public key as SPKI DER → wrap in PEM → base64-encode the PEM.
	// The interactsh server does: base64.Decode(field) → pem.Decode() → x509.ParsePKIXPublicKey
	spkiDER, err := x509.MarshalPKIXPublicKey(&privKey.PublicKey)
	if err != nil {
		return nil, fmt.Errorf("key export failed: %w", err)
	}
	pemBlock := &pem.Block{Type: "PUBLIC KEY", Bytes: spkiDER}
	pemBytes := pem.EncodeToMemory(pemBlock)
	publicKeyB64 := base64.StdEncoding.EncodeToString(pemBytes)

	// Correlation ID: 20 lowercase letters (matching interactsh-web default)
	correlationID := collabRandomLetters(20)
	secretKey := uuid.NewString()
	sessionID := uuid.NewString()
	currentURL := collabTestURL(correlationID, server)

	// Register with interactsh
	bodyMap := map[string]string{
		"public-key":     publicKeyB64,
		"secret-key":     secretKey,
		"correlation-id": correlationID,
	}
	bodyBytes, _ := json.Marshal(bodyMap)
	httpClient := &http.Client{Timeout: 15 * time.Second}
	resp, err := httpClient.Post(
		fmt.Sprintf("https://%s/register", server),
		"application/json",
		strings.NewReader(string(bodyBytes)),
	)
	if err != nil {
		return nil, fmt.Errorf("registration failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		text, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("registration failed (%d): %s", resp.StatusCode, string(text))
	}

	sess := &collabSession{
		Server:        server,
		CorrelationID: correlationID,
		SecretKey:     secretKey,
		PrivateKey:    privKey,
	}
	s.collaboratorSessions.Store(sessionID, sess)

	return map[string]any{
		"session_id":     sessionID,
		"url":            currentURL,
		"server":         server,
		"correlation_id": correlationID,
	}, nil
}

func (s *Server) toolCollaboratorPoll(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	sessionID, err := argRequiredString(req, "session_id")
	if err != nil {
		return nil, err
	}
	val, ok := s.collaboratorSessions.Load(sessionID)
	if !ok {
		return nil, fmt.Errorf("session %q not found; call collaborator_start first", sessionID)
	}
	sess := val.(*collabSession)

	interactions, err := collabDoPoll(sess)
	if err != nil {
		return nil, err
	}
	return map[string]any{"interactions": interactions, "count": len(interactions)}, nil
}

func (s *Server) toolCollaboratorStop(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	sessionID, err := argRequiredString(req, "session_id")
	if err != nil {
		return nil, err
	}
	val, loaded := s.collaboratorSessions.LoadAndDelete(sessionID)
	if !loaded {
		return map[string]any{"success": false, "reason": "session_not_found"}, nil
	}
	sess := val.(*collabSession)

	// Deregister (best-effort)
	bodyMap := map[string]string{
		"correlation-id": sess.CorrelationID,
		"secret-key":     sess.SecretKey,
	}
	bodyBytes, _ := json.Marshal(bodyMap)
	httpClient := &http.Client{Timeout: 5 * time.Second}
	deregReq, _ := http.NewRequestWithContext(ctx,
		http.MethodPost,
		fmt.Sprintf("https://%s/deregister", sess.Server),
		strings.NewReader(string(bodyBytes)),
	)
	deregReq.Header.Set("Content-Type", "application/json")
	deregResp, _ := httpClient.Do(deregReq)
	if deregResp != nil {
		deregResp.Body.Close()
	}

	return map[string]any{"success": true}, nil
}

func (s *Server) toolCollaboratorGenerateURL(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	sessionID, err := argRequiredString(req, "session_id")
	if err != nil {
		return nil, err
	}
	val, ok := s.collaboratorSessions.Load(sessionID)
	if !ok {
		return nil, fmt.Errorf("session %q not found; call collaborator_start first", sessionID)
	}
	sess := val.(*collabSession)
	return map[string]any{"url": collabTestURL(sess.CorrelationID, sess.Server)}, nil
}

// ── interactsh protocol helpers ────────────────────────────────────────────────

type collabPollResponse struct {
	Data   []string `json:"data"`
	AESKey string   `json:"aes_key"`
	Extra  []string `json:"extra"`
	TLData []string `json:"tlddata"`
}

type collabInteraction struct {
	Protocol      string `json:"protocol"`
	UniqueID      string `json:"unique-id"`
	FullID        string `json:"full-id"`
	QType         string `json:"q-type,omitempty"`
	RawRequest    string `json:"raw-request,omitempty"`
	RawResponse   string `json:"raw-response,omitempty"`
	SmtpFrom      string `json:"smtp-from,omitempty"`
	RemoteAddress string `json:"remote-address"`
	Timestamp     string `json:"timestamp"`
}

func collabDoPoll(sess *collabSession) ([]collabInteraction, error) {
	pollURL := fmt.Sprintf("https://%s/poll?id=%s&secret=%s",
		sess.Server, sess.CorrelationID, url.QueryEscape(sess.SecretKey))

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(pollURL)
	if err != nil {
		return nil, fmt.Errorf("poll request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("poll failed: %d", resp.StatusCode)
	}

	var pr collabPollResponse
	if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil {
		return nil, fmt.Errorf("poll decode failed: %w", err)
	}

	var interactions []collabInteraction

	// Decrypt AES-encrypted interactions
	if len(pr.Data) > 0 && pr.AESKey != "" {
		encAESKey, err := base64.StdEncoding.DecodeString(pr.AESKey)
		if err != nil {
			return nil, fmt.Errorf("aes_key decode failed: %w", err)
		}
		aesKeyBytes, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, sess.PrivateKey, encAESKey, nil)
		if err != nil {
			return nil, fmt.Errorf("RSA-OAEP decrypt failed: %w", err)
		}
		for _, enc := range pr.Data {
			encBytes, err := base64.StdEncoding.DecodeString(enc)
			if err != nil || len(encBytes) < 16 {
				continue
			}
			iv := encBytes[:16]
			ciphertext := encBytes[16:]
			block, err := aes.NewCipher(aesKeyBytes)
			if err != nil {
				continue
			}
			stream := cipher.NewCTR(block, iv)
			decrypted := make([]byte, len(ciphertext))
			stream.XORKeyStream(decrypted, ciphertext)
			var interaction collabInteraction
			if err := json.Unmarshal(decrypted, &interaction); err == nil {
				interactions = append(interactions, interaction)
			}
		}
	}

	// Extra / tlddata (unencrypted)
	for _, item := range pr.Extra {
		var i collabInteraction
		if err := json.Unmarshal([]byte(item), &i); err == nil {
			interactions = append(interactions, i)
		}
	}
	for _, item := range pr.TLData {
		var i collabInteraction
		if err := json.Unmarshal([]byte(item), &i); err == nil {
			interactions = append(interactions, i)
		}
	}

	return interactions, nil
}

// collabTestURL builds a unique test URL: corrId(20) + nonce(13) + "." + server.
// The nonce makes each URL unique for tracking individual injection points.
func collabTestURL(correlationID, server string) string {
	return correlationID + collabRandomAlphanumeric(13) + "." + server
}

// collabRandomLetters generates n lowercase letters using crypto/rand.
func collabRandomLetters(n int) string {
	const chars = "abcdefghijklmnopqrstuvwxyz"
	b := make([]byte, n)
	_, _ = rand.Read(b)
	for i, v := range b {
		b[i] = chars[int(v)%len(chars)]
	}
	return string(b)
}

// collabRandomAlphanumeric generates n lowercase alphanumeric chars using crypto/rand.
func collabRandomAlphanumeric(n int) string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	_, _ = rand.Read(b)
	for i, v := range b {
		b[i] = chars[int(v)%len(chars)]
	}
	return string(b)
}
