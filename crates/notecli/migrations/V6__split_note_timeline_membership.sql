-- ノート実体 (notes_cache) とタイムライン所属 (note_timelines) の分離。
-- 設計の正本: https://github.com/notedeck-dev/notecli/issues/30 の仕様 v5。
-- 本 migration は refinery の set_grouped(true) により履歴記録と単一 tx で適用される
-- (非 grouped だと本体コミット後・履歴記録前の kill で再適用が DROP COLUMN で失敗する)。

-- (1) 復元不能な壊れキー行を削除。'' = streaming の antenna/channel/role、
--     'user-list' = streaming の listId 欠落。この 2 種で全て (streaming.rs 書込箇所
--     全数確認済み)。これらはタイムライン読み出しからは不可視。検索・スキャン corpus
--     からは本 DELETE で消える (一時的。V6 以降は正キーで再蓄積)。
DELETE FROM notes_cache WHERE timeline_type IN ('', 'user-list');

-- (2) junction の定石どおり WITHOUT ROWID (autoindex 二重格納の排除。
--     容量 41% 減 — 1.9M 行実測)。
--     sort_key は note.created_at (サーバー由来文字列をそのまま。辞書順=時系列は
--     本家 toISOString 前提)。added_at は unix epoch 秒 (初回ローカル取得時刻)。
CREATE TABLE note_timelines (
    account_id   TEXT NOT NULL,
    timeline_key TEXT NOT NULL,
    note_id      TEXT NOT NULL,
    sort_key     TEXT NOT NULL,
    added_at     INTEGER NOT NULL,
    PRIMARY KEY (account_id, timeline_key, note_id),
    FOREIGN KEY (note_id, account_id)
        REFERENCES notes_cache (note_id, account_id) ON DELETE CASCADE
) WITHOUT ROWID;

-- note_id DESC まで明示: 3 列だと暗黙 PK 残余列が ASC になり tie-break 付き ORDER BY が
-- temp b-tree sort に落ちる (同一 sort_key 50K 行 + LIMIT 10 で 156 倍差を実測)。
-- PK 全列明示のためサイズ増ゼロ、COVERING 維持 (EQP 実測)。
CREATE INDEX idx_note_timelines_order
    ON note_timelines (account_id, timeline_key, sort_key DESC, note_id DESC);

-- CASCADE 性能の必須要件。ただし sqlite_stat1 必須 (本 migration 末尾の ANALYZE /
-- 起動時 PRAGMA optimize が生成。stat1 なしでは planner が本 index を選ばず
-- CASCADE が WITHOUT ROWID PK の prefix スキャンに落ちる — 実測 2000 倍差)。
CREATE INDEX idx_note_timelines_note
    ON note_timelines (note_id, account_id);

INSERT INTO note_timelines (account_id, timeline_key, note_id, sort_key, added_at)
SELECT account_id, timeline_type, note_id, created_at, cached_at
FROM notes_cache;

-- idx_notes_cache_timeline (V1 の account_id+created_at DESC) は search/scan の
-- ORDER BY が使うため残す。DROP するのは timeline_type 系のみ。
DROP INDEX IF EXISTS idx_notes_cache_tl;
ALTER TABLE notes_cache DROP COLUMN timeline_type;

-- stat1 生成 (idx_note_timelines_note を CASCADE の planner に選ばせるための必須要件)
ANALYZE;
