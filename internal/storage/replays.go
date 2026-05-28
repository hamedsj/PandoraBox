// SPDX-License-Identifier: Apache-2.0
package storage

import "database/sql"

func (db *DB) SaveReplay(r *Replay) (int64, error) {
	res, err := db.Exec(
		`INSERT INTO replays (origin_request_id, request_id, status, error) VALUES (?, ?, ?, ?)`,
		r.OriginRequestID, r.RequestID, r.Status, r.Error,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (db *DB) UpdateReplay(id int64, responseID *int64, status, errMsg string) error {
	_, err := db.Exec(
		`UPDATE replays SET response_id = ?, status = ?, error = ? WHERE id = ?`,
		responseID, status, errMsg, id,
	)
	return err
}

func (db *DB) GetReplay(id int64) (*Replay, error) {
	r := &Replay{}
	var ts string
	err := db.QueryRow(
		`SELECT id, origin_request_id, request_id, response_id, status, error, created_at
		 FROM replays WHERE id = ?`, id,
	).Scan(&r.ID, &r.OriginRequestID, &r.RequestID, &r.ResponseID, &r.Status, &r.Error, &ts)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.CreatedAt = parseDBTime(ts)

	req, _ := db.GetRequest(r.RequestID)
	r.Request = req
	if r.ResponseID != nil {
		resp, _ := db.GetResponseForRequest(r.RequestID)
		r.Response = resp
	}
	return r, nil
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
		`SELECT id, origin_request_id, request_id, response_id, status, error, created_at
		 FROM replays
		 ORDER BY id DESC
		 LIMIT ? OFFSET ?`,
		limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []*Replay
	for rows.Next() {
		r := &Replay{}
		var ts string
		if err := rows.Scan(&r.ID, &r.OriginRequestID, &r.RequestID, &r.ResponseID, &r.Status, &r.Error, &ts); err != nil {
			return nil, 0, err
		}
		r.CreatedAt = parseDBTime(ts)

		req, _ := db.GetRequest(r.RequestID)
		r.Request = req
		if r.ResponseID != nil {
			resp, _ := db.GetResponseForRequest(r.RequestID)
			r.Response = resp
		}

		out = append(out, r)
	}

	return out, total, rows.Err()
}
