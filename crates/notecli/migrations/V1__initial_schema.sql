-- V1: Complete initial schema
-- All statements are idempotent (IF NOT EXISTS) for safe migration of existing databases.

-- Core tables
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    token TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    software TEXT NOT NULL,
    UNIQUE(host, user_id)
);

CREATE TABLE IF NOT EXISTS servers (
    host TEXT PRIMARY KEY,
    software TEXT NOT NULL,
    version TEXT NOT NULL,
    features_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes_cache (
    note_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    server_host TEXT NOT NULL,
    created_at TEXT NOT NULL,
    text TEXT,
    note_json TEXT NOT NULL,
    cached_at INTEGER NOT NULL,
    timeline_type TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (note_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_cache_timeline
    ON notes_cache (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_cache_tl
    ON notes_cache (account_id, timeline_type, created_at DESC);

-- FTS5 trigram index for fast substring search (CJK-friendly)
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    text,
    content='notes_cache',
    content_rowid=rowid,
    tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS notes_fts_ai
    AFTER INSERT ON notes_cache WHEN new.text IS NOT NULL BEGIN
    INSERT INTO notes_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_ad
    AFTER DELETE ON notes_cache WHEN old.text IS NOT NULL BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;

-- Drop legacy index superseded by FTS5
DROP INDEX IF EXISTS idx_notes_cache_text;

-- OGP cache table (with all summaly-compatible columns)
CREATE TABLE IF NOT EXISTS ogp_cache (
    url TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    image TEXT,
    site_name TEXT,
    expires_at INTEGER NOT NULL,
    icon TEXT,
    player_url TEXT,
    player_width INTEGER,
    player_height INTEGER,
    player_allow TEXT,
    final_url TEXT,
    sensitive INTEGER NOT NULL DEFAULT 0,
    medias_json TEXT
);
