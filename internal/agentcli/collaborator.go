// SPDX-License-Identifier: Apache-2.0
package agentcli

import (
	"fmt"
	"net/url"

	"github.com/spf13/cobra"
)

func newCollaboratorCommand() *cobra.Command {
	opts := newOptions()
	cmd := &cobra.Command{
		Use:   "collaborator",
		Short: "Run out-of-band (interactsh) Collaborator sessions",
	}
	addCommonFlags(cmd, opts)
	cmd.AddCommand(
		newCollaboratorStartCommand(opts),
		newCollaboratorListCommand(opts),
		newCollaboratorPollCommand(opts),
		newCollaboratorStopCommand(opts),
		newCollaboratorURLCommand(opts),
	)
	return cmd
}

func newCollaboratorStartCommand(opts *options) *cobra.Command {
	var server string
	cmd := &cobra.Command{
		Use:   "start",
		Short: "Start a new Collaborator session and print its URL",
		Long:  "Embed the returned url in your payloads — DNS/HTTP/SMTP/LDAP interactions against it are recorded.",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var out struct {
				SessionID     string `json:"session_id"`
				Server        string `json:"server"`
				CorrelationID string `json:"correlation_id"`
				URL           string `json:"url"`
				StartedAt     string `json:"started_at"`
			}
			raw, err := c.post(cmd.Context(), "/collaborator/sessions", map[string]any{"server": server}, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("session_id=%s server=%s url=%s\n", out.SessionID, out.Server, out.URL)
			return nil
		},
	}
	cmd.Flags().StringVar(&server, "server", "", `Interactsh hostname (default "oast.pro")`)
	return cmd
}

func newCollaboratorListCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List active Collaborator sessions",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var out struct {
				Sessions []struct {
					SessionID        string `json:"session_id"`
					Server           string `json:"server"`
					URL              string `json:"url"`
					StartedAt        string `json:"started_at"`
					InteractionCount int    `json:"interaction_count"`
				} `json:"sessions"`
			}
			raw, err := c.get(cmd.Context(), "/collaborator/sessions", nil, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("total=%d\n", len(out.Sessions))
			for _, s := range out.Sessions {
				fmt.Printf("  session_id=%s url=%s interactions=%d started_at=%s\n",
					s.SessionID, s.URL, s.InteractionCount, s.StartedAt)
			}
			return nil
		},
	}
}

func newCollaboratorPollCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "poll <session-id>",
		Short: "Poll a session for accumulated out-of-band interactions",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var out struct {
				Interactions []map[string]any `json:"interactions"`
				Count        int              `json:"count"`
			}
			raw, err := c.post(cmd.Context(), fmt.Sprintf("/collaborator/sessions/%s/poll", url.PathEscape(args[0])), nil, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("count=%d\n", out.Count)
			for _, it := range out.Interactions {
				fmt.Printf("  protocol=%v remote=%v timestamp=%v\n", it["protocol"], it["remote-address"], it["timestamp"])
			}
			return nil
		},
	}
}

func newCollaboratorStopCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "stop <session-id>",
		Short: "Stop a Collaborator session and deregister it",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			raw, err := c.post(cmd.Context(), fmt.Sprintf("/collaborator/sessions/%s/stop", url.PathEscape(args[0])), nil, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("stopped session=%s\n", args[0])
			return nil
		},
	}
}

func newCollaboratorURLCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "url <session-id>",
		Short: "Generate another unique test URL for an existing session",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var out struct {
				URL string `json:"url"`
			}
			raw, err := c.post(cmd.Context(), fmt.Sprintf("/collaborator/sessions/%s/url", url.PathEscape(args[0])), nil, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Println(out.URL)
			return nil
		},
	}
}
