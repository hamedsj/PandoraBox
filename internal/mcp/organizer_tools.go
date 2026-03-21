package mcp

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hamedsj5/pandorabox/internal/events"
	"github.com/hamedsj5/pandorabox/internal/storage"
	"github.com/mark3labs/mcp-go/mcp"
)

func (s *Server) registerOrganizerTools() {
	s.mcp.AddTool(mcp.NewTool("organizer_list_folders",
		mcp.WithDescription("List all organizer folders as a nested tree. Optionally include items (requests) in each folder."),
		mcp.WithBoolean("include_items", mcp.Description("Include items (requests) in each folder")),
	), s.toolOrganizerListFolders)

	s.mcp.AddTool(mcp.NewTool("organizer_create_folder",
		mcp.WithDescription("Create a new organizer folder"),
		mcp.WithString("name", mcp.Description("Folder name")),
		mcp.WithString("color", mcp.Description(`Color: teal, blue, purple, indigo, pink, red, orange, yellow, green, cyan`)),
		mcp.WithString("icon", mcp.Description(`Icon name: Folder, FolderOpen, Star, Bookmark, Flag, Target, Zap, Shield, Bug, FlaskConical, Lock, Globe, Code, Database, Server`)),
		mcp.WithString("note", mcp.Description("Markdown note for the folder")),
		mcp.WithNumber("parent_id", mcp.Description("Parent folder ID (omit for root)")),
		mcp.WithNumber("sort_order", mcp.Description("Sort order position")),
	), s.toolOrganizerCreateFolder)

	s.mcp.AddTool(mcp.NewTool("organizer_update_folder",
		mcp.WithDescription("Update an existing organizer folder (name, color, icon, note, parent, sort_order)"),
		mcp.WithNumber("id", mcp.Description("Folder ID"), mcp.Required()),
		mcp.WithString("name", mcp.Description("New folder name")),
		mcp.WithString("color", mcp.Description("New color")),
		mcp.WithString("icon", mcp.Description("New icon name")),
		mcp.WithString("note", mcp.Description("New markdown note")),
		mcp.WithNumber("parent_id", mcp.Description("New parent folder ID (-1 to move to root)")),
		mcp.WithNumber("sort_order", mcp.Description("New sort order")),
	), s.toolOrganizerUpdateFolder)

	s.mcp.AddTool(mcp.NewTool("organizer_delete_folder",
		mcp.WithDescription("Delete an organizer folder and all its descendants"),
		mcp.WithNumber("id", mcp.Description("Folder ID"), mcp.Required()),
	), s.toolOrganizerDeleteFolder)

	s.mcp.AddTool(mcp.NewTool("organizer_reorder_folders",
		mcp.WithDescription(`Reorder organizer folders. Pass updates as a JSON array: [{"id":1,"sort_order":0},{"id":2,"sort_order":1}]`),
		mcp.WithString("updates", mcp.Description(`JSON array of {id, sort_order} objects`), mcp.Required()),
	), s.toolOrganizerReorderFolders)

	s.mcp.AddTool(mcp.NewTool("organizer_add_item",
		mcp.WithDescription("Add a captured request to an organizer folder"),
		mcp.WithNumber("folder_id", mcp.Description("Folder ID"), mcp.Required()),
		mcp.WithNumber("request_id", mcp.Description("Request ID"), mcp.Required()),
		mcp.WithString("note", mcp.Description("Optional markdown note for this item")),
		mcp.WithNumber("sort_order", mcp.Description("Sort order")),
	), s.toolOrganizerAddItem)

	s.mcp.AddTool(mcp.NewTool("organizer_update_item",
		mcp.WithDescription("Update the note or sort order of an organizer item"),
		mcp.WithNumber("id", mcp.Description("Item ID"), mcp.Required()),
		mcp.WithString("note", mcp.Description("New markdown note")),
		mcp.WithNumber("sort_order", mcp.Description("New sort order")),
	), s.toolOrganizerUpdateItem)

	s.mcp.AddTool(mcp.NewTool("organizer_remove_item",
		mcp.WithDescription("Remove a request from an organizer folder"),
		mcp.WithNumber("id", mcp.Description("Item ID"), mcp.Required()),
	), s.toolOrganizerRemoveItem)

	s.mcp.AddTool(mcp.NewTool("organizer_list_items",
		mcp.WithDescription("List all requests in an organizer folder"),
		mcp.WithNumber("folder_id", mcp.Description("Folder ID"), mcp.Required()),
	), s.toolOrganizerListItems)
}

func (s *Server) toolOrganizerListFolders(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
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

	includeItems, _ := req.Params.Arguments["include_items"].(bool)
	if includeItems {
		for _, f := range flat {
			items, err := db.ListOrganizerItems(f.ID)
			if err == nil {
				f.Items = items
			}
		}
	}

	roots := buildOrganizerTree(flat)
	return jsonResult(map[string]interface{}{
		"folders": roots,
		"flat":    flat,
	})
}

func (s *Server) toolOrganizerCreateFolder(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	args := req.Params.Arguments
	f := &storage.OrganizerFolder{
		Name:  "New Folder",
		Color: "teal",
		Icon:  "Folder",
	}
	if v, ok := args["name"].(string); ok && v != "" {
		f.Name = v
	}
	if v, ok := args["color"].(string); ok && v != "" {
		f.Color = v
	}
	if v, ok := args["icon"].(string); ok && v != "" {
		f.Icon = v
	}
	if v, ok := args["note"].(string); ok {
		f.Note = v
	}
	if v, ok := args["sort_order"].(float64); ok {
		f.SortOrder = int(v)
	}
	if v, ok := args["parent_id"].(float64); ok && v > 0 {
		pid := int64(v)
		f.ParentID = &pid
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
	return jsonResult(f)
}

func (s *Server) toolOrganizerUpdateFolder(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	args := req.Params.Arguments
	idF, ok := args["id"].(float64)
	if !ok {
		return nil, fmt.Errorf("id is required")
	}
	id := int64(idF)
	f, err := db.GetOrganizerFolder(id)
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, fmt.Errorf("folder %d not found", id)
	}
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
	if v, ok := args["sort_order"].(float64); ok {
		f.SortOrder = int(v)
	}
	if v, ok := args["parent_id"].(float64); ok {
		if v < 0 {
			f.ParentID = nil
		} else {
			pid := int64(v)
			f.ParentID = &pid
		}
	}
	if err := db.UpdateOrganizerFolder(f); err != nil {
		return nil, err
	}
	if updated, _ := db.GetOrganizerFolder(id); updated != nil {
		f = updated
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerFolderUpdated, Data: f})
	return jsonResult(f)
}

func (s *Server) toolOrganizerDeleteFolder(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	idF, ok := req.Params.Arguments["id"].(float64)
	if !ok {
		return nil, fmt.Errorf("id is required")
	}
	id := int64(idF)
	if err := db.DeleteOrganizerFolder(id); err != nil {
		return nil, err
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerFolderDeleted, Data: map[string]int64{"id": id}})
	return jsonResult(map[string]bool{"success": true})
}

func (s *Server) toolOrganizerReorderFolders(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	raw, ok := req.Params.Arguments["updates"].(string)
	if !ok {
		return nil, fmt.Errorf("updates is required")
	}
	var updates []storage.ReorderFolderUpdate
	if err := json.Unmarshal([]byte(raw), &updates); err != nil {
		return nil, fmt.Errorf("updates must be a JSON array of {id, sort_order}: %w", err)
	}
	if err := db.ReorderOrganizerFolders(updates); err != nil {
		return nil, err
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerFoldersReordered, Data: updates})
	return jsonResult(map[string]bool{"success": true})
}

func (s *Server) toolOrganizerAddItem(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	args := req.Params.Arguments
	folderIDF, ok := args["folder_id"].(float64)
	if !ok {
		return nil, fmt.Errorf("folder_id is required")
	}
	requestIDF, ok := args["request_id"].(float64)
	if !ok {
		return nil, fmt.Errorf("request_id is required")
	}
	item := &storage.OrganizerItem{
		FolderID:  int64(folderIDF),
		RequestID: int64(requestIDF),
	}
	if v, ok := args["note"].(string); ok {
		item.Note = v
	}
	if v, ok := args["sort_order"].(float64); ok {
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
	return jsonResult(item)
}

func (s *Server) toolOrganizerUpdateItem(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	args := req.Params.Arguments
	idF, ok := args["id"].(float64)
	if !ok {
		return nil, fmt.Errorf("id is required")
	}
	id := int64(idF)
	item, err := db.GetOrganizerItem(id)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, fmt.Errorf("item %d not found", id)
	}
	if v, ok := args["note"].(string); ok {
		item.Note = v
	}
	if v, ok := args["sort_order"].(float64); ok {
		item.SortOrder = int(v)
	}
	if err := db.UpdateOrganizerItem(item); err != nil {
		return nil, err
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerItemUpdated, Data: item})
	return jsonResult(item)
}

func (s *Server) toolOrganizerRemoveItem(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	idF, ok := req.Params.Arguments["id"].(float64)
	if !ok {
		return nil, fmt.Errorf("id is required")
	}
	id := int64(idF)
	if err := db.RemoveOrganizerItem(id); err != nil {
		return nil, err
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerItemRemoved, Data: map[string]int64{"id": id}})
	return jsonResult(map[string]bool{"success": true})
}

func (s *Server) toolOrganizerListItems(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	db := s.getDB()
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}
	folderIDF, ok := req.Params.Arguments["folder_id"].(float64)
	if !ok {
		return nil, fmt.Errorf("folder_id is required")
	}
	folderID := int64(folderIDF)
	items, err := db.ListOrganizerItems(folderID)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []*storage.OrganizerItem{}
	}
	return jsonResult(map[string]interface{}{"items": items})
}

// buildOrganizerTree assembles a flat folder list into a nested tree (MCP-side helper).
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
