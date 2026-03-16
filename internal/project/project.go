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
	Port             int  `json:"port"`
	InterceptEnabled bool `json:"intercept_enabled"`
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
}

type Config struct {
	Name      string       `json:"name"`
	CreatedAt time.Time    `json:"created_at"`
	Proxy     ProxyConfig  `json:"proxy"`
	Filters   FilterConfig `json:"filters"`
	Scope     ScopeConfig  `json:"scope"`
}

type Manager struct {
	path string
	cfg  Config
	mu   sync.RWMutex
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
			StatusCodes:     []string{},
			SearchScope:     []string{},
		},
		Scope: ScopeConfig{
			IncludeRules: []ScopeRule{},
			ExcludeRules: []ScopeRule{},
		},
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
	return &Manager{path: path, cfg: cfg}, nil
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
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	tempPath := filepath.Join(home, ".pitokmonitor", "temp")
	cfgFile := filepath.Join(tempPath, "project.json")
	if _, err := os.Stat(cfgFile); os.IsNotExist(err) {
		return CreateProject(tempPath, "Temporary Project")
	}
	return OpenProject(tempPath)
}

func (m *Manager) DBPath() string {
	return filepath.Join(m.path, "pitok.db")
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
	home, _ := os.UserHomeDir()
	tempPath := filepath.Join(home, ".pitokmonitor", "temp")
	return m.path == tempPath
}

func (m *Manager) SaveAs(destPath string) error {
	if err := os.MkdirAll(destPath, 0755); err != nil {
		return fmt.Errorf("create dest dir: %w", err)
	}
	if err := copyFile(m.DBPath(), filepath.Join(destPath, "pitok.db")); err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("copy db: %w", err)
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
