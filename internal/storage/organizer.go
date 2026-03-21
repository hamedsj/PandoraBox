package storage

import (
	"database/sql"
	"fmt"
	"strings"
)

// ─── Folders ─────────────────────────────────────────────────────────────────

// CreateOrganizerFolder inserts a new folder and returns its ID.
func (db *DB) CreateOrganizerFolder(f *OrganizerFolder) (int64, error) {
	res, err := db.Exec(
		`INSERT INTO organizer_folders (parent_id, name, color, icon, note, sort_order)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		int64PtrToNullInt64(f.ParentID), f.Name, f.Color, f.Icon, f.Note, f.SortOrder,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// GetOrganizerFolder returns a single folder by ID, or nil if not found.
func (db *DB) GetOrganizerFolder(id int64) (*OrganizerFolder, error) {
	f := &OrganizerFolder{}
	var parentID sql.NullInt64
	var createdAt, updatedAt string
	err := db.QueryRow(
		`SELECT id, parent_id, name, color, icon, note, sort_order, created_at, updated_at
		 FROM organizer_folders WHERE id = ?`, id,
	).Scan(&f.ID, &parentID, &f.Name, &f.Color, &f.Icon, &f.Note, &f.SortOrder,
		&createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if parentID.Valid {
		f.ParentID = &parentID.Int64
	}
	f.CreatedAt = parseDBTime(createdAt)
	f.UpdatedAt = parseDBTime(updatedAt)
	return f, nil
}

// ListOrganizerFolders returns all folders flat, ordered by sort_order then id.
func (db *DB) ListOrganizerFolders() ([]*OrganizerFolder, error) {
	rows, err := db.Query(
		`SELECT id, parent_id, name, color, icon, note, sort_order, created_at, updated_at
		 FROM organizer_folders ORDER BY sort_order ASC, id ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var folders []*OrganizerFolder
	for rows.Next() {
		f := &OrganizerFolder{}
		var parentID sql.NullInt64
		var createdAt, updatedAt string
		if err := rows.Scan(&f.ID, &parentID, &f.Name, &f.Color, &f.Icon, &f.Note, &f.SortOrder,
			&createdAt, &updatedAt); err != nil {
			return nil, err
		}
		if parentID.Valid {
			f.ParentID = &parentID.Int64
		}
		f.CreatedAt = parseDBTime(createdAt)
		f.UpdatedAt = parseDBTime(updatedAt)
		folders = append(folders, f)
	}
	return folders, rows.Err()
}

// UpdateOrganizerFolder saves all mutable fields of a folder.
func (db *DB) UpdateOrganizerFolder(f *OrganizerFolder) error {
	_, err := db.Exec(
		`UPDATE organizer_folders
		 SET parent_id=?, name=?, color=?, icon=?, note=?, sort_order=?,
		     updated_at=CURRENT_TIMESTAMP
		 WHERE id=?`,
		int64PtrToNullInt64(f.ParentID), f.Name, f.Color, f.Icon, f.Note, f.SortOrder, f.ID,
	)
	return err
}

// DeleteOrganizerFolder recursively deletes a folder and all its descendants.
func (db *DB) DeleteOrganizerFolder(id int64) error {
	ids, err := db.collectFolderAndDescendants(id)
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}

	placeholders := strings.Repeat("?,", len(ids))
	placeholders = placeholders[:len(placeholders)-1]

	args := make([]interface{}, len(ids))
	for i, v := range ids {
		args[i] = v
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(
		fmt.Sprintf(`DELETE FROM organizer_items WHERE folder_id IN (%s)`, placeholders),
		args...,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(
		fmt.Sprintf(`DELETE FROM organizer_folders WHERE id IN (%s)`, placeholders),
		args...,
	); err != nil {
		return err
	}
	return tx.Commit()
}

// collectFolderAndDescendants performs a BFS and returns all IDs in the subtree.
func (db *DB) collectFolderAndDescendants(root int64) ([]int64, error) {
	all := []int64{root}
	queue := []int64{root}
	for len(queue) > 0 {
		parent := queue[0]
		queue = queue[1:]
		rows, err := db.Query(`SELECT id FROM organizer_folders WHERE parent_id = ?`, parent)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var cid int64
			if err := rows.Scan(&cid); err != nil {
				rows.Close()
				return nil, err
			}
			all = append(all, cid)
			queue = append(queue, cid)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return all, nil
}

// ReorderFolderUpdate is a single item in a folder reorder batch.
type ReorderFolderUpdate struct {
	ID        int64 `json:"id"`
	SortOrder int   `json:"sort_order"`
}

// ReorderOrganizerFolders batch-updates sort_order for a set of folders.
func (db *DB) ReorderOrganizerFolders(updates []ReorderFolderUpdate) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	for _, u := range updates {
		if _, err := tx.Exec(
			`UPDATE organizer_folders SET sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
			u.SortOrder, u.ID,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ─── Items ────────────────────────────────────────────────────────────────────

// AddOrganizerItem inserts an item; duplicate (folder_id, request_id) is a no-op.
func (db *DB) AddOrganizerItem(item *OrganizerItem) (int64, error) {
	res, err := db.Exec(
		`INSERT OR IGNORE INTO organizer_items (folder_id, request_id, note, sort_order)
		 VALUES (?, ?, ?, ?)`,
		item.FolderID, item.RequestID, item.Note, item.SortOrder,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// GetOrganizerItem returns a single item by ID, or nil if not found.
func (db *DB) GetOrganizerItem(id int64) (*OrganizerItem, error) {
	item := &OrganizerItem{}
	var createdAt, updatedAt string
	err := db.QueryRow(
		`SELECT id, folder_id, request_id, note, sort_order, created_at, updated_at
		 FROM organizer_items WHERE id = ?`, id,
	).Scan(&item.ID, &item.FolderID, &item.RequestID, &item.Note, &item.SortOrder,
		&createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	item.CreatedAt = parseDBTime(createdAt)
	item.UpdatedAt = parseDBTime(updatedAt)
	return item, nil
}

// ListOrganizerItems returns all items in a folder with joined request summaries.
func (db *DB) ListOrganizerItems(folderID int64) ([]*OrganizerItem, error) {
	rows, err := db.Query(`
		SELECT oi.id, oi.folder_id, oi.request_id, oi.note, oi.sort_order,
		       oi.created_at, oi.updated_at,
		       r.id, r.method, r.scheme, r.host, r.path, r.query,
		       r.headers, r.timestamp, r.tags, r.user_id,
		       resp.status_code, resp.status_text, resp.duration_ms, resp.size_bytes
		FROM organizer_items oi
		JOIN requests r ON r.id = oi.request_id
		LEFT JOIN responses resp ON resp.request_id = r.id
		WHERE oi.folder_id = ?
		ORDER BY oi.sort_order ASC, oi.id ASC`, folderID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*OrganizerItem
	for rows.Next() {
		item := &OrganizerItem{}
		req := &Request{}
		var itemCreatedAt, itemUpdatedAt, reqTimestamp string
		var statusCode, durationMs, sizeBytes sql.NullInt64
		var statusText sql.NullString

		if err := rows.Scan(
			&item.ID, &item.FolderID, &item.RequestID, &item.Note, &item.SortOrder,
			&itemCreatedAt, &itemUpdatedAt,
			&req.ID, &req.Method, &req.Scheme, &req.Host, &req.Path, &req.Query,
			&req.Headers, &reqTimestamp, &req.Tags, &req.UserID,
			&statusCode, &statusText, &durationMs, &sizeBytes,
		); err != nil {
			return nil, err
		}
		item.CreatedAt = parseDBTime(itemCreatedAt)
		item.UpdatedAt = parseDBTime(itemUpdatedAt)
		req.Timestamp = parseDBTime(reqTimestamp)
		if statusCode.Valid {
			req.Response = &Response{
				RequestID:  req.ID,
				StatusCode: int(statusCode.Int64),
				StatusText: statusText.String,
				DurationMs: durationMs.Int64,
				SizeBytes:  sizeBytes.Int64,
			}
		}
		item.Request = req
		items = append(items, item)
	}
	return items, rows.Err()
}

// UpdateOrganizerItem saves note and sort_order for an item.
func (db *DB) UpdateOrganizerItem(item *OrganizerItem) error {
	_, err := db.Exec(
		`UPDATE organizer_items SET note=?, sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		item.Note, item.SortOrder, item.ID,
	)
	return err
}

// RemoveOrganizerItem deletes a single item by ID.
func (db *DB) RemoveOrganizerItem(id int64) error {
	_, err := db.Exec(`DELETE FROM organizer_items WHERE id=?`, id)
	return err
}

// ReorderItemUpdate is a single item in an items reorder batch.
type ReorderItemUpdate struct {
	ID        int64 `json:"id"`
	SortOrder int   `json:"sort_order"`
}

// ReorderOrganizerItems batch-updates sort_order for a set of items.
func (db *DB) ReorderOrganizerItems(updates []ReorderItemUpdate) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	for _, u := range updates {
		if _, err := tx.Exec(
			`UPDATE organizer_items SET sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
			u.SortOrder, u.ID,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetOrganizerFolderIDsForRequest returns all folder IDs that contain a given request.
func (db *DB) GetOrganizerFolderIDsForRequest(requestID int64) ([]int64, error) {
	rows, err := db.Query(
		`SELECT folder_id FROM organizer_items WHERE request_id = ?`, requestID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func int64PtrToNullInt64(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}
