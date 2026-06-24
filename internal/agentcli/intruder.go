// SPDX-License-Identifier: Apache-2.0
package agentcli

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strconv"

	"github.com/spf13/cobra"
)

func newIntruderCommand() *cobra.Command {
	opts := newOptions()
	cmd := &cobra.Command{
		Use:   "intruder",
		Short: "Run marker-driven fuzzing attacks",
	}
	addCommonFlags(cmd, opts)
	cmd.AddCommand(
		newIntruderStartCommand(opts),
		newIntruderStatusCommand(opts),
		newIntruderResultsCommand(opts),
		newIntruderCancelCommand(opts),
	)
	return cmd
}

func newIntruderStartCommand(opts *options) *cobra.Command {
	var requestID int64
	var rawFile, attackType, payloadsFile string
	var concurrency int
	cmd := &cobra.Command{
		Use:   "start",
		Short: "Start a fuzzing attack in the background",
		Long: `Wrap injection points in §markers§ in --raw-file (plain HTTP/1.1, not base64).

Attack types:
  sniper        — iterate one marker at a time across one payload set
  battering_ram — same payload at every marker
  pitchfork     — parallel iteration, one set per marker, stops at shortest
  cluster_bomb  — cartesian product of all sets (default if unset: sniper)`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if requestID <= 0 {
				return fmt.Errorf("--request-id is required")
			}
			if rawFile == "" {
				return fmt.Errorf("--raw-file is required (plain HTTP/1.1 with §markers§)")
			}
			rawBytes, err := os.ReadFile(rawFile)
			if err != nil {
				return fmt.Errorf("read --raw-file: %w", err)
			}
			if payloadsFile == "" {
				return fmt.Errorf("--payloads-file is required (JSON array of payload arrays)")
			}
			payloadsBytes, err := os.ReadFile(payloadsFile)
			if err != nil {
				return fmt.Errorf("read --payloads-file: %w", err)
			}
			var payloads [][]string
			if err := json.Unmarshal(payloadsBytes, &payloads); err != nil {
				return fmt.Errorf("--payloads-file: invalid JSON: %w", err)
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var out struct {
				JobID  string `json:"job_id"`
				Total  int    `json:"total"`
				Status string `json:"status"`
			}
			raw, err := c.post(cmd.Context(), "/intruder/start", map[string]any{
				"request_id": requestID, "raw_text": string(rawBytes),
				"attack_type": attackType, "payloads": payloads, "concurrency": concurrency,
			}, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("job_id=%s total=%d status=%s\n", out.JobID, out.Total, out.Status)
			return nil
		},
	}
	cmd.Flags().Int64Var(&requestID, "request-id", 0, "Captured request id used for host/scheme routing")
	cmd.Flags().StringVar(&rawFile, "raw-file", "", "Path to a raw HTTP/1.1 request with §markers§")
	cmd.Flags().StringVar(&attackType, "attack-type", "sniper", "sniper, battering_ram, pitchfork, or cluster_bomb")
	cmd.Flags().StringVar(&payloadsFile, "payloads-file", "", "Path to a JSON array of payload arrays (one per marker)")
	cmd.Flags().IntVar(&concurrency, "concurrency", 5, "Max concurrent requests (1-20)")
	return cmd
}

func newIntruderStatusCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "status <job-id>",
		Short: "Get the status and progress of a running job",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var out struct {
				JobID       string  `json:"job_id"`
				Status      string  `json:"status"`
				Total       int     `json:"total"`
				Completed   int     `json:"completed"`
				ProgressPct float64 `json:"progress_pct"`
			}
			raw, err := c.get(cmd.Context(), fmt.Sprintf("/intruder/%s/status", url.PathEscape(args[0])), nil, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("job_id=%s status=%s completed=%d total=%d progress=%.1f%%\n",
				out.JobID, out.Status, out.Completed, out.Total, out.ProgressPct)
			return nil
		},
	}
}

func newIntruderResultsCommand(opts *options) *cobra.Command {
	var afterIndex, limit int
	cmd := &cobra.Command{
		Use:   "results <job-id>",
		Short: "Get accumulated results for a job (incremental polling supported)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			q := url.Values{}
			q.Set("after_index", strconv.Itoa(afterIndex))
			if limit > 0 {
				q.Set("limit", strconv.Itoa(limit))
			}
			var out struct {
				JobID   string `json:"job_id"`
				Status  string `json:"status"`
				Results []struct {
					Index    int      `json:"index"`
					Payloads []string `json:"payloads"`
					Status   int      `json:"status"`
					Length   int64    `json:"length_bytes"`
					TimeMs   int64    `json:"time_ms"`
					Error    string   `json:"error,omitempty"`
				} `json:"results"`
				HasMore        bool `json:"has_more"`
				NextAfterIndex int  `json:"next_after_index"`
			}
			raw, err := c.get(cmd.Context(), fmt.Sprintf("/intruder/%s/results", url.PathEscape(args[0])), q, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("job_id=%s status=%s shown=%d has_more=%s next_after_index=%d\n",
				out.JobID, out.Status, len(out.Results), onOff(out.HasMore), out.NextAfterIndex)
			for _, r := range out.Results {
				status := fmt.Sprintf("%d", r.Status)
				if r.Error != "" {
					status = "error: " + r.Error
				}
				fmt.Printf("  index=%d status=%s length=%s time_ms=%d payloads=%v\n",
					r.Index, status, humanBytes(r.Length), r.TimeMs, r.Payloads)
			}
			return nil
		},
	}
	cmd.Flags().IntVar(&afterIndex, "after-index", -1, "Return only results with index > this cursor (-1 = from the start)")
	cmd.Flags().IntVar(&limit, "limit", 500, "Maximum results to return")
	return cmd
}

func newIntruderCancelCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "cancel <job-id>",
		Short: "Cancel a running job",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			raw, err := c.post(cmd.Context(), fmt.Sprintf("/intruder/%s/cancel", url.PathEscape(args[0])), nil, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("cancelled job=%s\n", args[0])
			return nil
		},
	}
}
