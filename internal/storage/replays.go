// SPDX-License-Identifier: Apache-2.0
package storage

import "database/sql"

// SaveReplay inserts a new replay row from the request snapshot carried on
// r.Request, in "pending" status. Replays are self-contained: they do NOT
// create rows in the requests/responses tables, so replay traffic never leaks
// into History, the SiteMap, or request counts.
func (db *DB) SaveReplay(r *Replay) (int64, error) {
	var (
		method, scheme, host, path, query, headers string
		body, raw                                  []byte
	)
	if r.Request != nil {
		method, scheme, host = r.Request.Method, r.Request.Scheme, r.Request.Host
		path, query, headers = r.Request.Path, r.Request.Query, r.Request.Headers
		body, raw = r.Request.Body, r.Request.Raw
	}
	status := r.Status
	if status == "" {
		status = "pending"
	}
	res, err := db.Exec(
		`INSERT INTO replays
		   (origin_request_id, method, scheme, host, path, query, req_headers, req_body, req_raw, status, error)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.OriginRequestID, method, scheme, host, path, query, headers, body, raw, status, r.Error,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateReplayResponse stores the response snapshot on a replay and marks it
// done/error. Pass resp == nil with status "error" for transport failures.
func (db *DB) UpdateReplayResponse(id int64, resp *Response, status, errMsg string) error {
	if resp == nil {
		_, err := db.Exec(
			`UPDATE replays SET status = ?, error = ? WHERE id = ?`,
			status, errMsg, id,
		)
		return err
	}
	_, err := db.Exec(
		`UPDATE replays
		    SET status_code = ?, status_text = ?, resp_proto = ?, resp_headers = ?,
		        resp_body = ?, duration_ms = ?, size_bytes = ?, status = ?, error = ?
		  WHERE id = ?`,
		resp.StatusCode, resp.StatusText, resp.Proto, resp.Headers,
		resp.Body, resp.DurationMs, resp.SizeBytes, status, errMsg, id,
	)
	return err
}

// scanReplay reads one replay row (with inline snapshots) into a *Replay,
// reconstructing the synthetic Request/Response objects the UI/MCP expect.
func scanReplay(scan func(dest ...any) error) (*Replay, error) {
	r := &Replay{}
	var (
		ts                                         string
		method, scheme, host, path, query          sql.NullString
		reqHeaders                                 sql.NullString
		reqBody, reqRaw                            []byte
		statusCode                                 sql.NullInt64
		statusText, respProto, respHeaders         sql.NullString
		respBody                                   []byte
		durationMs, sizeBytes                      sql.NullInt64
	)
	if err := scan(
		&r.ID, &r.OriginRequestID,
		&method, &scheme, &host, &path, &query, &reqHeaders, &reqBody, &reqRaw,
		&statusCode, &statusText, &respProto, &respHeaders, &respBody, &durationMs, &sizeBytes,
		&r.Status, &r.Error, &ts,
	); err != nil {
		return nil, err
	}
	r.CreatedAt = parseDBTime(ts)

	r.Request = &Request{
		Method:  method.String,
		Scheme:  scheme.String,
		Host:    host.String,
		Path:    path.String,
		Query:   query.String,
		Headers: reqHeaders.String,
		Body:    reqBody,
		Raw:     reqRaw,
	}
	if statusCode.Valid {
		r.Response = &Response{
			StatusCode: int(statusCode.Int64),
			StatusText: statusText.String,
			Proto:      respProto.String,
			Headers:    respHeaders.String,
			Body:       respBody,
			DurationMs: durationMs.Int64,
			SizeBytes:  sizeBytes.Int64,
		}
	}
	return r, nil
}

const replaySelectCols = `id, origin_request_id, method, scheme, host, path, query,
	req_headers, req_body, req_raw,
	status_code, status_text, resp_proto, resp_headers, resp_body, duration_ms, size_bytes,
	status, error, created_at`

func (db *DB) GetReplay(id int64) (*Replay, error) {
	row := db.QueryRow(`SELECT `+replaySelectCols+` FROM replays WHERE id = ?`, id)
	r, err := scanReplay(row.Scan)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return r, err
}

func (db *DB) ListReplays(limit, offset int) ([]*Replay, int, error) {
	if limit <= 0 {
		limit = 50
	}

	var total int
	if err := db.QueryRow(`SELECT COUNT(*) FROM replays`).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := db.Query(
		`SELECT `+replaySelectCols+` FROM replays ORDER BY id DESC LIMIT ? OFFSET ?`,
		limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []*Replay
	for rows.Next() {
		r, err := scanReplay(rows.Scan)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}
