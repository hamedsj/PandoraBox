// SPDX-License-Identifier: Apache-2.0
package agentcli

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

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
		newMiddlewareTestCommand(opts),
	)
	return cmd
}

func newMiddlewareTestCommand(opts *options) *cobra.Command {
	var codeFile, nodeType string
	var requestID int64
	cmd := &cobra.Command{
		Use:   "test",
		Short: "Dry-run a middleware script against a captured request/response and surface errors",
		RunE: func(cmd *cobra.Command, args []string) error {
			if codeFile == "" || requestID == 0 {
				return fmt.Errorf("--code-file and --request-id are required")
			}
			if nodeType != "request" && nodeType != "response" {
				return fmt.Errorf("--type must be request or response")
			}
			code, err := os.ReadFile(codeFile)
			if err != nil {
				return fmt.Errorf("read %s: %w", codeFile, err)
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			raw, err := c.post(cmd.Context(), "/middleware/test", map[string]any{
				"code": string(code), "type": nodeType, "request_id": requestID,
			}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			var res struct {
				Started        bool     `json:"started"`
				OK             bool     `json:"ok"`
				Error          string   `json:"error"`
				Console        []string `json:"console"`
				BodyChanged    bool     `json:"body_changed"`
				HeadersChanged bool     `json:"headers_changed"`
				BodyBefore     string   `json:"body_before"`
				BodyAfter      string   `json:"body_after"`
				MethodBefore   string   `json:"method_before"`
				MethodAfter    string   `json:"method_after"`
				URLBefore      string   `json:"url_before"`
				URLAfter       string   `json:"url_after"`
				StatusBefore   int      `json:"status_before"`
				StatusAfter    int      `json:"status_after"`
			}
			if err := json.Unmarshal(raw, &res); err != nil {
				return err
			}
			// The runner fail-opens on a per-node exception (prints the traceback
			// and passes the packet through unchanged), so a raised script still
			// reports ok. Detect the traceback so the result flags it clearly.
			raised := false
			for _, line := range res.Console {
				if strings.Contains(line, "Traceback (most recent call last)") || strings.Contains(line, "Error:") {
					raised = true
					break
				}
			}
			status := "OK"
			if !res.Started {
				status = "NOT STARTED"
			} else if !res.OK {
				status = "ERROR"
			} else if raised {
				status = "SCRIPT RAISED (packet passed through unchanged — see console)"
			}
			fmt.Printf("result=%s body_changed=%t headers_changed=%t\n", status, res.BodyChanged, res.HeadersChanged)
			if res.Error != "" {
				fmt.Printf("error: %s\n", res.Error)
			}
			if nodeType == "response" {
				if res.StatusBefore != res.StatusAfter {
					fmt.Printf("status: %d → %d\n", res.StatusBefore, res.StatusAfter)
				}
			} else {
				if res.MethodBefore != res.MethodAfter {
					fmt.Printf("method: %s → %s\n", res.MethodBefore, res.MethodAfter)
				}
				if res.URLBefore != res.URLAfter {
					fmt.Printf("url: %s → %s\n", res.URLBefore, res.URLAfter)
				}
			}
			if res.BodyChanged {
				fmt.Printf("body before: %s\n", res.BodyBefore)
				fmt.Printf("body after:  %s\n", res.BodyAfter)
			}
			if len(res.Console) > 0 {
				fmt.Println("console:")
				for _, line := range res.Console {
					fmt.Printf("  %s\n", line)
				}
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&codeFile, "code-file", "", "Python middleware script file (defines process(packet))")
	cmd.Flags().StringVar(&nodeType, "type", "request", "Packet type to run against: request or response")
	cmd.Flags().Int64Var(&requestID, "request-id", 0, "Captured request ID to feed the script")
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
