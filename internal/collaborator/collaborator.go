// SPDX-License-Identifier: Apache-2.0
// Package collaborator — out-of-band (interactsh) session management, usable
// by the REST API (and therefore the CLI) without the legacy MCP server.
// Ported from internal/mcp/collaborator_tools.go; ported rather than shared
// so internal/mcp stays untouched and this Manager has no MCP dependency.
package collaborator

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
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hamedsj5/pandorabox/internal/events"
)

type Session struct {
	ID            string
	Server        string
	CorrelationID string
	SecretKey     string
	PrivateKey    *rsa.PrivateKey
	CurrentURL    string
	StartedAt     time.Time

	mu           sync.RWMutex
	interactions []Interaction
	seenIDs      map[string]bool

	cancelPoll context.CancelFunc
}

// SessionInfo is the public projection used by the REST API + UI.
type SessionInfo struct {
	SessionID        string `json:"session_id"`
	Server           string `json:"server"`
	CorrelationID    string `json:"correlation_id"`
	URL              string `json:"url"`
	StartedAt        string `json:"started_at"`
	InteractionCount int    `json:"interaction_count"`
}

type Interaction struct {
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

type Manager struct {
	bus      *events.Bus
	bgCtx    context.Context
	sessions sync.Map // sessionID → *Session
}

func NewManager(bus *events.Bus) *Manager {
	return &Manager{bus: bus}
}

// SetContext stores the server's lifecycle context so polling goroutines stop
// when the process shuts down.
func (m *Manager) SetContext(ctx context.Context) {
	m.bgCtx = ctx
}

// List returns a snapshot of every active session, suitable for the UI's
// mount-time fetch. Hides crypto material.
func (m *Manager) List() []SessionInfo {
	out := []SessionInfo{}
	m.sessions.Range(func(_, v any) bool {
		sess := v.(*Session)
		sess.mu.RLock()
		out = append(out, SessionInfo{
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

// Interactions returns the accumulated interactions for a session, or
// (nil, false) if the session id is unknown.
func (m *Manager) Interactions(sessionID string) ([]Interaction, bool) {
	v, ok := m.sessions.Load(sessionID)
	if !ok {
		return nil, false
	}
	sess := v.(*Session)
	sess.mu.RLock()
	out := make([]Interaction, len(sess.interactions))
	copy(out, sess.interactions)
	sess.mu.RUnlock()
	return out, true
}

// Start registers a new interactsh session and begins background polling.
func (m *Manager) Start(server string) (SessionInfo, error) {
	if server == "" {
		server = "oast.pro"
	}

	privKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return SessionInfo{}, fmt.Errorf("key generation failed: %w", err)
	}

	spkiDER, err := x509.MarshalPKIXPublicKey(&privKey.PublicKey)
	if err != nil {
		return SessionInfo{}, fmt.Errorf("key export failed: %w", err)
	}
	pemBlock := &pem.Block{Type: "PUBLIC KEY", Bytes: spkiDER}
	pemBytes := pem.EncodeToMemory(pemBlock)
	publicKeyB64 := base64.StdEncoding.EncodeToString(pemBytes)

	correlationID := randomLetters(20)
	secretKey := uuid.NewString()
	sessionID := uuid.NewString()
	currentURL := testURL(correlationID, server)

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
		return SessionInfo{}, fmt.Errorf("registration failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		text, _ := io.ReadAll(resp.Body)
		return SessionInfo{}, fmt.Errorf("registration failed (%d): %s", resp.StatusCode, string(text))
	}

	sess := &Session{
		ID:            sessionID,
		Server:        server,
		CorrelationID: correlationID,
		SecretKey:     secretKey,
		PrivateKey:    privKey,
		CurrentURL:    currentURL,
		StartedAt:     time.Now(),
		seenIDs:       map[string]bool{},
	}
	m.sessions.Store(sessionID, sess)
	m.startPolling(sess)

	if m.bus != nil {
		m.bus.Publish(events.Event{
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

	return SessionInfo{
		SessionID:     sessionID,
		Server:        server,
		CorrelationID: correlationID,
		URL:           currentURL,
		StartedAt:     sess.StartedAt.UTC().Format(time.RFC3339Nano),
	}, nil
}

// Poll returns the cached, deduplicated interaction list. The background
// poller is the single owner of fetches against interactsh.
func (m *Manager) Poll(sessionID string) ([]Interaction, error) {
	v, ok := m.sessions.Load(sessionID)
	if !ok {
		return nil, fmt.Errorf("session %q not found; call Start first", sessionID)
	}
	sess := v.(*Session)
	sess.mu.RLock()
	defer sess.mu.RUnlock()
	out := make([]Interaction, len(sess.interactions))
	copy(out, sess.interactions)
	return out, nil
}

func (m *Manager) Stop(sessionID string) bool {
	val, loaded := m.sessions.LoadAndDelete(sessionID)
	if !loaded {
		return false
	}
	sess := val.(*Session)
	if sess.cancelPoll != nil {
		sess.cancelPoll()
	}

	bodyMap := map[string]string{
		"correlation-id": sess.CorrelationID,
		"secret-key":     sess.SecretKey,
	}
	bodyBytes, _ := json.Marshal(bodyMap)
	httpClient := &http.Client{Timeout: 5 * time.Second}
	deregReq, _ := http.NewRequest(
		http.MethodPost,
		fmt.Sprintf("https://%s/deregister", sess.Server),
		strings.NewReader(string(bodyBytes)),
	)
	deregReq.Header.Set("Content-Type", "application/json")
	deregResp, _ := httpClient.Do(deregReq)
	if deregResp != nil {
		deregResp.Body.Close()
	}

	if m.bus != nil {
		m.bus.Publish(events.Event{
			Type: events.EventCollaboratorSessionStopped,
			Data: map[string]any{"session_id": sessionID},
		})
	}
	return true
}

func (m *Manager) GenerateURL(sessionID string) (string, error) {
	v, ok := m.sessions.Load(sessionID)
	if !ok {
		return "", fmt.Errorf("session %q not found; call Start first", sessionID)
	}
	sess := v.(*Session)
	return testURL(sess.CorrelationID, sess.Server), nil
}

// startPolling kicks off a goroutine that polls the interactsh server every
// 5s (and once immediately). New interactions are deduped, kept on the
// session, and broadcast over the event bus so the UI updates live.
func (m *Manager) startPolling(sess *Session) {
	bg := m.bgCtx
	if bg == nil {
		bg = context.Background()
	}
	ctx, cancel := context.WithCancel(bg)
	sess.cancelPoll = cancel

	doPoll := func() {
		interactions, err := doPoll(sess)
		if err != nil {
			slog.Debug("collaborator poll failed", "session", sess.ID, "err", err)
			return
		}
		if len(interactions) == 0 {
			return
		}
		fresh := make([]Interaction, 0, len(interactions))
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
		if len(sess.interactions) > 1000 {
			sess.interactions = sess.interactions[len(sess.interactions)-1000:]
		}
		sess.mu.Unlock()

		if m.bus != nil {
			for _, it := range fresh {
				m.bus.Publish(events.Event{
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

// ── interactsh protocol helpers ──────────────────────────────────────────────

type pollResponse struct {
	Data   []string `json:"data"`
	AESKey string   `json:"aes_key"`
	Extra  []string `json:"extra"`
	TLData []string `json:"tlddata"`
}

func doPoll(sess *Session) ([]Interaction, error) {
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

	var pr pollResponse
	if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil {
		return nil, fmt.Errorf("poll decode failed: %w", err)
	}

	var interactions []Interaction

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
			var interaction Interaction
			if err := json.Unmarshal(decrypted, &interaction); err == nil {
				interactions = append(interactions, interaction)
			}
		}
	}

	for _, item := range pr.Extra {
		var i Interaction
		if err := json.Unmarshal([]byte(item), &i); err == nil {
			interactions = append(interactions, i)
		}
	}
	for _, item := range pr.TLData {
		var i Interaction
		if err := json.Unmarshal([]byte(item), &i); err == nil {
			interactions = append(interactions, i)
		}
	}

	return interactions, nil
}

// testURL builds a unique test URL: corrId(20) + nonce(13) + "." + server.
func testURL(correlationID, server string) string {
	return correlationID + randomAlphanumeric(13) + "." + server
}

func randomLetters(n int) string {
	const chars = "abcdefghijklmnopqrstuvwxyz"
	b := make([]byte, n)
	_, _ = rand.Read(b)
	for i, v := range b {
		b[i] = chars[int(v)%len(chars)]
	}
	return string(b)
}

func randomAlphanumeric(n int) string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	_, _ = rand.Read(b)
	for i, v := range b {
		b[i] = chars[int(v)%len(chars)]
	}
	return string(b)
}
