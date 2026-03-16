package storage

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

type DB struct {
	*sql.DB
}

func (db *DB) Checkpoint() error {
	_, err := db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
	return err
}

func Open(path string) (*DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// WAL mode for concurrent access
	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		return nil, err
	}
	if _, err := db.Exec(`PRAGMA foreign_keys=ON`); err != nil {
		return nil, err
	}

	if err := migrate(db); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return &DB{db}, nil
}

func migrate(db *sql.DB) error {
	schema := `
CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    method TEXT NOT NULL,
    scheme TEXT NOT NULL,
    host TEXT NOT NULL,
    path TEXT NOT NULL,
    query TEXT,
    headers TEXT NOT NULL,
    body BLOB,
    raw BLOB,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    tags TEXT
);
CREATE INDEX IF NOT EXISTS idx_req_host ON requests(host);
CREATE INDEX IF NOT EXISTS idx_req_ts ON requests(timestamp DESC);

CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id),
    status_code INTEGER NOT NULL,
    status_text TEXT NOT NULL,
    headers TEXT NOT NULL,
    body BLOB,
    raw BLOB,
    duration_ms INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS replays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin_request_id INTEGER REFERENCES requests(id),
    request_id INTEGER NOT NULL REFERENCES requests(id),
    response_id INTEGER REFERENCES responses(id),
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS intercept_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id),
    state TEXT NOT NULL DEFAULT 'held',
    modified_raw BLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
);
`
	_, err := db.Exec(schema)
	return err
}
