// SPDX-License-Identifier: Apache-2.0
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
    method      TEXT,
    scheme      TEXT,
    host        TEXT,
    path        TEXT,
    query       TEXT,
    req_headers TEXT,
    req_body    BLOB,
    req_raw     BLOB,
    status_code INTEGER,
    status_text TEXT,
    resp_proto  TEXT,
    resp_headers TEXT,
    resp_body   BLOB,
    duration_ms INTEGER,
    size_bytes  INTEGER,
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

	// v4 migration: make replays self-contained so replay/repeater traffic no
	// longer creates rows in the requests/responses tables (which leaked into
	// History, the SiteMap, and request counts).
	if err := migrateReplaysInline(db); err != nil {
		return fmt.Errorf("replays inline migration: %w", err)
	}

	return nil
}

// migrateReplaysInline rebuilds the replays table to store the request and
// response snapshots inline (instead of foreign-keying into requests/responses).
// It backfills existing replays from their linked rows and then deletes the
// orphaned replay request/response rows so previously-leaked replays disappear
// from History retroactively. Idempotent: a no-op once the new schema is in place.
func migrateReplaysInline(db *sql.DB) error {
	// Detect the new schema by probing for the `method` column on replays.
	if columnExists(db, "replays", "method") {
		return nil
	}

	// Collect the request ids that legacy replays created (their sent copies)
	// so we can purge them from history after the rebuild. origin_request_id is
	// the source request in history and must be preserved.
	var orphanReqIDs []int64
	if rows, err := db.Query(`SELECT request_id FROM replays`); err == nil {
		for rows.Next() {
			var id int64
			if rows.Scan(&id) == nil {
				orphanReqIDs = append(orphanReqIDs, id)
			}
		}
		rows.Close()
	}

	stmts := []string{
		`ALTER TABLE replays RENAME TO replays_legacy`,
		`CREATE TABLE replays (
			id                INTEGER PRIMARY KEY AUTOINCREMENT,
			origin_request_id INTEGER REFERENCES requests(id),
			method      TEXT,
			scheme      TEXT,
			host        TEXT,
			path        TEXT,
			query       TEXT,
			req_headers TEXT,
			req_body    BLOB,
			req_raw     BLOB,
			status_code INTEGER,
			status_text TEXT,
			resp_proto  TEXT,
			resp_headers TEXT,
			resp_body   BLOB,
			duration_ms INTEGER,
			size_bytes  INTEGER,
			status      TEXT NOT NULL DEFAULT 'pending',
			error       TEXT,
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`INSERT INTO replays (
			id, origin_request_id, method, scheme, host, path, query,
			req_headers, req_body, req_raw,
			status_code, status_text, resp_headers, resp_body, duration_ms, size_bytes,
			status, error, created_at)
		 SELECT rp.id, rp.origin_request_id,
		        req.method, req.scheme, req.host, req.path, req.query,
		        req.headers, req.body, req.raw,
		        resp.status_code, resp.status_text, resp.headers, resp.body, resp.duration_ms, resp.size_bytes,
		        rp.status, rp.error, rp.created_at
		 FROM replays_legacy rp
		 LEFT JOIN requests  req  ON req.id  = rp.request_id
		 LEFT JOIN responses resp ON resp.id = rp.response_id`,
		`DROP TABLE replays_legacy`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return fmt.Errorf("%s: %w", s, err)
		}
	}

	// Purge the orphaned replay request/response rows so they no longer show up
	// in History. Best-effort: a failure here must not block startup.
	for _, id := range orphanReqIDs {
		_, _ = db.Exec(`DELETE FROM responses WHERE request_id = ?`, id)
		_, _ = db.Exec(`DELETE FROM requests WHERE id = ?`, id)
	}
	return nil
}

// columnExists reports whether a table has a column with the given name.
func columnExists(db *sql.DB, table, column string) bool {
	rows, err := db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, table))
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return false
		}
		if name == column {
			return true
		}
	}
	return false
}
