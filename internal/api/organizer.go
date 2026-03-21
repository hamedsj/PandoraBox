package api

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/hamedsj5/pandorabox/internal/events"
	"github.com/hamedsj5/pandorabox/internal/storage"
)

// buildTree assembles a flat folder list into a nested tree, returning root folders.
func buildTree(flat []*storage.OrganizerFolder) []*storage.OrganizerFolder {
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
			parent, ok := m[*f.ParentID]
			if ok {
				parent.Children = append(parent.Children, node)
			} else {
				roots = append(roots, node) // orphan → promote to root
			}
		}
	}
	// Sort by sort_order then id at every level.
	var sortLevel func([]*storage.OrganizerFolder)
	sortLevel = func(folders []*storage.OrganizerFolder) {
		sort.Slice(folders, func(i, j int) bool {
			if folders[i].SortOrder != folders[j].SortOrder {
				return folders[i].SortOrder < folders[j].SortOrder
			}
			return folders[i].ID < folders[j].ID
		})
		for _, f := range folders {
			if len(f.Children) > 0 {
				sortLevel(f.Children)
			}
		}
	}
	sortLevel(roots)
	return roots
}

// GET /api/organizer/folders
func (s *Server) listOrganizerFolders(w http.ResponseWriter, r *http.Request) {
	db := s.getDB()
	if db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}
	flat, err := db.ListOrganizerFolders()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if flat == nil {
		flat = []*storage.OrganizerFolder{}
	}
	roots := buildTree(flat)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"folders": roots,
		"flat":    flat,
	})
}

// POST /api/organizer/folders
func (s *Server) createOrganizerFolder(w http.ResponseWriter, r *http.Request) {
	db := s.getDB()
	if db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}
	var body struct {
		ParentID  *int64 `json:"parent_id"`
		Name      string `json:"name"`
		Color     string `json:"color"`
		Icon      string `json:"icon"`
		Note      string `json:"note"`
		SortOrder int    `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Name == "" {
		body.Name = "New Folder"
	}
	if body.Color == "" {
		body.Color = "teal"
	}
	if body.Icon == "" {
		body.Icon = "Folder"
	}
	f := &storage.OrganizerFolder{
		ParentID:  body.ParentID,
		Name:      body.Name,
		Color:     body.Color,
		Icon:      body.Icon,
		Note:      body.Note,
		SortOrder: body.SortOrder,
	}
	id, err := db.CreateOrganizerFolder(f)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	f.ID = id
	created, _ := db.GetOrganizerFolder(id)
	if created != nil {
		f = created
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerFolderCreated, Data: f})
	writeJSON(w, http.StatusCreated, f)
}

// GET /api/organizer/folders/{id}
func (s *Server) getOrganizerFolder(w http.ResponseWriter, r *http.Request) {
	db := s.getDB()
	if db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	f, err := db.GetOrganizerFolder(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if f == nil {
		writeError(w, http.StatusNotFound, "folder not found")
		return
	}
	writeJSON(w, http.StatusOK, f)
}

// PUT /api/organizer/folders/{id}
func (s *Server) updateOrganizerFolder(w http.ResponseWriter, r *http.Request) {
	db := s.getDB()
	if db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	existing, err := db.GetOrganizerFolder(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "folder not found")
		return
	}
	// Decode partial update — fields present in JSON override existing values.
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if v, ok := body["name"].(string); ok {
		existing.Name = v
	}
	if v, ok := body["color"].(string); ok {
		existing.Color = v
	}
	if v, ok := body["icon"].(string); ok {
		existing.Icon = v
	}
	if v, ok := body["note"].(string); ok {
		existing.Note = v
	}
	if v, ok := body["sort_order"].(float64); ok {
		existing.SortOrder = int(v)
	}
	if v, ok := body["parent_id"]; ok {
		if v == nil {
			existing.ParentID = nil
		} else if fv, ok := v.(float64); ok {
			pid := int64(fv)
			existing.ParentID = &pid
		}
	}
	if err := db.UpdateOrganizerFolder(existing); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	updated, _ := db.GetOrganizerFolder(id)
	if updated == nil {
		updated = existing
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerFolderUpdated, Data: updated})
	writeJSON(w, http.StatusOK, updated)
}

// DELETE /api/organizer/folders/{id}
func (s *Server) deleteOrganizerFolder(w http.ResponseWriter, r *http.Request) {
	db := s.getDB()
	if db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := db.DeleteOrganizerFolder(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerFolderDeleted, Data: map[string]int64{"id": id}})
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// PUT /api/organizer/folders/reorder
func (s *Server) reorderOrganizerFolders(w http.ResponseWriter, r *http.Request) {
	db := s.getDB()
	if db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}
	var body struct {
		Updates []storage.ReorderFolderUpdate `json:"updates"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := db.ReorderOrganizerFolders(body.Updates); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerFoldersReordered, Data: body.Updates})
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// POST /api/organizer/folders/{id}/items
func (s *Server) addOrganizerItem(w http.ResponseWriter, r *http.Request) {
	db := s.getDB()
	if db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}
	folderID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid folder id")
		return
	}
	var body struct {
		RequestID int64  `json:"request_id"`
		Note      string `json:"note"`
		SortOrder int    `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.RequestID == 0 {
		writeError(w, http.StatusBadRequest, "request_id is required")
		return
	}
	item := &storage.OrganizerItem{
		FolderID:  folderID,
		RequestID: body.RequestID,
		Note:      body.Note,
		SortOrder: body.SortOrder,
	}
	id, err := db.AddOrganizerItem(item)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Fetch with joined request data.
	items, err := db.ListOrganizerItems(folderID)
	if err == nil {
		for _, it := range items {
			if it.ID == id || (id == 0 && it.RequestID == body.RequestID && it.FolderID == folderID) {
				item = it
				break
			}
		}
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerItemAdded, Data: item})
	writeJSON(w, http.StatusCreated, item)
}

// GET /api/organizer/folders/{id}/items
func (s *Server) listOrganizerItems(w http.ResponseWriter, r *http.Request) {
	db := s.getDB()
	if db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}
	folderID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid folder id")
		return
	}
	items, err := db.ListOrganizerItems(folderID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if items == nil {
		items = []*storage.OrganizerItem{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"items": items})
}

// PUT /api/organizer/items/{id}
func (s *Server) updateOrganizerItem(w http.ResponseWriter, r *http.Request) {
	db := s.getDB()
	if db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	item, err := db.GetOrganizerItem(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if item == nil {
		writeError(w, http.StatusNotFound, "item not found")
		return
	}
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if v, ok := body["note"].(string); ok {
		item.Note = v
	}
	if v, ok := body["sort_order"].(float64); ok {
		item.SortOrder = int(v)
	}
	if err := db.UpdateOrganizerItem(item); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerItemUpdated, Data: item})
	writeJSON(w, http.StatusOK, item)
}

// DELETE /api/organizer/items/{id}
func (s *Server) removeOrganizerItem(w http.ResponseWriter, r *http.Request) {
	db := s.getDB()
	if db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := db.RemoveOrganizerItem(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerItemRemoved, Data: map[string]int64{"id": id}})
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// PUT /api/organizer/folders/{id}/items/reorder
func (s *Server) reorderOrganizerItems(w http.ResponseWriter, r *http.Request) {
	db := s.getDB()
	if db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}
	folderID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid folder id")
		return
	}
	var body struct {
		Updates []storage.ReorderItemUpdate `json:"updates"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := db.ReorderOrganizerItems(body.Updates); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.bus.Publish(events.Event{Type: events.EventOrganizerItemsReordered, Data: map[string]int64{"folder_id": folderID}})
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// GET /api/organizer/request/{request_id}/folders
func (s *Server) getRequestFolders(w http.ResponseWriter, r *http.Request) {
	db := s.getDB()
	if db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}
	requestID, err := strconv.ParseInt(chi.URLParam(r, "request_id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request_id")
		return
	}
	ids, err := db.GetOrganizerFolderIDsForRequest(requestID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if ids == nil {
		ids = []int64{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"folder_ids": ids})
}
