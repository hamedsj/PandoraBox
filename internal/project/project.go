package project

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type ProxyConfig struct {
	Port             int    `json:"port"`
	InterceptEnabled bool   `json:"intercept_enabled"`
	UpstreamURL      string `json:"upstream_url,omitempty"` // "" = disabled
}

type ScopeRule struct {
	Enabled     bool   `json:"enabled"`
	PatternType string `json:"pattern_type"` // "exact" | "contains" | "wildcard" | "regex"
	Host        string `json:"host"`
	Path        string `json:"path"` // optional; empty = match any path
}

type ScopeConfig struct {
	Enabled      bool        `json:"enabled"`
	IncludeRules []ScopeRule `json:"include_rules"`
	ExcludeRules []ScopeRule `json:"exclude_rules"`
}

type FilterConfig struct {
	Search          string   `json:"search"`
	Method          string   `json:"method"`
	Host            string   `json:"host"`
	ExtensionShow   string   `json:"extensionShow"`
	ExtensionHide   string   `json:"extensionHide"`
	ContentTypeShow string   `json:"contentTypeShow"`
	ContentTypeHide string   `json:"contentTypeHide"`
	StatusCodes     []string `json:"statusCodes"`
	NegativeSearch  bool     `json:"negativeSearch"`
	CaseInsensitive bool     `json:"caseInsensitive"`
	UseRegex        bool     `json:"useRegex"`
	SearchScope     []string `json:"searchScope"`
	InScopeOnly     bool     `json:"inScopeOnly"`
}

type MatchReplaceRule struct {
	ID      int    `json:"id"`
	Enabled bool   `json:"enabled"`
	Name    string `json:"name,omitempty"`
	Target  string `json:"target"`  // "req-url" | "req-header" | "req-body" | "res-header" | "res-body"
	IsRegex bool   `json:"is_regex"`
	Match   string `json:"match"`
	Replace string `json:"replace"`
}

type MiddlewareNodePos struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type MiddlewareNode struct {
	ID       string            `json:"id"`
	Type     string            `json:"type"`     // "request"|"response"|"ws_c2s"|"ws_s2c"
	Name     string            `json:"name"`
	Enabled  bool              `json:"enabled"`
	Code     string            `json:"code"`     // full Python function: "def process(packet):..."
	Position MiddlewareNodePos `json:"position"`
}

type MiddlewareEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
}

type MiddlewareConfig struct {
	Enabled bool             `json:"enabled"`
	Nodes   []MiddlewareNode `json:"nodes"`
	Edges   []MiddlewareEdge `json:"edges"`
}

type FlowStep struct {
	ID   string `json:"id"`
	Type string `json:"type"` // "request" | "process"
	Name string `json:"name,omitempty"`
	Raw  string `json:"raw,omitempty"`  // base64-encoded raw HTTP
	Code string `json:"code,omitempty"` // Python code
}

type Flow struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Steps     []FlowStep        `json:"steps"`
	Variables map[string]string `json:"variables,omitempty"`
}

type Config struct {
	Name         string             `json:"name"`
	CreatedAt    time.Time          `json:"created_at"`
	Proxy        ProxyConfig        `json:"proxy"`
	Filters      FilterConfig       `json:"filters"`
	Scope        ScopeConfig        `json:"scope"`
	MCPDisabled  bool               `json:"mcp_disabled"`
	MCPPort      int                `json:"mcp_port,omitempty"`
	MatchReplace []MatchReplaceRule `json:"match_replace,omitempty"`
	Middleware   MiddlewareConfig   `json:"middleware,omitempty"`
	Flows        []Flow             `json:"flows,omitempty"`
}

type Manager struct {
	path string
	cfg  Config
	mu   sync.RWMutex
}

const defaultHiddenExtensionsCSV = "js, gif, jpg, png, css, woff, woff2, svg, json, map, fnt, ogg, jpeg, img, exe, mp4, flv, pdf, doc, ogv, webm, wmv, webp, mov, mp3, m4a, m4p, ppt, pptx, scss, tif, tiff, ttf, otf, bmp, ico, eot, htc, swf, rtf, image, rf, txt, ml, ip"

func defaultMatchReplaceRules() []MatchReplaceRule {
	return []MatchReplaceRule{
		{ID: 1, Enabled: false, Name: "Require non-cached response", Target: "req-header", IsRegex: true, Match: `^If-Modified-Since.*$`, Replace: ""},
		{ID: 2, Enabled: false, Name: "Require non-cached response", Target: "req-header", IsRegex: true, Match: `^If-None-Match.*$`, Replace: ""},
		{ID: 3, Enabled: false, Name: "Emulate Firefox User-Agent", Target: "req-header", IsRegex: true, Match: `^User-Agent.*$`, Replace: "User-Agent: Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0"},
		{ID: 4, Enabled: false, Name: "Ignore Cookies", Target: "res-header", IsRegex: true, Match: `^Set-Cookie.*$`, Replace: ""},
		{ID: 5, Enabled: false, Name: "Hide Referer header", Target: "req-header", IsRegex: true, Match: `^Referer.*$`, Replace: ""},
	}
}

func defaultConfig(name string) Config {
	return Config{
		Name:      name,
		CreatedAt: time.Now().UTC(),
		Proxy: ProxyConfig{
			Port:             8080,
			InterceptEnabled: false,
		},
		Filters: FilterConfig{
			CaseInsensitive: true,
			ExtensionHide:   defaultHiddenExtensionsCSV,
			StatusCodes:     []string{},
			SearchScope:     []string{},
			InScopeOnly:     true,
		},
		Scope: ScopeConfig{
			IncludeRules: []ScopeRule{},
			ExcludeRules: []ScopeRule{},
		},
		MatchReplace: defaultMatchReplaceRules(),
	}
}

func OpenProject(path string) (*Manager, error) {
	data, err := os.ReadFile(filepath.Join(path, "project.json"))
	if err != nil {
		return nil, fmt.Errorf("read project.json: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse project.json: %w", err)
	}
	if cfg.Filters.StatusCodes == nil {
		cfg.Filters.StatusCodes = []string{}
	}
	if cfg.Filters.SearchScope == nil {
		cfg.Filters.SearchScope = []string{}
	}
	if cfg.Scope.IncludeRules == nil {
		cfg.Scope.IncludeRules = []ScopeRule{}
	}
	if cfg.Scope.ExcludeRules == nil {
		cfg.Scope.ExcludeRules = []ScopeRule{}
	}
	if cfg.MatchReplace == nil {
		cfg.MatchReplace = defaultMatchReplaceRules()
	}
	if cfg.Middleware.Nodes == nil {
		cfg.Middleware.Nodes = []MiddlewareNode{}
	}
	if cfg.Middleware.Edges == nil {
		cfg.Middleware.Edges = []MiddlewareEdge{}
	}
	if cfg.Flows == nil {
		cfg.Flows = []Flow{}
	}
	return &Manager{path: path, cfg: cfg}, nil
}

func TempProjectPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".pandorabox", "temp"), nil
}

func IsTempPath(path string) bool {
	tempPath, err := TempProjectPath()
	if err != nil {
		return false
	}
	return path == tempPath
}

func CreateProject(path, name string) (*Manager, error) {
	if err := os.MkdirAll(path, 0755); err != nil {
		return nil, fmt.Errorf("create project dir: %w", err)
	}
	m := &Manager{path: path, cfg: defaultConfig(name)}
	if err := m.writeConfig(); err != nil {
		return nil, err
	}
	return m, nil
}

func TempProject() (*Manager, error) {
	tempPath, err := TempProjectPath()
	if err != nil {
		return nil, err
	}
	if err := os.RemoveAll(tempPath); err != nil {
		return nil, fmt.Errorf("reset temp project: %w", err)
	}
	return CreateProject(tempPath, "Temporary Project")
}

func (m *Manager) DBPath() string {
	return filepath.Join(m.path, "pandora.db")
}

func (m *Manager) Path() string {
	return m.path
}

func (m *Manager) Config() Config {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cfg
}

func (m *Manager) Save(cfg Config) error {
	m.mu.Lock()
	m.cfg = cfg
	m.mu.Unlock()
	return m.writeConfig()
}

func (m *Manager) IsTemp() bool {
	return IsTempPath(m.path)
}

func (m *Manager) SaveAs(destPath string) error {
	if err := os.MkdirAll(destPath, 0755); err != nil {
		return fmt.Errorf("create dest dir: %w", err)
	}
	if err := copyOptionalFile(m.DBPath(), filepath.Join(destPath, "pandora.db")); err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("copy db: %w", err)
		}
	}
	if err := copyOptionalFile(m.DBPath()+"-wal", filepath.Join(destPath, "pandora.db-wal")); err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("copy wal: %w", err)
		}
	}
	if err := copyOptionalFile(m.DBPath()+"-shm", filepath.Join(destPath, "pandora.db-shm")); err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("copy shm: %w", err)
		}
	}
	newMgr := &Manager{path: destPath, cfg: m.Config()}
	return newMgr.writeConfig()
}

func (m *Manager) writeConfig() error {
	cfg := m.Config()
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(m.path, "project.json"), data, 0644)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func copyOptionalFile(src, dst string) error {
	if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
		return err
	}
	return copyFile(src, dst)
}
