package storage

import "time"

// OrganizerFolder is a named, colored, icon-tagged container for requests.
type OrganizerFolder struct {
	ID        int64              `json:"id"`
	ParentID  *int64             `json:"parent_id"`
	Name      string             `json:"name"`
	Color     string             `json:"color"`
	Icon      string             `json:"icon"`
	Note      string             `json:"note"`
	SortOrder int                `json:"sort_order"`
	CreatedAt time.Time          `json:"created_at"`
	UpdatedAt time.Time          `json:"updated_at"`
	Children  []*OrganizerFolder `json:"children,omitempty"` // virtual: assembled in Go
	Items     []*OrganizerItem   `json:"items,omitempty"`    // virtual: lazy-loaded
}

// OrganizerItem links a request to a folder with an optional note.
type OrganizerItem struct {
	ID        int64     `json:"id"`
	FolderID  int64     `json:"folder_id"`
	RequestID int64     `json:"request_id"`
	Note      string    `json:"note"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Request   *Request  `json:"request,omitempty"` // virtual: joined from requests table
}
