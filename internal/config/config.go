package config

import (
	"github.com/spf13/cobra"
)

type Config struct {
	ProxyPort int
	APIPort   int
	MCPPort   int
	DBPath    string

	// Team collaboration flags.
	TeamServer       bool   // run as team sync hub (no local proxy)
	TeamPort         int    // WebSocket hub port (default 7778)
	TeamURL          string // outbound client URL, e.g. ws://host:7778
	ServerConfigPath string // path to pandorabox-server.json
}

func FromFlags(cmd *cobra.Command) *Config {
	proxyPort, _ := cmd.Flags().GetInt("proxy-port")
	apiPort, _ := cmd.Flags().GetInt("api-port")
	mcpPort, _ := cmd.Flags().GetInt("mcp-port")
	dbPath, _ := cmd.Flags().GetString("db")
	teamServer, _ := cmd.Flags().GetBool("team-server")
	teamPort, _ := cmd.Flags().GetInt("team-port")
	teamURL, _ := cmd.Flags().GetString("team-url")
	serverConfig, _ := cmd.Flags().GetString("server-config")
	return &Config{
		ProxyPort:        proxyPort,
		APIPort:          apiPort,
		MCPPort:          mcpPort,
		DBPath:           dbPath,
		TeamServer:       teamServer,
		TeamPort:         teamPort,
		TeamURL:          teamURL,
		ServerConfigPath: serverConfig,
	}
}
