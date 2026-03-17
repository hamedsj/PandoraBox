package project

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type AppConfig struct {
	RecentProjects []string `json:"recent_projects"`
	LastProject    string   `json:"last_project"`
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
