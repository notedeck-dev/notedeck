-- V2: Add uri column to notes_cache for cross-account URI-based lookups.
-- The uri field is extracted from note_json to enable indexed queries.

ALTER TABLE notes_cache ADD COLUMN uri TEXT;

-- Backfill uri from existing JSON data
UPDATE notes_cache
SET uri = json_extract(note_json, '$.uri')
WHERE json_extract(note_json, '$.uri') IS NOT NULL;

-- Partial index: only index rows that have a uri (most local notes don't)
CREATE INDEX IF NOT EXISTS idx_notes_cache_uri
    ON notes_cache(uri) WHERE uri IS NOT NULL;
