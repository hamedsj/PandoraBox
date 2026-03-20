package project

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
)

type AppConfig struct {
	RecentProjects []string `json:"recent_projects"`
	LastProject    string   `json:"last_project"`

	// User identity for team collaboration.
	UserID      string `json:"user_id,omitempty"`      // stable UUID (hex), generated once
	DisplayName string `json:"display_name,omitempty"` // shown to teammates
	Color       string `json:"color,omitempty"`        // accent color name from the UI palette

	// Team client connection settings (persisted across restarts).
	TeamURL   string `json:"team_url,omitempty"`   // ws://host:7778
	TeamToken string `json:"team_token,omitempty"` // last-used password (plaintext, local only)
}

func appConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".pandorabox")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

func LoadAppConfig() (*AppConfig, error) {
	p, err := appConfigPath()
	if err != nil {
		return &AppConfig{}, nil
	}
	data, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return &AppConfig{}, nil
	}
	if err != nil {
		return nil, err
	}
	var cfg AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return &AppConfig{}, nil
	}
	return &cfg, nil
}

func (c *AppConfig) Save() error {
	p, err := appConfigPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

// EnsureUserID generates a random 16-byte hex UserID if one is not already set,
// then saves the config. It is idempotent — safe to call on every startup.
func (c *AppConfig) EnsureUserID() error {
	if c.UserID != "" {
		return nil
	}
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return err
	}
	c.UserID = hex.EncodeToString(b)
	return c.Save()
}

func (c *AppConfig) AddRecent(path string) {
	filtered := c.RecentProjects[:0]
	for _, p := range c.RecentProjects {
		if p != path {
			filtered = append(filtered, p)
		}
	}
	c.RecentProjects = append([]string{path}, filtered...)
	if len(c.RecentProjects) > 10 {
		c.RecentProjects = c.RecentProjects[:10]
	}
	c.LastProject = path
}
