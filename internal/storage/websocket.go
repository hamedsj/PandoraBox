package storage

import (
	"database/sql"
	"time"
)

func (db *DB) SaveWebSocketSession(requestID int64) (int64, error) {
	res, err := db.Exec(
		`INSERT INTO websocket_sessions (request_id) VALUES (?)`,
		requestID,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (db *DB) CloseWebSocketSession(id int64) error {
	_, err := db.Exec(
		`UPDATE websocket_sessions SET closed_at = CURRENT_TIMESTAMP WHERE id = ?`,
		id,
	)
	return err
}

func (db *DB) GetWebSocketSession(requestID int64) (*WebSocketSession, error) {
	s := &WebSocketSession{}
	var createdAt string
	var closedAt sql.NullString
	err := db.QueryRow(
		`SELECT id, request_id, created_at, closed_at FROM websocket_sessions WHERE request_id = ? LIMIT 1`,
		requestID,
	).Scan(&s.ID, &s.RequestID, &createdAt, &closedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s.CreatedAt, _ = time.Parse("2006-01-02T15:04:05Z", createdAt)
	if closedAt.Valid {
		t, _ := time.Parse("2006-01-02T15:04:05Z", closedAt.String)
		s.ClosedAt = &t
	}
	return s, nil
}

func (db *DB) SaveWebSocketFrame(f *WebSocketFrame) error {
	res, err := db.Exec(
		`INSERT INTO websocket_frames (session_id, direction, opcode, fin, payload, length, truncated)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		f.SessionID, f.Direction, f.Opcode, f.Fin, f.Payload, f.Length,
		boolToInt(f.Truncated),
	)
	if err != nil {
		return err
	}
	id, _ := res.LastInsertId()
	f.ID = id
	return nil
}

func (db *DB) ListWebSocketFrames(sessionID int64) ([]*WebSocketFrame, error) {
	rows, err := db.Query(
		`SELECT id, session_id, direction, opcode, fin, payload, length, truncated, timestamp
		 FROM websocket_frames WHERE session_id = ? ORDER BY timestamp ASC, id ASC`,
		sessionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	frames := make([]*WebSocketFrame, 0)
	for rows.Next() {
		f := &WebSocketFrame{}
		var ts string
		var truncated int
		if err := rows.Scan(&f.ID, &f.SessionID, &f.Direction, &f.Opcode, &f.Fin,
			&f.Payload, &f.Length, &truncated, &ts); err != nil {
			return nil, err
		}
		f.Truncated = truncated != 0
		f.Timestamp, _ = time.Parse("2006-01-02T15:04:05Z", ts)
		frames = append(frames, f)
	}
	return frames, rows.Err()
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
