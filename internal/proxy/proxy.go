package proxy

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"sync"
	"sync/atomic"

	"github.com/hamedsj5/pandorabox/internal/ca"
	"github.com/hamedsj5/pandorabox/internal/config"
	"github.com/hamedsj5/pandorabox/internal/events"
	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/hamedsj5/pandorabox/internal/storage"
)

type Proxy struct {
	cfg       *config.Config
	ca        *ca.CA
	certCache *ca.CertCache
	bus       *events.Bus
	intercept *InterceptQueue
	scope     *ScopeChecker

	mu       sync.Mutex
	running  bool
	listener net.Listener

	dbMu sync.RWMutex
	db   *storage.DB

	upstreamMu  sync.RWMutex
	upstreamURL *url.URL // nil = no upstream proxy

	mrMu    sync.RWMutex
	mrRules []proj.MatchReplaceRule

	mwMu     sync.RWMutex
	mwRunner *MiddlewareRunner

	requestCount atomic.Int64
}

func New(cfg *config.Config, db *storage.DB, authority *ca.CA, bus *events.Bus, intercept *InterceptQueue) *Proxy {
	return &Proxy{
		cfg:       cfg,
		db:        db,
		ca:        authority,
		certCache: ca.NewCertCache(authority),
		bus:       bus,
		intercept: intercept,
		scope:     &ScopeChecker{},
		mwRunner:  NewMiddlewareRunner(),
	}
}

func (p *Proxy) SetScope(cfg proj.ScopeConfig) {
	p.scope.SetConfig(cfg)
}

func (p *Proxy) SetMatchReplace(rules []proj.MatchReplaceRule) {
	p.mrMu.Lock()
	p.mrRules = rules
	p.mrMu.Unlock()
}

func (p *Proxy) getMatchReplace() []proj.MatchReplaceRule {
	p.mrMu.RLock()
	defer p.mrMu.RUnlock()
	return p.mrRules
}

func (p *Proxy) getDB() *storage.DB {
	p.dbMu.RLock()
	defer p.dbMu.RUnlock()
	return p.db
}

func (p *Proxy) SetDB(db *storage.DB) {
	p.dbMu.Lock()
	p.db = db
	p.dbMu.Unlock()
}

func (p *Proxy) ApplyConfig(port int, interceptEnabled bool, upstreamURL string) {
	p.intercept.SetEnabled(interceptEnabled)
	// Port changes require a proxy restart; port is noted but not applied live.

	var parsed *url.URL
	if upstreamURL != "" {
		if u, err := url.Parse(upstreamURL); err == nil {
			parsed = u
		} else {
			slog.Warn("Invalid upstream proxy URL, ignoring", "url", upstreamURL, "err", err)
		}
	}
	p.upstreamMu.Lock()
	p.upstreamURL = parsed
	p.upstreamMu.Unlock()
}

func (p *Proxy) Start(ctx context.Context) error {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", p.cfg.ProxyPort))
	if err != nil {
		return fmt.Errorf("proxy listen: %w", err)
	}

	p.mu.Lock()
	p.listener = ln
	p.running = true
	p.mu.Unlock()

	slog.Info("Proxy listening", "port", p.cfg.ProxyPort)

	go func() {
		<-ctx.Done()
		ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				p.mu.Lock()
				p.running = false
				p.mu.Unlock()
				return nil
			default:
				slog.Error("Accept error", "err", err)
				continue
			}
		}
		go p.handleConn(conn)
	}
}

func (p *Proxy) IsRunning() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.running
}

func (p *Proxy) RequestCount() int64 {
	return p.requestCount.Load()
}

func (p *Proxy) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.listener != nil {
		p.listener.Close()
		p.running = false
	}
	p.mwRunner.Stop()
}

func (p *Proxy) SetMiddleware(cfg proj.MiddlewareConfig) {
	p.mwMu.Lock()
	p.mwRunner.SetConfig(cfg)
	p.mwMu.Unlock()
}

func (p *Proxy) SetMiddlewareBus(bus *events.Bus) {
	p.mwMu.Lock()
	p.mwRunner.SetBus(bus)
	p.mwMu.Unlock()
}

func (p *Proxy) getMiddlewareRunner() *MiddlewareRunner {
	p.mwMu.RLock()
	defer p.mwMu.RUnlock()
	return p.mwRunner
}
