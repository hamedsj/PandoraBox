// SPDX-License-Identifier: Apache-2.0
package agentcli

import (
	"fmt"
	"strconv"
	"strings"

	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/spf13/cobra"
)

func newScopeCommand() *cobra.Command {
	opts := newOptions()
	cmd := &cobra.Command{
		Use:   "scope",
		Short: "Manage project scope rules",
	}
	addCommonFlags(cmd, opts)
	cmd.AddCommand(
		newScopeGetCommand(opts),
		newScopeToggleCommand(opts, "enable", true),
		newScopeToggleCommand(opts, "disable", false),
		newScopeAddRuleCommand(opts, "add-include", true),
		newScopeAddRuleCommand(opts, "add-exclude", false),
		newScopeRemoveRuleCommand(opts, "remove-include", true),
		newScopeRemoveRuleCommand(opts, "remove-exclude", false),
	)
	return cmd
}

func newScopeGetCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "get",
		Short: "Print scope rules",
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
				return printCompactJSON(cfg.Scope)
			}
			fmt.Printf("enabled=%s\n", onOff(cfg.Scope.Enabled))
			fmt.Println("include:")
			for i, r := range cfg.Scope.IncludeRules {
				fmt.Println(formatScopeRule(i+1, r))
			}
			fmt.Println("exclude:")
			for i, r := range cfg.Scope.ExcludeRules {
				fmt.Println(formatScopeRule(i+1, r))
			}
			return nil
		},
	}
}

func newScopeToggleCommand(opts *options, name string, enabled bool) *cobra.Command {
	return &cobra.Command{
		Use:   name,
		Short: fmt.Sprintf("%s scope enforcement", strings.Title(name)), //nolint:staticcheck
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getProjectConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			cfg.Scope.Enabled = enabled
			raw, err := c.put(cmd.Context(), "/project", map[string]any{"scope": cfg.Scope}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("scope_enabled=%s\n", onOff(enabled))
			return nil
		},
	}
}

func newScopeAddRuleCommand(opts *options, name string, include bool) *cobra.Command {
	var host, path, patternType string
	var disabled bool
	cmd := &cobra.Command{
		Use:   name,
		Short: fmt.Sprintf("Add a %s rule", ruleKind(include)),
		RunE: func(cmd *cobra.Command, args []string) error {
			if host == "" {
				return fmt.Errorf("--host is required")
			}
			if patternType == "" {
				patternType = "contains"
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getProjectConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			rule := proj.ScopeRule{Enabled: !disabled, PatternType: patternType, Host: host, Path: path}
			if include {
				cfg.Scope.IncludeRules = append(cfg.Scope.IncludeRules, rule)
			} else {
				cfg.Scope.ExcludeRules = append(cfg.Scope.ExcludeRules, rule)
			}
			raw, err := c.put(cmd.Context(), "/project", map[string]any{"scope": cfg.Scope}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Println(formatScopeRule(ruleCount(cfg.Scope, include), rule))
			return nil
		},
	}
	cmd.Flags().StringVar(&host, "host", "", "Host to match")
	cmd.Flags().StringVar(&path, "path", "", "Path to match (empty = any path)")
	cmd.Flags().StringVar(&patternType, "pattern-type", "contains", "exact, contains, wildcard, or regex")
	cmd.Flags().BoolVar(&disabled, "disabled", false, "Add the rule disabled")
	return cmd
}

func newScopeRemoveRuleCommand(opts *options, name string, include bool) *cobra.Command {
	return &cobra.Command{
		Use:   name + " <index>",
		Short: fmt.Sprintf("Remove a %s rule by index (1-based, from scope get)", ruleKind(include)),
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			idx, err := strconv.Atoi(args[0])
			if err != nil || idx <= 0 {
				return fmt.Errorf("invalid index %q", args[0])
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getProjectConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			rules := cfg.Scope.IncludeRules
			if !include {
				rules = cfg.Scope.ExcludeRules
			}
			if idx > len(rules) {
				return fmt.Errorf("index %d out of range (1..%d)", idx, len(rules))
			}
			rules = append(rules[:idx-1], rules[idx:]...)
			if include {
				cfg.Scope.IncludeRules = rules
			} else {
				cfg.Scope.ExcludeRules = rules
			}
			raw, err := c.put(cmd.Context(), "/project", map[string]any{"scope": cfg.Scope}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("removed %s rule %d\n", ruleKind(include), idx)
			return nil
		},
	}
}

func formatScopeRule(index int, r proj.ScopeRule) string {
	path := r.Path
	if path == "" {
		path = "*"
	}
	return fmt.Sprintf("  %d enabled=%s type=%s host=%s path=%s", index, onOff(r.Enabled), r.PatternType, r.Host, path)
}

func ruleKind(include bool) string {
	if include {
		return "include"
	}
	return "exclude"
}

func ruleCount(s proj.ScopeConfig, include bool) int {
	if include {
		return len(s.IncludeRules)
	}
	return len(s.ExcludeRules)
}
