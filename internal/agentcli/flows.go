// SPDX-License-Identifier: Apache-2.0
package agentcli

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/google/uuid"
	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/hamedsj5/pandorabox/internal/storage"
	"github.com/spf13/cobra"
)

var interpolateRe = regexp.MustCompile(`\{\{(\w+)\}\}`)

// interpolate ports ui/src/lib/flowExecution.ts's interpolate: substitutes
// {{var}} placeholders, leaving unknown ones untouched.
func interpolate(template string, vars map[string]string) string {
	return interpolateRe.ReplaceAllStringFunc(template, func(m string) string {
		key := m[2 : len(m)-2]
		if v, ok := vars[key]; ok {
			return v
		}
		return m
	})
}

func newFlowsCommand() *cobra.Command {
	opts := newOptions()
	cmd := &cobra.Command{
		Use:   "flows",
		Short: "Run and manage HTTP/Python automation flows",
	}
	addCommonFlags(cmd, opts)
	cmd.AddCommand(
		newFlowsListCommand(opts),
		newFlowsRunCommand(opts),
		newFlowsAddCommand(opts),
		newFlowsRemoveCommand(opts),
	)
	return cmd
}

func newFlowsListCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List flows",
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
				return printCompactJSON(cfg.Flows)
			}
			fmt.Printf("total=%d\n", len(cfg.Flows))
			for _, f := range cfg.Flows {
				fmt.Printf("  id=%s name=%s steps=%d\n", f.ID, quote(f.Name), len(f.Steps))
			}
			return nil
		},
	}
}

func newFlowsRunCommand(opts *options) *cobra.Command {
	var varAssignments []string
	cmd := &cobra.Command{
		Use:   "run <id>",
		Short: "Run a flow's steps in order, threading variables through",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			seedVars, err := parseKeyValues(varAssignments)
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
			var flow *proj.Flow
			for i := range cfg.Flows {
				if cfg.Flows[i].ID == args[0] {
					flow = &cfg.Flows[i]
					break
				}
			}
			if flow == nil {
				return fmt.Errorf("flow %q not found", args[0])
			}
			variables, runErr := runFlow(cmd.Context(), c, *flow, seedVars, !opts.JSON)
			if opts.JSON {
				return printCompactJSON(map[string]any{"variables": variables, "error": errString(runErr)})
			}
			fmt.Println("final variables:")
			for k, v := range variables {
				fmt.Printf("  %s=%s\n", k, v)
			}
			return runErr
		},
	}
	cmd.Flags().StringArrayVar(&varAssignments, "var", nil, "Seed variable as key=value (repeatable)")
	return cmd
}

type flowExecResultResp struct {
	Variables map[string]string `json:"variables"`
	Error     string            `json:"error"`
}

// runFlow ports the step loop from ui/src/lib/flowExecution.ts: interpolate
// {{var}} placeholders into the raw HTTP template, POST /api/replay
// (synchronous — the response already contains the full result), and for
// "process" steps POST /api/flows/exec with the last response + variables.
func runFlow(ctx context.Context, c *client, flow proj.Flow, seedVars map[string]string, verbose bool) (map[string]string, error) {
	variables := map[string]string{}
	for k, v := range flow.Variables {
		variables[k] = v
	}
	for k, v := range seedVars {
		variables[k] = v
	}

	var lastReplay *storage.Replay
	for _, step := range flow.Steps {
		label := step.Name
		if label == "" {
			label = step.ID
		}
		switch step.Type {
		case "request":
			rawDecoded, err := base64.StdEncoding.DecodeString(step.Raw)
			if err != nil {
				return variables, fmt.Errorf("step %s: invalid base64 raw request: %w", label, err)
			}
			interpolated := interpolate(string(rawDecoded), variables)
			var replay storage.Replay
			_, err = c.post(ctx, "/replay", map[string]any{
				"request_id": 0,
				"raw":        base64.StdEncoding.EncodeToString([]byte(interpolated)),
			}, &replay)
			if err != nil {
				return variables, fmt.Errorf("step %s: replay failed: %w", label, err)
			}
			lastReplay = &replay
			if verbose {
				status := "-"
				if replay.Response != nil {
					status = fmt.Sprintf("%d", replay.Response.StatusCode)
				} else if replay.Error != "" {
					status = "error: " + replay.Error
				}
				fmt.Printf("step %s: request -> status=%s\n", label, status)
			}
		case "process":
			respPayload := map[string]any{"status": 0, "headers": map[string]string{}, "body": ""}
			if lastReplay != nil && lastReplay.Response != nil {
				respPayload["status"] = lastReplay.Response.StatusCode
				respPayload["headers"] = flattenHeaders(lastReplay.Response.Headers)
				respPayload["body"] = string(lastReplay.Response.Body)
			}
			var result flowExecResultResp
			_, err := c.post(ctx, "/flows/exec", map[string]any{
				"code": step.Code, "response": respPayload, "variables": variables,
			}, &result)
			if err != nil {
				return variables, fmt.Errorf("step %s: exec failed: %w", label, err)
			}
			if result.Error != "" {
				return variables, fmt.Errorf("step %s: %s", label, result.Error)
			}
			for k, v := range result.Variables {
				variables[k] = v
			}
			if verbose {
				fmt.Printf("step %s: process -> %d variable(s) updated\n", label, len(result.Variables))
			}
		default:
			return variables, fmt.Errorf("step %s: unknown step type %q", label, step.Type)
		}
	}
	return variables, nil
}

// flattenHeaders parses the stored JSON headers (map[string][]string, the
// standard net/http.Header shape) into map[string]string for the Python
// exec endpoint, taking the first value of each header.
func flattenHeaders(headersJSON string) map[string]string {
	out := map[string]string{}
	var parsed map[string][]string
	if err := json.Unmarshal([]byte(headersJSON), &parsed); err != nil {
		return out
	}
	for k, vals := range parsed {
		if len(vals) > 0 {
			out[k] = vals[0]
		}
	}
	return out
}

func newFlowsAddCommand(opts *options) *cobra.Command {
	var name, stepsFile string
	cmd := &cobra.Command{
		Use:   "add",
		Short: "Create a flow from a steps JSON file",
		RunE: func(cmd *cobra.Command, args []string) error {
			if stepsFile == "" {
				return fmt.Errorf("--steps-file is required (JSON array of {type, name, raw|code})")
			}
			raw, err := os.ReadFile(stepsFile)
			if err != nil {
				return fmt.Errorf("read --steps-file: %w", err)
			}
			var steps []proj.FlowStep
			if err := json.Unmarshal(raw, &steps); err != nil {
				return fmt.Errorf("--steps-file: invalid JSON: %w", err)
			}
			for i := range steps {
				if steps[i].ID == "" {
					steps[i].ID = uuid.NewString()
				}
				if steps[i].Type != "request" && steps[i].Type != "process" {
					return fmt.Errorf("step %d: type must be \"request\" or \"process\"", i)
				}
			}
			if name == "" {
				name = "New Flow"
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getProjectConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			flow := proj.Flow{ID: uuid.NewString(), Name: name, Steps: steps}
			cfg.Flows = append(cfg.Flows, flow)
			rawResp, err := c.put(cmd.Context(), "/project", map[string]any{"flows": cfg.Flows}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(rawResp))
				return nil
			}
			fmt.Printf("created flow id=%s name=%s steps=%d\n", flow.ID, quote(flow.Name), len(flow.Steps))
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Flow name")
	cmd.Flags().StringVar(&stepsFile, "steps-file", "", "Path to a JSON array of flow steps")
	return cmd
}

func newFlowsRemoveCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "remove <id>",
		Short: "Remove a flow",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getProjectConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			kept := make([]proj.Flow, 0, len(cfg.Flows))
			found := false
			for _, f := range cfg.Flows {
				if f.ID == args[0] {
					found = true
					continue
				}
				kept = append(kept, f)
			}
			if !found {
				return fmt.Errorf("flow %q not found", args[0])
			}
			cfg.Flows = kept
			raw, err := c.put(cmd.Context(), "/project", map[string]any{"flows": cfg.Flows}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("removed flow %s\n", args[0])
			return nil
		},
	}
}

func parseKeyValues(assignments []string) (map[string]string, error) {
	out := map[string]string{}
	for _, a := range assignments {
		parts := strings.SplitN(a, "=", 2)
		if len(parts) != 2 || parts[0] == "" {
			return nil, fmt.Errorf("invalid --var %q (want key=value)", a)
		}
		out[parts[0]] = parts[1]
	}
	return out, nil
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
