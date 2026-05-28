// SPDX-License-Identifier: Apache-2.0
package storage

import (
	"database/sql"
	"fmt"
	"strings"
)

type RequestFilter struct {
	Host        string
	Method      string
	StatusMin   int
	StatusMax   int
	Search      string
	UserID      string // filter by team member; empty = all users
	ContentType string // substring match against response Content-Type header
	Limit       int
	Offset      int
}

// buildRequestsWhere constructs the WHERE clause and args shared by ListRequests
// and ListRequestsWithBodies.
func buildRequestsWhere(f RequestFilter) (string, []interface{}) {
	var where []string
	var args []interface{}

	if f.Host != "" {
		where = append(where, "r.host LIKE ?")
		args = append(args, "%"+f.Host+"%")
	}
	if f.Method != "" {
		where = append(where, "r.method = ?")
		args = append(args, strings.ToUpper(f.Method))
	}
	if f.Search != "" {
		where = append(where, "(r.host LIKE ? OR r.path LIKE ? OR r.query LIKE ?)")
		args = append(args, "%"+f.Search+"%", "%"+f.Search+"%", "%"+f.Search+"%")
	}
	if f.StatusMin > 0 {
		where = append(where, "resp.status_code >= ?")
		args = append(args, f.StatusMin)
	}
	if f.StatusMax > 0 {
		where = append(where, "resp.status_code <= ?")
		args = append(args, f.StatusMax)
	}
	if f.UserID != "" {
		where = append(where, "r.user_id = ?")
		args = append(args, f.UserID)
	}
	if f.ContentType != "" {
		where = append(where, "LOWER(COALESCE(resp.headers,'')) LIKE ?")
		args = append(args, "%"+strings.ToLower(f.ContentType)+"%")
	}

	if len(where) == 0 {
		return "", args
	}
	return "WHERE " + strings.Join(where, " AND "), args
}

func (db *DB) SaveRequest(r *Request) (int64, error) {
	res, err := db.Exec(
		`INSERT INTO requests (method, scheme, host, path, query, headers, body, raw, tags, user_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.Method, r.Scheme, r.Host, r.Path, r.Query,
		r.Headers, r.Body, r.Raw, r.Tags, r.UserID,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (db *DB) SaveResponse(resp *Response) (int64, error) {
	res, err := db.Exec(
		`INSERT INTO responses (request_id, status_code, status_text, headers, body, raw, duration_ms, size_bytes)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		resp.RequestID, resp.StatusCode, resp.StatusText, resp.Headers,
		resp.Body, resp.Raw, resp.DurationMs, resp.SizeBytes,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (db *DB) GetRequest(id int64) (*Request, error) {
	r := &Request{}
	err := db.QueryRow(
		`SELECT id, method, scheme, host, path, query, headers, body, raw, timestamp, tags, user_id
		 FROM requests WHERE id = ?`, id,
	).Scan(&r.ID, &r.Method, &r.Scheme, &r.Host, &r.Path,
		&r.Query, &r.Headers, &r.Body, &r.Raw, &r.Timestamp, &r.Tags, &r.UserID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	resp, err := db.GetResponseForRequest(id)
	if err != nil {
		return nil, err
	}
	r.Response = resp
	return r, nil
}

func (db *DB) GetResponseForRequest(requestID int64) (*Response, error) {
	resp := &Response{}
	err := db.QueryRow(
		`SELECT id, request_id, status_code, status_text, headers, body, raw, duration_ms, size_bytes, timestamp
		 FROM responses WHERE request_id = ? ORDER BY id DESC LIMIT 1`, requestID,
	).Scan(&resp.ID, &resp.RequestID, &resp.StatusCode, &resp.StatusText,
		&resp.Headers, &resp.Body, &resp.Raw, &resp.DurationMs, &resp.SizeBytes, &resp.Timestamp)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func (db *DB) ListRequests(f RequestFilter) ([]*Request, int, error) {
	if f.Limit <= 0 {
		f.Limit = 50
	}

	whereClause, args := buildRequestsWhere(f)

	countQuery := fmt.Sprintf(`
		SELECT COUNT(*) FROM requests r
		LEFT JOIN responses resp ON resp.request_id = r.id
		%s`, whereClause)

	var total int
	if err := db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT r.id, r.method, r.scheme, r.host, r.path, r.query,
		       r.headers, r.body, r.timestamp, r.tags, r.user_id,
		       resp.id, resp.status_code, resp.status_text, resp.duration_ms, resp.size_bytes
		FROM requests r
		LEFT JOIN responses resp ON resp.request_id = r.id
		%s
		ORDER BY r.timestamp DESC
		LIMIT ? OFFSET ?`, whereClause)

	args = append(args, f.Limit, f.Offset)
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var requests []*Request
	for rows.Next() {
		r := &Request{}
		var respID sql.NullInt64
		var statusCode sql.NullInt64
		var statusText sql.NullString
		var durationMs sql.NullInt64
		var sizeBytes sql.NullInt64
		var ts string

		err := rows.Scan(
			&r.ID, &r.Method, &r.Scheme, &r.Host, &r.Path, &r.Query,
			&r.Headers, &r.Body, &ts, &r.Tags, &r.UserID,
			&respID, &statusCode, &statusText, &durationMs, &sizeBytes,
		)
		if err != nil {
			return nil, 0, err
		}
		r.Timestamp = parseDBTime(ts)
		if respID.Valid {
			r.Response = &Response{
				ID:         respID.Int64,
				RequestID:  r.ID,
				StatusCode: int(statusCode.Int64),
				StatusText: statusText.String,
				DurationMs: durationMs.Int64,
				SizeBytes:  sizeBytes.Int64,
			}
		}
		requests = append(requests, r)
	}
	return requests, total, rows.Err()
}

// ListRequestsWithBodies is like ListRequests but also fetches the full response
// headers and body. Only requests that have a response are returned.
// This is intended for analysis tools (grep_responses, export_responses).
func (db *DB) ListRequestsWithBodies(f RequestFilter) ([]*Request, int, error) {
	if f.Limit <= 0 {
		f.Limit = 50000
	}

	whereClause, args := buildRequestsWhere(f)

	// Always restrict to requests that have a response.
	if whereClause == "" {
		whereClause = "WHERE resp.id IS NOT NULL"
	} else {
		whereClause += " AND resp.id IS NOT NULL"
	}

	countQuery := fmt.Sprintf(`
		SELECT COUNT(*) FROM requests r
		LEFT JOIN responses resp ON resp.request_id = r.id
		%s`, whereClause)

	var total int
	if err := db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT r.id, r.method, r.scheme, r.host, r.path, r.query,
		       r.headers, r.body, r.timestamp, r.tags, r.user_id,
		       resp.id, resp.status_code, resp.status_text,
		       resp.headers, resp.body, resp.duration_ms, resp.size_bytes
		FROM requests r
		LEFT JOIN responses resp ON resp.request_id = r.id
		%s
		ORDER BY r.timestamp DESC
		LIMIT ? OFFSET ?`, whereClause)

	args = append(args, f.Limit, f.Offset)
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var requests []*Request
	for rows.Next() {
		r := &Request{}
		resp := &Response{}
		var ts string
		var respHeaders sql.NullString
		var respBody []byte

		if err := rows.Scan(
			&r.ID, &r.Method, &r.Scheme, &r.Host, &r.Path, &r.Query,
			&r.Headers, &r.Body, &ts, &r.Tags, &r.UserID,
			&resp.ID, &resp.StatusCode, &resp.StatusText,
			&respHeaders, &respBody, &resp.DurationMs, &resp.SizeBytes,
		); err != nil {
			return nil, 0, err
		}
		r.Timestamp = parseDBTime(ts)
		resp.RequestID = r.ID
		resp.Headers = respHeaders.String
		resp.Body = respBody
		r.Response = resp
		requests = append(requests, r)
	}
	return requests, total, rows.Err()
}

func (db *DB) DeleteRequest(id int64) error {
	return db.DeleteRequests([]int64{id})
}

func (db *DB) RequestIDsByHost(host string) ([]int64, error) {
	rows, err := db.Query(`SELECT id FROM requests WHERE host = ?`, host)
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

func (db *DB) DeleteRequestsByHost(host string) ([]int64, error) {
	ids, err := db.RequestIDsByHost(host)
	if err != nil {
		return nil, err
	}
	if err := db.DeleteRequests(ids); err != nil {
		return nil, err
	}
	return ids, nil
}

func (db *DB) UpdateRequestTags(id int64, tags string) error {
	_, err := db.Exec(`UPDATE requests SET tags = ? WHERE id = ?`, tags, id)
	return err
}

func (db *DB) DeleteRequests(ids []int64) error {
	if len(ids) == 0 {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := deleteRequestsTx(tx, ids); err != nil {
		return err
	}

	return tx.Commit()
}

func (db *DB) ClearRequests() error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM websocket_frames`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM websocket_sessions`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM intercept_queue`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM replays`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM responses`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM requests`); err != nil {
		return err
	}

	return tx.Commit()
}

// ClearRequestsByUser deletes all requests (and their related rows) captured by a specific
// team member. Pass an empty string to clear all requests (same behaviour as ClearRequests).
func (db *DB) ClearRequestsByUser(userID string) error {
	if userID == "" {
		return db.ClearRequests()
	}

	// Collect IDs for this user, then delegate to the existing batch-delete helper.
	rows, err := db.Query(`SELECT id FROM requests WHERE user_id = ?`, userID)
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	return db.DeleteRequests(ids)
}

func (db *DB) CountRequests() (int64, error) {
	var n int64
	err := db.QueryRow(`SELECT COUNT(*) FROM requests`).Scan(&n)
	return n, err
}

// CountRequestsByUser returns the number of requests captured by a specific user.
func (db *DB) CountRequestsByUser(userID string) (int64, error) {
	var n int64
	err := db.QueryRow(`SELECT COUNT(*) FROM requests WHERE user_id = ?`, userID).Scan(&n)
	return n, err
}

func deleteRequestsTx(tx *sql.Tx, ids []int64) error {
	placeholders := make([]string, 0, len(ids))
	args := make([]interface{}, 0, len(ids))
	for _, id := range ids {
		placeholders = append(placeholders, "?")
		args = append(args, id)
	}
	inClause := strings.Join(placeholders, ", ")

	if _, err := tx.Exec(
		fmt.Sprintf(`DELETE FROM websocket_frames WHERE session_id IN (SELECT id FROM websocket_sessions WHERE request_id IN (%s))`, inClause),
		args...,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(
		fmt.Sprintf(`DELETE FROM websocket_sessions WHERE request_id IN (%s)`, inClause),
		args...,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(
		fmt.Sprintf(`DELETE FROM intercept_queue WHERE request_id IN (%s)`, inClause),
		args...,
	); err != nil {
		return err
	}

	replayArgs := make([]interface{}, 0, len(args)*3)
	replayArgs = append(replayArgs, args...)
	replayArgs = append(replayArgs, args...)
	replayArgs = append(replayArgs, args...)
	if _, err := tx.Exec(
		fmt.Sprintf(
			`DELETE FROM replays
			 WHERE request_id IN (%[1]s)
			    OR origin_request_id IN (%[1]s)
			    OR response_id IN (SELECT id FROM responses WHERE request_id IN (%[1]s))`,
			inClause,
		),
		replayArgs...,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(
		fmt.Sprintf(`DELETE FROM responses WHERE request_id IN (%s)`, inClause),
		args...,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(
		fmt.Sprintf(`DELETE FROM requests WHERE id IN (%s)`, inClause),
		args...,
	); err != nil {
		return err
	}

	return nil
}
