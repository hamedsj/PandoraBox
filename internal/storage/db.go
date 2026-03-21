package storage

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

const sqliteBusyTimeoutMS = 5000

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
	// SQLite performs best here with a single shared connection. The default
	// database/sql pool may open multiple writer connections, which turns normal
	// concurrent capture bursts into SQLITE_BUSY lock errors.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	// WAL mode for concurrent access
	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		return nil, err
	}
	if _, err := db.Exec(fmt.Sprintf(`PRAGMA busy_timeout=%d`, sqliteBusyTimeoutMS)); err != nil {
		return nil, err
	}
	if _, err := db.Exec(`PRAGMA synchronous=NORMAL`); err != nil {
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

CREATE TABLE IF NOT EXISTS websocket_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_ws_sessions_req ON websocket_sessions(request_id);

CREATE TABLE IF NOT EXISTS websocket_frames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES websocket_sessions(id),
    direction TEXT NOT NULL,
    opcode INTEGER NOT NULL,
    fin INTEGER NOT NULL DEFAULT 1,
    payload BLOB,
    length INTEGER NOT NULL,
    truncated INTEGER NOT NULL DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ws_frames_session ON websocket_frames(session_id);
`
	if _, err := db.Exec(schema); err != nil {
		return err
	}

	// v2 migration: add user_id column for team collaboration.
	// ALTER TABLE returns an error if the column already exists; that is safe to ignore.
	_, _ = db.Exec(`ALTER TABLE requests ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_req_user ON requests(user_id)`)

	// v3 migration: Organizer folders and items.
	_, _ = db.Exec(`
CREATE TABLE IF NOT EXISTS organizer_folders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id  INTEGER REFERENCES organizer_folders(id),
    name       TEXT    NOT NULL DEFAULT 'New Folder',
    color      TEXT    NOT NULL DEFAULT 'teal',
    icon       TEXT    NOT NULL DEFAULT 'Folder',
    note       TEXT    NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`)
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_org_folders_parent ON organizer_folders(parent_id)`)
	_, _ = db.Exec(`
CREATE TABLE IF NOT EXISTS organizer_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id  INTEGER NOT NULL REFERENCES organizer_folders(id) ON DELETE CASCADE,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    note       TEXT    NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(folder_id, request_id)
)`)
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_org_items_folder  ON organizer_items(folder_id)`)
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_org_items_request ON organizer_items(request_id)`)

	return nil
}
