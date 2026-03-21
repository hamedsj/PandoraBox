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
	s.mcp.AddTool(mcp.NewTool("collaborator_start",
		mcp.WithDescription(`Start a new Collaborator session backed by an interactsh server. Returns a unique URL to embed in your payloads. Interactions (DNS, HTTP, SMTP, LDAP…) are detected when the target resolves or contacts the URL. Use collaborator_poll to fetch interactions and collaborator_stop to end the session.`),
		mcp.WithString("server", mcp.Description(`Interactsh server hostname. Defaults to "oast.pro". Public options: oast.pro, oast.live, oast.site, oast.online, oast.fun, oast.me`)),
	), s.toolCollaboratorStart)

	s.mcp.AddTool(mcp.NewTool("collaborator_poll",
		mcp.WithDescription("Poll an active Collaborator session for new out-of-band interactions (DNS lookups, HTTP requests, SMTP connections, etc.)"),
		mcp.WithString("session_id", mcp.Description("Session ID returned by collaborator_start"), mcp.Required()),
	), s.toolCollaboratorPoll)

	s.mcp.AddTool(mcp.NewTool("collaborator_stop",
		mcp.WithDescription("Stop a Collaborator session and deregister from the interactsh server"),
		mcp.WithString("session_id", mcp.Description("Session ID returned by collaborator_start"), mcp.Required()),
	), s.toolCollaboratorStop)

	s.mcp.AddTool(mcp.NewTool("collaborator_generate_url",
		mcp.WithDescription("Generate a fresh unique test URL for an active Collaborator session (same correlation ID, new random nonce). Use this to create distinct per-payload URLs so you can track which injection point triggered an interaction."),
		mcp.WithString("session_id", mcp.Description("Session ID returned by collaborator_start"), mcp.Required()),
	), s.toolCollaboratorGenerateURL)
}

// ── Tool handlers ──────────────────────────────────────────────────────────────

func (s *Server) toolCollaboratorStart(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	server := "oast.pro"
	if v, ok := req.Params.Arguments["server"].(string); ok && v != "" {
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

	return jsonResult(map[string]interface{}{
		"session_id":     sessionID,
		"url":            currentURL,
		"server":         server,
		"correlation_id": correlationID,
		"note":           "Embed 'url' in your payloads. Use collaborator_generate_url to create additional unique URLs for the same session.",
	})
}

func (s *Server) toolCollaboratorPoll(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	sessionID, ok := req.Params.Arguments["session_id"].(string)
	if !ok || sessionID == "" {
		return nil, fmt.Errorf("session_id required")
	}
	val, ok := s.collaboratorSessions.Load(sessionID)
	if !ok {
		return nil, fmt.Errorf("session not found; call collaborator_start first")
	}
	sess := val.(*collabSession)

	interactions, err := collabDoPoll(sess)
	if err != nil {
		return nil, err
	}

	return jsonResult(map[string]interface{}{
		"interactions": interactions,
		"count":        len(interactions),
	})
}

func (s *Server) toolCollaboratorStop(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	sessionID, ok := req.Params.Arguments["session_id"].(string)
	if !ok || sessionID == "" {
		return nil, fmt.Errorf("session_id required")
	}
	val, loaded := s.collaboratorSessions.LoadAndDelete(sessionID)
	if !loaded {
		return jsonResult(map[string]interface{}{"success": false, "note": "session not found"})
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

	return jsonResult(map[string]bool{"success": true})
}

func (s *Server) toolCollaboratorGenerateURL(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.mcpEnabled() {
		return nil, fmt.Errorf("MCP access is disabled for this project")
	}
	sessionID, ok := req.Params.Arguments["session_id"].(string)
	if !ok || sessionID == "" {
		return nil, fmt.Errorf("session_id required")
	}
	val, ok := s.collaboratorSessions.Load(sessionID)
	if !ok {
		return nil, fmt.Errorf("session not found; call collaborator_start first")
	}
	sess := val.(*collabSession)
	return jsonResult(map[string]string{
		"url": collabTestURL(sess.CorrelationID, sess.Server),
	})
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
