// Package mcp — organizer_tools.go: tools for the organizer (folders + items).
// Migrated to the registry so every tool now goes through the mcpEnabled gate,
// panic-recovery, and unified result envelope.
package mcp

import (
	"context"
	"fmt"

	"github.com/hamedsj5/pandorabox/internal/events"
	"github.com/hamedsj5/pandorabox/internal/storage"
	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerOrganizerTools() {
	s.register(ToolSpec{
		Name:     "organizer_list_folders",
		Category: CatOrganizer,
		Behavior: BehaviorReadOnly,
		Summary:  "List all organizer folders as a nested tree.",
		Description: "Returns both a tree of root folders and a `flat` list. " +
			"Pass `include_items=true` to embed the request items inside each folder.",
		Options: []mcp.ToolOption{
			mcp.WithBoolean("include_items", mcp.Description("Include items (requests) in each folder.")),
		},
		Handler: s.toolOrganizerListFolders,
	})

	s.register(ToolSpec{
		Name:     "organizer_create_folder",
		Category: CatOrganizer,
		Behavior: BehaviorMutating,
		Summary:  "Create a new organizer folder.",
		Options: []mcp.ToolOption{
			mcp.WithString("name", mcp.Description("Folder name (default \"New Folder\").")),
			mcp.WithString("color", mcp.Description("Color: teal, blue, purple, indigo, pink, red, orange, yellow, green, cyan.")),
			mcp.WithString("icon", mcp.Description("Icon: Folder, FolderOpen, Star, Bookmark, Flag, Target, Zap, Shield, Bug, FlaskConical, Lock, Globe, Code, Database, Server.")),
			mcp.WithString("note", mcp.Description("Markdown note.")),
			mcp.WithNumber("parent_id", mcp.Description("Parent folder id (omit for root).")),
			mcp.WithNumber("sort_order", mcp.Description("Position among siblings.")),
		},
		Handler: s.toolOrganizerCreateFolder,
	})

	s.register(ToolSpec{
		Name:     "organizer_update_folder",
		Category: CatOrganizer,
		Behavior: BehaviorMutating,
		Summary:  "Update a folder's name, color, icon, note, parent or sort order.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("id", mcp.Description("Folder id."), mcp.Required()),
			mcp.WithString("name", mcp.Description("New name.")),
			mcp.WithString("color", mcp.Description("New color.")),
			mcp.WithString("icon", mcp.Description("New icon.")),
			mcp.WithString("note", mcp.Description("New markdown note.")),
			mcp.WithNumber("parent_id", mcp.Description("New parent (-1 to move to root).")),
			mcp.WithNumber("sort_order", mcp.Description("New position.")),
		},
		Handler: s.toolOrganizerUpdateFolder,
	})

	s.register(ToolSpec{
		Name:     "organizer_delete_folder",
		Category: CatOrganizer,
		Behavior: BehaviorDestructive,
		Summary:  "Delete a folder and all its descendants.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("id", mcp.Description("Folder id."), mcp.Required()),
		},
		Handler: s.toolOrganizerDeleteFolder,
	})

	s.register(ToolSpec{
		Name:     "organizer_reorder_folders",
		Category: CatOrganizer,
		Behavior: BehaviorMutating,
		Summary:  "Reorder folders by passing a list of {id, sort_order} updates.",
		Options: []mcp.ToolOption{
			mcp.WithArray("updates", mcp.Description(`Array of {id, sort_order} objects, e.g. [{"id":1,"sort_order":0},{"id":2,"sort_order":1}].`), mcp.Items(map[string]any{"type": "object"})),
			mcp.WithString("updates_json", mcp.Description("Legacy stringified updates array. Prefer `updates`.")),
		},
		Handler: s.toolOrganizerReorderFolders,
	})

	s.register(ToolSpec{
		Name:     "organizer_add_item",
		Category: CatOrganizer,
		Behavior: BehaviorMutating,
		Summary:  "Add a captured request to an organizer folder.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("folder_id", mcp.Description("Folder id."), mcp.Required()),
			mcp.WithNumber("request_id", mcp.Description("Captured request id."), mcp.Required()),
			mcp.WithString("note", mcp.Description("Markdown note for this item.")),
			mcp.WithNumber("sort_order", mcp.Description("Position within the folder.")),
		},
		Handler: s.toolOrganizerAddItem,
	})

	s.register(ToolSpec{
		Name:     "organizer_update_item",
		Category: CatOrganizer,
		Behavior: BehaviorMutating,
		Summary:  "Update an organizer item's note or sort order.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("id", mcp.Description("Item id."), mcp.Required()),
			mcp.WithString("note", mcp.Description("New markdown note.")),
			mcp.WithNumber("sort_order", mcp.Description("New position.")),
		},
		Handler: s.toolOrganizerUpdateItem,
	})

	s.register(ToolSpec{
		Name:     "organizer_remove_item",
		Category: CatOrganizer,
		Behavior: BehaviorMutating,
		Summary:  "Remove a request from an organizer folder.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("id", mcp.Description("Item id."), mcp.Required()),
		},
		Handler: s.toolOrganizerRemoveItem,
	})

	s.register(ToolSpec{
		Name:     "organizer_list_items",
		Category: CatOrganizer,
		Behavior: BehaviorReadOnly,
		Summary:  "List all request items in one folder.",
		Options: []mcp.ToolOption{
			mcp.WithNumber("folder_id", mcp.Description("Folder id."), mcp.Required()),
		},
		Handler: s.toolOrganizerListItems,
	})
}

// ── Handlers ─────────────────────────────────────────────────────────────────

func (s *Server) toolOrganizerListFolders(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	flat, err := db.ListOrganizerFolders()
	if err != nil {
		return nil, err
	}
	if flat == nil {
		flat = []*storage.OrganizerFolder{}
	}
	if argBool(req, "include_items", false) {
		for _, f := range flat {
			items, err := db.ListOrganizerItems(f.ID)
			if err == nil {
				f.Items = items
			}
		}
	}
	roots := buildOrganizerTree(flat)
	return map[string]any{"folders": roots, "flat": flat}, nil
}

func (s *Server) toolOrganizerCreateFolder(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	f := &storage.OrganizerFolder{Name: "New Folder", Color: "teal", Icon: "Folder"}
	if v := argString(req, "name"); v != "" {
		f.Name = v
	}
	if v := argString(req, "color"); v != "" {
		f.Color = v
	}
	if v := argString(req, "icon"); v != "" {
		f.Icon = v
	}
	if v := argString(req, "note"); v != "" {
		f.Note = v
	}
	if v, ok := argInt64(req, "sort_order"); ok {
		f.SortOrder = int(v)
	}
	if v, ok := argInt64(req, "parent_id"); ok && v > 0 {
		f.ParentID = &v
	}

	id, err := db.CreateOrganizerFolder(f)
	if err != nil {
		return nil, err
	}
	f.ID = id
	if created, _ := db.GetOrganizerFolder(id); created != nil {
		f = created
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerFolderCreated, Data: f})
	return f, nil
}

func (s *Server) toolOrganizerUpdateFolder(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	id, err := argRequiredInt64(req, "id")
	if err != nil {
		return nil, err
	}
	f, err := db.GetOrganizerFolder(id)
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, fmt.Errorf("folder %d not found", id)
	}
	args := req.GetArguments()
	if v, ok := args["name"].(string); ok {
		f.Name = v
	}
	if v, ok := args["color"].(string); ok {
		f.Color = v
	}
	if v, ok := args["icon"].(string); ok {
		f.Icon = v
	}
	if v, ok := args["note"].(string); ok {
		f.Note = v
	}
	if v, ok := argInt64(req, "sort_order"); ok {
		f.SortOrder = int(v)
	}
	if v, ok := argInt64(req, "parent_id"); ok {
		if v < 0 {
			f.ParentID = nil
		} else {
			f.ParentID = &v
		}
	}
	if err := db.UpdateOrganizerFolder(f); err != nil {
		return nil, err
	}
	if updated, _ := db.GetOrganizerFolder(id); updated != nil {
		f = updated
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerFolderUpdated, Data: f})
	return f, nil
}

func (s *Server) toolOrganizerDeleteFolder(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	id, err := argRequiredInt64(req, "id")
	if err != nil {
		return nil, err
	}
	if err := db.DeleteOrganizerFolder(id); err != nil {
		return nil, err
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerFolderDeleted, Data: map[string]int64{"id": id}})
	return map[string]any{"success": true, "deleted_id": id}, nil
}

func (s *Server) toolOrganizerReorderFolders(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	var updates []storage.ReorderFolderUpdate
	present, err := argInto(req, "updates", &updates)
	if !present {
		present, err = argInto(req, "updates_json", &updates)
	}
	if err != nil {
		return nil, err
	}
	if !present {
		return nil, fmt.Errorf("`updates` is required: array of {id, sort_order}")
	}
	if err := db.ReorderOrganizerFolders(updates); err != nil {
		return nil, err
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerFoldersReordered, Data: updates})
	return map[string]any{"success": true}, nil
}

func (s *Server) toolOrganizerAddItem(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	folderID, err := argRequiredInt64(req, "folder_id")
	if err != nil {
		return nil, err
	}
	requestID, err := argRequiredInt64(req, "request_id")
	if err != nil {
		return nil, err
	}
	item := &storage.OrganizerItem{FolderID: folderID, RequestID: requestID}
	if v := argString(req, "note"); v != "" {
		item.Note = v
	}
	if v, ok := argInt64(req, "sort_order"); ok {
		item.SortOrder = int(v)
	}
	id, err := db.AddOrganizerItem(item)
	if err != nil {
		return nil, err
	}
	item.ID = id
	if items, err := db.ListOrganizerItems(item.FolderID); err == nil {
		for _, it := range items {
			if it.ID == id {
				item = it
				break
			}
		}
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerItemAdded, Data: item})
	return item, nil
}

func (s *Server) toolOrganizerUpdateItem(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	id, err := argRequiredInt64(req, "id")
	if err != nil {
		return nil, err
	}
	item, err := db.GetOrganizerItem(id)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, fmt.Errorf("item %d not found", id)
	}
	args := req.GetArguments()
	if v, ok := args["note"].(string); ok {
		item.Note = v
	}
	if v, ok := argInt64(req, "sort_order"); ok {
		item.SortOrder = int(v)
	}
	if err := db.UpdateOrganizerItem(item); err != nil {
		return nil, err
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerItemUpdated, Data: item})
	return item, nil
}

func (s *Server) toolOrganizerRemoveItem(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	id, err := argRequiredInt64(req, "id")
	if err != nil {
		return nil, err
	}
	if err := db.RemoveOrganizerItem(id); err != nil {
		return nil, err
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerItemRemoved, Data: map[string]int64{"id": id}})
	return map[string]any{"success": true, "removed_id": id}, nil
}

func (s *Server) toolOrganizerListItems(ctx context.Context, req mcp.CallToolRequest) (any, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	folderID, err := argRequiredInt64(req, "folder_id")
	if err != nil {
		return nil, err
	}
	items, err := db.ListOrganizerItems(folderID)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []*storage.OrganizerItem{}
	}
	return map[string]any{"items": items}, nil
}

// buildOrganizerTree assembles a flat folder list into a nested tree.
func buildOrganizerTree(flat []*storage.OrganizerFolder) []*storage.OrganizerFolder {
	m := make(map[int64]*storage.OrganizerFolder, len(flat))
	for _, f := range flat {
		clone := *f
		clone.Children = nil
		m[f.ID] = &clone
	}
	var roots []*storage.OrganizerFolder
	for _, f := range flat {
		node := m[f.ID]
		if f.ParentID == nil {
			roots = append(roots, node)
		} else {
			if parent, ok := m[*f.ParentID]; ok {
				parent.Children = append(parent.Children, node)
			} else {
				roots = append(roots, node)
			}
		}
	}
	return roots
}
