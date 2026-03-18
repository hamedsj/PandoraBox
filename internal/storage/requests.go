package storage

import (
	"database/sql"
	"fmt"
	"strings"
)

type RequestFilter struct {
	Host      string
	Method    string
	StatusMin int
	StatusMax int
	Search    string
	Limit     int
	Offset    int
}

func (db *DB) SaveRequest(r *Request) (int64, error) {
	res, err := db.Exec(
		`INSERT INTO requests (method, scheme, host, path, query, headers, body, raw, tags)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.Method, r.Scheme, r.Host, r.Path, r.Query,
		r.Headers, r.Body, r.Raw, r.Tags,
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
		`SELECT id, method, scheme, host, path, query, headers, body, raw, timestamp, tags
		 FROM requests WHERE id = ?`, id,
	).Scan(&r.ID, &r.Method, &r.Scheme, &r.Host, &r.Path,
		&r.Query, &r.Headers, &r.Body, &r.Raw, &r.Timestamp, &r.Tags)
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

	whereClause := ""
	if len(where) > 0 {
		whereClause = "WHERE " + strings.Join(where, " AND ")
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
		       r.headers, r.body, r.timestamp, r.tags,
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
			&r.Headers, &r.Body, &ts, &r.Tags,
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

func (db *DB) DeleteRequest(id int64) error {
	_, err := db.Exec(`DELETE FROM requests WHERE id = ?`, id)
	return err
}

func (db *DB) CountRequests() (int64, error) {
	var n int64
	err := db.QueryRow(`SELECT COUNT(*) FROM requests`).Scan(&n)
	return n, err
}
