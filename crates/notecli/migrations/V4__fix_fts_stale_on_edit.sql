-- V4: ノート編集時に FTS 索引が旧テキストのまま残るバグの修正。
-- これまで upsert が text 列を更新せず、FTS にも AFTER UPDATE トリガが
-- なかったため、編集されたノートは検索で取りこぼされていた。

-- external content FTS5 の delete + insert パターン。
-- FTS 側にエントリが存在するのは text IS NOT NULL の行のみ（V1 の insert
-- トリガの不変条件）で、存在しないエントリへの 'delete' は database corrupt
-- 扱いになるため、INSERT ... SELECT ... WHERE で条件付き実行にする。
-- 2 トリガに分割しないのは発火順が未定義なため（delete → insert の順を保証する）。
CREATE TRIGGER IF NOT EXISTS notes_fts_au
    AFTER UPDATE OF text ON notes_cache BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, text)
        SELECT 'delete', old.rowid, old.text WHERE old.text IS NOT NULL;
    INSERT INTO notes_fts(rowid, text)
        SELECT new.rowid, new.text WHERE new.text IS NOT NULL;
END;

-- 既存 DB では text 列が note_json と乖離している可能性があるため修復する。
-- この UPDATE は上のトリガを発火させ、FTS 索引も追随する。
UPDATE notes_cache
SET text = json_extract(note_json, '$.text')
WHERE json_valid(note_json)
  AND text IS NOT json_extract(note_json, '$.text');
