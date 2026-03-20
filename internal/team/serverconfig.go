package team

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/crypto/bcrypt"
)

const defaultServerConfigName = "pandorabox-server.json"
const defaultDataDir = "/data"
const defaultTeamPort = 7778
const defaultAPIPort = 7777
const defaultMaxMembers = 20
const defaultTeamName = "My Team"

// ServerConfig is the on-disk configuration for a team server instance.
// It is stored at the path specified by --server-config (default: ./pandorabox-server.json
// or /config/pandorabox-server.json inside Docker).
type ServerConfig struct {
	TeamPort     int    `json:"team_port"`
	APIPort      int    `json:"api_port"`
	PasswordHash string `json:"password_hash"` // bcrypt hash; set via SetPassword()
	DataDir      string `json:"data_dir"`      // where pandora.db + project.json live
	TeamName     string `json:"team_name"`
	MaxMembers   int    `json:"max_members"`
	LogLevel     string `json:"log_level"`

	// path is the file that was loaded from (not serialised).
	path string
}

// DefaultServerConfigPath returns the default path for the server config file.
// It checks $PANDORA_SERVER_CONFIG env var first, then falls back to
// ./pandorabox-server.json in the current working directory.
func DefaultServerConfigPath() string {
	if v := os.Getenv("PANDORA_SERVER_CONFIG"); v != "" {
		return v
	}
	return defaultServerConfigName
}

// LoadServerConfig reads a ServerConfig from path. If the file does not exist
// a default config is returned (and can be saved with Save()).
// If PANDORA_PASSWORD env var is set and password_hash is empty, the password
// is hashed and saved automatically (Docker first-run flow).
func LoadServerConfig(path string) (*ServerConfig, error) {
	if path == "" {
		path = DefaultServerConfigPath()
	}
	cfg := defaultServerConfig()
	cfg.path = path

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		// First run — apply env password if provided, then save.
		if pw := os.Getenv("PANDORA_PASSWORD"); pw != "" {
			if err := cfg.SetPassword(pw); err != nil {
				return nil, fmt.Errorf("hash initial password: %w", err)
			}
		}
		return cfg, cfg.Save()
	}
	if err != nil {
		return nil, fmt.Errorf("read server config: %w", err)
	}
	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse server config: %w", err)
	}
	cfg.path = path

	// Apply env password if hash is still empty (e.g. user left it blank in file).
	if cfg.PasswordHash == "" {
		if pw := os.Getenv("PANDORA_PASSWORD"); pw != "" {
			if err := cfg.SetPassword(pw); err != nil {
				return nil, fmt.Errorf("hash initial password: %w", err)
			}
		}
	}

	cfg.applyDefaults()
	return cfg, nil
}

// Save writes the config back to the file it was loaded from.
func (c *ServerConfig) Save() error {
	dir := filepath.Dir(c.path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(c.path, data, 0600)
}

// Path returns the file path this config was loaded from / will be saved to.
func (c *ServerConfig) Path() string { return c.path }

// SetPassword hashes plain and stores the result in PasswordHash, then saves.
func (c *ServerConfig) SetPassword(plain string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	c.PasswordHash = string(hash)
	return c.Save()
}

// CheckPassword returns true if plain matches the stored bcrypt hash.
func (c *ServerConfig) CheckPassword(plain string) bool {
	if c.PasswordHash == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(c.PasswordHash), []byte(plain)) == nil
}

func defaultServerConfig() *ServerConfig {
	return &ServerConfig{
		TeamPort:   defaultTeamPort,
		APIPort:    defaultAPIPort,
		DataDir:    defaultDataDir,
		TeamName:   defaultTeamName,
		MaxMembers: defaultMaxMembers,
		LogLevel:   "info",
	}
}

func (c *ServerConfig) applyDefaults() {
	if c.TeamPort == 0 {
		c.TeamPort = defaultTeamPort
	}
	if c.APIPort == 0 {
		c.APIPort = defaultAPIPort
	}
	if c.DataDir == "" {
		c.DataDir = defaultDataDir
	}
	if c.TeamName == "" {
		c.TeamName = defaultTeamName
	}
	if c.MaxMembers == 0 {
		c.MaxMembers = defaultMaxMembers
	}
	if c.LogLevel == "" {
		c.LogLevel = "info"
	}
}
