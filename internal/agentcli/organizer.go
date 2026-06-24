// SPDX-License-Identifier: Apache-2.0
package agentcli

import (
	"fmt"
	"net/http"

	"github.com/hamedsj5/pandorabox/internal/storage"
	"github.com/spf13/cobra"
)

func newOrganizerCommand() *cobra.Command {
	opts := newOptions()
	cmd := &cobra.Command{
		Use:   "organizer",
		Short: "Organize requests into folders",
	}
	addCommonFlags(cmd, opts)
	cmd.AddCommand(newOrganizerFolderCommand(opts), newOrganizerItemCommand(opts))
	return cmd
}

func newOrganizerFolderCommand(opts *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "folder",
		Short: "Manage organizer folders",
	}
	cmd.AddCommand(
		newOrganizerFolderListCommand(opts),
		newOrganizerFolderCreateCommand(opts),
		newOrganizerFolderDeleteCommand(opts),
	)
	return cmd
}

func newOrganizerFolderListCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List organizer folders",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var out struct {
				Flat []*storage.OrganizerFolder `json:"flat"`
			}
			raw, err := c.get(cmd.Context(), "/organizer/folders", nil, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("total=%d\n", len(out.Flat))
			for _, f := range out.Flat {
				parent := "-"
				if f.ParentID != nil {
					parent = fmt.Sprintf("%d", *f.ParentID)
				}
				fmt.Printf("  id=%d parent=%s name=%s\n", f.ID, parent, quote(f.Name))
			}
			return nil
		},
	}
}

func newOrganizerFolderCreateCommand(opts *options) *cobra.Command {
	var name, color, icon, note string
	var parentID int64
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create an organizer folder",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			body := map[string]any{"name": name, "color": color, "icon": icon, "note": note}
			if parentID > 0 {
				body["parent_id"] = parentID
			}
			var folder storage.OrganizerFolder
			raw, err := c.post(cmd.Context(), "/organizer/folders", body, &folder)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("created folder id=%d name=%s\n", folder.ID, quote(folder.Name))
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "New Folder", "Folder name")
	cmd.Flags().StringVar(&color, "color", "teal", "Folder color")
	cmd.Flags().StringVar(&icon, "icon", "Folder", "Folder icon")
	cmd.Flags().StringVar(&note, "note", "", "Folder note")
	cmd.Flags().Int64Var(&parentID, "parent", 0, "Parent folder id (0 = root)")
	return cmd
}

func newOrganizerFolderDeleteCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete an organizer folder",
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
			raw, err := c.do(cmd.Context(), http.MethodDelete, fmt.Sprintf("/organizer/folders/%d", id), nil, nil, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("deleted folder %d\n", id)
			return nil
		},
	}
}

func newOrganizerItemCommand(opts *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "item",
		Short: "Manage items inside organizer folders",
	}
	cmd.AddCommand(
		newOrganizerItemAddCommand(opts),
		newOrganizerItemListCommand(opts),
		newOrganizerItemRemoveCommand(opts),
	)
	return cmd
}

func newOrganizerItemAddCommand(opts *options) *cobra.Command {
	var requestID int64
	var note string
	cmd := &cobra.Command{
		Use:   "add <folder-id>",
		Short: "Add a captured request to a folder",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			folderID, err := parseID(args[0])
			if err != nil {
				return err
			}
			if requestID <= 0 {
				return fmt.Errorf("--request-id is required")
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var item storage.OrganizerItem
			raw, err := c.post(cmd.Context(), fmt.Sprintf("/organizer/folders/%d/items", folderID), map[string]any{
				"request_id": requestID, "note": note,
			}, &item)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("added item id=%d folder=%d request=%d\n", item.ID, folderID, requestID)
			return nil
		},
	}
	cmd.Flags().Int64Var(&requestID, "request-id", 0, "Captured request id to add")
	cmd.Flags().StringVar(&note, "note", "", "Item note")
	return cmd
}

func newOrganizerItemListCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "list <folder-id>",
		Short: "List items in a folder",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			folderID, err := parseID(args[0])
			if err != nil {
				return err
			}
			c, err := newClient(opts.API)
			if err != nil {
				return err
			}
			var out struct {
				Items []*storage.OrganizerItem `json:"items"`
			}
			raw, err := c.get(cmd.Context(), fmt.Sprintf("/organizer/folders/%d/items", folderID), nil, &out)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("total=%d\n", len(out.Items))
			for _, it := range out.Items {
				fmt.Printf("  id=%d request=%d note=%s\n", it.ID, it.RequestID, quote(it.Note))
			}
			return nil
		},
	}
}

func newOrganizerItemRemoveCommand(opts *options) *cobra.Command {
	return &cobra.Command{
		Use:   "remove <id>",
		Short: "Remove an item from its folder",
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
			raw, err := c.do(cmd.Context(), http.MethodDelete, fmt.Sprintf("/organizer/items/%d", id), nil, nil, nil)
			if err != nil {
				return err
			}
			if opts.JSON {
				fmt.Print(string(raw))
				return nil
			}
			fmt.Printf("removed item %d\n", id)
			return nil
		},
	}
}
