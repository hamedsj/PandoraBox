// SPDX-License-Identifier: Apache-2.0
package agentcli

import (
	"fmt"
	"os"

	"github.com/google/uuid"
	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/spf13/cobra"
)

var validMiddlewareNodeTypes = map[string]bool{
	"request": true, "response": true, "ws_c2s": true, "ws_s2c": true,
}

func newMiddlewareCommand() *cobra.Command {
	opts := newOptions()
	cmd := &cobra.Command{
		Use:   "middleware",
		Short: "Manage the Python middleware graph",
	}
	addCommonFlags(cmd, opts)
	cmd.AddCommand(
		newMiddlewareListCommand(opts),
		newMiddlewareAddCommand(opts),
		newMiddlewareRemoveCommand(opts),
		newMiddlewareSetEnabledCommand(opts, "enable", true),
		newMiddlewareSetEnabledCommand(opts, "disable", false),
		newMiddlewareToggleCommand(opts),
	)
	return cmd
}

func newMiddlewareListCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List middleware nodes and edges",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getProjectConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			if opts.JSON {
				return printCompactJSON(cfg.Middleware)
			}
			fmt.Printf("enabled=%s nodes=%d edges=%d\n", onOff(cfg.Middleware.Enabled), len(cfg.Middleware.Nodes), len(cfg.Middleware.Edges))
			for _, n := range cfg.Middleware.Nodes {
				fmt.Printf("  id=%s enabled=%s type=%s name=%s\n", n.ID, onOff(n.Enabled), n.Type, quote(n.Name))
			}
			for _, e := range cfg.Middleware.Edges {
				fmt.Printf("  edge %s -> %s\n", e.Source, e.Target)
			}
			return nil
		},
	}
}

func newMiddlewareAddCommand(opts *options) *cobra.Command {
	var nodeType, name, codeFile, after string
	var disabled bool
	cmd := &cobra.Command{
		Use:   "add",
		Short: "Add a middleware node",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !validMiddlewareNodeTypes[nodeType] {
				return fmt.Errorf("--type must be one of request, response, ws_c2s, ws_s2c")
			}
			if codeFile == "" {
				return fmt.Errorf("--code-file is required (Python: def process(packet): ...)")
			}
			code, err := os.ReadFile(codeFile)
			if err != nil {
				return fmt.Errorf("read --code-file: %w", err)
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getProjectConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			if name == "" {
				name = "New Node"
			}
			node := proj.MiddlewareNode{
				ID:      uuid.NewString(),
				Type:    nodeType,
				Name:    name,
				Enabled: !disabled,
				Code:    string(code),
				Position: proj.MiddlewareNodePos{
					X: float64(len(cfg.Middleware.Nodes) * 220),
					Y: 80,
				},
			}
			if after != "" {
				if !middlewareNodeExists(cfg.Middleware.Nodes, after) {
					return fmt.Errorf("--after node %q not found", after)
				}
				cfg.Middleware.Edges = append(cfg.Middleware.Edges, proj.MiddlewareEdge{
					ID: uuid.NewString(), Source: after, Target: node.ID,
				})
			}
			cfg.Middleware.Nodes = append(cfg.Middleware.Nodes, node)
			raw, err := c.put(cmd.Context(), "/project", map[string]any{"middleware": cfg.Middleware}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("added node id=%s type=%s name=%s\n", node.ID, node.Type, quote(node.Name))
			return nil
		},
	}
	cmd.Flags().StringVar(&nodeType, "type", "", "request, response, ws_c2s, or ws_s2c")
	cmd.Flags().StringVar(&name, "name", "", "Node name")
	cmd.Flags().StringVar(&codeFile, "code-file", "", "Path to a Python file defining process(packet)")
	cmd.Flags().StringVar(&after, "after", "", "Wire an edge from this existing node id to the new node")
	cmd.Flags().BoolVar(&disabled, "disabled", false, "Add the node disabled")
	return cmd
}

func newMiddlewareRemoveCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "remove <id>",
		Short: "Remove a middleware node (and any edges touching it)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id := args[0]
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getProjectConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			if !middlewareNodeExists(cfg.Middleware.Nodes, id) {
				return fmt.Errorf("node %q not found", id)
			}
			nodes := make([]proj.MiddlewareNode, 0, len(cfg.Middleware.Nodes))
			for _, n := range cfg.Middleware.Nodes {
				if n.ID != id {
					nodes = append(nodes, n)
				}
			}
			edges := make([]proj.MiddlewareEdge, 0, len(cfg.Middleware.Edges))
			for _, e := range cfg.Middleware.Edges {
				if e.Source != id && e.Target != id {
					edges = append(edges, e)
				}
			}
			cfg.Middleware.Nodes = nodes
			cfg.Middleware.Edges = edges
			raw, err := c.put(cmd.Context(), "/project", map[string]any{"middleware": cfg.Middleware}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("removed node %s\n", id)
			return nil
		},
	}
}

func newMiddlewareSetEnabledCommand(opts *options, name string, enabled bool) *cobra.Command {
	return &cobra.Command{
		Use:   name + " <id>",
		Short: fmt.Sprintf("%s a middleware node", name),
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id := args[0]
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getProjectConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			found := false
			for i := range cfg.Middleware.Nodes {
				if cfg.Middleware.Nodes[i].ID == id {
					cfg.Middleware.Nodes[i].Enabled = enabled
					found = true
					break
				}
			}
			if !found {
				return fmt.Errorf("node %q not found", id)
			}
			raw, err := c.put(cmd.Context(), "/project", map[string]any{"middleware": cfg.Middleware}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("node=%s enabled=%s\n", id, onOff(enabled))
			return nil
		},
	}
}

func newMiddlewareToggleCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "toggle <on|off>",
		Short: "Enable or disable the whole middleware graph",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			enabled, err := parseOnOff(args[0])
			if err != nil {
				return err
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getProjectConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			cfg.Middleware.Enabled = enabled
			raw, err := c.put(cmd.Context(), "/project", map[string]any{"middleware": cfg.Middleware}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("middleware_enabled=%s\n", onOff(enabled))
			return nil
		},
	}
}

func middlewareNodeExists(nodes []proj.MiddlewareNode, id string) bool {
	for _, n := range nodes {
		if n.ID == id {
			return true
		}
	}
	return false
}
