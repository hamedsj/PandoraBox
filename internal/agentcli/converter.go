// SPDX-License-Identifier: Apache-2.0
package agentcli

import (
	"context"
	"fmt"
	"strings"

	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/spf13/cobra"
)

type converterAlgorithm struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
}

type converterConfigResponse struct {
	Config     proj.ConverterConfig `json:"config"`
	Algorithms []converterAlgorithm `json:"algorithms"`
}

func getConverterConfig(ctx context.Context, c *client) (*converterConfigResponse, error) {
	var out converterConfigResponse
	if _, err := c.get(ctx, "/converter", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func newConverterCommand() *cobra.Command {
	opts := newOptions()
	cmd := &cobra.Command{
		Use:   "converter",
		Short: "Run data transforms and manage convert stacks",
	}
	addCommonFlags(cmd, opts)
	cmd.AddCommand(newConverterRunCommand(opts), newConverterAlgorithmsCommand(opts), newConverterStackCommand(opts))
	return cmd
}

func newConverterRunCommand(opts *options) *cobra.Command {
	var algorithm, file string
	var fromStdin bool
	cmd := &cobra.Command{
		Use:   "run",
		Short: "Run a single algorithm against input",
		RunE: func(cmd *cobra.Command, args []string) error {
			if algorithm == "" {
				return fmt.Errorf("--algorithm is required")
			}
			input, err := readInput(file, fromStdin)
			if err != nil {
				return err
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var out struct {
				Output string `json:"output"`
			}
			raw, err := c.post(cmd.Context(), "/converter/transform", map[string]any{
				"input": string(input), "algorithm": algorithm,
			}, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Println(out.Output)
			return nil
		},
	}
	cmd.Flags().StringVar(&algorithm, "algorithm", "", "Algorithm id (see converter algorithms)")
	cmd.Flags().StringVarP(&file, "file", "f", "", "Read input from file")
	cmd.Flags().BoolVar(&fromStdin, "stdin", false, "Read input from stdin")
	return cmd
}

func newConverterAlgorithmsCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "algorithms",
		Short: "List available converter algorithms",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getConverterConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			if opts.JSON {
				return printCompactJSON(cfg.Algorithms)
			}
			for _, a := range cfg.Algorithms {
				fmt.Printf("%s\t%s\t%s\n", a.ID, a.Kind, a.Label)
			}
			return nil
		},
	}
}

func newConverterStackCommand(opts *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "stack",
		Short: "Manage saved convert stacks",
	}
	cmd.AddCommand(
		newConverterStackListCommand(opts),
		newConverterStackRunCommand(opts),
		newConverterStackAddCommand(opts),
		newConverterStackRemoveCommand(opts),
	)
	return cmd
}

func newConverterStackListCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List saved convert stacks",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getConverterConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			if opts.JSON {
				return printCompactJSON(cfg.Config.Stacks)
			}
			fmt.Printf("total=%d\n", len(cfg.Config.Stacks))
			for _, s := range cfg.Config.Stacks {
				steps := make([]string, 0, len(s.Steps))
				for _, st := range s.Steps {
					mark := "x"
					if !st.Enabled {
						mark = "-"
					}
					steps = append(steps, fmt.Sprintf("%s%s", mark, st.Algorithm))
				}
				fmt.Printf("  id=%s name=%s steps=%s\n", s.ID, quote(s.Name), strings.Join(steps, ","))
			}
			return nil
		},
	}
}

func newConverterStackRunCommand(opts *options) *cobra.Command {
	var file string
	var fromStdin bool
	cmd := &cobra.Command{
		Use:   "run <id>",
		Short: "Run a saved convert stack against input",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			input, err := readInput(file, fromStdin)
			if err != nil {
				return err
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var out struct {
				Output string            `json:"output"`
				Stack  proj.ConvertStack `json:"stack"`
			}
			raw, err := c.post(cmd.Context(), "/converter/stack/run", map[string]any{
				"input": string(input), "stack_id": args[0],
			}, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Println(out.Output)
			return nil
		},
	}
	cmd.Flags().StringVarP(&file, "file", "f", "", "Read input from file")
	cmd.Flags().BoolVar(&fromStdin, "stdin", false, "Read input from stdin")
	return cmd
}

func newConverterStackAddCommand(opts *options) *cobra.Command {
	var name, algorithms string
	cmd := &cobra.Command{
		Use:   "add",
		Short: "Create a convert stack",
		RunE: func(cmd *cobra.Command, args []string) error {
			if algorithms == "" {
				return fmt.Errorf("--algorithms is required (comma-separated, in order)")
			}
			if name == "" {
				name = "New Stack"
			}
			steps := make([]proj.ConvertStep, 0)
			for _, a := range strings.Split(algorithms, ",") {
				a = strings.TrimSpace(a)
				if a == "" {
					continue
				}
				steps = append(steps, proj.ConvertStep{Algorithm: a, Enabled: true})
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getConverterConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			cfg.Config.Stacks = append(cfg.Config.Stacks, proj.ConvertStack{Name: name, Steps: steps})
			var out converterConfigResponse
			raw, err := c.put(cmd.Context(), "/converter", map[string]any{"config": cfg.Config}, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			added := out.Config.Stacks[len(out.Config.Stacks)-1]
			fmt.Printf("added stack id=%s name=%s\n", added.ID, quote(added.Name))
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Stack name")
	cmd.Flags().StringVar(&algorithms, "algorithms", "", "Comma-separated algorithm ids, in run order")
	return cmd
}

func newConverterStackRemoveCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "remove <id>",
		Short: "Remove a convert stack",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getConverterConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			kept := make([]proj.ConvertStack, 0, len(cfg.Config.Stacks))
			found := false
			for _, s := range cfg.Config.Stacks {
				if s.ID == args[0] {
					found = true
					continue
				}
				kept = append(kept, s)
			}
			if !found {
				return fmt.Errorf("stack %q not found", args[0])
			}
			cfg.Config.Stacks = kept
			raw, err := c.put(cmd.Context(), "/converter", map[string]any{"config": cfg.Config}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("removed stack %s\n", args[0])
			return nil
		},
	}
}
