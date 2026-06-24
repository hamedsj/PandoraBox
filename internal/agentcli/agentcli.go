// SPDX-License-Identifier: Apache-2.0
package agentcli

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hamedsj5/pandorabox/internal/storage"
	"github.com/spf13/cobra"
)

const defaultAPIBase = "http://localhost:7777/api"

type options struct {
	API      string
	JSON     bool
	MaxBytes int
}

type client struct {
	base string
	http *http.Client
}

type proxyStatus struct {
	Running          bool `json:"running"`
	Port             int  `json:"port"`
	InterceptEnabled bool `json:"intercept_enabled"`
	RequestCount     int  `json:"request_count"`
	QueueLength      int  `json:"queue_length"`
}

type projectInfo struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsTemp      bool   `json:"is_temp"`
	MCPDisabled bool   `json:"mcp_disabled"`
	MCPPort     int    `json:"mcp_port,omitempty"`
	MCPStatus   struct {
		Running       bool   `json:"running"`
		AccessEnabled bool   `json:"access_enabled"`
		LastError     string `json:"last_error,omitempty"`
	} `json:"mcp_status"`
	Proxy struct {
		Port             int    `json:"port"`
		InterceptEnabled bool   `json:"intercept_enabled"`
		UpstreamURL      string `json:"upstream_url,omitempty"`
	} `json:"proxy"`
}

type requestListResponse struct {
	Requests []*storage.Request `json:"requests"`
	Total    int                `json:"total"`
}

type replayListResponse struct {
	Replays []*storage.Replay `json:"replays"`
	Total   int               `json:"total"`
}

type interceptQueueResponse struct {
	Queue []interceptItem `json:"queue"`
}

type interceptItem struct {
	RequestID int64            `json:"request_id"`
	Kind      string           `json:"kind"`
	Raw       string           `json:"raw"`
	Request   *storage.Request `json:"request"`
}

type wsFramesResponse struct {
	Session *storage.WebSocketSession `json:"session"`
	Frames  []*storage.WebSocketFrame `json:"frames"`
}

// AddCommands installs the compact, REST-backed command surface used by agents.
func AddCommands(root *cobra.Command) {
	root.AddCommand(
		newStatusCommand(),
		newTrafficCommand(),
		newReplayCommand(),
		newInterceptCommand(),
		newProjectCommand(),
		newScopeCommand(),
		newMatchReplaceCommand(),
		newMiddlewareCommand(),
		newConverterCommand(),
		newOrganizerCommand(),
		newFlowsCommand(),
		newIntruderCommand(),
		newCollaboratorCommand(),
	)
}

func newOptions() *options {
	api := os.Getenv("PANDORABOX_API")
	if api == "" {
		api = defaultAPIBase
	}
	return &options{API: api, MaxBytes: 4096}
}

func addCommonFlags(cmd *cobra.Command, opts *options) {
	cmd.PersistentFlags().StringVar(&opts.API, "api", opts.API, "PandoraBox API base URL")
	cmd.PersistentFlags().BoolVar(&opts.JSON, "json", false, "Print raw JSON response")
}

func addMaxBytesFlag(cmd *cobra.Command, opts *options) {
	cmd.Flags().IntVar(&opts.MaxBytes, "max-bytes", opts.MaxBytes, "Maximum body/raw bytes to print in text mode")
}

func newStatusCommand() *cobra.Command {
	opts := newOptions()
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Print compact proxy/project status",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var status proxyStatus
			if _, err := c.get(cmd.Context(), "/proxy/status", nil, &status); err != nil {
				return err
			}
			var project projectInfo
			projectRaw, projectErr := c.get(cmd.Context(), "/project", nil, &project)
			if opts.JSON {
				out := map[string]any{"proxy": status}
				if projectErr == nil {
					out["project"] = project
				} else {
					out["project_error"] = projectErr.Error()
				}
				return printCompactJSON(out)
			}
			projectName := "-"
			projectPath := "-"
			if projectErr == nil && len(projectRaw) > 0 {
				projectName = quote(project.Name)
				projectPath = project.Path
			}
			mcpState := "legacy-off"
			if project.MCPStatus.Running {
				if project.MCPStatus.AccessEnabled {
					mcpState = "legacy-on"
				} else {
					mcpState = "legacy-blocked"
				}
			}
			fmt.Printf("proxy=%s port=%d intercept=%s queue=%d requests=%d project=%s path=%s agent=cli mcp=%s\n",
				onOff(status.Running), status.Port, onOff(status.InterceptEnabled), status.QueueLength, status.RequestCount,
				projectName, projectPath, mcpState)
			return nil
		},
	}
	addCommonFlags(cmd, opts)
	return cmd
}

func newTrafficCommand() *cobra.Command {
	opts := newOptions()
	cmd := &cobra.Command{
		Use:   "traffic",
		Short: "Inspect captured HTTP/WebSocket traffic",
	}
	addCommonFlags(cmd, opts)
	cmd.AddCommand(
		newTrafficListCommand(opts),
		newTrafficGetCommand(opts),
		newTrafficDeleteCommand(opts),
		newTrafficClearCommand(opts),
		newTrafficWSCommand(opts),
	)
	return cmd
}

func newTrafficListCommand(opts *options) *cobra.Command {
	var limit, offset, statusMin, statusMax int
	var host, method, search string
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List captured requests compactly",
		RunE: func(cmd *cobra.Command, args []string) error {
			if limit <= 0 {
				limit = 20
			}
			if limit > 500 {
				limit = 500
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			q := url.Values{}
			q.Set("limit", strconv.Itoa(limit))
			if offset > 0 {
				q.Set("offset", strconv.Itoa(offset))
			}
			setQuery(q, "host", host)
			setQuery(q, "method", strings.ToUpper(method))
			setQuery(q, "search", search)
			if statusMin > 0 {
				q.Set("status_min", strconv.Itoa(statusMin))
			}
			if statusMax > 0 {
				q.Set("status_max", strconv.Itoa(statusMax))
			}
			var out requestListResponse
			raw, err := c.get(cmd.Context(), "/requests", q, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("total=%d shown=%d offset=%d\n", out.Total, len(out.Requests), offset)
			for _, req := range out.Requests {
				fmt.Println(formatRequestLine(req))
			}
			return nil
		},
	}
	cmd.Flags().IntVarP(&limit, "limit", "n", 20, "Maximum rows to print")
	cmd.Flags().IntVar(&offset, "offset", 0, "Rows to skip")
	cmd.Flags().StringVar(&host, "host", "", "Host substring filter")
	cmd.Flags().StringVar(&method, "method", "", "HTTP method filter")
	cmd.Flags().StringVar(&search, "search", "", "Metadata search filter")
	cmd.Flags().IntVar(&statusMin, "status-min", 0, "Minimum response status")
	cmd.Flags().IntVar(&statusMax, "status-max", 0, "Maximum response status")
	return cmd
}

func newTrafficGetCommand(opts *options) *cobra.Command {
	var showHeaders, showRaw bool
	var bodyMode string
	cmd := &cobra.Command{
		Use:   "get <id>",
		Short: "Get one captured request with bounded output",
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
			var req storage.Request
			raw, err := c.get(cmd.Context(), fmt.Sprintf("/requests/%d", id), nil, &req)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			printRequestSummary(&req)
			if showHeaders {
				printHeaders("request.headers", req.Headers)
				if req.Response != nil {
					printHeaders("response.headers", req.Response.Headers)
				}
			}
			if showRaw {
				printBytes("request.raw", req.Raw, opts.MaxBytes)
				if req.Response != nil {
					printBytes("response.raw", req.Response.Raw, opts.MaxBytes)
				}
			}
			switch bodyMode {
			case "", "none":
			case "request", "req":
				printBytes("request.body", req.Body, opts.MaxBytes)
			case "response", "res":
				if req.Response != nil {
					printBytes("response.body", req.Response.Body, opts.MaxBytes)
				}
			case "both", "all":
				printBytes("request.body", req.Body, opts.MaxBytes)
				if req.Response != nil {
					printBytes("response.body", req.Response.Body, opts.MaxBytes)
				}
			default:
				return fmt.Errorf("invalid --body value %q (use none, request, response, both)", bodyMode)
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&showHeaders, "headers", false, "Print request and response headers")
	cmd.Flags().BoolVar(&showRaw, "raw", false, "Print raw request/response packets")
	cmd.Flags().StringVar(&bodyMode, "body", "none", "Body output: none, request, response, both")
	addMaxBytesFlag(cmd, opts)
	return cmd
}

func newTrafficDeleteCommand(opts *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete one captured request",
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
			raw, err := c.do(cmd.Context(), http.MethodDelete, fmt.Sprintf("/requests/%d", id), nil, nil, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("deleted request=%d\n", id)
			return nil
		},
	}
	return cmd
}

func newTrafficClearCommand(opts *options) *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "clear",
		Short: "Clear all captured traffic",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !yes {
				return fmt.Errorf("refusing to clear all traffic without --yes")
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			raw, err := c.post(cmd.Context(), "/requests/clear", nil, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Println("cleared traffic")
			return nil
		},
	}
	cmd.Flags().BoolVar(&yes, "yes", false, "Confirm destructive clear")
	return cmd
}

func newTrafficWSCommand(opts *options) *cobra.Command {
	var limit int
	var direction string
	cmd := &cobra.Command{
		Use:   "ws <request-id>",
		Short: "Print WebSocket frames for an upgrade request",
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
			var out wsFramesResponse
			raw, err := c.get(cmd.Context(), fmt.Sprintf("/requests/%d/ws-frames", id), nil, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			if out.Session == nil {
				fmt.Printf("request=%d websocket=no\n", id)
				return nil
			}
			printed := 0
			fmt.Printf("request=%d session=%d frames=%d\n", id, out.Session.ID, len(out.Frames))
			for _, frame := range out.Frames {
				if direction != "" && frame.Direction != direction {
					continue
				}
				if limit > 0 && printed >= limit {
					break
				}
				payload := boundedBytes(frame.Payload, opts.MaxBytes)
				fmt.Printf("%d %s opcode=%d len=%d truncated=%t payload=%s\n",
					frame.ID, frame.Direction, frame.Opcode, frame.Length, frame.Truncated, payload)
				printed++
			}
			return nil
		},
	}
	cmd.Flags().IntVarP(&limit, "limit", "n", 50, "Maximum frames to print")
	cmd.Flags().StringVar(&direction, "direction", "", "Filter direction: c2s or s2c")
	addMaxBytesFlag(cmd, opts)
	return cmd
}

func newReplayCommand() *cobra.Command {
	opts := newOptions()
	cmd := &cobra.Command{
		Use:   "replay",
		Short: "Replay captured or raw HTTP requests",
	}
	addCommonFlags(cmd, opts)
	cmd.AddCommand(newReplaySendCommand(opts), newReplayListCommand(opts), newReplayGetCommand(opts))
	return cmd
}

func newReplaySendCommand(opts *options) *cobra.Command {
	var rawFile, scheme string
	var fromStdin bool
	cmd := &cobra.Command{
		Use:   "send [request-id]",
		Short: "Replay a captured request or raw packet",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			body := map[string]any{"request_id": int64(0)}
			if len(args) == 1 {
				id, err := parseID(args[0])
				if err != nil {
					return err
				}
				body["request_id"] = id
			}
			if rawFile != "" || fromStdin {
				raw, err := readInput(rawFile, fromStdin)
				if err != nil {
					return err
				}
				body["raw"] = base64.StdEncoding.EncodeToString(raw)
				if len(args) == 0 {
					body["request_id"] = int64(0)
				}
			}
			if len(args) == 0 && rawFile == "" && !fromStdin {
				return fmt.Errorf("provide a request id, --file, or --stdin")
			}
			if scheme != "" {
				if scheme != "http" && scheme != "https" {
					return fmt.Errorf("--scheme must be http or https")
				}
				body["scheme"] = scheme
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var replay storage.Replay
			raw, err := c.post(cmd.Context(), "/replay", body, &replay)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			printReplaySummary(&replay)
			if replay.Response != nil {
				printBytes("response.body", replay.Response.Body, opts.MaxBytes)
			}
			return nil
		},
	}
	cmd.Flags().StringVarP(&rawFile, "file", "f", "", "Read raw HTTP request from file")
	cmd.Flags().BoolVar(&fromStdin, "stdin", false, "Read raw HTTP request from stdin")
	cmd.Flags().StringVar(&scheme, "scheme", "", "Override scheme for raw/captured replay: http or https")
	addMaxBytesFlag(cmd, opts)
	return cmd
}

func newReplayListCommand(opts *options) *cobra.Command {
	var limit, offset int
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List replay results compactly",
		RunE: func(cmd *cobra.Command, args []string) error {
			if limit <= 0 {
				limit = 20
			}
			if limit > 500 {
				limit = 500
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			q := url.Values{}
			q.Set("limit", strconv.Itoa(limit))
			if offset > 0 {
				q.Set("offset", strconv.Itoa(offset))
			}
			var out replayListResponse
			raw, err := c.get(cmd.Context(), "/replays", q, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("total=%d shown=%d offset=%d\n", out.Total, len(out.Replays), offset)
			for _, replay := range out.Replays {
				fmt.Println(formatReplayLine(replay))
			}
			return nil
		},
	}
	cmd.Flags().IntVarP(&limit, "limit", "n", 20, "Maximum rows to print")
	cmd.Flags().IntVar(&offset, "offset", 0, "Rows to skip")
	return cmd
}

func newReplayGetCommand(opts *options) *cobra.Command {
	var showBody bool
	cmd := &cobra.Command{
		Use:   "get <id>",
		Short: "Get one replay result",
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
			var replay storage.Replay
			raw, err := c.get(cmd.Context(), fmt.Sprintf("/replay/%d", id), nil, &replay)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			printReplaySummary(&replay)
			if showBody && replay.Response != nil {
				printBytes("response.body", replay.Response.Body, opts.MaxBytes)
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&showBody, "body", false, "Print response body")
	addMaxBytesFlag(cmd, opts)
	return cmd
}

func newInterceptCommand() *cobra.Command {
	opts := newOptions()
	cmd := &cobra.Command{
		Use:   "intercept",
		Short: "Control the intercept queue",
	}
	addCommonFlags(cmd, opts)
	cmd.AddCommand(
		newInterceptStatusCommand(opts),
		newInterceptToggleCommand(opts),
		newInterceptQueueCommand(opts),
		newInterceptGetCommand(opts),
		newInterceptForwardCommand(opts),
		newInterceptDropCommand(opts),
		newInterceptForwardAllCommand(opts),
		newInterceptDropAllCommand(opts),
		newInterceptModifyCommand(opts),
	)
	return cmd
}

func newInterceptStatusCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Print intercept status",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var status proxyStatus
			raw, err := c.get(cmd.Context(), "/proxy/status", nil, &status)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("intercept=%s queue=%d\n", onOff(status.InterceptEnabled), status.QueueLength)
			return nil
		},
	}
}

func newInterceptToggleCommand(opts *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "toggle <on|off>",
		Short: "Enable or disable interception",
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
			raw, err := c.put(cmd.Context(), "/intercept/toggle", map[string]bool{"enabled": enabled}, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("intercept=%s\n", onOff(enabled))
			return nil
		},
	}
	return cmd
}

func newInterceptQueueCommand(opts *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "queue",
		Short: "List held intercept entries",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var out interceptQueueResponse
			raw, err := c.get(cmd.Context(), "/intercept/queue", nil, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("queue=%d\n", len(out.Queue))
			for _, item := range out.Queue {
				fmt.Println(formatInterceptLine(item))
			}
			return nil
		},
	}
	return cmd
}

func newInterceptGetCommand(opts *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "get <request-id>",
		Short: "Print a held raw packet",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := parseID(args[0])
			if err != nil {
				return err
			}
			item, rawJSON, err := getInterceptItem(cmd.Context(), opts.API, id)
			if err != nil {
				return err
			}
			if opts.JSON {
				return printCompactJSON(rawJSON)
			}
			raw, err := base64.StdEncoding.DecodeString(item.Raw)
			if err != nil {
				return err
			}
			fmt.Printf("request=%d kind=%s bytes=%d\n", item.RequestID, item.Kind, len(raw))
			printBytes("packet.raw", raw, opts.MaxBytes)
			return nil
		},
	}
	addMaxBytesFlag(cmd, opts)
	return cmd
}

func newInterceptForwardCommand(opts *options) *cobra.Command {
	return interceptResolveCommand(opts, "forward", "/intercept/forward/%d", "forwarded")
}

func newInterceptDropCommand(opts *options) *cobra.Command {
	return interceptResolveCommand(opts, "drop", "/intercept/drop/%d", "dropped")
}

func interceptResolveCommand(opts *options, name, pathFormat, done string) *cobra.Command {
	return &cobra.Command{
		Use:   name + " <request-id>",
		Short: strings.Title(done) + " one held entry",
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
			raw, err := c.post(cmd.Context(), fmt.Sprintf(pathFormat, id), nil, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("%s request=%d\n", done, id)
			return nil
		},
	}
}

func newInterceptForwardAllCommand(opts *options) *cobra.Command {
	return interceptAllCommand(opts, "forward-all", "/intercept/forward-all", "forwarded")
}

func newInterceptDropAllCommand(opts *options) *cobra.Command {
	return interceptAllCommand(opts, "drop-all", "/intercept/drop-all", "dropped")
}

func interceptAllCommand(opts *options, name, path, field string) *cobra.Command {
	return &cobra.Command{
		Use:   name,
		Short: strings.Title(field) + " every held entry",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var out map[string]int
			raw, err := c.post(cmd.Context(), path, nil, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("%s=%d\n", field, out[field])
			return nil
		},
	}
}

func newInterceptModifyCommand(opts *options) *cobra.Command {
	var rawFile string
	var fromStdin bool
	cmd := &cobra.Command{
		Use:   "modify <request-id>",
		Short: "Forward a held entry with a modified raw packet",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := parseID(args[0])
			if err != nil {
				return err
			}
			rawPacket, err := readInput(rawFile, fromStdin)
			if err != nil {
				return err
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			body := map[string]string{"raw": base64.StdEncoding.EncodeToString(rawPacket)}
			raw, err := c.post(cmd.Context(), fmt.Sprintf("/intercept/modify/%d", id), body, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("modified-forward request=%d bytes=%d\n", id, len(rawPacket))
			return nil
		},
	}
	cmd.Flags().StringVarP(&rawFile, "file", "f", "", "Read modified raw packet from file")
	cmd.Flags().BoolVar(&fromStdin, "stdin", false, "Read modified raw packet from stdin")
	return cmd
}

func newProjectCommand() *cobra.Command {
	opts := newOptions()
	cmd := &cobra.Command{
		Use:   "project",
		Short: "Inspect and switch PandoraBox projects",
	}
	addCommonFlags(cmd, opts)
	cmd.AddCommand(newProjectGetCommand(opts), newProjectRecentCommand(opts), newProjectOpenCommand(opts), newProjectNewCommand(opts))
	return cmd
}

func newProjectGetCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "get",
		Short: "Print the current project",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var project projectInfo
			raw, err := c.get(cmd.Context(), "/project", nil, &project)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("name=%s path=%s temp=%t proxy_port=%d intercept=%s mcp_legacy=%s\n",
				quote(project.Name), project.Path, project.IsTemp, project.Proxy.Port,
				onOff(project.Proxy.InterceptEnabled), onOff(project.MCPStatus.Running))
			return nil
		},
	}
}

func newProjectRecentCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "recent",
		Short: "List recent projects",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var out []map[string]any
			raw, err := c.get(cmd.Context(), "/project/recent", nil, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			for _, p := range out {
				fmt.Printf("name=%s exists=%v path=%v\n", quote(fmt.Sprint(p["name"])), p["exists"], p["path"])
			}
			return nil
		},
	}
}

func newProjectOpenCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "open <path>",
		Short: "Open an existing project",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var project projectInfo
			raw, err := c.post(cmd.Context(), "/project/open", map[string]string{"path": args[0]}, &project)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("opened name=%s path=%s\n", quote(project.Name), project.Path)
			return nil
		},
	}
}

func newProjectNewCommand(opts *options) *cobra.Command {
	var name string
	cmd := &cobra.Command{
		Use:   "new <path>",
		Short: "Create and open a new project",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if name == "" {
				name = "PandoraBox Project"
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var project projectInfo
			raw, err := c.post(cmd.Context(), "/project/new", map[string]string{"path": args[0], "name": name}, &project)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("created name=%s path=%s\n", quote(project.Name), project.Path)
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Project name")
	return cmd
}

func newClient(rawBase string) (*client, error) {
	if rawBase == "" {
		rawBase = defaultAPIBase
	}
	if !strings.Contains(rawBase, "://") {
		rawBase = "http://" + rawBase
	}
	u, err := url.Parse(rawBase)
	if err != nil {
		return nil, err
	}
	if u.Path == "" || u.Path == "/" {
		u.Path = "/api"
	}
	return &client{
		base: strings.TrimRight(u.String(), "/"),
		http: &http.Client{Timeout: 90 * time.Second},
	}, nil
}

func (c *client) get(ctx context.Context, path string, q url.Values, out any) ([]byte, error) {
	return c.do(ctx, http.MethodGet, path, q, nil, out)
}

func (c *client) post(ctx context.Context, path string, body any, out any) ([]byte, error) {
	return c.do(ctx, http.MethodPost, path, nil, body, out)
}

func (c *client) put(ctx context.Context, path string, body any, out any) ([]byte, error) {
	return c.do(ctx, http.MethodPut, path, nil, body, out)
}

func (c *client) do(ctx context.Context, method, path string, q url.Values, body any, out any) ([]byte, error) {
	var r io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		r = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.url(path, q), r)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("connect to PandoraBox API: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s %s: %s", method, path, apiErrorText(data, resp.Status))
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return nil, err
		}
	}
	return data, nil
}

func (c *client) url(path string, q url.Values) string {
	u := c.base + "/" + strings.TrimLeft(path, "/")
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	return u
}

func getInterceptItem(ctx context.Context, api string, id int64) (interceptItem, any, error) {
	c, err := newClient(api)
	if err != nil {
		return interceptItem{}, nil, err
	}
	var out interceptQueueResponse
	if _, err := c.get(ctx, "/intercept/queue", nil, &out); err != nil {
		return interceptItem{}, nil, err
	}
	for _, item := range out.Queue {
		if item.RequestID == id {
			return item, item, nil
		}
	}
	return interceptItem{}, nil, fmt.Errorf("request %d is not in the intercept queue", id)
}

func printCompactJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	fmt.Println(string(data))
	return nil
}

func printRequestSummary(req *storage.Request) {
	status := "status=-"
	duration := ""
	size := ""
	if req.Response != nil {
		status = fmt.Sprintf("status=%d", req.Response.StatusCode)
		if req.Response.StatusText != "" {
			status += " " + shellToken(req.Response.StatusText)
		}
		duration = fmt.Sprintf(" duration_ms=%d", req.Response.DurationMs)
		size = fmt.Sprintf(" size=%s", humanBytes(req.Response.SizeBytes))
	}
	fmt.Printf("id=%d %s %s %s%s req_body=%s",
		req.ID, req.Method, displayURL(req), status, duration, humanBytes(int64(len(req.Body))))
	if req.Response != nil {
		fmt.Printf(" res_body=%s%s", humanBytes(int64(len(req.Response.Body))), size)
	}
	fmt.Println()
}

func printReplaySummary(replay *storage.Replay) {
	status := replay.Status
	if status == "" {
		status = "-"
	}
	req := "-"
	if replay.Request != nil {
		req = fmt.Sprintf("%s %s", replay.Request.Method, displayURL(replay.Request))
	}
	resp := "response=-"
	if replay.Response != nil {
		resp = fmt.Sprintf("response=%d duration_ms=%d size=%s",
			replay.Response.StatusCode, replay.Response.DurationMs, humanBytes(replay.Response.SizeBytes))
	}
	errText := ""
	if replay.Error != "" {
		errText = " error=" + quote(replay.Error)
	}
	fmt.Printf("replay=%d status=%s origin=%s request=%s %s%s\n",
		replay.ID, status, optionalID(replay.OriginRequestID), quote(req), resp, errText)
}

func formatRequestLine(req *storage.Request) string {
	status := "-"
	size := "-"
	if req.Response != nil {
		status = strconv.Itoa(req.Response.StatusCode)
		size = humanBytes(req.Response.SizeBytes)
	}
	return fmt.Sprintf("%d %s %s %s %s", req.ID, req.Method, status, size, truncate(displayURL(req), 140))
}

func formatReplayLine(replay *storage.Replay) string {
	statusCode := "-"
	size := "-"
	if replay.Response != nil {
		statusCode = strconv.Itoa(replay.Response.StatusCode)
		size = humanBytes(replay.Response.SizeBytes)
	}
	target := "-"
	if replay.Request != nil {
		target = displayURL(replay.Request)
	}
	return fmt.Sprintf("%d %s http=%s size=%s origin=%s %s",
		replay.ID, replay.Status, statusCode, size, optionalID(replay.OriginRequestID), truncate(target, 140))
}

func formatInterceptLine(item interceptItem) string {
	target := "-"
	if item.Request != nil {
		target = displayURL(item.Request)
	}
	return fmt.Sprintf("%d %s %s", item.RequestID, item.Kind, truncate(target, 140))
}

func printHeaders(label, headerJSON string) {
	headers := map[string][]string{}
	if err := json.Unmarshal([]byte(headerJSON), &headers); err != nil {
		fmt.Printf("%s: %s\n", label, headerJSON)
		return
	}
	fmt.Println(label + ":")
	for k, vals := range headers {
		fmt.Printf("%s: %s\n", k, strings.Join(vals, ", "))
	}
}

func printBytes(label string, b []byte, max int) {
	fmt.Printf("%s bytes=%d", label, len(b))
	if max >= 0 && len(b) > max {
		fmt.Printf(" shown=%d truncated=true", max)
		b = b[:max]
	}
	fmt.Println()
	if len(b) == 0 {
		return
	}
	if utf8.Valid(b) {
		fmt.Println(string(b))
		return
	}
	fmt.Println(base64.StdEncoding.EncodeToString(b))
}

func boundedBytes(b []byte, max int) string {
	if len(b) == 0 {
		return ""
	}
	if max >= 0 && len(b) > max {
		b = b[:max]
	}
	if utf8.Valid(b) {
		return quote(string(b))
	}
	return "base64:" + base64.StdEncoding.EncodeToString(b)
}

func displayURL(req *storage.Request) string {
	if req == nil {
		return "-"
	}
	scheme := req.Scheme
	if scheme == "" {
		scheme = "http"
	}
	path := req.Path
	if path == "" {
		path = "/"
	}
	if req.Query != "" {
		path += "?" + req.Query
	}
	return scheme + "://" + req.Host + path
}

func humanBytes(n int64) string {
	if n < 0 {
		return "-"
	}
	if n < 1024 {
		return fmt.Sprintf("%dB", n)
	}
	if n < 1024*1024 {
		return fmt.Sprintf("%.1fK", float64(n)/1024)
	}
	return fmt.Sprintf("%.1fM", float64(n)/(1024*1024))
}

func readInput(path string, fromStdin bool) ([]byte, error) {
	if path != "" && fromStdin {
		return nil, fmt.Errorf("use either --file or --stdin, not both")
	}
	if fromStdin {
		return io.ReadAll(os.Stdin)
	}
	if path == "" {
		return nil, fmt.Errorf("--file or --stdin required")
	}
	return os.ReadFile(path)
}

func apiErrorText(data []byte, fallback string) string {
	var body struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(data, &body) == nil && body.Error != "" {
		return body.Error
	}
	text := strings.TrimSpace(string(data))
	if text == "" {
		return fallback
	}
	return text
}

func parseID(s string) (int64, error) {
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid id %q", s)
	}
	return id, nil
}

func parseOnOff(s string) (bool, error) {
	switch strings.ToLower(s) {
	case "on", "true", "1", "enabled", "enable":
		return true, nil
	case "off", "false", "0", "disabled", "disable":
		return false, nil
	default:
		return false, fmt.Errorf("expected on or off")
	}
}

func setQuery(q url.Values, key, value string) {
	if value != "" {
		q.Set(key, value)
	}
}

func optionalID(id *int64) string {
	if id == nil {
		return "-"
	}
	return strconv.FormatInt(*id, 10)
}

func onOff(v bool) string {
	if v {
		return "on"
	}
	return "off"
}

func quote(s string) string {
	return strconv.Quote(s)
}

func shellToken(s string) string {
	if s == "" {
		return "-"
	}
	return strings.ReplaceAll(s, " ", "_")
}

func truncate(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	if max <= 3 {
		return s[:max]
	}
	return s[:max-3] + "..."
}
