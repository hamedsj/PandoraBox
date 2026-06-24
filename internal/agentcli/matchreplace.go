// SPDX-License-Identifier: Apache-2.0
package agentcli

import (
	"fmt"

	proj "github.com/hamedsj5/pandorabox/internal/project"
	"github.com/spf13/cobra"
)

var validMatchReplaceTargets = map[string]bool{
	"req-url": true, "req-header": true, "req-body": true, "res-header": true, "res-body": true,
}

func newMatchReplaceCommand() *cobra.Command {
	opts := newOptions()
	cmd := &cobra.Command{
		Use:   "matchreplace",
		Short: "Manage match & replace rules",
	}
	addCommonFlags(cmd, opts)
	cmd.AddCommand(
		newMatchReplaceListCommand(opts),
		newMatchReplaceAddCommand(opts),
		newMatchReplaceRemoveCommand(opts),
		newMatchReplaceSetEnabledCommand(opts, "enable", true),
		newMatchReplaceSetEnabledCommand(opts, "disable", false),
	)
	return cmd
}

func newMatchReplaceListCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List match & replace rules",
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
				return printCompactJSON(cfg.MatchReplace)
			}
			fmt.Printf("total=%d\n", len(cfg.MatchReplace))
			for _, r := range cfg.MatchReplace {
				fmt.Println(formatMatchReplaceRule(r))
			}
			return nil
		},
	}
}

func newMatchReplaceAddCommand(opts *options) *cobra.Command {
	var target, match, replace, name string
	var isRegex, disabled bool
	cmd := &cobra.Command{
		Use:   "add",
		Short: "Add a match & replace rule",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !validMatchReplaceTargets[target] {
				return fmt.Errorf("--target must be one of req-url, req-header, req-body, res-header, res-body")
			}
			if match == "" {
				return fmt.Errorf("--match is required")
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			cfg, err := getProjectConfig(cmd.Context(), c)
			if err != nil {
				return err
			}
			nextID := 1
			for _, r := range cfg.MatchReplace {
				if r.ID >= nextID {
					nextID = r.ID + 1
				}
			}
			rule := proj.MatchReplaceRule{
				ID: nextID, Enabled: !disabled, Name: name,
				Target: target, IsRegex: isRegex, Match: match, Replace: replace,
			}
			cfg.MatchReplace = append(cfg.MatchReplace, rule)
			raw, err := c.put(cmd.Context(), "/project", map[string]any{"match_replace": cfg.MatchReplace}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Println(formatMatchReplaceRule(rule))
			return nil
		},
	}
	cmd.Flags().StringVar(&target, "target", "", "req-url, req-header, req-body, res-header, or res-body")
	cmd.Flags().StringVar(&match, "match", "", "Match string or regex")
	cmd.Flags().StringVar(&replace, "replace", "", "Replacement text")
	cmd.Flags().StringVar(&name, "name", "", "Optional rule name")
	cmd.Flags().BoolVar(&isRegex, "regex", false, "Treat --match as a regular expression")
	cmd.Flags().BoolVar(&disabled, "disabled", false, "Add the rule disabled")
	return cmd
}

func newMatchReplaceRemoveCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "remove <id>",
		Short: "Remove a match & replace rule",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := parseID(args[0])
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
			next, found := removeMatchReplaceRule(cfg.MatchReplace, int(id))
			if !found {
				return fmt.Errorf("rule %d not found", id)
			}
			cfg.MatchReplace = next
			raw, err := c.put(cmd.Context(), "/project", map[string]any{"match_replace": cfg.MatchReplace}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("removed rule %d\n", id)
			return nil
		},
	}
}

func newMatchReplaceSetEnabledCommand(opts *options, name string, enabled bool) *cobra.Command {
	return &cobra.Command{
		Use:   name + " <id>",
		Short: fmt.Sprintf("%s a match & replace rule", name),
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := parseID(args[0])
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
			found := false
			for i := range cfg.MatchReplace {
				if cfg.MatchReplace[i].ID == int(id) {
					cfg.MatchReplace[i].Enabled = enabled
					found = true
					break
				}
			}
			if !found {
				return fmt.Errorf("rule %d not found", id)
			}
			raw, err := c.put(cmd.Context(), "/project", map[string]any{"match_replace": cfg.MatchReplace}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("rule=%d enabled=%s\n", id, onOff(enabled))
			return nil
		},
	}
}

func removeMatchReplaceRule(rules []proj.MatchReplaceRule, id int) ([]proj.MatchReplaceRule, bool) {
	for i, r := range rules {
		if r.ID == id {
			return append(rules[:i], rules[i+1:]...), true
		}
	}
	return rules, false
}

func formatMatchReplaceRule(r proj.MatchReplaceRule) string {
	name := r.Name
	if name == "" {
		name = "-"
	}
	return fmt.Sprintf("  id=%d enabled=%s target=%s regex=%s name=%s match=%s replace=%s",
		r.ID, onOff(r.Enabled), r.Target, onOff(r.IsRegex), quote(name), quote(r.Match), quote(r.Replace))
}
