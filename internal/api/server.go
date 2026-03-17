package api

import (
	"io/fs"
	"net/http"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/hamedsj5/pitokmonitor/internal/ca"
	"github.com/hamedsj5/pitokmonitor/internal/config"
	"github.com/hamedsj5/pitokmonitor/internal/events"
	"github.com/hamedsj5/pitokmonitor/internal/project"
	"github.com/hamedsj5/pitokmonitor/internal/proxy"
	"github.com/hamedsj5/pitokmonitor/internal/storage"
)

type Server struct {
	cfg       *config.Config
	dbMu      sync.RWMutex
	db        *storage.DB
	bus       *events.Bus
	proxy     *proxy.Proxy
	intercept *proxy.InterceptQueue
	ca        *ca.CA
	hub       *Hub
	uiFS      fs.FS
	mcpServer interface {
		SetDB(*storage.DB)
		SetProject(*project.Manager, *project.AppConfig)
	}

	projectMu sync.RWMutex
	project   *project.Manager
	appCfg    *project.AppConfig
}

func NewServer(cfg *config.Config, db *storage.DB, bus *events.Bus, p *proxy.Proxy, intercept *proxy.InterceptQueue, authority *ca.CA) *Server {
	p.SetMiddlewareBus(bus)
	return &Server{
		cfg:       cfg,
		db:        db,
		bus:       bus,
		proxy:     p,
		intercept: intercept,
		ca:        authority,
		hub:       NewHub(bus),
	}
}

func (s *Server) SetProject(mgr *project.Manager, appCfg *project.AppConfig) {
	s.projectMu.Lock()
	s.project = mgr
	s.appCfg = appCfg
	s.projectMu.Unlock()
}

func (s *Server) SetMCPServer(mcp interface {
	SetDB(*storage.DB)
	SetProject(*project.Manager, *project.AppConfig)
}) {
	s.mcpServer = mcp
}

func (s *Server) getDB() *storage.DB {
	s.dbMu.RLock()
	defer s.dbMu.RUnlock()
	return s.db
}

func (s *Server) setDB(db *storage.DB) {
	s.dbMu.Lock()
	s.db = db
	s.dbMu.Unlock()
}

func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	// WebSocket
	r.Get("/ws", s.hub.ServeWS)

	// API routes
	r.Route("/api", func(r chi.Router) {
		// Proxy control
		r.Post("/proxy/start", s.proxyStart)
		r.Post("/proxy/stop", s.proxyStop)
		r.Get("/proxy/status", s.proxyStatus)
		r.Put("/proxy/config", s.proxyConfig)

		// Traffic history
		r.Get("/requests", s.listRequests)
		r.Get("/requests/{id}", s.getRequest)
		r.Delete("/requests/{id}", s.deleteRequest)
		r.Get("/requests/{id}/ws-frames", s.getWebSocketFrames)

		// Intercept
		r.Get("/intercept/queue", s.interceptQueue)
		r.Put("/intercept/toggle", s.interceptToggle)
		r.Post("/intercept/forward/{id}", s.interceptForward)
		r.Post("/intercept/forward-all", s.interceptForwardAll)
		r.Post("/intercept/drop/{id}", s.interceptDrop)
		r.Post("/intercept/modify/{id}", s.interceptModify)
		r.Get("/intercept/filter", s.getInterceptFilter)
		r.Put("/intercept/filter", s.setInterceptFilter)

		// Replay
		r.Post("/replay", s.createReplay)
		r.Get("/replay/{id}", s.getReplay)

		// CA cert download
		r.Get("/ca/cert", s.getCACert)

		// Project management
		r.Get("/project", s.getProject)
		r.Put("/project", s.updateProject)
		r.Post("/project/save-as", s.projectSaveAs)
		r.Get("/project/recent", s.getRecentProjects)
		r.Post("/project/open", s.openProject)
		r.Post("/project/new", s.newProject)

		// Flows
		r.Post("/flows/exec", s.execFlowStep)
	})

	// Serve embedded UI for all non-API routes
	if s.uiFS != nil {
		sub, err := fs.Sub(s.uiFS, "dist")
		if err == nil {
			fileServer := http.FileServer(http.FS(sub))
			r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
				// SPA fallback: serve index.html for unknown paths
				if _, err := sub.Open(r.URL.Path[1:]); err != nil {
					r.URL.Path = "/"
				}
				fileServer.ServeHTTP(w, r)
			})
		}
	}

	return r
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
