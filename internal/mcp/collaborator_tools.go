// SPDX-License-Identifier: Apache-2.0
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
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hamedsj5/pandorabox/internal/events"
	"github.com/mark3labs/mcp-go/mcp"
)

// collabSession holds the state for one active Collaborator (interactsh) session.
// MCP-driven sessions are now visible to the UI: the server polls in the
// background, accumulates interactions, and broadcasts events as they arrive.
type collabSession struct {
	ID            string
	Server        string
	CorrelationID string
	SecretKey     string
	PrivateKey    *rsa.PrivateKey
	CurrentURL    string
	StartedAt     time.Time

	mu           sync.RWMutex
	interactions []collabInteraction
	seenIDs      map[string]bool // dedup by interactsh UniqueID

	cancelPoll context.CancelFunc
}

// CollaboratorSessionInfo is the public projection used by the REST API + UI.
type CollaboratorSessionInfo struct {
	SessionID        string `json:"session_id"`
	Server           string `json:"server"`
	CorrelationID    string `json:"correlation_id"`
	URL              string `json:"url"`
	StartedAt        string `json:"started_at"`
	InteractionCount int    `json:"interaction_count"`
}

// ListCollaboratorSessions returns a snapshot of every server-side session,
// suitable for the UI's mount-time fetch. Hides crypto material.
func (s *Server) ListCollaboratorSessions() []CollaboratorSessionInfo {
	out := []CollaboratorSessionInfo{}
	s.collaboratorSessions.Range(func(_, v any) bool {
		sess := v.(*collabSession)
		sess.mu.RLock()
		out = append(out, CollaboratorSessionInfo{
			SessionID:        sess.ID,
			Server:           sess.Server,
			CorrelationID:    sess.CorrelationID,
			URL:              sess.CurrentURL,
			StartedAt:        sess.StartedAt.UTC().Format(time.RFC3339Nano),
			InteractionCount: len(sess.interactions),
		})
		sess.mu.RUnlock()
		return true
	})
	return out
}

// GetCollaboratorSessionInteractions returns the accumulated interactions for a
// session, or (nil, false) if the session id is unknown. The slice is a copy.
// Returns []any so the public MCPServerFacade interface in internal/api stays
// decoupled from the mcp package's private types.
func (s *Server) GetCollaboratorSessionInteractions(sessionID string) ([]any, bool) {
	v, ok := s.collaboratorSessions.Load(sessionID)
	if !ok {
		return nil, false
	}
	sess := v.(*collabSession)
	sess.mu.RLock()
	out := make([]any, len(sess.interactions))
	for i, it := range sess.interactions {
		out[i] = it
	}
	sess.mu.RUnlock()
	return out, true
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
		ID:            sessionID,
		Server:        server,
		CorrelationID: correlationID,
		SecretKey:     secretKey,
		PrivateKey:    privKey,
		CurrentURL:    currentURL,
		StartedAt:     time.Now(),
		seenIDs:       map[string]bool{},
	}
	s.collaboratorSessions.Store(sessionID, sess)

	// Start background polling so interactions stream to the UI without anyone
	// having to call collaborator_poll.
	s.startCollaboratorPolling(sess)

	// Notify the UI a server-side session exists.
	if s.bus != nil {
		s.bus.Publish(events.Event{
			Type: events.EventCollaboratorSessionStarted,
			Data: map[string]any{
				"session_id":     sessionID,
				"url":            currentURL,
				"server":         server,
				"correlation_id": correlationID,
				"started_at":     sess.StartedAt.UTC().Format(time.RFC3339Nano),
			},
		})
	}

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

	// The background poller is the single owner of fetches against interactsh.
	// Return the cached, deduplicated list so callers get the full picture and
	// we don't race the poller (which would burn quota and double-decrypt).
	sess.mu.RLock()
	interactions := append([]collabInteraction(nil), sess.interactions...)
	sess.mu.RUnlock()
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

	// Stop the background poller before deregistering.
	if sess.cancelPoll != nil {
		sess.cancelPoll()
	}

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

	if s.bus != nil {
		s.bus.Publish(events.Event{
			Type: events.EventCollaboratorSessionStopped,
			Data: map[string]any{"session_id": sessionID},
		})
	}

	return map[string]any{"success": true}, nil
}

// startCollaboratorPolling kicks off a goroutine that polls the interactsh
// server every 5s (and once immediately). New interactions are deduped, kept
// on the session, and broadcast over the event bus so the UI updates live.
func (s *Server) startCollaboratorPolling(sess *collabSession) {
	bg := s.bgCtx
	if bg == nil {
		bg = context.Background()
	}
	ctx, cancel := context.WithCancel(bg)
	sess.cancelPoll = cancel

	doPoll := func() {
		interactions, err := collabDoPoll(sess)
		if err != nil {
			slog.Debug("collaborator poll failed", "session", sess.ID, "err", err)
			return
		}
		if len(interactions) == 0 {
			return
		}
		fresh := make([]collabInteraction, 0, len(interactions))
		sess.mu.Lock()
		for _, it := range interactions {
			key := it.UniqueID
			if key == "" {
				key = it.FullID + "|" + it.Timestamp
			}
			if sess.seenIDs[key] {
				continue
			}
			sess.seenIDs[key] = true
			sess.interactions = append(sess.interactions, it)
			fresh = append(fresh, it)
		}
		// Cap memory: keep the most recent 1000 interactions.
		if len(sess.interactions) > 1000 {
			sess.interactions = sess.interactions[len(sess.interactions)-1000:]
		}
		sess.mu.Unlock()

		if s.bus != nil {
			for _, it := range fresh {
				s.bus.Publish(events.Event{
					Type: events.EventCollaboratorInteraction,
					Data: map[string]any{
						"session_id":  sess.ID,
						"interaction": it,
					},
				})
			}
		}
	}

	go func() {
		// First poll happens after a short delay so initial DNS records have
		// time to register at the interactsh server.
		select {
		case <-ctx.Done():
			return
		case <-time.After(1 * time.Second):
		}
		doPoll()
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				doPoll()
			}
		}
	}()
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
